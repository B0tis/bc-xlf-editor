import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  applyAllGitConflictResolutions,
  applyGitConflictResolution,
  hasGitMergeConflictMarkers,
  parseXlf
} from './xlfParser';
import { serializeXlf } from './xlfSerializer';
import type { MergeResult, TargetState, TransUnit, XlfDocument } from './types';

const TARGET_STATES: readonly TargetState[] = [
  'translated',
  'needs-translation',
  'needs-review-translation',
  'needs-adaptation',
  'final'
] as const;

function cloneXlf(doc: XlfDocument): XlfDocument {
  const units = new Map<string, TransUnit>();
  for (const [k, v] of doc.units) {
    units.set(k, { ...v });
  }
  return {
    sourceLanguage: doc.sourceLanguage,
    targetLanguage: doc.targetLanguage,
    original: doc.original,
    datatype: doc.datatype,
    units,
    orderedIds: [...doc.orderedIds]
  };
}

function asMergeResult(doc: XlfDocument): MergeResult {
  return {
    units: doc.units,
    orderedIds: doc.orderedIds,
    stats: {
      total: doc.units.size,
      added: [],
      removed: [],
      conflicts: [],
      unchanged: doc.units.size
    }
  };
}

function parseTargetState(value: unknown): TargetState | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return (TARGET_STATES as readonly string[]).includes(value) ? (value as TargetState) : undefined;
}

function positionAtOffset(text: string, offset: number): vscode.Position {
  const safe = Math.min(Math.max(0, offset), text.length);
  const head = text.slice(0, safe);
  const parts = head.split(/\r\n|\n|\r/);
  const line = parts.length - 1;
  const character = parts[parts.length - 1].length;
  return new vscode.Position(line, character);
}

function unescapeAlSingleQuotedInner(s: string): string {
  return s.replace(/''/g, "'");
}

/**
 * BC XLF property values are single-quoted AL literals (`'` escaped as `''`).
 * Returns empty string if the line is not exactly one quoted literal (after trim / optional `;`).
 */
function stripSingleQuotedAlLiteral(line: string): string {
  const t = line.trim().replace(/;\s*$/, '').trim();
  const m = t.match(/^'((?:''|[^'])*)'$/);
  if (m) {
    return unescapeAlSingleQuotedInner(m[1]);
  }
  return '';
}

const PROP_HEAD = /^\s*(Caption|ToolTip|Tooltip|Label)\s*=/i;

/**
 * BC `<source>` may be a block of Caption / ToolTip / Label lines (`= '…'` or `=` then `'…'` on the next line).
 * Values are always single-quoted; extract inner text for AL search.
 */
function extractPropertyLiteralsFromXlfSource(source: string): string[] {
  const text = source.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(Caption|ToolTip|Tooltip|Label)\s*=\s*(.*)$/i);
    if (!m) {
      continue;
    }
    let rest = m[2] ?? '';
    rest = rest.trim();
    if (rest.length > 0) {
      const inner = stripSingleQuotedAlLiteral(rest);
      if (inner.length >= 1) {
        out.push(inner);
      }
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next === '') {
        continue;
      }
      if (PROP_HEAD.test(next)) {
        break;
      }
      const inner = stripSingleQuotedAlLiteral(next);
      if (inner.length >= 1) {
        out.push(inner);
      }
      break;
    }
  }
  return out;
}

function isJunkSourceFirstLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 2) {
    return true;
  }
  if (PROP_HEAD.test(t) && !/=\s*\S/.test(t)) {
    return true;
  }
  return false;
}

/**
 * BC xliff trans-unit ids are hashes (e.g. "Table 212484631 - Field …"); they do not appear in AL.
 * Jump-to-AL searches AL file text, like NAB's "Find source of current Translation Unit" (F12 in XLF):
 * the compiler emits the development-language string into `<source>`; AL almost always contains that literal.
 * NAB's "Find translated texts of current line" is the inverse (AL → XLF). When code still contains a
 * localized literal (legacy / non-ENU), also try `<target>` so we can jump from translation back to AL.
 */
function buildAlSearchNeedles(source: string, xliffNote?: string, target?: string): string[] {
  const needles: string[] = [];
  const extracted = extractPropertyLiteralsFromXlfSource(source);
  extracted.sort((a, b) => b.length - a.length);
  needles.push(...extracted);

  const lines = source.trim().split(/\r?\n/);
  const firstLineSource = lines[0]?.slice(0, 500) ?? '';
  if (!extracted.length && firstLineSource.length >= 2 && !isJunkSourceFirstLine(firstLineSource)) {
    needles.push(firstLineSource.trim());
  }

  const tgt = target?.trim() ?? '';
  const extractedTarget = tgt ? extractPropertyLiteralsFromXlfSource(tgt) : [];
  extractedTarget.sort((a, b) => b.length - a.length);
  needles.push(...extractedTarget);

  const firstLineTarget = tgt.split(/\r?\n/)[0]?.slice(0, 500) ?? '';
  if (
    firstLineTarget.length >= 2 &&
    firstLineTarget.toLowerCase() !== firstLineSource.toLowerCase() &&
    !extractedTarget.length &&
    !isJunkSourceFirstLine(firstLineTarget)
  ) {
    needles.push(firstLineTarget);
  }
  const n = xliffNote?.trim();
  if (n) {
    const t = n.match(/^Table\s+(.+?)\s+-\s+Field\s+/i);
    if (t?.[1]) {
      needles.push(t[1].trim());
    }
    const p = n.match(/^Page\s+(.+?)\s+-\s+Control\s+/i);
    if (p?.[1]) {
      needles.push(p[1].trim());
    }
    const r = n.match(/^Report\s+(.+?)\s+-\s+/i);
    if (r?.[1]) {
      needles.push(r[1].trim());
    }
    /** Table/Page property captions (no Field segment) — e.g. "Table BBE DEV Setup - Property Caption" */
    const tProp = n.match(/^Table\s+(.+?)\s+-\s+Property\b/i);
    if (tProp?.[1]) {
      needles.push(tProp[1].trim());
    }
    const pProp = n.match(/^Page\s+(.+?)\s+-\s+Property\b/i);
    if (pProp?.[1]) {
      needles.push(pProp[1].trim());
    }
    const pEx = n.match(/^PageExtension\s+(.+?)\s+-\s+Action\s+/i);
    if (pEx?.[1]) {
      needles.push(pEx[1].trim());
    }
    const q = n.match(/^Query\s+(.+?)\s+-\s+/i);
    if (q?.[1]) {
      needles.push(q[1].trim());
    }
    const xml = n.match(/^XmlPort\s+(.+?)\s+-\s+/i);
    if (xml?.[1]) {
      needles.push(xml[1].trim());
    }
    const code = n.match(/^Codeunit\s+(.+?)\s+-\s+/i);
    if (code?.[1]) {
      needles.push(code[1].trim());
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of needles) {
    const k = s.toLowerCase();
    if (s.length < 2 || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Tokens from the Xliff Generator note used to prefer AL files (path) when several contain the same literal. */
function buildAlNotePathHints(xliffNote?: string): string[] {
  const n = xliffNote?.trim();
  if (!n) {
    return [];
  }
  const hints: string[] = [];
  const push = (s: string | undefined): void => {
    const t = s?.trim();
    if (t && t.length >= 2) {
      hints.push(t);
    }
  };
  push(n.match(/^Table\s+(.+?)\s+-\s+(?:Field|Property)\b/i)?.[1]);
  push(n.match(/^Page\s+(.+?)\s+-\s+(?:Control|Property)\b/i)?.[1]);
  push(n.match(/^PageExtension\s+(.+?)\s+-\s+Action\s+/i)?.[1]);
  push(n.match(/^Report\s+(.+?)\s+-\s+/i)?.[1]);
  push(n.match(/^Query\s+(.+?)\s+-\s+/i)?.[1]);
  push(n.match(/^XmlPort\s+(.+?)\s+-\s+/i)?.[1]);
  push(n.match(/^Codeunit\s+(.+?)\s+-\s+/i)?.[1]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hints) {
    const k = h.toLowerCase();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(h);
  }
  return out;
}

function scoreAlPathForHints(fsPath: string, hints: string[]): number {
  if (hints.length === 0) {
    return 0;
  }
  const norm = fsPath.toLowerCase().replace(/\\/g, '/');
  let score = 0;
  for (const h of hints) {
    const compact = h.toLowerCase().replace(/\s+/g, '');
    const dashed = h.toLowerCase().replace(/\s+/g, '-');
    if (compact.length >= 3 && norm.includes(compact)) {
      score += 3;
    } else if (dashed.length >= 3 && norm.includes(dashed)) {
      score += 2;
    } else if (h.length >= 4 && norm.includes(h.toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

const AL_GLOB = '**/*.al';
const AL_EXCLUDE = '**/node_modules/**';
/** Upper bound for workspace file discovery — avoids missing AL when the project has many .al files. */
const AL_MAX_FILES_TO_SCAN = 200_000;
/** Max distinct AL locations offered when many files contain the same caption. */
const AL_MAX_MATCHES = 48;

/** AL single-quoted literal: apostrophe doubled inside (`''`). Captions / ToolTip / Label use only this form. */
function escapeAlSingleQuotedContent(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Match only a complete AL single-quoted literal (`'…'`), not a substring (e.g. avoid matching
 * `BBE DEV Setup` inside `'BBE DEV Setup Mgt.'`).
 */
function findStrictAlLiteralNeedleOffset(text: string, needle: string): number {
  if (!needle) {
    return -1;
  }
  const open = "'";
  const close = "'";
  const escape = escapeAlSingleQuotedContent;
  const pattern = open + escape(needle) + close;
  let i = text.indexOf(pattern);
  if (i >= 0) {
    return i + open.length;
  }
  const tl = text.toLowerCase();
  const pl = pattern.toLowerCase();
  i = tl.indexOf(pl);
  if (i >= 0) {
    return i + open.length;
  }
  return -1;
}

/**
 * Cursor positions must be derived from {@link vscode.TextDocument#getText} — VS Code normalizes line endings;
 * offsets from raw `fs.readFile` buffers can be invalid and break navigation silently.
 */
async function openAlAtNeedle(uri: vscode.Uri, needle: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const idx = findStrictAlLiteralNeedleOffset(text, needle);
  if (idx < 0) {
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    await vscode.window.showWarningMessage(
      'Found this AL file while scanning but could not re-locate the text in the editor (encoding or line endings). Try Search or a shorter caption.'
    );
    return;
  }
  const pos = doc.positionAt(idx);
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(pos, pos),
    viewColumn: vscode.ViewColumn.Beside
  });
}

async function findAlMatchesByScan(
  needles: string[],
  xliffNote?: string
): Promise<Array<{ uri: vscode.Uri; needle: string; previewLine: number; previewCol: number }>> {
  if (needles.length === 0) {
    return [];
  }
  const pathHints = buildAlNotePathHints(xliffNote);
  const uris = await vscode.workspace.findFiles(AL_GLOB, AL_EXCLUDE, AL_MAX_FILES_TO_SCAN);
  const sortedUris = [...uris].sort((a, b) => {
    const sa = scoreAlPathForHints(a.fsPath, pathHints);
    const sb = scoreAlPathForHints(b.fsPath, pathHints);
    if (sb !== sa) {
      return sb - sa;
    }
    return a.fsPath.localeCompare(b.fsPath);
  });

  for (const needle of needles) {
    const batch: Array<{
      uri: vscode.Uri;
      needle: string;
      previewLine: number;
      previewCol: number;
      pathScore: number;
    }> = [];
    for (const uri of sortedUris) {
      if (batch.length >= AL_MAX_MATCHES) {
        break;
      }
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(uri);
      } catch {
        continue;
      }
      const text = Buffer.from(bytes).toString('utf8');
      const idx = findStrictAlLiteralNeedleOffset(text, needle);
      if (idx >= 0) {
        const pos = positionAtOffset(text, idx);
        batch.push({
          uri,
          needle,
          previewLine: pos.line + 1,
          previewCol: pos.character + 1,
          pathScore: scoreAlPathForHints(uri.fsPath, pathHints)
        });
      }
    }
    if (batch.length > 0) {
      batch.sort((a, b) => {
        if (b.pathScore !== a.pathScore) {
          return b.pathScore - a.pathScore;
        }
        return a.uri.fsPath.localeCompare(b.uri.fsPath);
      });
      return batch.map(({ uri, needle: ndl, previewLine, previewCol }) => ({
        uri,
        needle: ndl,
        previewLine,
        previewCol
      }));
    }
  }
  return [];
}

async function goToAlSource(source: string, xliffNote?: string, target?: string): Promise<void> {
  try {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      await vscode.window.showInformationMessage('Open a workspace to search AL files.');
      return;
    }
    const needles = buildAlSearchNeedles(source, xliffNote, target);
    if (needles.length === 0) {
      await vscode.window.showWarningMessage('Nothing to search (empty source).');
      return;
    }
    const matches = await findAlMatchesByScan(needles, xliffNote);
    if (matches.length === 0) {
      const primary = needles[0] ?? '';
      await vscode.commands.executeCommand('workbench.action.findInFiles', {
        query: primary,
        isRegex: false,
        triggerSearch: true,
        filesToInclude: '**/*.al'
      });
      await vscode.window.showInformationMessage(
        'No matching single-quoted caption in scanned AL files (substrings are ignored). Opened Search — try the Xliff Generator note or a shorter phrase.'
      );
      return;
    }
    if (matches.length === 1) {
      await openAlAtNeedle(matches[0].uri, matches[0].needle);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      matches.map((m) => ({
        label: vscode.workspace.asRelativePath(m.uri),
        description: `${m.previewLine}:${m.previewCol}`,
        m
      })),
      { placeHolder: 'Multiple AL matches — pick one' }
    );
    if (picked) {
      await openAlAtNeedle(picked.m.uri, picked.m.needle);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(`Jump to AL failed: ${msg}`);
  }
}

function escapeXmlAttrValue(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function revealTransUnitInTextEditor(document: vscode.TextDocument, id: string): Promise<void> {
  const text = document.getText();
  const escapedId = escapeXmlAttrValue(id);
  const needles = [`id="${escapedId}"`, `id="${id}"`];
  let idx = -1;
  for (const needle of needles) {
    idx = text.indexOf(needle);
    if (idx >= 0) {
      break;
    }
  }
  if (idx < 0) {
    await vscode.window.showWarningMessage(
      'Could not find this trans-unit in the XML. If the file changed on disk, reload the editor.'
    );
    return;
  }
  const pos = document.positionAt(idx);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    selection: new vscode.Selection(pos, pos)
  });
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

export class MergeEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'bcXlf.mergeEditor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
      ]
    };

    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'mergeEditor.js')
    );

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, scriptUri);

    let working: XlfDocument | null = null;
    let applyingEdit = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let applyQueue: Promise<void> = Promise.resolve();
    /** Skip document-driven refresh right after we rewrote the buffer (avoids list flicker / focus loss). */
    let ignoreDocRefreshUntil = 0;

    const applyWorkingToDocument = async (): Promise<void> => {
      if (!working) {
        return;
      }
      if (hasGitMergeConflictMarkers(document.getText())) {
        void vscode.window.showWarningMessage(
          'Resolve all Git merge conflicts in the panel above before editing other trans-units.'
        );
        return;
      }
      const content = serializeXlf(working, asMergeResult(working));
      const endPos = document.positionAt(document.getText().length);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), endPos), content);
      applyingEdit = true;
      try {
        await vscode.workspace.applyEdit(edit);
        ignoreDocRefreshUntil = Date.now() + 900;
      } finally {
        applyingEdit = false;
      }
    };

    const enqueueApply = (fn: () => Promise<void>): void => {
      applyQueue = applyQueue.then(fn).catch((err) => {
        console.error(err);
        void vscode.window.showErrorMessage(`XLF update failed: ${String(err)}`);
      });
    };

    const replaceDocumentAndSave = async (nextContent: string): Promise<void> => {
      const cur = document.getText();
      if (cur === nextContent) {
        return;
      }
      const endPos = document.positionAt(cur.length);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), endPos), nextContent);
      applyingEdit = true;
      try {
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
          throw new Error('Could not apply edit to the document.');
        }
        await vscode.workspace.save(document.uri);
        ignoreDocRefreshUntil = Date.now() + 900;
      } finally {
        applyingEdit = false;
      }
      await enqueueSendUnits();
    };

    let sendUnitsChain: Promise<void> = Promise.resolve();

    const runSendUnits = async (): Promise<void> => {
      webviewPanel.webview.postMessage({
        type: 'loading',
        message: 'Parsing XLF…'
      });
      const text = document.getText();
      try {
        const { document: doc, gitConflicts } = await parseXlf(text, (n) => {
          if (n % 2000 === 0) {
            webviewPanel.webview.postMessage({
              type: 'loading',
              message: `Parsing… ${n} units`
            });
          }
        });
        working = cloneXlf(doc);

        const rows: Array<{
          id: string;
          source: string;
          target: string;
          targetState: string;
          note: string;
        }> = [];
        for (const id of doc.orderedIds) {
          const u = doc.units.get(id);
          if (!u) {
            continue;
          }
          rows.push({
            id: u.id,
            source: u.source,
            target: u.target,
            targetState: u.targetState,
            note: u.note ?? ''
          });
        }

        webviewPanel.webview.postMessage({
          type: 'units',
          units: rows,
          states: [...TARGET_STATES],
          gitConflicts,
          editingLocked: gitConflicts.length > 0
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        webviewPanel.webview.postMessage({
          type: 'parseError',
          message: msg
        });
        void vscode.window.showErrorMessage(`BC XLF: ${msg}`);
      }
    };

    const enqueueSendUnits = (): Promise<void> => {
      const next = sendUnitsChain.then(() => runSendUnits());
      sendUnitsChain = next.catch((err) => {
        console.error(err);
      });
      return next;
    };

    const scheduleRefreshFromDocument = (): void => {
      if (applyingEdit || Date.now() < ignoreDocRefreshUntil) {
        return;
      }
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        void enqueueSendUnits();
      }, 350);
    };

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        void enqueueSendUnits();
        return;
      }
      if (msg?.type === 'resolveGitConflict') {
        const idx = typeof msg.index === 'number' ? msg.index : -1;
        const side = msg.side === 'theirs' || msg.side === 'ours' ? msg.side : undefined;
        if (idx < 0 || !side) {
          return;
        }
        enqueueApply(async () => {
          try {
            const fullText = document.getText();
            const next = applyGitConflictResolution(fullText, idx, side);
            await replaceDocumentAndSave(next);
          } catch (e) {
            void vscode.window.showErrorMessage(
              e instanceof Error ? e.message : String(e)
            );
          }
        });
        return;
      }
      if (msg?.type === 'resolveAllGitConflicts') {
        const side = msg.side === 'theirs' || msg.side === 'ours' ? msg.side : undefined;
        if (!side) {
          return;
        }
        enqueueApply(async () => {
          try {
            const fullText = document.getText();
            const next = applyAllGitConflictResolutions(fullText, side);
            await replaceDocumentAndSave(next);
          } catch (e) {
            void vscode.window.showErrorMessage(
              e instanceof Error ? e.message : String(e)
            );
          }
        });
        return;
      }
      if (msg?.type === 'updateUnit' && working) {
        if (hasGitMergeConflictMarkers(document.getText())) {
          return;
        }
        const id = typeof msg.id === 'string' ? msg.id : '';
        const unit = id ? working.units.get(id) : undefined;
        if (!unit) {
          return;
        }
        const nextState = parseTargetState(msg.targetState) ?? unit.targetState;
        const nextTarget = typeof msg.target === 'string' ? msg.target : unit.target;
        working.units.set(id, {
          ...unit,
          target: nextTarget,
          targetState: nextState
        });
        enqueueApply(applyWorkingToDocument);
        return;
      }
      if (msg?.type === 'goToAlSource' && typeof msg.source === 'string') {
        const xliffNote = typeof msg.xliffNote === 'string' ? msg.xliffNote : undefined;
        const tgt = typeof msg.target === 'string' ? msg.target : undefined;
        void goToAlSource(msg.source, xliffNote, tgt);
        return;
      }
      if (msg?.type === 'revealInXlf' && typeof msg.id === 'string') {
        void revealTransUnitInTextEditor(document, msg.id);
      }
    });

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      scheduleRefreshFromDocument();
    });
    webviewPanel.onDidDispose(() => {
      sub.dispose();
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
      }
    });
  }

  private static mergeEditorHtmlTemplate: string | null = null;

  private getHtml(webview: vscode.Webview, scriptUri: vscode.Uri): string {
    if (!MergeEditorProvider.mergeEditorHtmlTemplate) {
      const htmlPath = path.join(this.context.extensionPath, 'webview', 'mergeEditor.html');
      MergeEditorProvider.mergeEditorHtmlTemplate = fs.readFileSync(htmlPath, 'utf8');
    }
    const raw = MergeEditorProvider.mergeEditorHtmlTemplate;
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`
    ].join('; ');
    return raw.replace('{{CSP}}', csp).replace('{{SCRIPT_URI}}', scriptUri.toString());
  }
}
