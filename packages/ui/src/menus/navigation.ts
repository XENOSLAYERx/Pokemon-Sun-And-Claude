/**
 * Menu navigation.
 *
 * A grid-based focus model that works identically for gamepad, keyboard and
 * touch. The reason to model this rather than rely on DOM focus order is that
 * a Pokémon party screen, a box grid and a bag list all need directional
 * navigation that wraps sensibly and skips disabled entries — and getting that
 * right by hand per screen is how inconsistent, frustrating menus happen.
 */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** Grid position. */
  readonly row: number;
  readonly col: number;
  readonly enabled: boolean;
  /** Optional payload for the screen that owns this menu. */
  readonly data?: unknown;
}

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface MenuOptions {
  /** Wrap around the edges rather than stopping. */
  readonly wrap?: boolean;
  /** Allow moving focus onto disabled items. */
  readonly allowDisabled?: boolean;
}

export class MenuGrid {
  private items: MenuItem[] = [];
  private focusIndex = 0;
  private readonly wrap: boolean;
  private readonly allowDisabled: boolean;

  /** Fired when focus moves — the client plays a cursor sound. */
  onFocusChange: ((item: MenuItem | null) => void) | null = null;

  constructor(opts: MenuOptions = {}) {
    this.wrap = opts.wrap ?? true;
    this.allowDisabled = opts.allowDisabled ?? false;
  }

  setItems(items: readonly MenuItem[]): void {
    // Capture the previously focused id BEFORE swapping the array: reading it
    // afterwards resolves the old index against the new list and returns the
    // wrong item, which silently moves the player's cursor.
    const previous = this.focused?.id;
    this.items = [...items];
    if (previous) {
      const index = this.items.findIndex((i) => i.id === previous);
      this.focusIndex = index >= 0 ? index : 0;
    } else {
      this.focusIndex = 0;
    }
    if (!this.allowDisabled && this.items.length > 0 && !this.items[this.focusIndex]?.enabled) {
      const firstEnabled = this.items.findIndex((i) => i.enabled);
      if (firstEnabled >= 0) this.focusIndex = firstEnabled;
    }
  }

  get focused(): MenuItem | null {
    return this.items[this.focusIndex] ?? null;
  }

  get focusedIndex(): number {
    return this.focusIndex;
  }

  focusById(id: string): boolean {
    const index = this.items.findIndex((i) => i.id === id);
    if (index < 0) return false;
    this.focusIndex = index;
    this.onFocusChange?.(this.focused);
    return true;
  }

  /**
   * Move focus.
   *
   * Picks the nearest candidate in the requested direction, scored by primary
   * axis distance first and secondary axis drift second. That is what makes
   * navigation feel right on a ragged grid — a strict same-row/same-column
   * rule strands the cursor on any layout that is not a perfect rectangle.
   */
  move(direction: NavDirection): boolean {
    const current = this.focused;
    if (!current || this.items.length === 0) return false;

    let best: { index: number; score: number } | null = null;

    for (let i = 0; i < this.items.length; i++) {
      if (i === this.focusIndex) continue;
      const item = this.items[i];
      if (!this.allowDisabled && !item.enabled) continue;

      const dRow = item.row - current.row;
      const dCol = item.col - current.col;

      let primary: number;
      let secondary: number;
      switch (direction) {
        case 'up':
          if (dRow >= 0) continue;
          primary = -dRow;
          secondary = Math.abs(dCol);
          break;
        case 'down':
          if (dRow <= 0) continue;
          primary = dRow;
          secondary = Math.abs(dCol);
          break;
        case 'left':
          if (dCol >= 0) continue;
          primary = -dCol;
          secondary = Math.abs(dRow);
          break;
        case 'right':
          if (dCol <= 0) continue;
          primary = dCol;
          secondary = Math.abs(dRow);
          break;
      }

      // Weight the primary axis heavily so a distant item directly in line
      // beats a near item far off-axis.
      const score = primary * 10 + secondary * 3;
      if (best === null || score < best.score) {
        best = { index: i, score };
      }
    }

    if (best === null) {
      return this.wrap ? this.wrapFocus(direction) : false;
    }

    this.focusIndex = best.index;
    this.onFocusChange?.(this.focused);
    return true;
  }

  /** Jump to the far edge when wrapping. */
  private wrapFocus(direction: NavDirection): boolean {
    const current = this.focused;
    if (!current) return false;

    const candidates = this.items.filter(
      (i, idx) => idx !== this.focusIndex && (this.allowDisabled || i.enabled),
    );
    if (candidates.length === 0) return false;

    let target: MenuItem | null = null;
    for (const item of candidates) {
      switch (direction) {
        case 'up':
          // Wrap to the bottom-most item in the nearest column.
          if (!target || item.row > target.row ||
              (item.row === target.row && Math.abs(item.col - current.col) < Math.abs(target.col - current.col))) {
            target = item;
          }
          break;
        case 'down':
          if (!target || item.row < target.row ||
              (item.row === target.row && Math.abs(item.col - current.col) < Math.abs(target.col - current.col))) {
            target = item;
          }
          break;
        case 'left':
          if (!target || item.col > target.col ||
              (item.col === target.col && Math.abs(item.row - current.row) < Math.abs(target.row - current.row))) {
            target = item;
          }
          break;
        case 'right':
          if (!target || item.col < target.col ||
              (item.col === target.col && Math.abs(item.row - current.row) < Math.abs(target.row - current.row))) {
            target = item;
          }
          break;
      }
    }

    if (!target) return false;
    this.focusIndex = this.items.indexOf(target);
    this.onFocusChange?.(this.focused);
    return true;
  }

  /** Confirm the focused item. Returns null when it is disabled. */
  confirm(): MenuItem | null {
    const item = this.focused;
    if (!item || !item.enabled) return null;
    return item;
  }

  get itemCount(): number {
    return this.items.length;
  }
}

/** A stack of menu screens, so Back always does the obvious thing. */
export class MenuStack {
  private stack: string[] = [];

  push(screen: string): void {
    this.stack.push(screen);
  }

  pop(): string | null {
    return this.stack.pop() ?? null;
  }

  get current(): string | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Close everything — used when a battle or cutscene interrupts. */
  clear(): void {
    this.stack.length = 0;
  }

  replace(screen: string): void {
    if (this.stack.length > 0) this.stack[this.stack.length - 1] = screen;
    else this.stack.push(screen);
  }
}
