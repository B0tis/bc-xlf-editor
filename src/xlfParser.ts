import * as sax from 'sax';
import { TransUnit, XlfDocument, TargetState } from './types';

const PROGRESS_INTERVAL = 500;
const CHUNK_SIZE = 65536;

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

export async function parseXlf(
  content: string,
  onProgress?: (parsed: number) => void
): Promise<XlfDocument> {
  return new Promise((resolve, reject) => {
    const parser = sax.parser(true, { trim: false, normalize: false });

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

    parser.onerror = (err) => reject(err);
    parser.onend = () => resolve(doc);

    if (content.length <= CHUNK_SIZE) {
      parser.write(content);
      parser.close();
      return;
    }

    let offset = 0;

    function writeNextChunk(): void {
      const chunk = content.slice(offset, offset + CHUNK_SIZE);
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
