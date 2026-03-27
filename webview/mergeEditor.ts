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
  btnAl.textContent = 'AL';
  btnAl.title =
    'Open AL: finds single-quoted strings after Caption / ToolTip / Label in the source (and target), searches those literals in .al files, and uses the Xliff Generator note to rank matches when several files contain the same text.';
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
  btnXlf.textContent = 'XLF';
  btnXlf.title = 'Reveal this trans-unit in the XLF XML';
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
    ta.title = 'Resolve Git merge conflicts in the panel above first.';
  }
  tgtCell.appendChild(ta);

  const stCell = document.createElement('div');
  stCell.className = 'cell state';
  const sel = document.createElement('select');
  sel.className = 'state-select';
  sel.disabled = editingLocked;
  if (editingLocked) {
    sel.title = 'Resolve Git merge conflicts in the panel above first.';
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
    summaryEl.textContent = 'All states';
    return;
  }
  const labels = [...set];
  labels.sort();
  if (labels.length <= 2) {
    summaryEl.textContent = labels.join(', ');
    return;
  }
  summaryEl.textContent = `${labels.length} states: ${labels.slice(0, 2).join(', ')}…`;
}

function closeStatePanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement
): void {
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

function filterUnits(rows: UnitRow[], states: Set<string> | null, textQ: string): UnitRow[] {
  let out = rows;
  if (states) {
    out = out.filter((u) => states.has(u.targetState));
  }
  const q = textQ.trim().toLowerCase();
  if (!q) {
    return out;
  }
  return out.filter(
    (u) =>
      u.id.toLowerCase().includes(q) ||
      u.source.toLowerCase().includes(q) ||
      u.target.toLowerCase().includes(q)
  );
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

function updateFileStats(container: HTMLElement, units: UnitRow[], gitConflictCount: number): void {
  container.replaceChildren();
  if (units.length === 0) {
    container.appendChild(makeStatChip('Trans-units', 0, 'stat-total'));
    return;
  }
  const st = computeFileStats(units);
  container.appendChild(makeStatChip('Total', st.total, 'stat-total'));
  if (gitConflictCount > 0) {
    container.appendChild(makeStatChip('Git conflicts', gitConflictCount, 'stat-review'));
  }
  container.appendChild(makeStatChip('Needs translation', st.needsTranslation, 'stat-missing'));
  container.appendChild(makeStatChip('Empty target', st.emptyTarget, 'stat-missing'));
  container.appendChild(makeStatChip('Needs review', st.needsReview, 'stat-review'));
  container.appendChild(makeStatChip('Needs adaptation', st.needsAdaptation, 'stat-adapt'));
  const done = st.translated + st.final;
  container.appendChild(makeStatChip('Translated + final', done, 'stat-done'));
  if (st.otherState > 0) {
    container.appendChild(makeStatChip('Other state', st.otherState, 'stat-adapt'));
  }
}

interface GitConflictPayload {
  index: number;
  transUnitId: string;
  ours: { source: string; target: string; targetState: string };
  theirs: { source: string; target: string; targetState: string };
}

function formatConflictSide(side: GitConflictPayload['ours']): string {
  return `source:\n${side.source}\n\ntarget:\n${side.target}\n\nstate: ${side.targetState}`;
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
    oursLab.textContent = 'Current (ours / HEAD)';
    const oursPre = document.createElement('pre');
    oursPre.className = 'git-merge-pre';
    oursPre.textContent = formatConflictSide(c.ours);
    oursWrap.appendChild(oursLab);
    oursWrap.appendChild(oursPre);

    const theirsWrap = document.createElement('div');
    const theirsLab = document.createElement('div');
    theirsLab.className = 'git-merge-side-label';
    theirsLab.textContent = 'Incoming (theirs)';
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
    bOurs.textContent = 'Use current (ours)';
    bOurs.addEventListener('click', () => {
      vscode.postMessage({ type: 'resolveGitConflict', index: c.index, side: 'ours' });
    });
    const bTheirs = document.createElement('button');
    bTheirs.type = 'button';
    bTheirs.textContent = 'Use incoming (theirs)';
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

function boot(): void {
  const viewport = document.getElementById('viewport');
  const spacer = document.getElementById('spacer');
  const mergeHeader = document.getElementById('mergeHeader');
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

  let listDebounce: ReturnType<typeof setTimeout> | undefined;
  let list: VirtualList;

  let firstUnitsLoad = true;
  const uiState = { editingLocked: false };
  let gitConflictCount = 0;

  const refreshList = (opts?: { resetScroll?: boolean }): void => {
    const stateSet = getStateFilterSet(stateDdList);
    const filtered = filterUnits(allUnits, stateSet, filterText.value);
    if (opts?.resetScroll) {
      viewport.scrollTop = 0;
    }
    list.setItems(filtered);
    updateStateDropdownSummary(stateDdList, stateDdSummary);

    updateFileStats(fileStats, allUnits, gitConflictCount);

    const total = allUnits.length;
    const shown = filtered.length;
    const hint = uiState.editingLocked
      ? ' — resolve Git conflicts above to edit targets'
      : ' — edit target / state; changes apply to the file buffer';
    if (!hasActiveFilters(stateDdList, filterText)) {
      status.textContent = `List: ${total} trans-units${hint}`;
    } else {
      status.textContent = `List: showing ${shown} of ${total} trans-units (filters active)${hint}`;
    }
  };

  const scheduleRefreshList = (): void => {
    if (listDebounce !== undefined) {
      clearTimeout(listDebounce);
    }
    listDebounce = setTimeout(() => {
      listDebounce = undefined;
      refreshList({ resetScroll: true });
    }, 200);
  };

  list = new VirtualList(viewport, spacer, (item) =>
    renderRow(item, () => refreshList(), scheduleRefreshList, uiState.editingLocked)
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
    refreshList({ resetScroll: true });
  });

  filterText.addEventListener('input', () => scheduleRefreshList());

  filterClear.addEventListener('click', () => {
    filterText.value = '';
    stateDdList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
    closeStatePanel(stateDdPanel, stateDdToggle);
    refreshList({ resetScroll: true });
  });

  window.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as {
      type?: string;
      units?: UnitRow[];
      states?: string[];
      message?: string;
      gitConflicts?: GitConflictPayload[];
      editingLocked?: boolean;
    };
    if (msg.type === 'loading') {
      mergeHeader.hidden = true;
      gitMergePanel.hidden = true;
      gitMergeCards.replaceChildren();
      status.textContent = msg.message ?? 'Loading…';
      return;
    }
    if (msg.type === 'parseError' && typeof msg.message === 'string') {
      mergeHeader.hidden = true;
      gitMergePanel.hidden = true;
      gitMergeCards.replaceChildren();
      allUnits = [];
      gitConflictCount = 0;
      uiState.editingLocked = false;
      list.setItems([]);
      updateFileStats(fileStats, allUnits, 0);
      status.textContent = `Parse error: ${msg.message}`;
      return;
    }
    if (msg.type === 'units' && msg.units) {
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
      if (gc.length > 0) {
        renderGitMergeCards(gitMergeCards, gc);
        gitMergePanel.hidden = false;
      } else {
        gitMergeCards.replaceChildren();
        gitMergePanel.hidden = true;
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
