import { l10n } from 'vscode';

/** Localized strings for the merge editor webview (injected as JSON). */
export function getWebviewUiStrings(): Record<string, string> {
  return {
    mergeHeaderAria: l10n.t('Translation merge'),
    fileStatsAria: l10n.t('Translation file summary'),
    gitMergeTitle: l10n.t('Git merge conflicts'),
    gitMergeHint: l10n.t(
      'Choose current (ours) or incoming (theirs) per block, or use Accept all. Each action saves the file and reloads conflicts so indices stay in sync. The translation editor stays hidden until all conflicts are resolved.'
    ),
    acceptAllOurs: l10n.t('Accept all current (ours)'),
    acceptAllTheirs: l10n.t('Accept all incoming (theirs)'),
    stateFilterLabel: l10n.t('States'),
    stateDdSummaryAll: l10n.t('All states'),
    stateDdHint: l10n.t(
      'Leave all unchecked to show every state. Check one or more to list rows in any of those states.'
    ),
    filterEmptyTargetOnly: l10n.t('Empty target only'),
    filterEmptyTargetOnlyTitle: l10n.t(
      'Show rows where the target text is blank (whitespace only), regardless of state. Use when status is wrong but the cell is empty.'
    ),
    filterSearchLabel: l10n.t('Search id, source, or target'),
    filterPlaceholder: l10n.t('Type to filter rows…'),
    filterClear: l10n.t('Clear'),
    filterHint: l10n.t(
      'BC XLF trans-unit ids are compiler hashes (they do not match AL object names). Use AL to find captions in *.al (source text + Xliff note hints). Use XLF to jump to the XML.'
    ),
    statusLoading: l10n.t('Loading…'),
    btnAl: l10n.t('AL'),
    btnAlTitle: l10n.t(
      'Open AL: finds single-quoted strings after Caption / ToolTip / Label in the source (and target), searches those literals in .al files, and uses the Xliff Generator note to rank matches when several files contain the same text.'
    ),
    btnXlf: l10n.t('XLF'),
    btnXlfTitle: l10n.t('Reveal this trans-unit in the XLF XML'),
    btnDeepL: l10n.t('DeepL'),
    btnDeepLTitle: l10n.t(
      'Translate source into the target language with DeepL (requires API key). Does not save the file by itself.'
    ),
    targetLockedTitle: l10n.t('Resolve Git merge conflicts in the panel above first.'),
    statTransUnits: l10n.t('Trans-units'),
    statTotal: l10n.t('Total'),
    statGitConflicts: l10n.t('Git conflicts'),
    statNeedsTranslation: l10n.t('Needs translation'),
    statEmptyTarget: l10n.t('Empty target'),
    statNeedsReview: l10n.t('Needs review'),
    statNeedsAdaptation: l10n.t('Needs adaptation'),
    statTranslatedFinal: l10n.t('Translated + final'),
    statOtherState: l10n.t('Other state'),
    statTransUnitsInFile: l10n.t('Trans-units in file'),
    gitSideOurs: l10n.t('Current (ours / HEAD)'),
    gitSideTheirs: l10n.t('Incoming (theirs)'),
    gitUseOurs: l10n.t('Use current (ours)'),
    gitUseTheirs: l10n.t('Use incoming (theirs)'),
    conflictLabelSource: l10n.t('source:'),
    conflictLabelTarget: l10n.t('target:'),
    conflictLabelState: l10n.t('state:'),
    stateFilterMany: l10n.t('{0} states: {1}, {2}…'),
    statusConflictOnly: l10n.t(
      'Resolve {0} conflict(s). {1} trans-units in file — editor loads when all are resolved.'
    ),
    statusListHint: l10n.t(' — edit target / state; changes apply to the file buffer'),
    statusListHintLocked: l10n.t(' — resolve Git conflicts above to edit targets'),
    statusEditsOnSave: l10n.t(
      'Edits apply to the XML when you save the file (Ctrl+S).'
    ),
    statusEditsPendingSave: l10n.t(
      'Unsaved changes in the panel — save (Ctrl+S) to write them to the XML.'
    ),
    statusListPlain: l10n.t('List: {0} trans-units{1}'),
    statusListFiltered: l10n.t('List: showing {0} of {1} trans-units (filters active){2}'),
    parseErrorPrefix: l10n.t('Parse error: {0}')
  };
}
