import { XlfDocument, MergeResult, MergeOptions, TransUnit, MergeStats } from './types';

export function mergeXlf(
  base: XlfDocument,
  custom: XlfDocument,
  options: MergeOptions
): MergeResult {
  const merged = new Map<string, TransUnit>();
  const stats: MergeStats = {
    total: 0,
    added: [],
    removed: [],
    conflicts: [],
    unchanged: 0
  };

  for (const [id, baseUnit] of base.units) {
    const customUnit = custom.units.get(id);

    if (!customUnit) {
      stats.added.push(id);
      merged.set(id, {
        ...baseUnit,
        target: '',
        targetState: 'needs-translation'
      });
      continue;
    }

    const sourceChanged = baseUnit.source !== customUnit.source;

    if (sourceChanged) {
      stats.conflicts.push(id);
      if (options.strategy === 'keep-translated') {
        merged.set(id, {
          ...customUnit,
          source: baseUnit.source,
          extraAttrs: baseUnit.extraAttrs ?? customUnit.extraAttrs,
          targetState: 'needs-review-translation'
        });
      } else {
        merged.set(id, {
          ...baseUnit,
          target: '',
          targetState: 'needs-translation',
          note: customUnit.note,
          developerNote: customUnit.developerNote
        });
      }
    } else {
      stats.unchanged++;
      merged.set(id, { ...customUnit });
    }
  }

  for (const id of custom.units.keys()) {
    if (!base.units.has(id)) {
      stats.removed.push(id);
      if (options.preserveRemoved) {
        const u = custom.units.get(id)!;
        merged.set(id, { ...u, targetState: 'needs-review-translation' });
      }
    }
  }

  stats.total = merged.size;

  const orderedIds = options.sortOutput
    ? Array.from(merged.keys()).sort()
    : Array.from(merged.keys());

  return { units: merged, orderedIds, stats };
}
