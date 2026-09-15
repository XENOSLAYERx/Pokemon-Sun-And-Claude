import { MOVE_LIST } from './moves.ts';
import type { MoveDefinition } from './schema.ts';
import type { PokemonType } from '../types.ts';

const byId = new Map<string, MoveDefinition>();
const byType = new Map<PokemonType, MoveDefinition[]>();

for (const m of MOVE_LIST) {
  if (byId.has(m.id)) throw new Error(`Duplicate move id "${m.id}".`);
  byId.set(m.id, m);
  const list = byType.get(m.type) ?? [];
  list.push(m);
  byType.set(m.type, list);
}

export function getMove(id: string): MoveDefinition {
  const m = byId.get(id);
  if (!m) throw new Error(`Unknown move "${id}".`);
  return m;
}

export function tryGetMove(id: string): MoveDefinition | undefined {
  return byId.get(id);
}

export function allMoves(): readonly MoveDefinition[] {
  return MOVE_LIST;
}

export function movesOfType(type: PokemonType): readonly MoveDefinition[] {
  return byType.get(type) ?? [];
}

export const MOVE_COUNT = byId.size;
