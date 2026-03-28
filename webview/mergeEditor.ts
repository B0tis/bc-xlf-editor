import { VirtualList } from './virtualList';

interface UnitRow {
  id: string;
  source: string;
  target: string;
  targetState: string;
  /** Xliff Generator note — used to locate AL when captions are generic */
  note: string;
}

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

const vscode = acquireVsCodeApi();

/** Injected from extension host (`webviewUiStrings`). */
let uiStrings: Record<string, string> = {};

function loadUiStrings(): Record<string, string> {
  const el = document.getElementById('bcxlf-ui-json');
  const raw = el?.textContent?.trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function format(template: string, ...parts: (string | number)[]): string {
  let s = template;
  parts.forEach((p, i) => {
    s = s.replace(new RegExp(`\\{${i}\\}`, 'g'), String(p));
  });
  return s;
}

function t(key: string): string {
  return uiStrings[key] ?? key;
}

let stateOptions: string[] = [
  'translated',
  'needs-translation',
  'needs-review-translation',
  'needs-adaptation',
  'final'
];

/** Full list from extension (object identity preserved for edits). */
let allUnits: UnitRow[] = [];

function postUpdate(u: UnitRow): void {
  vscode.postMessage({
    type: 'updateUnit',
    id: u.id,
    target: u.target,
    targetState: u.targetState
  });
}

function renderRow(
  item: unknown,
  afterRowStateChange: () => void,
  afterTargetBlur: () => void,
  editingLocked: boolean
): HTMLElement {
  const u = item as UnitRow;
  const row = document.createElement('div');
  row.className = 'row';

  const idCell = document.createElement('div');
  idCell.className = 'cell id';
  idCell.textContent = u.id;

  const srcCell = document.createElement('div');
  srcCell.className = 'cell src';
  srcCell.textContent = u.source;

  const jumpCell = document.createElement('div');
  jumpCell.className = 'cell jump';
  const btnAl = document.createElement('button');
  btnAl.type = 'button';
  btnAl.className = 'jump-btn';
  btnAl.textContent = t('btnAl');
  btnAl.title = t('btnAlTitle');
  btnAl.addEventListener('click', () => {
    vscode.postMessage({
      type: 'goToAlSource',
      source: u.source,
      xliffNote: u.note,
      target: u.target
    });
  });
  const btnXlf = document.createElement('button');
  btnXlf.type = 'button';
  btnXlf.className = 'jump-btn';
  btnXlf.textContent = t('btnXlf');
  btnXlf.title = t('btnXlfTitle');
  btnXlf.addEventListener('click', () => {
    vscode.postMessage({ type: 'revealInXlf', id: u.id });
  });
  jumpCell.appendChild(btnAl);
  jumpCell.appendChild(btnXlf);

  const tgtCell = document.createElement('div');
  tgtCell.className = 'cell tgt';
  const ta = document.createElement('textarea');
  ta.className = 'target-input';
  ta.rows = 3;
  ta.value = u.target;
  ta.addEventListener('input', () => {
    u.target = ta.value;
  });
  ta.addEventListener('blur', () => {
    postUpdate(u);
    afterTargetBlur();
  });
  ta.disabled = editingLocked;
  if (editingLocked) {
    ta.title = t('targetLockedTitle');
  }
  tgtCell.appendChild(ta);

  const stCell = document.createElement('div');
  stCell.className = 'cell state';
  const sel = document.createElement('select');
  sel.className = 'state-select';
  sel.disabled = editingLocked;
  if (editingLocked) {
    sel.title = t('targetLockedTitle');
  }
  const opts = [...stateOptions];
  if (!opts.includes(u.targetState)) {
    opts.unshift(u.targetState);
  }
  for (const s of opts) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (s === u.targetState) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    u.targetState = sel.value;
    postUpdate(u);
    afterRowStateChange();
  });
  stCell.appendChild(sel);

  row.appendChild(idCell);
  row.appendChild(srcCell);
  row.appendChild(jumpCell);
  row.appendChild(tgtCell);
  row.appendChild(stCell);

  return row;
}

function getCheckedStateSet(listEl: HTMLElement): Set<string> {
  const set = new Set<string>();
  listEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-state]:checked').forEach((cb) => {
    const v = cb.dataset.state;
    if (v) {
      set.add(v);
    }
  });
  return set;
}

/** When empty, show all states; otherwise only rows whose state is in the set. */
function getStateFilterSet(listEl: HTMLElement): Set<string> | null {
  const set = getCheckedStateSet(listEl);
  if (set.size === 0) {
    return null;
  }
  return set;
}

function rebuildStateFilterList(listEl: HTMLElement, preserveChecked: Set<string>): void {
  listEl.replaceChildren();
  for (const s of stateOptions) {
    const row = document.createElement('label');
    row.className = 'state-dd-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.state = s;
    if (preserveChecked.has(s)) {
      cb.checked = true;
    }
    const span = document.createElement('span');
    span.textContent = s;
    row.appendChild(cb);
    row.appendChild(span);
    listEl.appendChild(row);
  }
}

function updateStateDropdownSummary(listEl: HTMLElement, summaryEl: HTMLElement): void {
  const set = getCheckedStateSet(listEl);
  if (set.size === 0) {
    summaryEl.textContent = t('stateDdSummaryAll');
    return;
  }
  const labels = [...set];
  labels.sort();
  if (labels.length <= 2) {
    summaryEl.textContent = labels.join(', ');
    return;
  }
  summaryEl.textContent = format(t('stateFilterMany'), labels.length, labels[0], labels[1]);
}

function closeStatePanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement
): void {
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

function hasActiveFilters(listEl: HTMLElement, textEl: HTMLInputElement): boolean {
  return getCheckedStateSet(listEl).size > 0 || textEl.value.trim().length > 0;
}

interface FileStats {
  total: number;
  needsTranslation: number;
  emptyTarget: number;
  needsReview: number;
  needsAdaptation: number;
  translated: number;
  final: number;
  otherState: number;
}

function computeFileStats(units: UnitRow[]): FileStats {
  const s: FileStats = {
    total: units.length,
    needsTranslation: 0,
    emptyTarget: 0,
    needsReview: 0,
    needsAdaptation: 0,
    translated: 0,
    final: 0,
    otherState: 0
  };
  for (const u of units) {
    if (!u.target.trim()) {
      s.emptyTarget++;
    }
    switch (u.targetState) {
      case 'needs-translation':
        s.needsTranslation++;
        break;
      case 'needs-review-translation':
        s.needsReview++;
        break;
      case 'needs-adaptation':
        s.needsAdaptation++;
        break;
      case 'translated':
        s.translated++;
        break;
      case 'final':
        s.final++;
        break;
      default:
        s.otherState++;
        break;
    }
  }
  return s;
}

function makeStatChip(label: string, value: number, className: string): HTMLElement {
  const chip = document.createElement('div');
  chip.className = `stat-chip ${className}`;
  const val = document.createElement('span');
  val.className = 'stat-value';
  val.textContent = String(value);
  const lab = document.createElement('span');
  lab.className = 'stat-label';
  lab.textContent = label;
  chip.appendChild(val);
  chip.appendChild(lab);
  return chip;
}

function updateFileStats(
  container: HTMLElement,
  units: UnitRow[],
  gitConflictCount: number,
  fullStatsFromHost: FileStats | null
): void {
  container.replaceChildren();
  const st = fullStatsFromHost ?? (units.length > 0 ? computeFileStats(units) : null);
  if (!st) {
    container.appendChild(makeStatChip(t('statTransUnits'), 0, 'stat-total'));
    return;
  }
  container.appendChild(makeStatChip(t('statTotal'), st.total, 'stat-total'));
  if (gitConflictCount > 0) {
    container.appendChild(makeStatChip(t('statGitConflicts'), gitConflictCount, 'stat-review'));
  }
  container.appendChild(makeStatChip(t('statNeedsTranslation'), st.needsTranslation, 'stat-missing'));
  container.appendChild(makeStatChip(t('statEmptyTarget'), st.emptyTarget, 'stat-missing'));
  container.appendChild(makeStatChip(t('statNeedsReview'), st.needsReview, 'stat-review'));
  container.appendChild(makeStatChip(t('statNeedsAdaptation'), st.needsAdaptation, 'stat-adapt'));
  const done = st.translated + st.final;
  container.appendChild(makeStatChip(t('statTranslatedFinal'), done, 'stat-done'));
  if (st.otherState > 0) {
    container.appendChild(makeStatChip(t('statOtherState'), st.otherState, 'stat-adapt'));
  }
}

function updateFileStatsConflictOnly(
  container: HTMLElement,
  totalInFile: number,
  gitConflictCount: number
): void {
  container.replaceChildren();
  container.appendChild(makeStatChip(t('statTransUnitsInFile'), totalInFile, 'stat-total'));
  container.appendChild(makeStatChip(t('statGitConflicts'), gitConflictCount, 'stat-review'));
}

interface GitConflictPayload {
  index: number;
  transUnitId: string;
  ours: { source: string; target: string; targetState: string };
  theirs: { source: string; target: string; targetState: string };
}

function formatConflictSide(side: GitConflictPayload['ours']): string {
  return `${t('conflictLabelSource')}\n${side.source}\n\n${t('conflictLabelTarget')}\n${side.target}\n\n${t('conflictLabelState')} ${side.targetState}`;
}

function renderGitMergeCards(container: HTMLElement, conflicts: GitConflictPayload[]): void {
  container.replaceChildren();
  for (const c of conflicts) {
    const card = document.createElement('div');
    card.className = 'git-merge-card';

    const idEl = document.createElement('div');
    idEl.className = 'git-merge-card-id';
    idEl.textContent = c.transUnitId;

    const cols = document.createElement('div');
    cols.className = 'git-merge-cols';

    const oursWrap = document.createElement('div');
    const oursLab = document.createElement('div');
    oursLab.className = 'git-merge-side-label';
    oursLab.textContent = t('gitSideOurs');
    const oursPre = document.createElement('pre');
    oursPre.className = 'git-merge-pre';
    oursPre.textContent = formatConflictSide(c.ours);
    oursWrap.appendChild(oursLab);
    oursWrap.appendChild(oursPre);

    const theirsWrap = document.createElement('div');
    const theirsLab = document.createElement('div');
    theirsLab.className = 'git-merge-side-label';
    theirsLab.textContent = t('gitSideTheirs');
    const theirsPre = document.createElement('pre');
    theirsPre.className = 'git-merge-pre';
    theirsPre.textContent = formatConflictSide(c.theirs);
    theirsWrap.appendChild(theirsLab);
    theirsWrap.appendChild(theirsPre);

    cols.appendChild(oursWrap);
    cols.appendChild(theirsWrap);

    const actions = document.createElement('div');
    actions.className = 'git-merge-actions';
    const bOurs = document.createElement('button');
    bOurs.type = 'button';
    bOurs.className = 'git-merge-pick-primary';
    bOurs.textContent = t('gitUseOurs');
    bOurs.addEventListener('click', () => {
      vscode.postMessage({ type: 'resolveGitConflict', index: c.index, side: 'ours' });
    });
    const bTheirs = document.createElement('button');
    bTheirs.type = 'button';
    bTheirs.textContent = t('gitUseTheirs');
    bTheirs.addEventListener('click', () => {
      vscode.postMessage({ type: 'resolveGitConflict', index: c.index, side: 'theirs' });
    });
    actions.appendChild(bOurs);
    actions.appendChild(bTheirs);

    card.appendChild(idEl);
    card.appendChild(cols);
    card.appendChild(actions);
    container.appendChild(card);
  }
}

function applyChrome(): void {
  const m = document.getElementById('mergeHeader');
  if (m) {
    m.setAttribute('aria-label', t('mergeHeaderAria'));
  }
  const fsAria = document.getElementById('fileStats');
  if (fsAria) {
    fsAria.setAttribute('aria-label', t('fileStatsAria'));
  }
  const gt = document.getElementById('gitMergeTitle');
  if (gt) {
    gt.textContent = t('gitMergeTitle');
  }
  const gh = document.getElementById('gitMergeHint');
  if (gh) {
    gh.textContent = t('gitMergeHint');
  }
  const o = document.getElementById('gitMergeAcceptAllOurs');
  if (o) {
    o.textContent = t('acceptAllOurs');
  }
  const th = document.getElementById('gitMergeAcceptAllTheirs');
  if (th) {
    th.textContent = t('acceptAllTheirs');
  }
  const sl = document.getElementById('stateFilterLabel');
  if (sl) {
    sl.textContent = t('stateFilterLabel');
  }
  const sdh = document.getElementById('stateDdHint');
  if (sdh) {
    sdh.textContent = t('stateDdHint');
  }
  const fsl = document.getElementById('filterSearchLabel');
  if (fsl) {
    fsl.textContent = t('filterSearchLabel');
  }
  const ft = document.getElementById('filterText') as HTMLInputElement | null;
  if (ft) {
    ft.placeholder = t('filterPlaceholder');
  }
  const fc = document.getElementById('filterClear');
  if (fc) {
    fc.textContent = t('filterClear');
  }
  const fh = document.getElementById('filterHint');
  if (fh) {
    fh.textContent = t('filterHint');
  }
  const st = document.getElementById('status');
  if (st) {
    st.textContent = t('statusLoading');
  }
}

function boot(): void {
  const viewport = document.getElementById('viewport');
  const spacer = document.getElementById('spacer');
  const mergeHeader = document.getElementById('mergeHeader');
  const editorShell = document.getElementById('editorShell');
  const gitMergePanel = document.getElementById('gitMergePanel');
  const gitMergeCards = document.getElementById('gitMergeCards');
  const fileStats = document.getElementById('fileStats');
  const status = document.getElementById('status');
  const filtersEl = document.getElementById('filters');
  const stateDd = document.getElementById('stateDd');
  const stateDdToggle = document.getElementById('stateDdToggle') as HTMLButtonElement | null;
  const stateDdPanel = document.getElementById('stateDdPanel');
  const stateDdList = document.getElementById('stateDdList');
  const stateDdSummary = document.getElementById('stateDdSummary');
  const filterText = document.getElementById('filterText') as HTMLInputElement | null;
  const filterClear = document.getElementById('filterClear') as HTMLButtonElement | null;

  if (
    !viewport ||
    !spacer ||
    !mergeHeader ||
    !editorShell ||
    !gitMergePanel ||
    !gitMergeCards ||
    !fileStats ||
    !status ||
    !filtersEl ||
    !stateDd ||
    !stateDdToggle ||
    !stateDdPanel ||
    !stateDdList ||
    !stateDdSummary ||
    !filterText ||
    !filterClear
  ) {
    return;
  }

  uiStrings = loadUiStrings();
  applyChrome();

  let filterDebounce: ReturnType<typeof setTimeout> | undefined;
  let list: VirtualList;

  let firstUnitsLoad = true;
  const uiState = { editingLocked: false };
  let gitConflictCount = 0;
  let viewMode: 'editor' | 'conflictsOnly' = 'editor';
  let totalCount = 0;
  let matchCount = 0;
  let totalInFile = 0;
  let hostFileStats: FileStats | null = null;

  const postFilterToHost = (): void => {
    if (viewMode !== 'editor' || uiState.editingLocked) {
      return;
    }
    const stateSet = getStateFilterSet(stateDdList);
    const states = !stateSet || stateSet.size === 0 ? [] : [...stateSet];
    vscode.postMessage({
      type: 'filterChanged',
      states,
      text: filterText.value
    });
  };

  const schedulePostFilterToHost = (): void => {
    if (filterDebounce !== undefined) {
      clearTimeout(filterDebounce);
    }
    filterDebounce = setTimeout(() => {
      filterDebounce = undefined;
      postFilterToHost();
    }, 200);
  };

  const refreshList = (opts?: { resetScroll?: boolean }): void => {
    if (opts?.resetScroll) {
      viewport.scrollTop = 0;
    }
    list.setItems(allUnits);
    updateStateDropdownSummary(stateDdList, stateDdSummary);

    if (viewMode === 'conflictsOnly') {
      updateFileStatsConflictOnly(fileStats, totalInFile, gitConflictCount);
      status.textContent = format(t('statusConflictOnly'), gitConflictCount, totalInFile);
      return;
    }

    updateFileStats(fileStats, allUnits, gitConflictCount, hostFileStats);

    const hint = uiState.editingLocked ? t('statusListHintLocked') : t('statusListHint');
    if (!hasActiveFilters(stateDdList, filterText)) {
      status.textContent = format(t('statusListPlain'), matchCount, hint);
    } else {
      status.textContent = format(t('statusListFiltered'), matchCount, totalCount, hint);
    }
  };

  list = new VirtualList(viewport, spacer, (item) =>
    renderRow(item, () => refreshList(), () => refreshList(), uiState.editingLocked)
  );

  const gitMergeAcceptAllOurs = document.getElementById('gitMergeAcceptAllOurs');
  const gitMergeAcceptAllTheirs = document.getElementById('gitMergeAcceptAllTheirs');
  if (gitMergeAcceptAllOurs) {
    gitMergeAcceptAllOurs.addEventListener('click', () => {
      vscode.postMessage({ type: 'resolveAllGitConflicts', side: 'ours' });
    });
  }
  if (gitMergeAcceptAllTheirs) {
    gitMergeAcceptAllTheirs.addEventListener('click', () => {
      vscode.postMessage({ type: 'resolveAllGitConflicts', side: 'theirs' });
    });
  }

  const ro = new ResizeObserver(() => list.refresh());
  ro.observe(viewport);

  stateDdToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = stateDdPanel.hidden;
    stateDdPanel.hidden = !open;
    stateDdToggle.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (!stateDd.contains(e.target as Node)) {
        closeStatePanel(stateDdPanel, stateDdToggle);
      }
    },
    true
  );

  stateDdList.addEventListener('change', () => {
    schedulePostFilterToHost();
  });

  filterText.addEventListener('input', () => schedulePostFilterToHost());

  filterClear.addEventListener('click', () => {
    filterText.value = '';
    stateDdList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
    closeStatePanel(stateDdPanel, stateDdToggle);
    postFilterToHost();
  });

  window.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as {
      type?: string;
      units?: UnitRow[];
      states?: string[];
      message?: string;
      gitConflicts?: GitConflictPayload[];
      editingLocked?: boolean;
      viewMode?: 'editor' | 'conflictsOnly';
      totalCount?: number;
      matchCount?: number;
      fileStats?: FileStats | null;
    };
    if (msg.type === 'loading') {
      mergeHeader.hidden = true;
      editorShell.hidden = true;
      gitMergePanel.hidden = true;
      gitMergeCards.replaceChildren();
      status.textContent = msg.message ?? t('statusLoading');
      return;
    }
    if (msg.type === 'parseError' && typeof msg.message === 'string') {
      mergeHeader.hidden = true;
      editorShell.hidden = true;
      gitMergePanel.hidden = true;
      gitMergeCards.replaceChildren();
      allUnits = [];
      gitConflictCount = 0;
      hostFileStats = null;
      viewMode = 'editor';
      uiState.editingLocked = false;
      list.setItems([]);
      updateFileStats(fileStats, allUnits, 0, null);
      status.textContent = format(t('parseErrorPrefix'), msg.message);
      return;
    }
    if (msg.type === 'units' && Array.isArray(msg.units)) {
      if (msg.states?.length) {
        stateOptions = msg.states;
      }
      allUnits = msg.units.map((u) => ({
        ...u,
        note: typeof u.note === 'string' ? u.note : ''
      }));
      mergeHeader.hidden = false;
      const gc = Array.isArray(msg.gitConflicts) ? (msg.gitConflicts as GitConflictPayload[]) : [];
      gitConflictCount = gc.length;
      uiState.editingLocked = Boolean(msg.editingLocked);
      viewMode = msg.viewMode === 'conflictsOnly' ? 'conflictsOnly' : 'editor';
      totalCount = typeof msg.totalCount === 'number' ? msg.totalCount : allUnits.length;
      matchCount = typeof msg.matchCount === 'number' ? msg.matchCount : allUnits.length;
      totalInFile = typeof msg.totalCount === 'number' ? msg.totalCount : allUnits.length;
      hostFileStats =
        msg.fileStats && typeof msg.fileStats === 'object'
          ? (msg.fileStats as FileStats)
          : null;

      if (gc.length > 0) {
        renderGitMergeCards(gitMergeCards, gc);
        gitMergePanel.hidden = false;
      } else {
        gitMergeCards.replaceChildren();
        gitMergePanel.hidden = true;
      }

      if (viewMode === 'conflictsOnly') {
        editorShell.hidden = true;
      } else {
        editorShell.hidden = false;
      }

      const prevChecked = getCheckedStateSet(stateDdList);
      rebuildStateFilterList(stateDdList, prevChecked);
      updateStateDropdownSummary(stateDdList, stateDdSummary);
      closeStatePanel(stateDdPanel, stateDdToggle);
      refreshList({ resetScroll: firstUnitsLoad });
      firstUnitsLoad = false;
    }
  });

  vscode.postMessage({ type: 'ready' });
}

boot();
