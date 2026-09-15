/**
 * The battle interface.
 *
 * Renders a `BattleSession` and feeds player choices back into it. It makes no
 * gameplay decisions of its own — every number it shows comes from the session,
 * and every message it prints comes from the engine's event stream, so the UI
 * cannot tell the player something the simulation did not do.
 *
 * Input is keyboard-first with the mouse as an equal alternative, because a
 * battle is the one place a controller-shaped layout genuinely helps.
 */
import { getMove, getSpecies, getItem, type ZMoveDefinition } from '@alola/data';
import type { BattlePokemon } from '@alola/battle';
import {
  BattleSession, maxHpOf, isFainted,
  type PartyPokemon, type PlayerChoice, type TurnResult,
} from '@alola/game';
import { el, hpColor, TYPE_COLORS, injectGameStyles } from './ui-kit.ts';

type Screen = 'root' | 'fight' | 'bag' | 'party' | 'pose' | 'replace' | 'over';

/** Directions the pose minigame accepts, and the keys that produce them. */
const POSE_KEYS: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Space: 'cross', Enter: 'cross', KeyE: 'cross',
};

const POSE_GLYPHS: Record<string, string> = {
  up: '↑', down: '↓', left: '←', right: '→',
  cross: '✕', circle: '○', square: '□', triangle: '△',
};

export interface BattleUiCallbacks {
  /** Called once the battle is completely finished and dismissed. */
  onFinished(session: BattleSession, outcome: TurnResult['outcome']): void;
  /** Play an audio cue. */
  onCue?(cue: string): void;
}

export class BattleUi {
  private readonly root = el('div', 'ov');
  private readonly logNode = el('div', 'battle-log');
  private readonly actions = el('div', 'battle-actions');
  private readonly combatants = el('div', 'combatants');
  private readonly foePlate = el('div', 'nameplate foe');
  private readonly minePlate = el('div', 'nameplate mine');
  private poseLayer: HTMLDivElement | null = null;

  private session: BattleSession | null = null;
  private screen: Screen = 'root';
  private cursor = 0;
  private buttons: HTMLButtonElement[] = [];
  private readonly callbacks: BattleUiCallbacks;

  /** Set while a turn is resolving, so input cannot double-submit. */
  private busy = false;

  // Pose minigame state.
  private poseMove: ZMoveDefinition | null = null;
  private poseBaseMoveId = '';
  private poseInputs: { input: string; at: number }[] = [];
  private poseStart = 0;
  private poseTimer = 0;
  private poseRaf = 0;

  constructor(callbacks: BattleUiCallbacks) {
    injectGameStyles();
    this.callbacks = callbacks;

    const scrim = el('div', 'ov-scrim');
    const dock = el('div', 'battle-dock');
    dock.append(this.logNode, this.actions);
    this.combatants.append(this.foePlate, this.minePlate);
    this.root.append(scrim, this.combatants, dock);
    this.root.id = 'battle';
    document.body.appendChild(this.root);

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  // ------------------------------------------------------------- lifecycle

  open(session: BattleSession): void {
    this.session = session;
    this.screen = 'root';
    this.cursor = 0;
    this.busy = false;
    this.logNode.replaceChildren();
    this.root.classList.add('open');

    const foe = getSpecies(session.foeActive.speciesId);
    this.log([`A wild ${foe.name} appeared!`], true);
    this.log([`Go! ${session.playerActive.name}!`], true);
    this.render();
  }

  private close(outcome: TurnResult['outcome']): void {
    const session = this.session;
    this.root.classList.remove('open');
    this.stopPose();
    this.session = null;
    if (session) this.callbacks.onFinished(session, outcome);
  }

  // ----------------------------------------------------------------- input

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.session) return;
    // The battle owns the keyboard while it is open — the overworld must not
    // also act on WASD, or the player walks away mid-fight.
    event.stopPropagation();

    if (this.screen === 'pose') {
      const direction = POSE_KEYS[event.code];
      if (direction) {
        event.preventDefault();
        this.recordPose(direction);
      }
      return;
    }

    if (this.busy) return;

    switch (event.code) {
      case 'ArrowUp': case 'KeyW':
        event.preventDefault(); this.moveCursor(-2); break;
      case 'ArrowDown': case 'KeyS':
        event.preventDefault(); this.moveCursor(2); break;
      case 'ArrowLeft': case 'KeyA':
        event.preventDefault(); this.moveCursor(-1); break;
      case 'ArrowRight': case 'KeyD':
        event.preventDefault(); this.moveCursor(1); break;
      case 'Enter': case 'Space': case 'KeyE':
        event.preventDefault(); this.buttons[this.cursor]?.click(); break;
      case 'Escape': case 'Backspace':
        event.preventDefault();
        if (this.screen !== 'root' && this.screen !== 'replace' && this.screen !== 'over') {
          this.screen = 'root';
          this.cursor = 0;
          this.render();
        }
        break;
    }
  };

  private moveCursor(delta: number): void {
    if (this.buttons.length === 0) return;
    let next = this.cursor;
    for (let guard = 0; guard < this.buttons.length; guard++) {
      next = (next + delta + this.buttons.length) % this.buttons.length;
      if (!this.buttons[next].disabled) break;
    }
    this.cursor = next;
    this.highlight();
  }

  private highlight(): void {
    this.buttons.forEach((b, i) => b.classList.toggle('sel', i === this.cursor));
    this.buttons[this.cursor]?.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    if (!this.session) return;
    this.renderPlates();
    this.renderActions();
  }

  private renderPlates(): void {
    const session = this.session!;
    this.fillPlate(this.foePlate, session.foeActive, null);
    this.fillPlate(this.minePlate, session.playerActive, session.playerActiveParty);
  }

  private fillPlate(node: HTMLElement, mon: BattlePokemon, party: PartyPokemon | null): void {
    node.replaceChildren();

    const top = el('div', 'np-top');
    const name = el('span', 'np-name', mon.name);
    if (mon.shiny) {
      name.append(el('span', 'np-shiny', ' ✦'));
    }
    top.append(name, el('span', 'np-lv', `Lv ${mon.level}`));

    const types = el('div', 'np-types');
    for (const type of mon.types) {
      const chip = el('span', 'np-type', type);
      chip.style.background = TYPE_COLORS[type] ?? '#888';
      types.appendChild(chip);
    }
    top.appendChild(types);

    const fraction = mon.maxHp > 0 ? Math.max(0, mon.hp) / mon.maxHp : 0;
    const bar = el('div', 'np-bar');
    const fill = el('div');
    fill.style.width = `${fraction * 100}%`;
    fill.style.background = hpColor(fraction);
    bar.appendChild(fill);

    const hp = el('div', 'np-hp');
    // The player sees exact numbers for their own Pokémon and a bar for the
    // opponent's — knowing the wild Pokémon's precise HP would make the catch
    // decision mechanical rather than a judgement call.
    hp.append(el('span', undefined, party ? `${Math.max(0, mon.hp)} / ${mon.maxHp}` : `${Math.round(fraction * 100)}%`));
    if (mon.status !== 'none') hp.append(el('span', 'np-status', mon.status));

    node.append(top, bar, hp);
  }

  private renderActions(): void {
    this.actions.replaceChildren();
    this.buttons = [];
    const session = this.session!;

    const button = (
      label: string,
      sub: string | null,
      enabled: boolean,
      onClick: () => void,
      extraClass = '',
    ): HTMLButtonElement => {
      const node = el('button', `btn ${extraClass}`.trim());
      node.append(document.createTextNode(label));
      if (sub) node.append(el('span', 'btn-sub', sub));
      node.disabled = !enabled;
      node.addEventListener('click', () => {
        if (node.disabled || this.busy) return;
        onClick();
      });
      node.addEventListener('mouseenter', () => {
        const index = this.buttons.indexOf(node);
        if (index >= 0 && !node.disabled) {
          this.cursor = index;
          this.highlight();
        }
      });
      this.actions.appendChild(node);
      this.buttons.push(node);
      return node;
    };

    switch (this.screen) {
      case 'root': {
        button('Fight', 'choose a move', true, () => { this.screen = 'fight'; this.cursor = 0; this.render(); });
        button('Bag', `${session.profile.bag.count('poke-ball')} Poké Balls`, true, () => {
          this.screen = 'bag'; this.cursor = 0; this.render();
        });
        button('Pokémon', `${session.profile.party.filter((p) => !isFainted(p)).length} able`, true, () => {
          this.screen = 'party'; this.cursor = 0; this.render();
        });
        button(
          'Run',
          session.canFlee ? 'leave the encounter' : 'it will not let you',
          true,
          () => this.submit({ kind: 'run' }),
        );
        break;
      }

      case 'fight': {
        const active = session.playerActive;
        for (const slot of active.moves) {
          const move = getMove(slot.id);
          const chip = `${move.type} · ${move.category} · ${move.power ?? '—'} pow`;
          button(move.name, `${chip}   PP ${slot.pp}/${slot.maxPp}`, slot.pp > 0 && !slot.disabled, () => {
            this.submit({ kind: 'move', moveId: slot.id });
          });
        }
        const zMove = session.availableZMove();
        if (zMove) {
          const base = active.moves.find((m) => getMove(m.id).type === zMove.type && m.pp > 0);
          if (base) {
            button(`Z-Move: ${zMove.name}`, `${zMove.pose.name} — perform the pose`, true, () => {
              this.startPose(zMove, base.id);
            }, 'z');
          }
        }
        button('Back', null, true, () => { this.screen = 'root'; this.cursor = 0; this.render(); }, 'back');
        break;
      }

      case 'bag': {
        const usable = [
          ...session.profile.bag.ofCategory('pokeball'),
          ...session.profile.bag.ofCategory('medicine'),
        ];
        if (usable.length === 0) {
          button('(the bag is empty)', null, false, () => {});
        }
        for (const entry of usable) {
          const isBall = entry.item.category === 'pokeball';
          button(entry.item.name, `×${entry.count}${isBall ? '' : ' — used on the active Pokémon'}`, true, () => {
            if (isBall) this.submit({ kind: 'ball', ballId: entry.item.id });
            else this.submit({ kind: 'item', itemId: entry.item.id, partyIndex: this.activePartyIndex() });
          });
        }
        button('Back', null, true, () => { this.screen = 'root'; this.cursor = 0; this.render(); }, 'back');
        break;
      }

      case 'party':
      case 'replace': {
        const active = session.playerActiveParty;
        session.profile.party.forEach((mon, index) => {
          const fainted = isFainted(mon);
          const isActive = mon === active;
          const max = maxHpOf(mon);
          const label = `${mon.nickname ?? getSpecies(mon.species).name}  Lv ${mon.level}`;
          const sub = fainted ? 'fainted' : `${mon.currentHp} / ${max} HP${isActive ? '  (in battle)' : ''}`;
          button(label, sub, !fainted && !isActive, () => {
            if (this.screen === 'replace') this.resolve(session.replaceFainted(index));
            else this.submit({ kind: 'switch', partyIndex: index });
          });
        });
        if (this.screen === 'party') {
          button('Back', null, true, () => { this.screen = 'root'; this.cursor = 0; this.render(); }, 'back');
        }
        break;
      }

      case 'over': {
        button('Continue', null, true, () => this.close(session.outcome), 'back');
        break;
      }

      case 'pose':
        break;
    }

    this.cursor = Math.min(this.cursor, Math.max(0, this.buttons.length - 1));
    if (this.buttons[this.cursor]?.disabled) this.moveCursor(1);
    else this.highlight();
  }

  private activePartyIndex(): number {
    const session = this.session!;
    const active = session.playerActiveParty;
    const index = session.profile.party.findIndex((p) => p === active);
    return index >= 0 ? index : 0;
  }

  // ------------------------------------------------------------ turn flow

  private submit(choice: PlayerChoice): void {
    if (!this.session || this.busy) return;
    this.busy = true;
    this.screen = 'root';
    this.resolve(this.session.submit(choice));
  }

  private resolve(result: TurnResult): void {
    const session = this.session!;
    this.log(result.messages, true);
    this.renderPlates();

    if (result.capture?.caught) this.callbacks.onCue?.('capture');
    if (result.levelUps.length > 0) this.callbacks.onCue?.('level-up');

    if (result.outcome !== 'ongoing' && result.outcome !== 'flee-failed') {
      this.finish(result.outcome);
      return;
    }

    // The player's active Pokémon fainted but the battle continues — they must
    // send out a replacement, and it does not cost a turn.
    if (isFainted(session.playerActiveParty ?? ({ currentHp: 1 } as PartyPokemon))) {
      if (session.profile.hasUsablePokemon) {
        this.busy = false;
        this.screen = 'replace';
        this.cursor = 0;
        this.log(['Choose a Pokémon to send out.'], false);
        this.render();
        return;
      }
      this.finish('lost');
      return;
    }

    this.busy = false;
    this.screen = 'root';
    this.cursor = 0;
    this.render();
  }

  private finish(outcome: TurnResult['outcome']): void {
    const session = this.session!;
    const closing =
      outcome === 'won' ? 'You won the battle!'
      : outcome === 'lost' ? `${session.profile.name} has no Pokémon left to fight...`
      : outcome === 'caught' ? ''
      : outcome === 'fled' ? '' : '';
    if (closing) this.log([closing], true);

    this.busy = false;
    this.screen = 'over';
    this.cursor = 0;
    this.render();
  }

  private log(lines: readonly string[], fresh: boolean): void {
    for (const line of lines) {
      const p = el('p', fresh ? 'fresh' : undefined, line);
      this.logNode.appendChild(p);
    }
    // Keep the log bounded; a long battle should not grow an unbounded DOM.
    while (this.logNode.childElementCount > 200) {
      this.logNode.removeChild(this.logNode.firstChild!);
    }
    this.logNode.scrollTop = this.logNode.scrollHeight;
  }

  // ------------------------------------------------------- Z-Move pose game

  /**
   * The pose.
   *
   * The player physically performs the Z-Move: a short directional sequence
   * inside a timing window. Scoring lives in `evaluatePose` and is forgiving
   * on purpose — a fumbled pose still delivers most of the power, because a
   * once-per-battle resource lost to a missed input feels terrible.
   */
  private startPose(zMove: ZMoveDefinition, baseMoveId: string): void {
    this.screen = 'pose';
    this.poseMove = zMove;
    this.poseBaseMoveId = baseMoveId;
    this.poseInputs = [];
    this.poseStart = performance.now();

    const layer = el('div', 'pose');
    const inner = el('div', 'pose-inner');
    inner.append(
      el('div', 'pose-title', 'Z-Power'),
      el('div', 'pose-name', zMove.pose.name),
    );

    const seq = el('div', 'pose-seq');
    for (const input of zMove.pose.inputs) {
      seq.appendChild(el('div', 'pose-key', POSE_GLYPHS[input] ?? input));
    }
    inner.appendChild(seq);

    const timer = el('div', 'pose-timer');
    const fill = el('div');
    timer.appendChild(fill);
    inner.append(timer, el('div', 'pose-hint', 'arrow keys / WASD · space for ✕'));

    layer.appendChild(inner);
    this.root.appendChild(layer);
    this.poseLayer = layer;
    this.actions.replaceChildren();
    this.buttons = [];
    this.updatePoseKeys();

    const window_ = zMove.pose.window;
    const tick = (): void => {
      const elapsed = (performance.now() - this.poseStart) / 1000;
      fill.style.width = `${Math.max(0, 1 - elapsed / window_) * 100}%`;
      if (elapsed >= window_) {
        this.commitPose();
        return;
      }
      this.poseRaf = requestAnimationFrame(tick);
    };
    this.poseRaf = requestAnimationFrame(tick);
    // A hard backstop in case rAF is throttled in a background tab — the
    // battle must never be left sitting in the pose screen forever.
    this.poseTimer = window.setTimeout(() => this.commitPose(), (window_ + 0.5) * 1000);
  }

  private recordPose(direction: string): void {
    if (!this.poseMove) return;
    const at = (performance.now() - this.poseStart) / 1000;
    this.poseInputs.push({ input: direction, at });
    this.updatePoseKeys();
    if (this.poseInputs.length >= this.poseMove.pose.inputs.length) this.commitPose();
  }

  private updatePoseKeys(): void {
    if (!this.poseLayer || !this.poseMove) return;
    const expected = this.poseMove.pose.inputs;
    const keys = [...this.poseLayer.querySelectorAll('.pose-key')];
    // Count how many of the expected inputs have been matched in order — the
    // same forgiving rule `evaluatePose` uses, so the display cannot disagree
    // with the score.
    let matched = 0;
    for (const input of this.poseInputs) {
      if (matched < expected.length && input.input === expected[matched]) matched++;
    }
    keys.forEach((node, i) => {
      node.classList.toggle('done', i < matched);
      node.classList.toggle('next', i === matched);
    });
  }

  private commitPose(): void {
    if (!this.poseMove) return;
    const baseMoveId = this.poseBaseMoveId;
    const inputs = this.poseInputs;
    this.stopPose();
    this.busy = true;
    this.screen = 'root';
    this.resolve(this.session!.submit({ kind: 'move', moveId: baseMoveId, zMove: true, pose: inputs }));
  }

  private stopPose(): void {
    cancelAnimationFrame(this.poseRaf);
    window.clearTimeout(this.poseTimer);
    this.poseLayer?.remove();
    this.poseLayer = null;
    this.poseMove = null;
    this.poseInputs = [];
  }

  /** Unused today, but the overworld disposes its systems and this should too. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.stopPose();
    this.root.remove();
  }
}

export { getItem };
