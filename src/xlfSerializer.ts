import { XlfDocument, MergeResult, TransUnit } from './types';
import { formatTransUnit } from './xlfUnitFormat';

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
    parts.push(
      formatTransUnit(unit, {
        unitIndent: INDENT.repeat(4),
        newline: '\n',
        trailingNewline: true
      })
    );
  }

  parts.push(`${INDENT}${INDENT}${INDENT}</group>\n`);
  parts.push(`${INDENT}${INDENT}</body>\n`);
  parts.push(`${INDENT}</file>\n`);
  parts.push('</xliff>');

  return parts.join('');
}

/** One trans-unit block for partial buffer replace / editor edits. Prefer rewrite for updates. */
export function serializeTransUnit(unit: TransUnit): string {
  return formatTransUnit(unit, {
    unitIndent: INDENT.repeat(4),
    newline: '\n',
    trailingNewline: false
  });
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
