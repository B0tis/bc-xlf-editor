export interface TransUnit {
  id: string;
  source: string;
  target: string;
  targetState: TargetState;
  /** Xliff Generator / contextual note */
  note?: string;
  /** Developer note */
  developerNote?: string;
  /**
   * Review note written as `<note from="XLIFF Sync">` when source text changed
   * (xliff-sync compatible).
   */
  syncNote?: string;
  /** Extra trans-unit attributes (e.g. al-object-target) for stable round-trip */
  extraAttrs?: Record<string, string>;
}

export type TargetState =
  | 'translated'
  | 'needs-translation'
  | 'needs-review-translation'
  | 'needs-adaptation'
  | 'final';

export interface XlfDocument {
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  datatype: string;
  units: Map<string, TransUnit>;
  orderedIds: string[];
}

export interface MergeResult {
  units: Map<string, TransUnit>;
  orderedIds: string[];
  stats: MergeStats;
}

export interface RemappedUnit {
  fromId: string;
  toId: string;
}

export interface MergeStats {
  total: number;
  added: string[];
  removed: string[];
  conflicts: string[];
  unchanged: number;
  /** Custom units whose id changed but were rematched via note/source (xliff-sync). */
  remapped: RemappedUnit[];
}

export type MergeStrategy = 'keep-translated' | 'prefer-source';

/**
 * Sync options aligned with [XLIFF Sync](https://github.com/rvanbekkum/vsc-xliff-sync)
 * matching order (id → generator note(+source/dev) → source(+dev) → parse/copy).
 */
export interface MergeOptions {
  strategy: MergeStrategy;
  sortOutput: boolean;
  preserveRemoved: boolean;
  findByXliffGeneratorNoteAndSource: boolean;
  findByXliffGeneratorAndDeveloperNote: boolean;
  findByXliffGeneratorNote: boolean;
  findBySourceAndDeveloperNote: boolean;
  findBySource: boolean;
  parseFromDeveloperNote: boolean;
  parseFromDeveloperNoteOverwrite: boolean;
  parseFromDeveloperNoteSeparator: string;
  parseFromDeveloperNoteTrimCharacters: string;
  copyFromSourceForSameLanguage: boolean;
  copyFromSourceForLanguages: string[];
  copyFromSourceOverwrite: boolean;
  detectSourceTextChanges: boolean;
  ignoreLineEndingTypeChanges: boolean;
  missingTranslation: string;
  addNeedsWorkTranslationNote: boolean;
}

export function defaultMergeOptions(partial?: Partial<MergeOptions>): MergeOptions {
  return {
    strategy: 'keep-translated',
    sortOutput: true,
    preserveRemoved: false,
    findByXliffGeneratorNoteAndSource: true,
    findByXliffGeneratorAndDeveloperNote: true,
    findByXliffGeneratorNote: true,
    findBySourceAndDeveloperNote: false,
    findBySource: false,
    parseFromDeveloperNote: false,
    parseFromDeveloperNoteOverwrite: false,
    parseFromDeveloperNoteSeparator: '|',
    parseFromDeveloperNoteTrimCharacters: '',
    copyFromSourceForSameLanguage: false,
    copyFromSourceForLanguages: [],
    copyFromSourceOverwrite: false,
    detectSourceTextChanges: true,
    ignoreLineEndingTypeChanges: false,
    missingTranslation: '',
    addNeedsWorkTranslationNote: true,
    ...partial
  };
}
