export type RowRenderer = (item: unknown, index: number) => HTMLElement;

/**
 * Virtual list: viewport scrolls; spacer provides total height; only visible rows are mounted.
 */
export class VirtualList {
  private viewport: HTMLElement;
  private spacer: HTMLElement;
  private items: unknown[] = [];
  /** Must match `.row` min-height in mergeEditor.html (virtual spacer). */
  private itemHeight = 108;
  private visibleBuffer = 5;
  private renderFn: RowRenderer;

  constructor(viewport: HTMLElement, spacer: HTMLElement, renderFn: RowRenderer) {
    this.viewport = viewport;
    this.spacer = spacer;
    this.renderFn = renderFn;
    this.spacer.style.position = 'relative';
    this.viewport.addEventListener('scroll', () => this.onScroll(), { passive: true });
  }

  setItems(items: unknown[]): void {
    this.items = items;
    const total = Math.max(0, items.length * this.itemHeight);
    this.spacer.style.height = `${total}px`;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  /** Scroll so row `index` is near the top of the viewport (best-effort). */
  scrollToIndex(index: number): void {
    const i = Math.max(0, Math.min(index, Math.max(0, this.items.length - 1)));
    this.viewport.scrollTop = i * this.itemHeight;
    this.render();
  }

  private onScroll(): void {
    this.render();
  }

  private render(): void {
    const scrollTop = this.viewport.scrollTop;
    const viewportH = this.viewport.clientHeight;
    const visibleCount = Math.ceil(viewportH / this.itemHeight) + this.visibleBuffer;
    const startIdx = Math.max(0, Math.floor(scrollTop / this.itemHeight) - 2);
    const endIdx = Math.min(this.items.length, startIdx + visibleCount + 4);

    const fragment = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      const el = this.renderFn(this.items[i], i);
      el.style.position = 'absolute';
      el.style.top = `${i * this.itemHeight}px`;
      el.style.left = '0';
      el.style.right = '0';
      el.style.boxSizing = 'border-box';
      fragment.appendChild(el);
    }

    this.spacer.replaceChildren(fragment);
  }
}
