import { XlfDocument, MergeResult, TransUnit } from './types';

const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>\n';
const INDENT = '  ';

const XLIFF_OPEN =
  '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xsi:schemaLocation="urn:oasis:names:tc:xliff:document:1.2 xliff-core-1.2-transitional.xsd">\n';

export function serializeXlf(header: XlfDocument, result: MergeResult): string {
  const parts: string[] = [];
  parts.push(XML_DECL);
  parts.push(XLIFF_OPEN);
  parts.push(
    `${INDENT}<file source-language="${esc(header.sourceLanguage)}" ` +
      `target-language="${esc(header.targetLanguage)}" ` +
      `original="${esc(header.original)}" ` +
      `datatype="${esc(header.datatype)}">\n`
  );
  parts.push(`${INDENT}${INDENT}<body>\n`);
  parts.push(`${INDENT}${INDENT}${INDENT}<group id="body">\n`);

  for (const id of result.orderedIds) {
    const unit = result.units.get(id);
    if (!unit) {
      continue;
    }
    appendTransUnit(parts, unit);
  }

  parts.push(`${INDENT}${INDENT}${INDENT}</group>\n`);
  parts.push(`${INDENT}${INDENT}</body>\n`);
  parts.push(`${INDENT}</file>\n`);
  parts.push('</xliff>');

  return parts.join('');
}

function appendTransUnit(parts: string[], unit: TransUnit): void {
  const openTag = buildTransUnitOpen(unit);
  parts.push(`${INDENT.repeat(3)}${openTag}\n`);
  parts.push(`${INDENT.repeat(4)}<source>${esc(unit.source)}</source>\n`);
  parts.push(
    `${INDENT.repeat(4)}<target state="${esc(unit.targetState)}">${esc(unit.target)}</target>\n`
  );
  parts.push(
    `${INDENT.repeat(4)}<note from="Developer" annotates="general" priority="2">${esc(
      unit.developerNote ?? ''
    )}</note>\n`
  );
  parts.push(
    `${INDENT.repeat(4)}<note from="Xliff Generator" annotates="general" priority="3">${esc(
      unit.note ?? ''
    )}</note>\n`
  );
  parts.push(`${INDENT.repeat(3)}</trans-unit>\n`);
}

/** One trans-unit block, same canonical shape as {@link serializeXlf} (for partial buffer replace). */
export function serializeTransUnit(unit: TransUnit): string {
  const parts: string[] = [];
  appendTransUnit(parts, unit);
  return parts.join('');
}

function buildTransUnitOpen(unit: TransUnit): string {
  const base =
    `<trans-unit id="${esc(unit.id)}" ` +
    `size-unit="char" translate="yes" ` +
    `xml:space="preserve"`;
  const extra = unit.extraAttrs ?? {};
  const keys = Object.keys(extra).sort();
  const extraStr = keys.map((k) => ` ${k}="${esc(extra[k])}"`).join('');
  return `${base}${extraStr}>`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
