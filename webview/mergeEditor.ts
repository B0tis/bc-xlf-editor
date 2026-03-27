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
  afterTargetBlur: () => void
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
  tgtCell.appendChild(ta);

  const stCell = document.createElement('div');
  stCell.className = 'cell state';
  const sel = document.createElement('select');
  sel.className = 'state-select';
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

function updateFileStats(container: HTMLElement, units: UnitRow[]): void {
  container.replaceChildren();
  if (units.length === 0) {
    container.appendChild(makeStatChip('Trans-units', 0, 'stat-total'));
    return;
  }
  const st = computeFileStats(units);
  container.appendChild(makeStatChip('Total', st.total, 'stat-total'));
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

function boot(): void {
  const viewport = document.getElementById('viewport');
  const spacer = document.getElementById('spacer');
  const mergeHeader = document.getElementById('mergeHeader');
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

  const refreshList = (opts?: { resetScroll?: boolean }): void => {
    const stateSet = getStateFilterSet(stateDdList);
    const filtered = filterUnits(allUnits, stateSet, filterText.value);
    if (opts?.resetScroll) {
      viewport.scrollTop = 0;
    }
    list.setItems(filtered);
    updateStateDropdownSummary(stateDdList, stateDdSummary);

    updateFileStats(fileStats, allUnits);

    const total = allUnits.length;
    const shown = filtered.length;
    const hint = ' — edit target / state; changes apply to the file buffer';
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
    renderRow(item, () => refreshList(), scheduleRefreshList)
  );

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
    };
    if (msg.type === 'loading') {
      mergeHeader.hidden = true;
      status.textContent = msg.message ?? 'Loading…';
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
