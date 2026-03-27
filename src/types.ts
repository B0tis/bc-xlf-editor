export interface TransUnit {
  id: string;
  source: string;
  target: string;
  targetState: TargetState;
  /** Xliff Generator / contextual note */
  note?: string;
  /** Developer note */
  developerNote?: string;
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

export interface MergeStats {
  total: number;
  added: string[];
  removed: string[];
  conflicts: string[];
  unchanged: number;
}

export type MergeStrategy = 'keep-translated' | 'prefer-source';

export interface MergeOptions {
  strategy: MergeStrategy;
  sortOutput: boolean;
  preserveRemoved: boolean;
}
