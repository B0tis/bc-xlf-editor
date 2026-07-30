import type { TransUnit } from './types';

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Whitespace from the start of the line up to `offset` (the `<` of `<trans-unit`). */
export function lineIndentAt(content: string, offset: number): string {
  let i = offset;
  while (i > 0) {
    const ch = content[i - 1];
    if (ch === '\n' || ch === '\r') {
      break;
    }
    i--;
  }
  return content.slice(i, offset);
}

/** Prefer the indent of an existing trans-unit in the file; fall back to 8 spaces (BC layout). */
export function detectTransUnitIndent(content: string): string {
  const m = /\n([ \t]*)<trans-unit\b/.exec(content);
  if (m) {
    return m[1];
  }
  return '        ';
}

export function detectNewline(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function childIndentOf(unitIndent: string): string {
  if (unitIndent.length > 0 && !unitIndent.includes(' ') && unitIndent.includes('\t')) {
    return unitIndent + '\t';
  }
  // Infer step from indent length when possible (2-space BC default).
  if (unitIndent.length >= 2 && unitIndent.length % 2 === 0 && /^[ ]+$/.test(unitIndent)) {
    return unitIndent + '  ';
  }
  return unitIndent + '  ';
}

/**
 * Rewrite an existing `<trans-unit>…</trans-unit>` block in place.
 * Keeps surrounding whitespace, child indentation, and unknown attributes
 * (e.g. target match-percent / origin-*).
 */
export function rewriteTransUnitBlock(block: string, unit: TransUnit): string {
  let out = block;

  out = out.replace(/<trans-unit\b([^>]*)>/i, (_full, attrs: string) => {
    let next = attrs;
    if (/\bid\s*=\s*"[^"]*"/i.test(next)) {
      next = next.replace(/\bid\s*=\s*"[^"]*"/i, `id="${esc(unit.id)}"`);
    } else {
      next = ` id="${esc(unit.id)}"` + next;
    }
    return `<trans-unit${next}>`;
  });

  out = out.replace(/<source\b([^>]*)>([\s\S]*?)<\/source>/i, (_full, attrs: string) => {
    return `<source${attrs}>${esc(unit.source)}</source>`;
  });

  if (/<target\b/i.test(out)) {
    out = out.replace(/<target\b([^>]*)>([\s\S]*?)<\/target>/i, (_full, attrs: string) => {
      let nextAttrs = attrs;
      if (/\bstate\s*=\s*"[^"]*"/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(
          /\bstate\s*=\s*"[^"]*"/i,
          `state="${esc(unit.targetState)}"`
        );
      } else {
        nextAttrs = `${nextAttrs} state="${esc(unit.targetState)}"`;
      }
      return `<target${nextAttrs}>${esc(unit.target)}</target>`;
    });
  } else {
    // Insert target after source when missing.
    out = out.replace(
      /(<source\b[^>]*>[\s\S]*?<\/source>)(\r?\n)([ \t]*)/i,
      (_full, sourceTag: string, nl: string, indent: string) => {
        return (
          `${sourceTag}${nl}${indent}` +
          `<target state="${esc(unit.targetState)}">${esc(unit.target)}</target>${nl}${indent}`
        );
      }
    );
  }

  out = patchOrInsertNote(out, 'Developer', unit.developerNote ?? '', 2);
  out = patchOrInsertNote(out, 'Xliff Generator', unit.note ?? '', 3);
  if (unit.syncNote) {
    out = patchOrInsertNote(out, 'XLIFF Sync', unit.syncNote, 1);
  } else {
    out = removeNoteFrom(out, 'XLIFF Sync');
  }

  return out;
}

function noteFromPattern(from: string): RegExp {
  const escFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `<note\\b([^>]*\\bfrom\\s*=\\s*"${escFrom}"[^>]*)>([\\s\\S]*?)<\\/note>`,
    'i'
  );
}

function patchOrInsertNote(
  block: string,
  from: string,
  text: string,
  priority: number
): string {
  const re = noteFromPattern(from);
  if (re.test(block)) {
    return block.replace(re, (_full, attrs: string) => {
      return `<note${attrs}>${esc(text)}</note>`;
    });
  }
  if (!text && from !== 'XLIFF Sync') {
    // Keep BC habit of always having Developer / Xliff Generator notes when serializing
    // new blocks; for in-place rewrite, don't invent missing notes unless we have text
    // or it's a sync review note.
    return block;
  }
  if (!text && from === 'XLIFF Sync') {
    return block;
  }

  const noteXml =
    `<note from="${from}" annotates="general" priority="${priority}">${esc(text)}</note>`;

  // Insert after </target>, reusing the following line's newline + indent.
  const targetClose = /<\/target>/i.exec(block);
  if (targetClose) {
    const after = targetClose.index + targetClose[0].length;
    const rest = block.slice(after);
    const lead = /^(\r?\n)([ \t]*)/.exec(rest);
    if (lead) {
      return block.slice(0, after) + lead[1] + lead[2] + noteXml + rest;
    }
    return block.slice(0, after) + noteXml + rest;
  }

  const beforeClose = block.lastIndexOf('</trans-unit>');
  if (beforeClose >= 0) {
    const before = block.slice(0, beforeClose);
    const lead = /(\r?\n)([ \t]*)$/.exec(before);
    const nl = lead?.[1] ?? '\n';
    const indent = lead?.[2] ?? '';
    return before + noteXml + nl + indent + block.slice(beforeClose);
  }
  return block;
}

function removeNoteFrom(block: string, from: string): string {
  const escFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Also drop a single trailing newline+indent that belonged to the note line.
  const re = new RegExp(
    `\\r?\\n[ \\t]*<note\\b[^>]*\\bfrom\\s*=\\s*"${escFrom}"[^>]*>[\\s\\S]*?<\\/note>`,
    'i'
  );
  return block.replace(re, '');
}

export interface SerializeTransUnitOptions {
  /** Indent of the `<trans-unit` line itself (no leading newline). */
  unitIndent?: string;
  /** Line ending to use inside the block. */
  newline?: '\n' | '\r\n';
  /**
   * When false, omit the final newline after `</trans-unit>` (surgical replace of a
   * span that does not include the trailing newline).
   */
  trailingNewline?: boolean;
}

/**
 * Canonical trans-unit serialization for full-file writes and newly appended units.
 * Do not use for surgical in-place updates — use {@link rewriteTransUnitBlock} instead.
 */
export function formatTransUnit(unit: TransUnit, options: SerializeTransUnitOptions = {}): string {
  const unitIndent = options.unitIndent ?? '        ';
  const childIndent = childIndentOf(unitIndent);
  const nl = options.newline ?? '\n';
  const trailingNewline = options.trailingNewline !== false;

  const openTag = buildTransUnitOpen(unit);
  const parts: string[] = [];
  parts.push(`${unitIndent}${openTag}${nl}`);
  parts.push(`${childIndent}<source>${esc(unit.source)}</source>${nl}`);
  parts.push(
    `${childIndent}<target${formatTargetAttrs(unit)}>${esc(unit.target)}</target>${nl}`
  );
  if (unit.syncNote) {
    parts.push(
      `${childIndent}<note from="XLIFF Sync" annotates="general" priority="1">${esc(
        unit.syncNote
      )}</note>${nl}`
    );
  }
  parts.push(
    `${childIndent}<note from="Developer" annotates="general" priority="2">${esc(
      unit.developerNote ?? ''
    )}</note>${nl}`
  );
  parts.push(
    `${childIndent}<note from="Xliff Generator" annotates="general" priority="3">${esc(
      unit.note ?? ''
    )}</note>${nl}`
  );
  parts.push(`${unitIndent}</trans-unit>`);
  if (trailingNewline) {
    parts.push(nl);
  }
  return parts.join('');
}

function formatTargetAttrs(unit: TransUnit): string {
  const attrs: string[] = [` state="${esc(unit.targetState)}"`];
  const extra = unit.targetAttrs ?? {};
  for (const k of Object.keys(extra).sort()) {
    if (k === 'state') {
      continue;
    }
    attrs.push(` ${k}="${esc(extra[k])}"`);
  }
  return attrs.join('');
}

function buildTransUnitOpen(unit: TransUnit): string {
  const extra = unit.extraAttrs ?? {};
  const hasTranslate = 'translate' in extra;
  const hasSizeUnit = 'size-unit' in extra;
  const hasXmlSpace = 'xml:space' in extra;

  let open = `<trans-unit id="${esc(unit.id)}"`;
  if (!hasSizeUnit) {
    open += ` size-unit="char"`;
  }
  if (!hasTranslate) {
    open += ` translate="yes"`;
  }
  if (!hasXmlSpace) {
    open += ` xml:space="preserve"`;
  }
  const keys = Object.keys(extra).sort();
  for (const k of keys) {
    open += ` ${k}="${esc(extra[k])}"`;
  }
  return `${open}>`;
}
