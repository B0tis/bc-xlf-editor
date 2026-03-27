import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { parseXlf } from './xlfParser';
import { mergeXlf } from './xlfMerger';
import { serializeXlf } from './xlfSerializer';
import { MergeOptions, MergeStats, XlfDocument } from './types';
import { MergeEditorProvider } from './mergeEditorProvider';

let lastStats: MergeStats | undefined;

function countTransUnits(content: string): number {
  const m = content.match(/<trans-unit\b/gi);
  return m ? m.length : 0;
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

async function runMerge(baseUri: vscode.Uri, customUri: vscode.Uri): Promise<void> {
  const baseContent = await fs.readFile(baseUri.fsPath, 'utf-8');
  const customContent = await fs.readFile(customUri.fsPath, 'utf-8');
  const n = Math.max(countTransUnits(baseContent), countTransUnits(customContent));

  const work = async (
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> => {
    const report = (message: string) => progress?.report({ message });

    report('Parse Base XLF…');
    const base = await parseXlf(baseContent, (parsed) => {
      if (n > 1000 && parsed % 500 === 0) {
        report(`Base: ${parsed} units geparst…`);
      }
    });

    report('Parse Custom XLF…');
    const custom = await parseXlf(customContent, (parsed) => {
      if (n > 1000 && parsed % 500 === 0) {
        report(`Custom: ${parsed} units geparst…`);
      }
    });

    const config = vscode.workspace.getConfiguration('bcXlf');
    const options: MergeOptions = {
      strategy: config.get('defaultStrategy', 'keep-translated'),
      sortOutput: config.get('sortById', true),
      preserveRemoved: config.get('preserveRemoved', false)
    };

    report('Merge…');
    const result = mergeXlf(base, custom, options);

    report('Serialisiere…');
    const header = buildOutputHeader(base, custom);
    const output = serializeXlf(header, result);

    await fs.writeFile(customUri.fsPath, output, { encoding: 'utf-8' });
    lastStats = result.stats;

    report('Gespeichert.');

    const { stats } = result;
    const msg = `Merge fertig: +${stats.added.length} neu · ${stats.conflicts.length} Konflikte · −${stats.removed.length} entfernt`;

    const openDiff = config.get('openDiffAfterMerge', true);
    if (openDiff) {
      try {
        await vscode.commands.executeCommand('git.openChange', customUri);
      } catch {
        /* Git-Erweiterung nicht aktiv */
      }
    }

    const action = await vscode.window.showInformationMessage(msg, 'Git-Diff öffnen', 'Details');
    if (action === 'Git-Diff öffnen') {
      try {
        await vscode.commands.executeCommand('git.openChange', customUri);
      } catch {
        await vscode.window.showWarningMessage('Git-Diff konnte nicht geöffnet werden.');
      }
    } else if (action === 'Details') {
      await vscode.commands.executeCommand('bcXlf.showSummary');
    }
  };

  if (n > 1000) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'BC XLF Editor',
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
      const baseUri = await pickFile('Base XLF wählen (.g.xlf)');
      if (!baseUri) {
        return;
      }
      const customUri = await pickFile('Custom XLF wählen (Übersetzung)');
      if (!customUri) {
        return;
      }
      await runMerge(baseUri, customUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bcXlf.mergeFromContext', async (uri?: vscode.Uri) => {
      const customUri = uri ?? (await pickFile('Custom XLF wählen (Übersetzung)'));
      if (!customUri) {
        return;
      }
      const baseUri = await pickFile('Base XLF wählen (.g.xlf)');
      if (!baseUri) {
        return;
      }
      await runMerge(baseUri, customUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('bcXlf.showSummary', async () => {
      if (!lastStats) {
        await vscode.window.showInformationMessage('Noch kein Merge in dieser Session ausgeführt.');
        return;
      }
      const s = lastStats;
      const doc = await vscode.workspace.openTextDocument({
        content: [
          'BC XLF Editor — Statistik',
          '',
          `Gesamt: ${s.total}`,
          `Unverändert: ${s.unchanged}`,
          `Neu (nur Base): ${s.added.length}`,
          `Konflikte (Source geändert): ${s.conflicts.length}`,
          `Entfernt (nur Custom): ${s.removed.length}`,
          '',
          '— Neu —',
          ...s.added.map((id) => `  ${id}`),
          '',
          '— Konflikte —',
          ...s.conflicts.map((id) => `  ${id}`),
          '',
          '— Entfernt —',
          ...s.removed.map((id) => `  ${id}`)
        ].join('\n'),
        language: 'plaintext'
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );
}

export function deactivate(): void {}

async function pickFile(title: string): Promise<vscode.Uri | undefined> {
  const result = await vscode.window.showOpenDialog({
    title,
    filters: { 'XLF Files': ['xlf'] },
    canSelectMany: false
  });
  return result?.[0];
}
