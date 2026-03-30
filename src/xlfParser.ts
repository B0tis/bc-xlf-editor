import * as sax from 'sax';
import { TransUnit, XlfDocument, TargetState } from './types';

const PROGRESS_INTERVAL = 500;
const CHUNK_SIZE = 65536;

/** Standard Git merge conflict: <<<<<<< … / ======= / >>>>>>> */
const GIT_CONFLICT_BLOCK =
  /^<<<<<<< .*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> .*\r?\n/gm;

const TRANS_UNIT_OPEN = /<trans-unit\b[^>]*\bid="([^"]+)"/g;

export type GitConflictSideChoice = 'ours' | 'theirs';

/** One parsed side of a conflict (fragment inside trans-unit). */
export interface ParsedConflictSide {
  source: string;
  target: string;
  targetState: string;
}

/** Full region for applying a resolution back into the file buffer. */
export interface GitConflictRegion {
  index: number;
  start: number;
  end: number;
  oursRaw: string;
  theirsRaw: string;
  transUnitId: string;
  ours: ParsedConflictSide;
  theirs: ParsedConflictSide;
}

/** Payload for the webview merge panel (no byte offsets). */
export interface GitConflictForWebview {
  index: number;
  transUnitId: string;
  ours: ParsedConflictSide;
  theirs: ParsedConflictSide;
}

export interface ParseXlfResult {
  document: XlfDocument;
  gitConflicts: GitConflictForWebview[];
}

/**
 * Replaces Git merge conflict regions with one side so the result is valid XML.
 * Raw conflict markers are not valid XML (bare `<` in `<<<<<<<` breaks SAX).
 */
export function stripGitMergeConflictMarkers(
  content: string,
  prefer: GitConflictSideChoice
): { text: string; blocks: number } {
  let blocks = 0;
  const text = content.replace(GIT_CONFLICT_BLOCK, (_full, ours: string, theirs: string) => {
    blocks++;
    return prefer === 'ours' ? ours : theirs;
  });
  return { text, blocks };
}

/** Positions of `<trans-unit id="…">` open tags for O(log n) lookup by byte offset. */
function buildTransUnitIdIndex(content: string): Array<{ pos: number; id: string }> {
  const out: Array<{ pos: number; id: string }> = [];
  const re = new RegExp(TRANS_UNIT_OPEN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({ pos: m.index, id: m[1] });
  }
  return out;
}

/** Last trans-unit id whose open tag starts strictly before `offset`. */
function transUnitIdBeforeOffset(index: Array<{ pos: number; id: string }>, offset: number): string | undefined {
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid].pos < offset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo > 0 ? index[lo - 1].id : undefined;
}

/**
 * True if the buffer may contain Git conflict markers (cheap scan before full regex analysis).
 */
export function hasGitMergeConflictMarkers(content: string): boolean {
  return content.includes('<<<<<<<');
}

/**
 * Best-effort parse of &lt;source&gt; / &lt;target&gt; inside a conflict fragment.
 */
export function parseConflictSideFragment(fragment: string): ParsedConflictSide {
  const sourceMatch = fragment.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
  const targetMatch = fragment.match(/<target\b([^>]*)>([\s\S]*?)<\/target>/i);
  const source = sourceMatch ? sourceMatch[1] : '';
  let target = '';
  let targetState = 'needs-translation';
  if (targetMatch) {
    target = targetMatch[2];
    const st = /(?:^|\s)state\s*=\s*"([^"]*)"/i.exec(targetMatch[1]);
    if (st) {
      targetState = st[1];
    }
  }
  return { source, target, targetState };
}

/**
 * Finds all Git conflict blocks and parses both sides for the merge UI.
 */
export function analyzeGitConflicts(content: string): GitConflictRegion[] {
  const tuIndex = buildTransUnitIdIndex(content);
  const re = new RegExp(GIT_CONFLICT_BLOCK.source, GIT_CONFLICT_BLOCK.flags);
  const out: GitConflictRegion[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(content)) !== null) {
    const full = m[0];
    const oursRaw = m[1];
    const theirsRaw = m[2];
    const start = m.index;
    const end = start + full.length;
    const transUnitId = transUnitIdBeforeOffset(tuIndex, start) ?? `unknown-${index}`;
    out.push({
      index,
      start,
      end,
      oursRaw,
      theirsRaw,
      transUnitId,
      ours: parseConflictSideFragment(oursRaw),
      theirs: parseConflictSideFragment(theirsRaw)
    });
    index++;
  }
  return out;
}

export function gitConflictsToWebPayload(regions: GitConflictRegion[]): GitConflictForWebview[] {
  return regions.map((r) => ({
    index: r.index,
    transUnitId: r.transUnitId,
    ours: r.ours,
    theirs: r.theirs
  }));
}

/**
 * Replaces one conflict block with the chosen side (raw XML fragment, same indentation as in the conflict).
 */
export function applyGitConflictResolution(
  fullText: string,
  conflictIndex: number,
  side: GitConflictSideChoice
): string {
  const regions = analyzeGitConflicts(fullText);
  const r = regions[conflictIndex];
  if (!r) {
    throw new Error(`No Git conflict at index ${conflictIndex}.`);
  }
  const pick = side === 'ours' ? r.oursRaw : r.theirsRaw;
  return fullText.slice(0, r.start) + pick + fullText.slice(r.end);
}

/**
 * Resolves every conflict using the same side in one pass (regions applied last → first so offsets stay valid).
 */
export function applyAllGitConflictResolutions(
  fullText: string,
  side: GitConflictSideChoice
): string {
  const regions = analyzeGitConflicts(fullText);
  if (regions.length === 0) {
    return fullText;
  }
  const sorted = [...regions].sort((a, b) => b.start - a.start);
  let text = fullText;
  for (const r of sorted) {
    const pick = side === 'ours' ? r.oursRaw : r.theirsRaw;
    text = text.slice(0, r.start) + pick + text.slice(r.end);
  }
  return text;
}

function hasUnresolvedGitConflictLines(text: string): boolean {
  return /(^|\n)<<<<<<< /.test(text) || /(^|\n)>>>>>>> /.test(text);
}

function tagName(name: string): string {
  return name.replace(/^.*:/, '').toLowerCase();
}

function isTransUnit(name: string): boolean {
  return tagName(name) === 'trans-unit';
}

function isSource(name: string): boolean {
  return tagName(name) === 'source';
}

function isTarget(name: string): boolean {
  return tagName(name) === 'target';
}

function isNote(name: string): boolean {
  return tagName(name) === 'note';
}

function isFile(name: string): boolean {
  return tagName(name) === 'file';
}

function emptyXlfDocument(): XlfDocument {
  return {
    sourceLanguage: '',
    targetLanguage: '',
    original: '',
    datatype: 'xml',
    units: new Map(),
    orderedIds: []
  };
}

export interface ParseXlfOptions {
  /** Merge / CLI: always run full SAX even when Git conflict markers are present. */
  forceFullParse?: boolean;
}

/** Count `<trans-unit` open tags (cheap; used for conflict-only UI totals). */
export function countTransUnitsInBuffer(content: string): number {
  const re = /<trans-unit\b/gi;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    n++;
  }
  return n;
}

/**
 * Byte offsets of each `<trans-unit …>…</trans-unit>` in the current buffer (for partial edits).
 * Assumes trans-units are not nested (BC XLF).
 */
export function buildTransUnitSpanIndex(content: string): Map<string, { start: number; end: number }> {
  const map = new Map<string, { start: number; end: number }>();
  const re = /<trans-unit\b[^>]*\bid="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const id = m[1];
    const start = m.index;
    const afterOpen = m.index + m[0].length;
    const closeIdx = content.indexOf('</trans-unit>', afterOpen);
    if (closeIdx < 0) {
      continue;
    }
    const end = closeIdx + '</trans-unit>'.length;
    map.set(id, { start, end });
  }
  return map;
}

/** Which `trans-unit` contains this byte offset (e.g. cursor from search / text editor). */
export function findTransUnitIdAtOffset(content: string, offset: number): string | undefined {
  const safe = Math.min(Math.max(0, offset), content.length);
  const spans = buildTransUnitSpanIndex(content);
  for (const [id, span] of spans) {
    if (safe >= span.start && safe < span.end) {
      return id;
    }
  }
  return undefined;
}

export async function parseXlf(
  content: string,
  onProgress?: (parsed: number) => void,
  options?: ParseXlfOptions
): Promise<ParseXlfResult> {
  if (!options?.forceFullParse && hasGitMergeConflictMarkers(content)) {
    const conflictRegions = analyzeGitConflicts(content);
    const gitConflicts = gitConflictsToWebPayload(conflictRegions);
    const { text: stripped } = stripGitMergeConflictMarkers(content, 'ours');
    if (hasUnresolvedGitConflictLines(stripped)) {
      throw new Error(
        'This file still contains Git conflict markers that could not be parsed as complete conflict blocks. Resolve them in the merge panel or text editor, then try again.'
      );
    }
    return Promise.resolve({
      document: emptyXlfDocument(),
      gitConflicts
    });
  }

  let gitConflicts: GitConflictForWebview[];
  let xmlInput: string;

  if (!hasGitMergeConflictMarkers(content)) {
    gitConflicts = [];
    xmlInput = content;
  } else {
    const conflictRegions = analyzeGitConflicts(content);
    gitConflicts = gitConflictsToWebPayload(conflictRegions);
    const { text: stripped } = stripGitMergeConflictMarkers(content, 'ours');
    xmlInput = stripped;
    if (hasUnresolvedGitConflictLines(xmlInput)) {
      throw new Error(
        'This file still contains Git conflict markers that could not be parsed as complete conflict blocks. Resolve them in the merge panel or text editor, then try again.'
      );
    }
  }

  return new Promise((resolve, reject) => {
    const parser = sax.parser(true, { trim: false, normalize: false });
    let failed = false;

    const doc: XlfDocument = {
      sourceLanguage: '',
      targetLanguage: '',
      original: '',
      datatype: 'xml',
      units: new Map(),
      orderedIds: []
    };

    let currentUnit: Partial<TransUnit> | null = null;
    let currentExtraAttrs: Record<string, string> | undefined;
    let currentText = '';
    let inSource = false;
    let inTarget = false;
    let inNote = false;
    let noteFrom = '';
    let sawTarget = false;
    let parsed = 0;

    parser.onopentag = (node) => {
      const attrs = node.attributes as Record<string, string>;

      if (isFile(node.name)) {
        doc.sourceLanguage = attrs['source-language'] ?? '';
        doc.targetLanguage = attrs['target-language'] ?? '';
        doc.original = attrs['original'] ?? '';
        doc.datatype = attrs['datatype'] ?? 'xml';
        return;
      }

      if (isTransUnit(node.name)) {
        const id = attrs['id'];
        if (!id) {
          return;
        }
        const fixed = new Set(['id', 'size-unit', 'translate', 'xml:space']);
        const extra: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrs)) {
          if (!fixed.has(k)) {
            extra[k] = v;
          }
        }
        currentExtraAttrs = Object.keys(extra).length ? extra : undefined;
        currentUnit = {
          id,
          source: '',
          target: '',
          targetState: 'needs-translation'
        };
        currentText = '';
        sawTarget = false;
        return;
      }

      if (!currentUnit) {
        return;
      }

      if (isSource(node.name)) {
        inSource = true;
        currentText = '';
      } else if (isTarget(node.name)) {
        inTarget = true;
        sawTarget = true;
        currentText = '';
        const st = attrs['state'] as TargetState | undefined;
        currentUnit.targetState = st ?? 'translated';
      } else if (isNote(node.name)) {
        inNote = true;
        currentText = '';
        noteFrom = (attrs['from'] ?? '').toLowerCase();
      }
    };

    parser.ontext = (text) => {
      if (inSource || inTarget || inNote) {
        currentText += text;
      }
    };

    parser.onclosetag = (name) => {
      if (isSource(name) && inSource) {
        if (currentUnit) {
          currentUnit.source = currentText;
        }
        inSource = false;
      } else if (isTarget(name) && inTarget) {
        if (currentUnit) {
          currentUnit.target = currentText;
        }
        inTarget = false;
      } else if (isNote(name) && inNote) {
        if (currentUnit) {
          if (noteFrom === 'developer') {
            currentUnit.developerNote = currentText;
          } else {
            currentUnit.note = currentText;
          }
        }
        inNote = false;
      } else if (isTransUnit(name) && currentUnit?.id) {
        const unit = currentUnit as TransUnit;
        if (!sawTarget) {
          unit.target = '';
          unit.targetState = 'needs-translation';
        }
        if (currentExtraAttrs) {
          unit.extraAttrs = currentExtraAttrs;
        }
        doc.units.set(unit.id, unit);
        doc.orderedIds.push(unit.id);
        parsed++;
        if (onProgress && parsed % PROGRESS_INTERVAL === 0) {
          onProgress(parsed);
        }
        currentUnit = null;
        currentExtraAttrs = undefined;
        sawTarget = false;
      }
    };

    parser.onerror = (err) => {
      if (!failed) {
        failed = true;
        reject(err);
      }
    };
    parser.onend = () => {
      if (!failed) {
        resolve({ document: doc, gitConflicts });
      }
    };

    if (xmlInput.length <= CHUNK_SIZE) {
      parser.write(xmlInput);
      parser.close();
      return;
    }

    let offset = 0;

    function writeNextChunk(): void {
      if (failed) {
        return;
      }
      const chunk = xmlInput.slice(offset, offset + CHUNK_SIZE);
      if (!chunk) {
        parser.close();
        return;
      }
      parser.write(chunk);
      offset += CHUNK_SIZE;
      setImmediate(writeNextChunk);
    }

    writeNextChunk();
  });
}
