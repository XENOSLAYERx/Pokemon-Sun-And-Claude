/**
 * Shared DOM helpers and styling for the game overlays.
 *
 * The overlays build their own DOM rather than living in index.html: they are
 * only present during a battle or a menu, and keeping their markup next to the
 * code that drives it is what stops the two drifting apart.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const TYPE_COLORS: Record<string, string> = {
  normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#98d8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848',
  steel: '#b8b8d0', fairy: '#ee99ac',
};

/** HP bar colour, on the usual green → amber → red thresholds. */
export function hpColor(fraction: number): string {
  if (fraction > 0.5) return '#57d16a';
  if (fraction > 0.2) return '#f0c040';
  return '#f05a5a';
}

let injected = false;

/** Inject the overlay stylesheet once. */
export function injectGameStyles(): void {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.textContent = `
  .ov { position: fixed; inset: 0; z-index: 20; display: none;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .ov.open { display: block; }
  .ov-scrim { position: absolute; inset: 0; background: rgba(3,6,12,0.55);
              backdrop-filter: blur(2px); }

  /* ---- battle ---- */
  #battle { pointer-events: none; }
  #battle.open { pointer-events: auto; }
  #battle .ov-scrim { background: linear-gradient(180deg,
      rgba(3,6,12,0.35) 0%, rgba(3,6,12,0) 28%,
      rgba(3,6,12,0) 52%, rgba(3,6,12,0.72) 100%);
      backdrop-filter: none; }

  .combatants { position: absolute; inset: 0; pointer-events: none; }
  .nameplate { position: absolute; min-width: 268px; padding: 9px 13px 11px;
      background: rgba(6,12,22,0.86); border: 1px solid rgba(120,180,255,0.22);
      border-radius: 10px; font-size: 13px; }
  .nameplate.foe { top: 7vh; left: 5vw; }
  .nameplate.mine { top: 7vh; right: 5vw; }
  .np-top { display: flex; align-items: baseline; gap: 8px; }
  .np-name { font-weight: 700; letter-spacing: 0.02em; }
  .np-lv { color: #8fb8ff; font-size: 11px; }
  .np-types { display: flex; gap: 4px; margin-left: auto; }
  .np-type { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
      padding: 1px 5px; border-radius: 3px; color: #0b1018; font-weight: 700; }
  .np-bar { height: 7px; margin-top: 7px; border-radius: 4px;
      background: rgba(255,255,255,0.1); overflow: hidden; }
  .np-bar > div { height: 100%; width: 100%; border-radius: 4px;
      transition: width 0.35s ease, background-color 0.35s ease; }
  .np-hp { font-size: 11px; color: #9fc0e8; margin-top: 4px; font-variant-numeric: tabular-nums;
      display: flex; gap: 8px; align-items: center; }
  .np-status { text-transform: uppercase; font-size: 9px; letter-spacing: 0.08em;
      padding: 1px 5px; border-radius: 3px; background: #7a4bd0; color: #fff; font-weight: 700; }
  .np-shiny { color: #ffd76a; }

  .battle-dock { position: absolute; left: 0; right: 0; bottom: 0;
      padding: 14px max(16px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-bottom));
      display: flex; gap: 14px; align-items: stretch; }
  .battle-log { flex: 1 1 auto; min-width: 0; min-height: 118px; max-height: 148px;
      overflow-y: auto; background: rgba(6,12,22,0.88);
      border: 1px solid rgba(120,180,255,0.2); border-radius: 10px;
      padding: 11px 14px; font-size: 13px; line-height: 1.62; color: #dce8f8; }
  .battle-log p { margin: 0 0 2px; }
  .battle-log p.fresh { color: #fff; }
  .battle-actions { flex: 0 0 360px; display: grid; gap: 8px;
      grid-template-columns: 1fr 1fr; align-content: start; }
  .battle-actions.wide { grid-template-columns: 1fr 1fr; }

  .btn { appearance: none; border: 1px solid rgba(120,180,255,0.28);
      background: rgba(10,18,32,0.9); color: #e8eef7; border-radius: 9px;
      padding: 10px 12px; font: inherit; font-size: 13px; text-align: left;
      cursor: pointer; transition: border-color 0.12s, background 0.12s, transform 0.08s;
      display: block; width: 100%; }
  .btn:hover:not(:disabled) { border-color: rgba(150,205,255,0.6); background: rgba(16,28,48,0.95); }
  .btn.sel { border-color: #6fb4ff; background: rgba(24,46,78,0.95); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn-sub { display: block; font-size: 10.5px; color: #8fb0d8; margin-top: 3px;
      font-variant-numeric: tabular-nums; }
  .btn.z { border-color: rgba(255,200,90,0.55); background: rgba(58,42,10,0.9); grid-column: 1 / -1; }
  .btn.z:hover:not(:disabled) { border-color: #ffd76a; }
  .btn.back { grid-column: 1 / -1; text-align: center; color: #9fc0e8; }

  .pose { position: absolute; inset: 0; display: grid; place-items: center; }
  .pose-inner { text-align: center; background: rgba(6,12,22,0.93);
      border: 1px solid rgba(255,200,90,0.45); border-radius: 14px; padding: 26px 38px; }
  .pose-title { font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase;
      color: #ffd76a; margin-bottom: 4px; }
  .pose-name { font-size: 22px; font-weight: 700; margin-bottom: 16px; }
  .pose-seq { display: flex; gap: 10px; justify-content: center; margin-bottom: 16px; }
  .pose-key { width: 54px; height: 54px; display: grid; place-items: center;
      border: 2px solid rgba(255,200,90,0.35); border-radius: 10px; font-size: 20px;
      color: #ffd76a; transition: all 0.12s; }
  .pose-key.done { background: rgba(255,200,90,0.9); color: #2a1e00; border-color: #ffd76a; }
  .pose-key.next { border-color: #ffd76a; box-shadow: 0 0 0 3px rgba(255,200,90,0.18); }
  .pose-timer { height: 4px; background: rgba(255,200,90,0.2); border-radius: 2px; overflow: hidden; }
  .pose-timer > div { height: 100%; background: #ffd76a; width: 100%; }
  .pose-hint { font-size: 11px; color: #9fc0e8; margin-top: 12px; }

  /* ---- menus ---- */
  .menu-card { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
      width: min(760px, 92vw); max-height: 84vh; overflow: hidden;
      background: rgba(6,12,22,0.95); border: 1px solid rgba(120,180,255,0.24);
      border-radius: 14px; display: flex; flex-direction: column; }
  .menu-head { padding: 14px 20px; border-bottom: 1px solid rgba(120,180,255,0.16);
      display: flex; align-items: baseline; gap: 12px; }
  .menu-title { font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #8fb8ff; }
  .menu-meta { margin-left: auto; font-size: 11.5px; color: #7f9dc4; font-variant-numeric: tabular-nums; }
  .menu-body { padding: 16px 20px; overflow-y: auto; display: grid; gap: 8px; }
  .menu-body.two { grid-template-columns: 1fr 1fr; }
  .menu-foot { padding: 11px 20px; border-top: 1px solid rgba(120,180,255,0.16);
      font-size: 11.5px; color: #7f9dc4; }
  .mon-row { display: flex; align-items: center; gap: 12px; }
  .mon-name { font-weight: 600; }
  .mon-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); overflow: hidden; }
  .mon-bar > div { height: 100%; }
  .toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
      background: rgba(6,12,22,0.94); border: 1px solid rgba(120,180,255,0.3);
      border-radius: 9px; padding: 9px 18px; font-size: 13px; z-index: 40;
      opacity: 0; transition: opacity 0.25s ease; pointer-events: none; }
  .toast.show { opacity: 1; }
  .prompt { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
      background: rgba(6,12,22,0.9); border: 1px solid rgba(120,180,255,0.3);
      border-radius: 9px; padding: 8px 16px; font-size: 13px; z-index: 15;
      display: none; pointer-events: none; }
  .prompt.show { display: block; }
  .prompt kbd { background: rgba(120,180,255,0.16); border: 1px solid rgba(120,180,255,0.3);
      border-radius: 4px; padding: 1px 6px; font-size: 11px; font-family: inherit; }
  `;
  document.head.appendChild(style);
}

/** A transient status line, for "caught!", "saved", "your team is exhausted". */
export class Toast {
  private readonly node = el('div', 'toast');
  private timer = 0;

  constructor() {
    document.body.appendChild(this.node);
  }

  show(text: string, seconds = 2.6): void {
    this.node.textContent = text;
    this.node.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.node.classList.remove('show'), seconds * 1000);
  }
}
