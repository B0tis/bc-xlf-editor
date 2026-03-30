import { buildTransUnitSpanIndex } from './xlfParser';
import { serializeTransUnit } from './xlfSerializer';
import type { MergeOptions, MergeResult, MergeStats, TransUnit, XlfDocument } from './types';

function escAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replace the first `<file …>` tag attributes to match merged header (minimal header churn). */
export function replaceFileHeaderAttributes(content: string, header: XlfDocument): string {
  const re = /<file\b[^>]*>/i;
  const m = content.match(re);
  if (!m) {
    return content;
  }
  const next =
    `<file source-language="${escAttr(header.sourceLanguage)}" ` +
    `target-language="${escAttr(header.targetLanguage)}" ` +
    `original="${escAttr(header.original)}" ` +
    `datatype="${escAttr(header.datatype)}">`;
  return content.slice(0, m.index!) + next + content.slice(m.index! + m[0].length);
}

function unitsEqual(a: TransUnit, b: TransUnit): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    a.targetState === b.targetState &&
    (a.note ?? '') === (b.note ?? '') &&
    (a.developerNote ?? '') === (b.developerNote ?? '') &&
    JSON.stringify(sortRecord(a.extraAttrs)) === JSON.stringify(sortRecord(b.extraAttrs))
  );
}

function sortRecord(r: Record<string, string> | undefined): Record<string, string> {
  if (!r) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const k of Object.keys(r).sort()) {
    out[k] = r[k];
  }
  return out;
}

/** Byte offset to insert new trans-units before the closing `</group>` of the body group. */
function findGroupBodyInsertOffset(content: string): number {
  const re = /<\/group>\s*\r?\n\s*<\/body>/i;
  const m = re.exec(content);
  if (m) {
    return m.index;
  }
  const idx = content.lastIndexOf('</group>');
  return idx >= 0 ? idx : content.length;
}

/**
 * Applies merge result by replacing only changed trans-units, deleting removed ones, and appending new ones.
 * Preserves document order for existing units (ignores {@link MergeOptions.sortOutput} reordering).
 */
export function applyMergeSurgically(
  buffer: string,
  custom: XlfDocument,
  result: MergeResult,
  stats: MergeStats,
  options: MergeOptions,
  header: XlfDocument
): string {
  let work = buffer;

  const toRemove = options.preserveRemoved ? [] : [...stats.removed];
  const spans0 = buildTransUnitSpanIndex(work);
  const removeSpans = toRemove
    .map((id) => spans0.get(id))
    .filter((s): s is { start: number; end: number } => Boolean(s))
    .sort((a, b) => b.start - a.start);
  for (const sp of removeSpans) {
    work = work.slice(0, sp.start) + work.slice(sp.end);
  }

  const spans = buildTransUnitSpanIndex(work);

  const updates: Array<{ start: number; end: number; text: string }> = [];
  for (const id of custom.orderedIds) {
    if (toRemove.includes(id)) {
      continue;
    }
    const merged = result.units.get(id);
    const prev = custom.units.get(id);
    if (!merged || !prev) {
      continue;
    }
    if (unitsEqual(prev, merged)) {
      continue;
    }
    const span = spans.get(id);
    if (!span) {
      throw new Error(`Surgical merge: trans-unit "${id}" not found in buffer after deletes.`);
    }
    updates.push({ start: span.start, end: span.end, text: serializeTransUnit(merged) });
  }
  updates.sort((a, b) => b.start - a.start);
  for (const u of updates) {
    work = work.slice(0, u.start) + u.text + work.slice(u.end);
  }

  if (stats.added.length > 0) {
    const insertAt = findGroupBodyInsertOffset(work);
    const block = stats.added.map((id) => {
      const u = result.units.get(id);
      if (!u) {
        throw new Error(`Surgical merge: missing merged unit "${id}".`);
      }
      return serializeTransUnit(u);
    });
    work = work.slice(0, insertAt) + block.join('') + work.slice(insertAt);
  }

  work = replaceFileHeaderAttributes(work, header);
  return work;
}

/**
 * Surgical update of the buffer when the in-memory model (`next`) diverges from the last parsed document (`prev`).
 * Used by the custom editor when a full trans-unit replace is required without rewriting the entire file.
 */
export function applyTransUnitDiffSurgically(
  buffer: string,
  prev: XlfDocument,
  next: XlfDocument,
  header: XlfDocument
): string {
  const added = next.orderedIds.filter((id) => !prev.units.has(id));
  const removed = prev.orderedIds.filter((id) => !next.units.has(id));
  const stats: MergeStats = {
    total: next.units.size,
    added,
    removed,
    conflicts: [],
    unchanged: 0
  };
  const result: MergeResult = {
    units: next.units,
    orderedIds: next.orderedIds,
    stats
  };
  const options: MergeOptions = {
    preserveRemoved: false,
    sortOutput: false,
    strategy: 'keep-translated'
  };
  return applyMergeSurgically(buffer, prev, result, stats, options, header);
}
