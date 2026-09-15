/**
 * Totem Pokémon — multi-phase cinematic bosses.
 *
 * The brief asks for Totems to be "giant cinematic boss fights" rather than a
 * scaled-up wild encounter. Three mechanics deliver that:
 *
 * 1. **The aura.** A Totem enters with stat stages already raised, announced as
 *    a visible event. The fight starts from a losing position, which reframes
 *    it as something to overcome rather than a normal battle with more HP.
 *
 * 2. **Phases.** Crossing an HP threshold triggers a named phase with its own
 *    boosts and an arena event. The fight visibly escalates, and the player can
 *    see it coming, which is what makes it readable rather than arbitrary.
 *
 * 3. **SOS allies.** The Totem calls reinforcements at set thresholds, turning
 *    a single battle into a sustained encounter that pressures resources.
 *
 * Phases are declared as data in @alola/data's trial definitions; this module
 * only runs them.
 */
import { getTrial, type TotemDefinition } from '@alola/data';
import type { BattleEngine } from '../engine/engine.ts';
import type { BattlePokemon, StatStages } from '../engine/state.ts';

/** Registry of the Totem definition backing each in-battle Pokémon id. */
const totemDefinitions = new Map<number, TotemDefinition>();
/** Which phase index each Totem has already entered. */
const enteredPhases = new Map<number, number>();
/** Which SOS thresholds have already fired. */
const calledAllies = new Map<number, Set<number>>();

/**
 * Bind a Totem definition to a battle Pokémon before the battle starts.
 *
 * This also flips the Pokémon's `isTotem` flag, which is what the engine
 * checks on every damage application. Keeping both in one call means a
 * registered Totem can never silently fail to run its phases.
 */
export function registerTotem(pokemon: BattlePokemon, definition: TotemDefinition): void {
  totemDefinitions.set(pokemon.id, definition);
  enteredPhases.set(pokemon.id, -1);
  calledAllies.set(pokemon.id, new Set());
  pokemon.isTotem = true;
}

/** Clear registry entries when a battle ends, so ids can be reused. */
export function clearTotemRegistry(): void {
  totemDefinitions.clear();
  enteredPhases.clear();
  calledAllies.clear();
}

export function totemDefinitionFor(pokemonId: number): TotemDefinition | undefined {
  return totemDefinitions.get(pokemonId);
}

/** Apply the Totem's entry aura. Called once, at battle start. */
export function applyTotemAura(engine: BattleEngine, pokemon: BattlePokemon): void {
  const def = totemDefinitions.get(pokemon.id);
  if (!def) return;

  for (const [stat, delta] of Object.entries(def.auraBoosts)) {
    const key = stat as keyof StatStages;
    const current = pokemon.stages[key] ?? 0;
    pokemon.stages[key] = Math.max(-6, Math.min(6, current + (delta as number)));
    engine.emitEvent({ type: 'totem-aura', pokemonId: pokemon.id, stat: key, delta: delta as number });
  }

  engine.emitEvent({
    type: 'message',
    text: `The Totem ${pokemon.name} towers over you, wreathed in an aura!`,
  });
}

/**
 * Check and apply phase transitions.
 *
 * Called after every damage application, so a single large hit can cross two
 * thresholds at once. In that case only the *deepest* phase is entered rather
 * than queueing both — an overkill hit should not replay three cutscenes.
 */
export function applyTotemPhases(engine: BattleEngine, pokemon: BattlePokemon): void {
  const def = totemDefinitions.get(pokemon.id);
  if (!def || pokemon.fainted) return;

  const hpFraction = pokemon.maxHp > 0 ? pokemon.hp / pokemon.maxHp : 0;
  const alreadyEntered = enteredPhases.get(pokemon.id) ?? -1;

  // Find the deepest phase whose threshold we are now at or below.
  let targetPhase = -1;
  for (let i = 0; i < def.phases.length; i++) {
    if (hpFraction <= def.phases[i].atHpPercent) targetPhase = i;
  }

  if (targetPhase <= alreadyEntered) {
    // Still check SOS, which is independent of phase transitions.
    checkSosCalls(engine, pokemon, def, hpFraction);
    return;
  }

  const phase = def.phases[targetPhase];
  enteredPhases.set(pokemon.id, targetPhase);
  pokemon.totemPhase = targetPhase;

  engine.emitEvent({
    type: 'totem-phase',
    pokemonId: pokemon.id,
    phase: targetPhase,
    name: phase.name,
    description: phase.description,
  });

  if (phase.boosts) {
    for (const [stat, delta] of Object.entries(phase.boosts)) {
      const key = stat as keyof StatStages;
      const current = pokemon.stages[key] ?? 0;
      pokemon.stages[key] = Math.max(-6, Math.min(6, current + (delta as number)));
      engine.emitEvent({
        type: 'stat-change',
        targetId: pokemon.id,
        stat: key,
        delta: delta as number,
        newStage: pokemon.stages[key],
      });
    }
  }

  if (phase.arenaEvent) {
    engine.emitEvent({ type: 'arena-event', event: phase.arenaEvent, radius: 20 });
  }

  checkSosCalls(engine, pokemon, def, hpFraction);
}

/** Emit SOS calls whose thresholds have been crossed. */
function checkSosCalls(
  engine: BattleEngine,
  pokemon: BattlePokemon,
  def: TotemDefinition,
  hpFraction: number,
): void {
  const called = calledAllies.get(pokemon.id);
  if (!called) return;

  for (let i = 0; i < def.sosAllies.length; i++) {
    const ally = def.sosAllies[i];
    if (called.has(i)) continue;
    if (hpFraction > ally.atHpPercent) continue;

    called.add(i);
    engine.emitEvent({
      type: 'sos-call',
      callerId: pokemon.id,
      allyId: -1, // Filled in by the battle controller when it spawns the ally.
      species: ally.species,
    });
    engine.emitEvent({
      type: 'message',
      text: `The Totem ${pokemon.name} called for help!`,
    });
  }
}

/** Everything the battle controller needs to build a Totem encounter. */
export interface TotemEncounter {
  readonly trialId: string;
  readonly totem: TotemDefinition;
  readonly recommendedLevel: number;
  readonly arenaEvents: readonly string[];
  readonly reward: string;
}

export function totemEncounterFor(trialId: string): TotemEncounter {
  const trial = getTrial(trialId);
  const arenaEvents: string[] = [];
  for (const phase of trial.totem.phases) {
    if (phase.arenaEvent) arenaEvents.push(phase.arenaEvent);
  }
  return {
    trialId,
    totem: trial.totem,
    recommendedLevel: trial.recommendedLevel,
    arenaEvents,
    reward: trial.reward,
  };
}

/**
 * Effective HP multiplier for a Totem.
 *
 * A Totem should feel substantial without the fight dragging. Scaling HP with
 * the visual scale is the cheapest legible signal: a 2x-size Totem reads as
 * roughly twice as durable, and the number matches what the player can see.
 */
export function totemHpMultiplier(scale: number): number {
  return 1 + (scale - 1) * 1.15;
}
