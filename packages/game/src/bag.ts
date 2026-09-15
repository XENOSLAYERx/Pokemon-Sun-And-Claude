/**
 * The bag.
 *
 * Counted items plus a separate key-item list, matching the save schema — key
 * items live apart specifically so they cannot be sold or consumed by a
 * generic "use item" path.
 */
import { getItem, tryGetItem, type ItemDefinition } from '@alola/data';
import type { SavedInventory } from '@alola/save';

export class Bag {
  private counts = new Map<string, number>();
  private keyItems = new Set<string>();

  add(itemId: string, count = 1): void {
    const item = getItem(itemId);
    if (item.category === 'key') {
      this.keyItems.add(itemId);
      return;
    }
    this.counts.set(itemId, Math.min(999, (this.counts.get(itemId) ?? 0) + count));
  }

  /** Remove items. Returns false and changes nothing when there are too few. */
  remove(itemId: string, count = 1): boolean {
    const have = this.counts.get(itemId) ?? 0;
    if (have < count) return false;
    if (have === count) this.counts.delete(itemId);
    else this.counts.set(itemId, have - count);
    return true;
  }

  count(itemId: string): number {
    return this.counts.get(itemId) ?? 0;
  }

  hasKeyItem(itemId: string): boolean {
    return this.keyItems.has(itemId);
  }

  /** Every non-key item held, in a stable display order. */
  entries(): { item: ItemDefinition; count: number }[] {
    return [...this.counts.entries()]
      .map(([id, count]) => ({ item: getItem(id), count }))
      .filter((e) => e.count > 0)
      .sort((a, b) => {
        const byCategory = a.item.category.localeCompare(b.item.category);
        return byCategory !== 0 ? byCategory : a.item.name.localeCompare(b.item.name);
      });
  }

  ofCategory(category: ItemDefinition['category']): { item: ItemDefinition; count: number }[] {
    return this.entries().filter((e) => e.item.category === category);
  }

  keyItemIds(): string[] {
    return [...this.keyItems].sort();
  }

  toSaved(): SavedInventory {
    return {
      items: Object.fromEntries([...this.counts.entries()].filter(([, c]) => c > 0)),
      keyItems: this.keyItemIds(),
    };
  }

  static fromSaved(saved: SavedInventory): Bag {
    const bag = new Bag();
    // Unknown ids are dropped rather than crashing the load — a save written
    // before an item was removed must still open.
    for (const [id, count] of Object.entries(saved.items ?? {})) {
      if (tryGetItem(id) && count > 0) bag.counts.set(id, count);
    }
    for (const id of saved.keyItems ?? []) {
      if (tryGetItem(id)) bag.keyItems.add(id);
    }
    return bag;
  }
}
