/**
 * HUD state model.
 *
 * Pure data describing what should be on screen, with no DOM or canvas
 * dependency. The client renders it; the tests assert on it. Keeping the HUD's
 * *logic* testable matters more than it might seem — notification queueing,
 * contextual prompt priority and objective tracking are where HUD bugs
 * actually live, and none of them need a browser to verify.
 */
import { clamp01 } from '@alola/core';

export type HudElement =
  | 'party' | 'minimap' | 'objective' | 'prompt' | 'notifications'
  | 'clock' | 'weather' | 'ride' | 'crosshair' | 'compass';

/** Which elements are visible in each context. */
export const HUD_LAYOUTS: Readonly<Record<string, readonly HudElement[]>> = {
  explore: ['party', 'minimap', 'objective', 'prompt', 'notifications', 'clock', 'weather', 'compass'],
  ride: ['party', 'minimap', 'prompt', 'notifications', 'clock', 'weather', 'ride', 'compass'],
  battle: ['notifications'],
  cutscene: [],
  photo: ['crosshair'],
  menu: [],
};

export interface PartyMemberHud {
  readonly speciesId: string;
  readonly nickname: string;
  readonly level: number;
  /** 0–1. */
  readonly hpFraction: number;
  readonly status: string;
  readonly shiny: boolean;
  /** True while this Pokémon is out of its ball following the player. */
  readonly active: boolean;
}

export type NotificationKind =
  | 'item' | 'quest' | 'dex' | 'level' | 'achievement' | 'warning' | 'social';

export interface Notification {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly detail: string;
  /** Icon key for the renderer. */
  readonly icon: string;
  /** Seconds remaining on screen. */
  remaining: number;
  readonly duration: number;
}

export interface ContextPrompt {
  /** Input glyph key: 'a', 'x', 'lt'... */
  readonly button: string;
  readonly label: string;
  /** Higher wins when several prompts are valid at once. */
  readonly priority: number;
  /** World distance, used to break ties between equal priorities. */
  readonly distance: number;
}

export interface ObjectiveHud {
  readonly questName: string;
  readonly text: string;
  /** 0–1, or null when the objective is not counted. */
  readonly progress: number | null;
  /** Distance to the marker in metres, or null when there is none. */
  readonly distance: number | null;
}

export interface HudState {
  layout: string;
  visible: Set<HudElement>;
  party: PartyMemberHud[];
  notifications: Notification[];
  prompt: ContextPrompt | null;
  objective: ObjectiveHud | null;
  /** 0–24. */
  hour: number;
  weather: string;
  /** Current ride species, or null. */
  ride: string | null;
  /** 0–1 global HUD opacity, faded during cinematics. */
  opacity: number;
  /** Player compass heading in radians. */
  heading: number;
}

export interface HudOptions {
  /** Maximum notifications on screen at once. */
  readonly maxNotifications?: number;
  /** Default seconds a notification stays up. */
  readonly notificationDuration?: number;
}

export class Hud {
  readonly state: HudState = {
    layout: 'explore',
    visible: new Set(HUD_LAYOUTS.explore),
    party: [],
    notifications: [],
    prompt: null,
    objective: null,
    hour: 12,
    weather: 'clear',
    ride: null,
    opacity: 1,
    heading: 0,
  };

  private readonly maxNotifications: number;
  private readonly defaultDuration: number;
  private nextNotificationId = 1;
  /** Prompts offered this frame, highest priority wins. */
  private promptCandidates: ContextPrompt[] = [];
  private targetOpacity = 1;

  constructor(opts: HudOptions = {}) {
    this.maxNotifications = opts.maxNotifications ?? 4;
    this.defaultDuration = opts.notificationDuration ?? 4;
  }

  setLayout(layout: string): void {
    this.state.layout = layout;
    const elements = HUD_LAYOUTS[layout] ?? HUD_LAYOUTS.explore;
    this.state.visible = new Set(elements);
    // A prompt from the previous context is stale the instant we switch.
    this.state.prompt = null;
    this.promptCandidates.length = 0;
  }

  isVisible(element: HudElement): boolean {
    return this.state.visible.has(element) && this.state.opacity > 0.01;
  }

  /**
   * Offer a contextual prompt this frame.
   *
   * Several are usually valid at once — "talk to NPC", "pick up item", "mount
   * ride". Rather than letting the last caller win (which makes the prompt
   * flicker as the player turns), every candidate is collected and resolved
   * deterministically by priority, then distance.
   */
  offerPrompt(prompt: ContextPrompt): void {
    this.promptCandidates.push(prompt);
  }

  notify(
    kind: NotificationKind,
    title: string,
    detail = '',
    icon = kind,
    duration?: number,
  ): number {
    const id = this.nextNotificationId++;
    const seconds = duration ?? this.defaultDuration;
    this.state.notifications.push({
      id, kind, title, detail, icon,
      remaining: seconds,
      duration: seconds,
    });

    // Oldest out first when the queue overflows, so the newest event — which
    // is what the player just caused — is always the one they see.
    while (this.state.notifications.length > this.maxNotifications) {
      this.state.notifications.shift();
    }
    return id;
  }

  dismiss(id: number): void {
    const index = this.state.notifications.findIndex((n) => n.id === id);
    if (index >= 0) this.state.notifications.splice(index, 1);
  }

  setObjective(objective: ObjectiveHud | null): void {
    this.state.objective = objective;
  }

  setParty(party: readonly PartyMemberHud[]): void {
    this.state.party = [...party];
  }

  /** Fade the HUD out, e.g. for a cinematic or a photo. */
  fadeTo(opacity: number): void {
    this.targetOpacity = clamp01(opacity);
  }

  update(dt: number): void {
    // Resolve the frame's prompt.
    if (this.promptCandidates.length === 0) {
      this.state.prompt = null;
    } else {
      let best = this.promptCandidates[0];
      for (const candidate of this.promptCandidates) {
        if (
          candidate.priority > best.priority ||
          (candidate.priority === best.priority && candidate.distance < best.distance)
        ) {
          best = candidate;
        }
      }
      this.state.prompt = best;
    }
    this.promptCandidates.length = 0;

    // Expire notifications.
    for (const notification of this.state.notifications) {
      notification.remaining -= dt;
    }
    this.state.notifications = this.state.notifications.filter((n) => n.remaining > 0);

    // Ease opacity.
    const delta = this.targetOpacity - this.state.opacity;
    if (Math.abs(delta) > 0.001) {
      this.state.opacity = clamp01(this.state.opacity + Math.sign(delta) * Math.min(Math.abs(delta), dt * 4));
    } else {
      this.state.opacity = this.targetOpacity;
    }
  }

  /** Alpha for a notification, for the fade-out animation. */
  notificationAlpha(notification: Notification): number {
    const fade = 0.4;
    if (notification.remaining < fade) return clamp01(notification.remaining / fade);
    const elapsed = notification.duration - notification.remaining;
    if (elapsed < fade) return clamp01(elapsed / fade);
    return 1;
  }
}
