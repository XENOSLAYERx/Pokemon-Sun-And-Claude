import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@alola/core';
import {
  APPEARANCE_OPTIONS, CLOTHING, combinationCount, optionsForSlot, unlockedOptions,
  sanitiseAppearance, randomAppearance, defaultAppearance, defaultOutfit,
} from '../src/creator/character.ts';
import type { ClothingSlot } from '../src/creator/character.ts';
import { Hud, HUD_LAYOUTS } from '../src/hud/state.ts';
import { MenuGrid, MenuStack } from '../src/menus/navigation.ts';
import type { MenuItem } from '../src/menus/navigation.ts';

describe('Character creator', () => {
  test('delivers far more than "thousands" of combinations', () => {
    const counts = combinationCount();
    assert.ok(counts.appearance > 1_000_000, `appearance space is only ${counts.appearance}`);
    assert.ok(counts.outfit > 1_000_000, `outfit space is only ${counts.outfit}`);
    assert.ok(Number.isFinite(counts.total));
  });

  test('every appearance option is usable', () => {
    for (const option of APPEARANCE_OPTIONS) {
      assert.ok(option.count >= 1, `${option.id} has no options`);
      assert.ok(option.label.length > 0, `${option.id} has no label`);
      if (option.palettes !== undefined) {
        assert.ok(option.palettes >= 1, `${option.id} has an empty palette`);
      }
    }
  });

  test('every clothing slot has at least one option, and optional slots have "none"', () => {
    const slots: ClothingSlot[] = [
      'hat', 'eyewear', 'top', 'outerwear', 'bottom', 'socks', 'shoes', 'bag', 'accessory',
    ];
    for (const slot of slots) {
      const options = optionsForSlot(slot);
      assert.ok(options.length > 0, `slot "${slot}" has no clothing`);
      for (const option of options) {
        assert.ok(option.palettes >= 1, `${option.id} has no palette`);
        assert.ok(option.price >= 0, `${option.id} has a negative price`);
      }
    }
    // Slots a player may reasonably want empty must offer that.
    for (const slot of ['hat', 'eyewear', 'outerwear', 'socks', 'accessory'] as ClothingSlot[]) {
      assert.ok(
        optionsForSlot(slot).some((o) => o.id.startsWith('none-')),
        `slot "${slot}" must offer a "none" option`,
      );
    }
  });

  test('clothing ids are unique', () => {
    const seen = new Set<string>();
    for (const option of CLOTHING) {
      assert.ok(!seen.has(option.id), `duplicate clothing id "${option.id}"`);
      seen.add(option.id);
    }
  });

  test('locked clothing stays hidden until its flag is set', () => {
    const noFlags = new Set<string>();
    const locked = unlockedOptions('hat', noFlags);
    assert.ok(!locked.some((o) => o.id === 'trial-headband'), 'reward clothing should be hidden');

    const unlocked = unlockedOptions('hat', new Set(['trial_1_done']));
    assert.ok(unlocked.some((o) => o.id === 'trial-headband'), 'and revealed once earned');
  });

  test('the default appearance and outfit are valid', () => {
    const appearance = defaultAppearance();
    assert.deepEqual(sanitiseAppearance(appearance), appearance, 'the default must already be legal');

    const outfit = defaultOutfit();
    for (const [key, value] of Object.entries(outfit)) {
      if (key.endsWith('Color')) {
        assert.ok(typeof value === 'number' && value >= 0, `${key} is not a valid palette index`);
      } else {
        assert.ok(CLOTHING.some((c) => c.id === value), `default outfit references unknown item "${value}"`);
      }
    }
  });

  test('out-of-range indices are clamped rather than crashing', () => {
    const broken = {
      ...defaultAppearance(),
      hairStyle: 9999,
      skinTone: -5,
      eyeColor: Number.NaN,
      bodyType: 1.7,
    };
    const fixed = sanitiseAppearance(broken);
    assert.ok(fixed.hairStyle < 32 && fixed.hairStyle >= 0);
    assert.equal(fixed.skinTone, 0);
    assert.equal(fixed.eyeColor, 0);
    assert.equal(fixed.bodyType, 1, 'fractional indices should floor');
  });

  test('randomised appearances are always valid', () => {
    const rng = new Rng('creator');
    for (let i = 0; i < 300; i++) {
      const appearance = randomAppearance(() => rng.next());
      assert.deepEqual(
        sanitiseAppearance(appearance),
        appearance,
        'a randomised appearance must already be in range',
      );
    }
  });

  test('randomisation actually varies', () => {
    const rng = new Rng('variety');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(JSON.stringify(randomAppearance(() => rng.next())));
    }
    assert.ok(seen.size > 190, `only ${seen.size} distinct results from 200 rolls`);
  });
});

describe('HUD', () => {
  test('layouts control which elements are visible', () => {
    const hud = new Hud();
    hud.setLayout('explore');
    assert.ok(hud.isVisible('party'));
    assert.ok(hud.isVisible('minimap'));

    hud.setLayout('battle');
    assert.ok(!hud.isVisible('minimap'), 'the minimap has no place in a battle');
    assert.ok(hud.isVisible('notifications'));

    hud.setLayout('cutscene');
    for (const element of Object.keys(HUD_LAYOUTS) as never[]) void element;
    assert.ok(!hud.isVisible('party'), 'a cutscene should be clean');
  });

  test('changing layout clears a stale prompt', () => {
    const hud = new Hud();
    hud.offerPrompt({ button: 'a', label: 'Talk', priority: 1, distance: 2 });
    hud.update(1 / 60);
    assert.ok(hud.state.prompt);

    hud.setLayout('battle');
    assert.equal(hud.state.prompt, null, 'a prompt from another context must not linger');
  });

  test('the highest-priority prompt wins, then the nearest', () => {
    const hud = new Hud();
    hud.offerPrompt({ button: 'a', label: 'Pick up', priority: 1, distance: 1 });
    hud.offerPrompt({ button: 'x', label: 'Mount', priority: 5, distance: 8 });
    hud.offerPrompt({ button: 'b', label: 'Talk', priority: 5, distance: 3 });
    hud.update(1 / 60);
    assert.equal(hud.state.prompt?.label, 'Talk', 'priority first, then distance');
  });

  test('prompts do not persist once no longer offered', () => {
    const hud = new Hud();
    hud.offerPrompt({ button: 'a', label: 'Talk', priority: 1, distance: 2 });
    hud.update(1 / 60);
    assert.ok(hud.state.prompt);
    hud.update(1 / 60);
    assert.equal(hud.state.prompt, null, 'walking away should clear the prompt');
  });

  test('notifications expire on schedule', () => {
    const hud = new Hud({ notificationDuration: 2 });
    hud.notify('item', 'Found a Pearl');
    assert.equal(hud.state.notifications.length, 1);

    for (let i = 0; i < 60; i++) hud.update(1 / 60);
    assert.equal(hud.state.notifications.length, 1, 'should still be showing after one second');

    for (let i = 0; i < 90; i++) hud.update(1 / 60);
    assert.equal(hud.state.notifications.length, 0, 'should have expired');
  });

  test('the notification queue is bounded, keeping the newest', () => {
    const hud = new Hud({ maxNotifications: 3 });
    for (let i = 0; i < 10; i++) hud.notify('item', `Item ${i}`);
    assert.equal(hud.state.notifications.length, 3);
    assert.equal(hud.state.notifications[2].title, 'Item 9', 'the newest event must be visible');
  });

  test('notifications can be dismissed early', () => {
    const hud = new Hud();
    const id = hud.notify('quest', 'Objective complete');
    hud.dismiss(id);
    assert.equal(hud.state.notifications.length, 0);
    hud.dismiss(9999); // Must not throw.
  });

  test('notification alpha fades in and out', () => {
    const hud = new Hud({ notificationDuration: 3 });
    hud.notify('level', 'Pikachu grew to level 26');
    const notification = hud.state.notifications[0];

    assert.ok(hud.notificationAlpha(notification) < 1, 'should fade in');
    for (let i = 0; i < 60; i++) hud.update(1 / 60);
    assert.equal(hud.notificationAlpha(notification), 1, 'fully visible in the middle');

    notification.remaining = 0.2;
    assert.ok(hud.notificationAlpha(notification) < 1, 'should fade out');
  });

  test('HUD opacity eases rather than snapping', () => {
    const hud = new Hud();
    assert.equal(hud.state.opacity, 1);
    hud.fadeTo(0);
    hud.update(1 / 60);
    assert.ok(hud.state.opacity > 0 && hud.state.opacity < 1, 'should ease, not snap');
    for (let i = 0; i < 120; i++) hud.update(1 / 60);
    assert.equal(hud.state.opacity, 0);
    assert.ok(!hud.isVisible('party'), 'a fully faded HUD is not visible');
  });
});

describe('Menu navigation', () => {
  function grid(rows: number, cols: number, disabled: string[] = []): MenuGrid {
    const menu = new MenuGrid();
    const items: MenuItem[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = `${r},${c}`;
        items.push({ id, label: id, row: r, col: c, enabled: !disabled.includes(id) });
      }
    }
    menu.setItems(items);
    return menu;
  }

  test('directional movement works on a rectangular grid', () => {
    const menu = grid(3, 3);
    assert.equal(menu.focused?.id, '0,0');
    menu.move('right');
    assert.equal(menu.focused?.id, '0,1');
    menu.move('down');
    assert.equal(menu.focused?.id, '1,1');
    menu.move('left');
    assert.equal(menu.focused?.id, '1,0');
    menu.move('up');
    assert.equal(menu.focused?.id, '0,0');
  });

  test('disabled items are skipped', () => {
    const menu = grid(1, 3, ['0,1']);
    assert.equal(menu.focused?.id, '0,0');
    menu.move('right');
    assert.equal(menu.focused?.id, '0,2', 'should jump over the disabled entry');
  });

  test('focus starts on an enabled item', () => {
    const menu = grid(1, 3, ['0,0']);
    assert.equal(menu.focused?.id, '0,1', 'must not start on a disabled item');
  });

  test('wrapping moves to the far edge', () => {
    const menu = grid(3, 3);
    menu.move('up'); // Already at the top row.
    assert.equal(menu.focused?.row, 2, 'should wrap to the bottom');
  });

  test('wrapping can be disabled', () => {
    const menu = new MenuGrid({ wrap: false });
    menu.setItems([
      { id: 'a', label: 'A', row: 0, col: 0, enabled: true },
      { id: 'b', label: 'B', row: 1, col: 0, enabled: true },
    ]);
    assert.equal(menu.move('up'), false, 'should refuse to move past the edge');
    assert.equal(menu.focused?.id, 'a');
  });

  test('navigation works on a ragged layout', () => {
    // A party screen: one lead slot, then a 2x2 grid below it.
    const menu = new MenuGrid();
    menu.setItems([
      { id: 'lead', label: 'Lead', row: 0, col: 0, enabled: true },
      { id: 'a', label: 'A', row: 1, col: 0, enabled: true },
      { id: 'b', label: 'B', row: 1, col: 1, enabled: true },
      { id: 'c', label: 'C', row: 2, col: 0, enabled: true },
      { id: 'd', label: 'D', row: 2, col: 1, enabled: true },
    ]);
    assert.equal(menu.focused?.id, 'lead');
    menu.move('down');
    assert.equal(menu.focused?.id, 'a', 'should reach the nearest item below');
    menu.move('right');
    assert.equal(menu.focused?.id, 'b');
    menu.move('down');
    assert.equal(menu.focused?.id, 'd');
  });

  test('rebuilding the list keeps focus on the same item', () => {
    const menu = grid(2, 2);
    menu.focusById('1,1');
    // Simulate a bag list losing an unrelated entry.
    menu.setItems([
      { id: '0,0', label: 'a', row: 0, col: 0, enabled: true },
      { id: '1,1', label: 'd', row: 1, col: 1, enabled: true },
    ]);
    assert.equal(menu.focused?.id, '1,1', 'focus must not jump back to the top');
  });

  test('confirm refuses a disabled item', () => {
    const menu = new MenuGrid({ allowDisabled: true });
    menu.setItems([{ id: 'x', label: 'X', row: 0, col: 0, enabled: false }]);
    assert.equal(menu.confirm(), null);
  });

  test('focus change fires a callback for the cursor sound', () => {
    const menu = grid(2, 2);
    let moves = 0;
    menu.onFocusChange = () => { moves++; };
    menu.move('right');
    menu.move('down');
    assert.equal(moves, 2);
  });

  test('an empty menu is handled safely', () => {
    const menu = new MenuGrid();
    menu.setItems([]);
    assert.equal(menu.focused, null);
    assert.equal(menu.move('down'), false);
    assert.equal(menu.confirm(), null);
  });
});

describe('Menu stack', () => {
  test('push and pop behave like a back stack', () => {
    const stack = new MenuStack();
    assert.equal(stack.current, null);
    stack.push('main');
    stack.push('bag');
    stack.push('item-detail');
    assert.equal(stack.current, 'item-detail');
    assert.equal(stack.depth, 3);

    assert.equal(stack.pop(), 'item-detail');
    assert.equal(stack.current, 'bag');
  });

  test('clear closes everything, for an interrupting battle', () => {
    const stack = new MenuStack();
    stack.push('main');
    stack.push('party');
    stack.clear();
    assert.equal(stack.depth, 0);
    assert.equal(stack.current, null);
  });

  test('replace swaps the top screen without growing the stack', () => {
    const stack = new MenuStack();
    stack.push('main');
    stack.replace('options');
    assert.equal(stack.depth, 1);
    assert.equal(stack.current, 'options');

    const empty = new MenuStack();
    empty.replace('first');
    assert.equal(empty.current, 'first');
  });

  test('popping an empty stack is safe', () => {
    const stack = new MenuStack();
    assert.equal(stack.pop(), null);
  });
});
