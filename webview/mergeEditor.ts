import { VirtualList } from './virtualList';

interface UnitRow {
  id: string;
  source: string;
  target: string;
  targetState: string;
}

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

const vscode = acquireVsCodeApi();

function el(tag: string, className: string | undefined, text: string): HTMLElement {
  const n = document.createElement(tag);
  if (className) {
    n.className = className;
  }
  n.textContent = text;
  return n;
}

function renderRow(item: unknown): HTMLElement {
  const u = item as UnitRow;
  const row = document.createElement('div');
  row.className = 'row';
  const id = el('div', 'cell id', u.id);
  const src = el('div', 'cell src', u.source);
  const tgt = el('div', 'cell tgt', u.target);
  const st = el('div', 'cell state', u.targetState);
  row.appendChild(id);
  row.appendChild(src);
  row.appendChild(tgt);
  row.appendChild(st);
  return row;
}

function boot(): void {
  const viewport = document.getElementById('viewport');
  const spacer = document.getElementById('spacer');
  const status = document.getElementById('status');
  if (!viewport || !spacer || !status) {
    return;
  }

  const list = new VirtualList(viewport, spacer, (item) => renderRow(item));

  const ro = new ResizeObserver(() => list.refresh());
  ro.observe(viewport);

  window.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as { type?: string; units?: UnitRow[]; message?: string };
    if (msg.type === 'loading') {
      status.textContent = msg.message ?? 'Loading…';
      return;
    }
    if (msg.type === 'units' && msg.units) {
      status.textContent = `${msg.units.length} trans-units`;
      list.setItems(msg.units);
    }
  });

  vscode.postMessage({ type: 'ready' });
}

boot();
