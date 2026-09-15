/**
 * Pause menu: party, bag, Pokédex, save.
 *
 * Built on `MenuStack`/`MenuGrid` from @alola/ui so navigation semantics —
 * wrapping, skipping disabled entries, remembering focus by id across a
 * rebuild — are the tested ones rather than a second implementation.
 */
import { getSpecies, SPECIES_LIST } from '@alola/data';
import { MenuGrid, MenuStack, type MenuItem } from '@alola/ui';
import { GameProfile, maxHpOf, isFainted, type PartyPokemon } from '@alola/game';
import { el, hpColor, injectGameStyles } from './ui-kit.ts';

export type MenuPage = 'root' | 'party' | 'bag' | 'dex' | 'save';

export interface MenuCallbacks {
  onSave(): Promise<string>;
  onClose(): void;
  onHeal?(): void;
}

export class MenuUi {
  private readonly root = el('div', 'ov');
  private readonly card = el('div', 'menu-card');
  private readonly title = el('div', 'menu-title', 'Menu');
  private readonly meta = el('div', 'menu-meta');
  private readonly body = el('div', 'menu-body');
  private readonly foot = el('div', 'menu-foot');

  private readonly stack = new MenuStack();
  private readonly grid = new MenuGrid({ wrap: true });
  private page: MenuPage = 'root';
  private profile: GameProfile | null = null;
  private buttons: HTMLButtonElement[] = [];
  private busy = false;

  private readonly callbacks: MenuCallbacks;

  constructor(callbacks: MenuCallbacks) {
    injectGameStyles();
    this.callbacks = callbacks;

    const scrim = el('div', 'ov-scrim');
    scrim.addEventListener('click', () => this.close());

    const head = el('div', 'menu-head');
    head.append(this.title, this.meta);
    this.card.append(head, this.body, this.foot);
    this.root.append(scrim, this.card);
    document.body.appendChild(this.root);

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean {
    return this.profile !== null;
  }

  open(profile: GameProfile): void {
    this.profile = profile;
    this.page = 'root';
    this.stack.clear();
    this.stack.push('root');
    this.root.classList.add('open');
    this.render();
  }

  close(): void {
    if (!this.profile) return;
    this.profile = null;
    this.root.classList.remove('open');
    this.callbacks.onClose();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.profile) return;
    event.stopPropagation();

    switch (event.code) {
      case 'ArrowUp': case 'KeyW': event.preventDefault(); this.move('up'); break;
      case 'ArrowDown': case 'KeyS': event.preventDefault(); this.move('down'); break;
      case 'Enter': case 'Space': case 'KeyE':
        event.preventDefault();
        this.buttons[this.grid.focusedIndex]?.click();
        break;
      case 'Escape': case 'Tab':
        event.preventDefault();
        if (this.page === 'root') this.close();
        else { this.page = 'root'; this.stack.pop(); this.render(); }
        break;
    }
  };

  private move(direction: 'up' | 'down'): void {
    this.grid.move(direction);
    this.highlight();
  }

  private highlight(): void {
    const index = this.grid.focusedIndex;
    this.buttons.forEach((b, i) => b.classList.toggle('sel', i === index));
    this.buttons[index]?.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    const profile = this.profile;
    if (!profile) return;

    this.body.replaceChildren();
    this.body.classList.toggle('two', this.page === 'dex');
    this.buttons = [];

    const hours = Math.floor(profile.playtimeSeconds / 3600);
    const minutes = Math.floor((profile.playtimeSeconds % 3600) / 60);
    this.meta.textContent =
      `${profile.name} · ₽${profile.money.toLocaleString()} · ` +
      `dex ${profile.dexCaught}/${profile.dexSeen} · ${hours}h ${String(minutes).padStart(2, '0')}m`;

    const items: MenuItem[] = [];
    const add = (
      id: string, label: string, sub: string | null, enabled: boolean, onClick: () => void,
    ): void => {
      // A single column, so every entry is its own row.
      items.push({ id, label, row: items.length, col: 0, enabled });
      const node = el('button', 'btn');
      node.append(document.createTextNode(label));
      if (sub) node.append(el('span', 'btn-sub', sub));
      node.disabled = !enabled;
      node.addEventListener('click', () => {
        if (node.disabled || this.busy) return;
        onClick();
      });
      node.addEventListener('mouseenter', () => {
        if (node.disabled) return;
        this.grid.focusById(id);
        this.highlight();
      });
      this.body.appendChild(node);
      this.buttons.push(node);
    };

    switch (this.page) {
      case 'root':
        this.title.textContent = 'Menu';
        this.foot.textContent = 'W/S or ↑/↓ to move · Enter to choose · Esc to close';
        add('party', 'Pokémon', `${profile.party.length} in party`, profile.party.length > 0, () => this.go('party'));
        add('bag', 'Bag', `${profile.bag.entries().length} kinds of item`, true, () => this.go('bag'));
        add('dex', 'Pokédex', `${profile.dexCaught} caught, ${profile.dexSeen} seen`, true, () => this.go('dex'));
        add('heal', 'Rest', 'restore the whole party', profile.party.some((p) => this.isHurt(p)), () => {
          profile.healParty();
          this.callbacks.onHeal?.();
          this.render();
        });
        add('save', 'Save', 'write to this browser', true, () => { void this.doSave(); });
        add('close', 'Close', null, true, () => this.close());
        break;

      case 'party':
        this.title.textContent = 'Pokémon';
        this.foot.textContent = 'Esc to go back';
        profile.party.forEach((mon, index) => {
          const species = getSpecies(mon.species);
          const max = maxHpOf(mon);
          const label = `${mon.nickname ?? species.name}${mon.shiny ? ' ✦' : ''}  Lv ${mon.level}`;
          const moves = mon.moves.map((m) => m.id.replace(/-/g, ' ')).join(', ');
          const sub = isFainted(mon)
            ? `fainted · ${species.types.join('/')}`
            : `${mon.currentHp}/${max} HP · ${species.types.join('/')} · ${moves}`;
          add(`mon-${index}`, label, sub, true, () => {
            // Selecting a party member promotes it to the front, which is the
            // one party operation that matters outside a battle.
            profile.swapParty(0, index);
            this.render();
          });
          const bar = el('div', 'mon-bar');
          const fill = el('div');
          const fraction = max > 0 ? Math.max(0, mon.currentHp) / max : 0;
          fill.style.width = `${fraction * 100}%`;
          fill.style.background = hpColor(fraction);
          bar.appendChild(fill);
          this.buttons[this.buttons.length - 1].appendChild(bar);
        });
        break;

      case 'bag': {
        this.title.textContent = 'Bag';
        this.foot.textContent = 'Esc to go back';
        const entries = profile.bag.entries();
        if (entries.length === 0) add('empty', '(nothing in the bag)', null, false, () => {});
        for (const entry of entries) {
          add(entry.item.id, `${entry.item.name}  ×${entry.count}`, entry.item.description ?? entry.item.category, false, () => {});
        }
        for (const id of profile.bag.keyItemIds()) {
          add(`key-${id}`, getKeyItemName(id), 'key item', false, () => {});
        }
        break;
      }

      case 'dex': {
        this.title.textContent = 'Pokédex';
        this.foot.textContent = `${profile.dexCaught} caught · ${profile.dexSeen} seen · ${SPECIES_LIST.length} in Alola`;
        for (const species of SPECIES_LIST) {
          const entry = profile.pokedex.get(species.id);
          const label = entry?.seen ? species.name : '— — —';
          const sub = entry?.caught ? `caught · ${species.types.join('/')}`
            : entry?.seen ? `seen · ${species.types.join('/')}`
            : 'not encountered';
          add(`dex-${species.id}`, `#${String(species.alolaDex || species.dex).padStart(3, '0')}  ${label}`, sub, false, () => {});
        }
        break;
      }

      case 'save':
        break;
    }

    this.grid.setItems(items);
    this.highlight();
  }

  private isHurt(mon: PartyPokemon): boolean {
    return mon.currentHp < maxHpOf(mon) || mon.status !== 'none';
  }

  private go(page: MenuPage): void {
    this.page = page;
    this.stack.push(page);
    this.render();
  }

  private async doSave(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.foot.textContent = 'saving…';
    try {
      this.foot.textContent = await this.callbacks.onSave();
    } catch (error) {
      this.foot.textContent = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.busy = false;
    }
  }
}

function getKeyItemName(id: string): string {
  try {
    return getSpecies(id).name;
  } catch {
    return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
