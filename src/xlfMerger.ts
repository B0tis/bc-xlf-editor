import {
  XlfDocument,
  MergeResult,
  MergeOptions,
  TransUnit,
  MergeStats,
  TargetState,
  defaultMergeOptions
} from './types';

const SOURCE_CHANGED_NOTE = 'Source text has changed. Please review the translation.';

interface UnitMaps {
  byId: Map<string, TransUnit>;
  byNoteAndSource: Map<string, TransUnit>;
  byNoteAndDeveloper: Map<string, TransUnit>;
  byNote: Map<string, TransUnit>;
  bySourceAndDeveloper: Map<string, TransUnit>;
  bySource: Map<string, TransUnit>;
}

function pairKey(a: string | undefined, b: string | undefined): string {
  return `${a ?? ''}\0${b ?? ''}`;
}

function hasUsableTranslation(unit: TransUnit, missing: string): boolean {
  if (missing === '') {
    return unit.target.trim().length > 0;
  }
  return unit.target !== missing && unit.target.trim().length > 0;
}

function isMissingTranslation(text: string | undefined, missing: string): boolean {
  if (text === undefined) {
    return true;
  }
  if (missing === '') {
    return text.trim().length === 0;
  }
  return text === missing;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function buildUnitMaps(custom: XlfDocument, options: MergeOptions): UnitMaps {
  const maps: UnitMaps = {
    byId: new Map(),
    byNoteAndSource: new Map(),
    byNoteAndDeveloper: new Map(),
    byNote: new Map(),
    bySourceAndDeveloper: new Map(),
    bySource: new Map()
  };

  const findByXliffGen =
    options.findByXliffGeneratorNoteAndSource ||
    options.findByXliffGeneratorAndDeveloperNote ||
    options.findByXliffGeneratorNote;
  const findBySourceEnabled =
    options.findBySourceAndDeveloperNote || options.findBySource;

  for (const id of custom.orderedIds) {
    const unit = custom.units.get(id);
    if (!unit) {
      continue;
    }
    if (!maps.byId.has(id)) {
      maps.byId.set(id, unit);
    }

    if (findByXliffGen) {
      const note = unit.note;
      if (options.findByXliffGeneratorNoteAndSource && (note || unit.source)) {
        const key = pairKey(note, unit.source);
        if (!maps.byNoteAndSource.has(key)) {
          maps.byNoteAndSource.set(key, unit);
        }
      }
      if (options.findByXliffGeneratorAndDeveloperNote && (note || unit.developerNote)) {
        const key = pairKey(note, unit.developerNote);
        if (!maps.byNoteAndDeveloper.has(key)) {
          maps.byNoteAndDeveloper.set(key, unit);
        }
      }
      if (options.findByXliffGeneratorNote && note) {
        if (!maps.byNote.has(note)) {
          maps.byNote.set(note, unit);
        }
      }
    }

    if (findBySourceEnabled) {
      if (options.findBySourceAndDeveloperNote && (unit.source || unit.developerNote)) {
        const key = pairKey(unit.source, unit.developerNote);
        if (!maps.bySourceAndDeveloper.has(key) && hasUsableTranslation(unit, options.missingTranslation)) {
          maps.bySourceAndDeveloper.set(key, unit);
        }
      }
      if (options.findBySource && unit.source) {
        if (!maps.bySource.has(unit.source) && hasUsableTranslation(unit, options.missingTranslation)) {
          maps.bySource.set(unit.source, unit);
        }
      }
    }
  }

  return maps;
}

function parseTranslationFromDeveloperNote(
  developerNote: string | undefined,
  targetLanguage: string,
  separator: string,
  trimCharacters: string
): string | undefined {
  if (!developerNote || !targetLanguage) {
    return undefined;
  }
  const entries = developerNote.split(separator);
  let translation: string | undefined;
  for (const entry of entries) {
    const sepIdx = entry.indexOf('=');
    if (sepIdx < 0) {
      continue;
    }
    const language = entry.slice(0, sepIdx).trim();
    if (language === targetLanguage) {
      translation = entry.slice(sepIdx + 1);
      break;
    }
  }
  if (translation !== undefined && trimCharacters) {
    translation = trimAny(translation, trimCharacters);
  }
  return translation;
}

function trimAny(str: string, chars: string): string {
  let start = 0;
  let end = str.length;
  while (start < end && chars.indexOf(str[start]) >= 0) {
    start++;
  }
  while (end > start && chars.indexOf(str[end - 1]) >= 0) {
    end--;
  }
  return start > 0 || end < str.length ? str.slice(start, end) : str;
}

function mergeExtraAttrs(
  base: TransUnit,
  custom: TransUnit | undefined
): Record<string, string> | undefined {
  if (!custom?.extraAttrs) {
    return base.extraAttrs;
  }
  if (!base.extraAttrs) {
    return { ...custom.extraAttrs };
  }
  const out = { ...base.extraAttrs };
  for (const [k, v] of Object.entries(custom.extraAttrs)) {
    if (!(k in out)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function mergeTargetAttrs(
  custom: TransUnit | undefined
): Record<string, string> | undefined {
  if (!custom?.targetAttrs || !Object.keys(custom.targetAttrs).length) {
    return undefined;
  }
  return { ...custom.targetAttrs };
}

/**
 * Synchronize base (`.g.xlf`) into a custom translation file using XLIFF Sync–compatible matching.
 *
 * Match order for existing units:
 * 1. id
 * 2. Xliff Generator note + source
 * 3. Xliff Generator note + developer note
 * 4. Xliff Generator note
 *
 * If no unit is found, try to copy a translation by:
 * 5. source + developer note
 * 6. source
 * then optionally parse from developer note / copy from source text.
 */
export function mergeXlf(
  base: XlfDocument,
  custom: XlfDocument,
  optionsInput: MergeOptions
): MergeResult {
  const options = defaultMergeOptions(optionsInput);
  const missing = options.missingTranslation === '%EMPTY%' ? '' : options.missingTranslation;

  const maps = buildUnitMaps(custom, { ...options, missingTranslation: missing });
  const merged = new Map<string, TransUnit>();
  const stats: MergeStats = {
    total: 0,
    added: [],
    removed: [],
    conflicts: [],
    unchanged: 0,
    remapped: []
  };

  const consumedCustomIds = new Set<string>();
  const sourceTranslationCache = new Map<
    string,
    { target: string; targetAttrs?: Record<string, string> }
  >();

  let copyFromSource =
    options.copyFromSourceForSameLanguage &&
    Boolean(base.sourceLanguage) &&
    base.sourceLanguage === custom.targetLanguage;
  if (custom.targetLanguage && options.copyFromSourceForLanguages.includes(custom.targetLanguage)) {
    copyFromSource = true;
  }

  const findByXliffGen =
    options.findByXliffGeneratorNoteAndSource ||
    options.findByXliffGeneratorAndDeveloperNote ||
    options.findByXliffGeneratorNote;
  const findByEnabled =
    findByXliffGen ||
    options.findBySourceAndDeveloperNote ||
    options.findBySource ||
    copyFromSource ||
    options.parseFromDeveloperNote;

  for (const baseId of base.orderedIds) {
    const baseUnit = base.units.get(baseId);
    if (!baseUnit) {
      continue;
    }

    let matchedUnit = maps.byId.get(baseId);
    let matchedById = Boolean(matchedUnit);
    let borrowedTarget: string | undefined;
    let borrowedTargetAttrs: Record<string, string> | undefined;

    if (!matchedUnit && findByEnabled) {
      const developerNote = baseUnit.developerNote;
      const source = baseUnit.source;

      if (findByXliffGen && baseUnit.note) {
        if (options.findByXliffGeneratorNoteAndSource && source) {
          matchedUnit = maps.byNoteAndSource.get(pairKey(baseUnit.note, source));
        }
        if (!matchedUnit && options.findByXliffGeneratorAndDeveloperNote && developerNote) {
          matchedUnit = maps.byNoteAndDeveloper.get(pairKey(baseUnit.note, developerNote));
        }
        if (!matchedUnit && options.findByXliffGeneratorNote) {
          matchedUnit = maps.byNote.get(baseUnit.note);
        }
      }

      if (!matchedUnit && source) {
        if (options.findBySourceAndDeveloperNote) {
          const bySrcDev = maps.bySourceAndDeveloper.get(pairKey(source, developerNote));
          if (bySrcDev && hasUsableTranslation(bySrcDev, missing)) {
            borrowedTarget = bySrcDev.target;
            borrowedTargetAttrs = bySrcDev.targetAttrs;
          }
        }
        if (isMissingTranslation(borrowedTarget, missing) && options.findBySource) {
          const cached = sourceTranslationCache.get(source);
          if (cached) {
            borrowedTarget = cached.target;
            borrowedTargetAttrs = cached.targetAttrs;
          } else {
            const bySrc = maps.bySource.get(source);
            if (bySrc && hasUsableTranslation(bySrc, missing)) {
              borrowedTarget = bySrc.target;
              borrowedTargetAttrs = bySrc.targetAttrs;
              sourceTranslationCache.set(source, {
                target: bySrc.target,
                targetAttrs: bySrc.targetAttrs
              });
            }
          }
        }
      }
    }

    if (
      isMissingTranslation(borrowedTarget, missing) &&
      (copyFromSource || options.parseFromDeveloperNote)
    ) {
      const existingTarget = matchedUnit?.target;
      const hasNoTranslation =
        !matchedUnit || isMissingTranslation(existingTarget, missing);

      const shouldParse =
        options.parseFromDeveloperNote &&
        (hasNoTranslation || options.parseFromDeveloperNoteOverwrite);
      const shouldCopy =
        copyFromSource && (hasNoTranslation || options.copyFromSourceOverwrite);

      if (isMissingTranslation(borrowedTarget, missing) && shouldParse) {
        const fromNote = parseTranslationFromDeveloperNote(
          baseUnit.developerNote,
          custom.targetLanguage,
          options.parseFromDeveloperNoteSeparator,
          options.parseFromDeveloperNoteTrimCharacters
        );
        if (fromNote !== undefined && fromNote !== '') {
          borrowedTarget = fromNote;
        }
      }
      if (isMissingTranslation(borrowedTarget, missing) && shouldCopy) {
        borrowedTarget = baseUnit.source;
      }
    }

    if (!matchedUnit) {
      stats.added.push(baseId);
      const target =
        borrowedTarget !== undefined && !isMissingTranslation(borrowedTarget, missing)
          ? borrowedTarget
          : missing;
      const targetState: TargetState =
        borrowedTarget !== undefined && !isMissingTranslation(borrowedTarget, missing)
          ? 'translated'
          : 'needs-translation';
      merged.set(baseId, {
        ...baseUnit,
        target,
        targetState,
        syncNote: undefined,
        targetAttrs: borrowedTargetAttrs
      });
      continue;
    }

    consumedCustomIds.add(matchedUnit.id);
    if (!matchedById && matchedUnit.id !== baseId) {
      stats.remapped.push({ fromId: matchedUnit.id, toId: baseId });
    }

    let target = matchedUnit.target;
    let targetState = matchedUnit.targetState;
    let syncNote = matchedUnit.syncNote;
    let targetAttrs = mergeTargetAttrs(matchedUnit);

    // parseFromDeveloperNote / copyFromSource (with optional overwrite) fill translChildNodes
    // in xliff-sync even when a target unit already exists.
    if (borrowedTarget !== undefined && !isMissingTranslation(borrowedTarget, missing)) {
      target = borrowedTarget;
      targetState = 'translated';
      if (borrowedTargetAttrs) {
        targetAttrs = { ...borrowedTargetAttrs };
      }
    }

    const mergedUnit: TransUnit = {
      id: baseId,
      source: baseUnit.source,
      target,
      targetState,
      note: baseUnit.note ?? matchedUnit.note,
      developerNote: baseUnit.developerNote ?? matchedUnit.developerNote,
      syncNote,
      extraAttrs: mergeExtraAttrs(baseUnit, matchedUnit),
      // Always keep TM/origin metadata from the matched translation unit.
      targetAttrs
    };

    let sourceChanged = false;
    if (options.detectSourceTextChanges) {
      let mergedSource = baseUnit.source;
      let origSource = matchedUnit.source;
      if (options.ignoreLineEndingTypeChanges) {
        mergedSource = normalizeLineEndings(mergedSource);
        origSource = normalizeLineEndings(origSource);
      }
      sourceChanged =
        Boolean(mergedSource) &&
        Boolean(origSource) &&
        Boolean(target) &&
        !isMissingTranslation(target, missing) &&
        mergedSource !== origSource;
    }

    if (sourceChanged) {
      stats.conflicts.push(baseId);
      if (options.strategy === 'prefer-source') {
        mergedUnit.target = missing;
        mergedUnit.targetState = 'needs-translation';
        mergedUnit.syncNote = undefined;
      } else {
        // keep-translated (xliff-sync default): keep target, mark needs-adaptation
        mergedUnit.targetState = 'needs-adaptation';
        if (options.addNeedsWorkTranslationNote) {
          mergedUnit.syncNote = SOURCE_CHANGED_NOTE;
        }
      }
    } else if (matchedById && matchedUnit.source === baseUnit.source && matchedUnit.target === target) {
      stats.unchanged++;
    }

    merged.set(baseId, mergedUnit);
  }

  for (const id of custom.orderedIds) {
    if (merged.has(id) || consumedCustomIds.has(id)) {
      continue;
    }
    if (base.units.has(id)) {
      continue;
    }
    stats.removed.push(id);
    if (options.preserveRemoved) {
      const u = custom.units.get(id)!;
      merged.set(id, { ...u, targetState: 'needs-review-translation' });
    }
  }

  stats.total = merged.size;

  const orderedIds = options.sortOutput
    ? Array.from(merged.keys()).sort()
    : [
        ...base.orderedIds.filter((id) => merged.has(id)),
        ...Array.from(merged.keys()).filter((id) => !base.units.has(id))
      ];

  return { units: merged, orderedIds, stats };
}
