/**
 * New game: name, look, starter.
 *
 * Deliberately short. The character creator in @alola/ui carries the full
 * option set — this screen exposes the handful of choices that change what the
 * player sees in the first minute, and rolls the rest, because a thirty-slider
 * creator in front of a prototype is a wall, not a welcome.
 */
import { getSpecies } from '@alola/data';
import { randomAppearance, combinationCount, type CharacterAppearance } from '@alola/ui';
import { Rng } from '@alola/core';
import { el, TYPE_COLORS, injectGameStyles } from './ui-kit.ts';

export interface NewGameChoice {
  readonly name: string;
  readonly starter: string;
  readonly appearance: CharacterAppearance;
}

const STARTERS = ['ROWLET', 'LITTEN', 'POPPLIO'] as const;

const BLURBS: Record<string, string> = {
  ROWLET: 'Quiet and watchful. Flies without a sound.',
  LITTEN: 'Guarded, and slow to trust. Burns hot when it does.',
  POPPLIO: 'Relentlessly cheerful. Practises constantly.',
};

export function askNewGame(seed: number): Promise<NewGameChoice> {
  injectGameStyles();

  return new Promise((resolve) => {
    const root = el('div', 'ov');
    root.classList.add('open');
    root.style.zIndex = '30';

    const scrim = el('div', 'ov-scrim');
    const card = el('div', 'menu-card');
    card.style.width = 'min(680px, 92vw)';

    const head = el('div', 'menu-head');
    head.append(
      el('div', 'menu-title', 'Welcome to Alola'),
      el('div', 'menu-meta', `${combinationCount().total.toLocaleString()} possible looks`),
    );

    const body = el('div', 'menu-body');

    // --- name
    const nameRow = el('div');
    nameRow.append(el('div', 'label', 'Your name'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.value = 'Kai';
    nameInput.maxLength = 12;
    nameInput.style.cssText =
      'width:100%;margin-top:6px;padding:9px 12px;border-radius:9px;font:inherit;' +
      'background:rgba(10,18,32,0.9);border:1px solid rgba(120,180,255,0.28);color:#e8eef7;';
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    // --- appearance
    const rollRng = (value: number): (() => number) => {
      const rng = new Rng(value);
      return () => rng.next();
    };
    let appearance = randomAppearance(rollRng(seed));
    const lookRow = el('div');
    lookRow.style.cssText = 'display:flex;gap:10px;align-items:center;';
    const lookLabel = el('div', 'label', 'Appearance rolled');
    const reroll = el('button', 'btn');
    reroll.textContent = 'Roll again';
    reroll.style.width = 'auto';
    let rollSeed = seed;
    reroll.addEventListener('click', () => {
      rollSeed = (rollSeed * 1664525 + 1013904223) | 0;
      appearance = randomAppearance(rollRng(rollSeed));
      lookLabel.textContent = `Appearance rolled (#${(rollSeed >>> 0).toString(16)})`;
    });
    lookRow.append(lookLabel, reroll);
    body.appendChild(lookRow);

    // --- starter
    body.appendChild(el('div', 'label', 'Choose a partner'));
    let chosen: string = STARTERS[0];
    const buttons: HTMLButtonElement[] = [];

    for (const id of STARTERS) {
      const species = getSpecies(id);
      const node = el('button', 'btn');
      const title = el('span');
      title.textContent = species.name;
      title.style.fontWeight = '700';
      const types = el('span');
      types.style.cssText = 'margin-left:8px;font-size:10px;letter-spacing:0.06em;';
      for (const type of species.types) {
        const chip = el('span', undefined, type.toUpperCase());
        chip.style.cssText =
          `background:${TYPE_COLORS[type] ?? '#888'};color:#0b1018;font-weight:700;` +
          'border-radius:3px;padding:1px 5px;margin-right:4px;';
        types.appendChild(chip);
      }
      node.append(title, types, el('span', 'btn-sub', BLURBS[id] ?? species.flavorText));
      node.addEventListener('click', () => {
        chosen = id;
        buttons.forEach((b) => b.classList.toggle('sel', b === node));
      });
      buttons.push(node);
      body.appendChild(node);
    }
    buttons[0].classList.add('sel');

    // --- confirm
    const start = el('button', 'btn');
    start.textContent = 'Begin';
    start.style.cssText += 'text-align:center;border-color:#6fb4ff;background:rgba(24,46,78,0.95);';
    start.addEventListener('click', () => {
      root.remove();
      resolve({
        name: nameInput.value.trim() || 'Trainer',
        starter: chosen,
        appearance,
      });
    });

    const foot = el('div', 'menu-foot');
    foot.append(start);

    card.append(head, body, foot);
    root.append(scrim, card);
    document.body.appendChild(root);
    nameInput.focus();
    nameInput.select();

    // Enter starts the game from anywhere on this screen.
    root.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') start.click();
    });
  });
}
