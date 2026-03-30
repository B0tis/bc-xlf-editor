import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parseXlf, hasGitMergeConflictMarkers } from './xlfParser';
import { mergeXlf } from './xlfMerger';
import { serializeXlf } from './xlfSerializer';
import { applyMergeSurgically } from './xlfSurgicalMerge';
import { listBaseGxlCandidates } from './resolveBaseGxl';
import { MergeOptions, MergeStats, XlfDocument } from './types';
import { MergeEditorProvider } from './mergeEditorProvider';

const l10n = vscode.l10n;

const SECRET_DEEPL_KEY = 'bcXlf.deeplApiKey';

let lastStats: MergeStats | undefined;

function countTransUnits(content: string): number {
  const re = /<trans-unit\b/gi;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    n++;
  }
  return n;
}

function buildOutputHeader(base: XlfDocument, custom: XlfDocument): XlfDocument {
  return {
    sourceLanguage: base.sourceLanguage,
    targetLanguage: custom.targetLanguage,
    original: custom.original || base.original,
    datatype: base.datatype || custom.datatype,
    units: base.units,
    orderedIds: base.orderedIds
  };
}

async function pickFile(title: string, defaultUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const result = await vscode.window.showOpenDialog({
    title,
    filters: { [l10n.t('XLF files')]: ['xlf'] },
    canSelectMany: false,
    defaultUri
  });
  return result?.[0];
}

async function runMerge(baseUri: vscode.Uri, customUri: vscode.Uri): Promise<void> {
  const baseContent = await fs.readFile(baseUri.fsPath, 'utf-8');
  const customContent = await fs.readFile(customUri.fsPath, 'utf-8');
  const n = Math.max(countTransUnits(baseContent), countTransUnits(customContent));

  const work = async (
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> => {
    const report = (message: string) => progress?.report({ message });

    const config = vscode.workspace.getConfiguration('bcXlf');

    report(l10n.t('Parse base XLF…'));
    const { document: base } = await parseXlf(
      baseContent,
      (parsed) => {
        if (n > 1000 && parsed % 500 === 0) {
          report(l10n.t('Base: {0} units parsed…', parsed));
        }
      },
      { forceFullParse: true }
    );

    report(l10n.t('Parse custom XLF…'));
    const { document: custom } = await parseXlf(
      customContent,
      (parsed) => {
        if (n > 1000 && parsed % 500 === 0) {
          report(l10n.t('Custom: {0} units parsed…', parsed));
        }
      },
      { forceFullParse: true }
    );

    const options: MergeOptions = {
      strategy: config.get('defaultStrategy', 'keep-translated'),
      sortOutput: config.get('sortById', true),
      preserveRemoved: config.get('preserveRemoved', false)
    };

    report(l10n.t('Update translation…'));
    const result = mergeXlf(base, custom, options);

    report(l10n.t('Write translation file…'));
    const header = buildOutputHeader(base, custom);
    const surgical =
      config.get('surgicalMerge', true) && !hasGitMergeConflictMarkers(customContent);
    let output: string;
    if (surgical) {
      try {
        output = applyMergeSurgically(customContent, custom, result, result.stats, options, header);
      } catch (e) {
        console.warn('bc-xlf-editor: surgical merge failed, using full serialize', e);
        output = serializeXlf(header, result);
      }
    } else {
      output = serializeXlf(header, result);
    }

    await fs.writeFile(customUri.fsPath, output, { encoding: 'utf-8' });
    lastStats = result.stats;

    report(l10n.t('Saved.'));

    const { stats } = result;
    const msg = l10n.t(
      'Update complete: +{0} new · {1} source changes · −{2} removed',
      stats.added.length,
      stats.conflicts.length,
      stats.removed.length
    );

    const openDiff = config.get('openDiffAfterMerge', true);
    if (openDiff) {
      try {
        await vscode.commands.executeCommand('git.openChange', customUri);
      } catch {
        /* Git extension not active */
      }
    }

    const labelOpenDiff = l10n.t('Open Git diff');
    const labelDetails = l10n.t('Details');
    const action = await vscode.window.showInformationMessage(msg, labelOpenDiff, labelDetails);
    if (action === labelOpenDiff) {
      try {
        await vscode.commands.executeCommand('git.openChange', customUri);
      } catch {
        await vscode.window.showWarningMessage(l10n.t('Could not open Git diff.'));
      }
    } else if (action === labelDetails) {
      await vscode.commands.executeCommand('bcXlf.showSummary');
    }
  };

  if (n > 1000) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: l10n.t('BC XLF Editor'),
        cancellable: false
      },
      async (progress) => {
        await work(progress);
      }
    );
  } else {
    await work();
  }
}

async function resolveBaseWithOptionalPick(
  customUri: vscode.Uri,
  customContent: string
): Promise<vscode.Uri | undefined> {
  const candidates = await listBaseGxlCandidates(customUri, customContent);
  const dir = vscode.Uri.file(path.dirname(customUri.fsPath));
  if (candidates.length === 0) {
    return pickFile(l10n.t('Pick base XLF (.g.xlf)'), dir);
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  type PickItem = { label: string; description: string; uri: vscode.Uri };
  const picked = await vscode.window.showQuickPick<PickItem>(
    candidates.map((u) => ({
      label: path.basename(u.fsPath),
      description: u.fsPath,
      uri: u
    })),
    { placeHolder: l10n.t('Pick base .g.xlf') }
  );
  return picked?.uri;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      MergeEditorProvider.viewType,
      new MergeEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bcXlf.merge', async () => {
      const customUri = await pickFile(l10n.t('Pick translation XLF (not .g.xlf)'));
      if (!customUri) {
        return;
      }
      const customContent = await fs.readFile(customUri.fsPath, 'utf-8');
      const baseUri = await resolveBaseWithOptionalPick(customUri, customContent);
      if (!baseUri) {
        return;
      }
      await runMerge(baseUri, customUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bcXlf.mergeFromContext', async (uri?: vscode.Uri) => {
      const customUri = uri ?? (await pickFile(l10n.t('Pick translation XLF (not .g.xlf)')));
      if (!customUri) {
        return;
      }
      const customContent = await fs.readFile(customUri.fsPath, 'utf-8');
      const baseUri = await resolveBaseWithOptionalPick(customUri, customContent);
      if (!baseUri) {
        return;
      }
      await runMerge(baseUri, customUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bcXlf.showSummary', async () => {
      if (!lastStats) {
        await vscode.window.showInformationMessage(
          l10n.t('No update has been run in this session yet.')
        );
        return;
      }
      const s = lastStats;
      const doc = await vscode.workspace.openTextDocument({
        content: [
          l10n.t('BC XLF Editor — statistics'),
          '',
          l10n.t('Total: {0}', s.total),
          l10n.t('Unchanged: {0}', s.unchanged),
          l10n.t('New (base only): {0}', s.added.length),
          l10n.t('Conflicts (source changed): {0}', s.conflicts.length),
          l10n.t('Removed (custom only): {0}', s.removed.length),
          '',
          l10n.t('— New —'),
          ...s.added.map((id) => `  ${id}`),
          '',
          l10n.t('— Conflicts —'),
          ...s.conflicts.map((id) => `  ${id}`),
          '',
          l10n.t('— Removed —'),
          ...s.removed.map((id) => `  ${id}`)
        ].join('\n'),
        language: 'plaintext'
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bcXlf.setDeepLApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: l10n.t('DeepL API key'),
        prompt: l10n.t('Paste your DeepL API authentication key.'),
        password: true,
        ignoreFocusOut: true
      });
      if (key?.trim()) {
        await context.secrets.store(SECRET_DEEPL_KEY, key.trim());
        await vscode.window.showInformationMessage(l10n.t('DeepL API key stored.'));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bcXlf.clearDeepLApiKey', async () => {
      await context.secrets.delete(SECRET_DEEPL_KEY);
      await vscode.window.showInformationMessage(l10n.t('DeepL API key removed.'));
    })
  );
}

export function deactivate(): void {}
