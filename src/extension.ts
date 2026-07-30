import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parseXlf, hasGitMergeConflictMarkers } from './xlfParser';
import { mergeXlf } from './xlfMerger';
import { serializeXlf } from './xlfSerializer';
import { applyMergeSurgically } from './xlfSurgicalMerge';
import { listBaseGxlCandidates } from './resolveBaseGxl';
import { MergeOptions, MergeStats, XlfDocument, defaultMergeOptions } from './types';
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

async function formatDocumentIfPossible(uri: vscode.Uri): Promise<boolean> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editorOptions =
      vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString())
        ?.options ?? { tabSize: 2, insertSpaces: true };
    const formattingOptions: vscode.FormattingOptions = {
      tabSize: typeof editorOptions.tabSize === 'number' ? editorOptions.tabSize : 2,
      insertSpaces: editorOptions.insertSpaces !== false
    };
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
      'vscode.executeFormatDocumentProvider',
      uri,
      formattingOptions
    );
    if (!edits?.length) {
      return false;
    }
    const we = new vscode.WorkspaceEdit();
    we.set(uri, edits);
    const applied = await vscode.workspace.applyEdit(we);
    if (applied) {
      await (await vscode.workspace.openTextDocument(uri)).save();
    }
    return applied;
  } catch (e) {
    console.warn('bc-xlf-editor: format after update failed', e);
    return false;
  }
}

/** Ensure the open editor buffer matches `text` after an external disk write. */
async function syncOpenDocumentToText(uri: vscode.Uri, text: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.getText() === text) {
    return;
  }
  const we = new vscode.WorkspaceEdit();
  const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  we.replace(uri, full, text);
  await vscode.workspace.applyEdit(we);
  await doc.save();
}

async function runMerge(baseUri: vscode.Uri, customUri: vscode.Uri): Promise<void> {
  const baseContent = await fs.readFile(baseUri.fsPath, 'utf-8');
  const customContent = await fs.readFile(customUri.fsPath, 'utf-8');
  const n = Math.max(countTransUnits(baseContent), countTransUnits(customContent));

  const runUpdate = async (
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<MergeStats> => {
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

    const options: MergeOptions = defaultMergeOptions({
      strategy: config.get('defaultStrategy', 'keep-translated'),
      sortOutput: config.get('sortById', true),
      preserveRemoved: config.get('preserveRemoved', false),
      findByXliffGeneratorNoteAndSource: config.get('findByXliffGeneratorNoteAndSource', true),
      findByXliffGeneratorAndDeveloperNote: config.get(
        'findByXliffGeneratorAndDeveloperNote',
        true
      ),
      findByXliffGeneratorNote: config.get('findByXliffGeneratorNote', true),
      findBySourceAndDeveloperNote: config.get('findBySourceAndDeveloperNote', false),
      findBySource: config.get('findBySource', false),
      parseFromDeveloperNote: config.get('parseFromDeveloperNote', false),
      parseFromDeveloperNoteOverwrite: config.get('parseFromDeveloperNoteOverwrite', false),
      parseFromDeveloperNoteSeparator: config.get('parseFromDeveloperNoteSeparator', '|'),
      parseFromDeveloperNoteTrimCharacters: config.get('parseFromDeveloperNoteTrimCharacters', ''),
      copyFromSourceForSameLanguage: config.get('copyFromSourceForSameLanguage', false),
      copyFromSourceForLanguages: config.get('copyFromSourceForLanguages', []),
      copyFromSourceOverwrite: config.get('copyFromSourceOverwrite', false),
      detectSourceTextChanges: config.get('detectSourceTextChanges', true),
      ignoreLineEndingTypeChanges: config.get('ignoreLineEndingTypeChanges', false),
      missingTranslation: config.get('missingTranslation', ''),
      addNeedsWorkTranslationNote: config.get('addNeedsWorkTranslationNote', true)
    });

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

    if (config.get('formatAfterUpdate', false)) {
      report(l10n.t('Format translation file…'));
      await syncOpenDocumentToText(customUri, output);
      const formatted = await formatDocumentIfPossible(customUri);
      if (!formatted) {
        console.warn(
          'bc-xlf-editor: formatAfterUpdate is on but no format edits were applied (install an XML formatter?).'
        );
      }
    }

    return result.stats;
  };

  const stats =
    n > 1000
      ? await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('BC XLF Editor'),
            cancellable: false
          },
          async (progress) => runUpdate(progress)
        )
      : await runUpdate();

  const config = vscode.workspace.getConfiguration('bcXlf');
  const msg = l10n.t(
    'Update complete: +{0} new · {1} rematched · {2} source changes · −{3} removed',
    stats.added.length,
    stats.remapped.length,
    stats.conflicts.length,
    stats.removed.length
  );

  if (config.get('openDiffAfterMerge', true)) {
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
          l10n.t('Rematched (id changed): {0}', s.remapped.length),
          l10n.t('Conflicts (source changed): {0}', s.conflicts.length),
          l10n.t('Removed (custom only): {0}', s.removed.length),
          '',
          l10n.t('— New —'),
          ...s.added.map((id) => `  ${id}`),
          '',
          l10n.t('— Rematched —'),
          ...s.remapped.map((r) => `  ${r.fromId} → ${r.toId}`),
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
