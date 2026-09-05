import type { AttackStyle } from '../../data/inferno/monsters'
import type { Actor } from '../Actor'
import type { World } from '../World'

export interface CombatEvent {
  tick: number
  source: Actor
  target: Actor
  style: AttackStyle | 'heal' | 'drain'
  damage: number
  prayed: boolean
}

const listeners = new WeakMap<World, ((e: CombatEvent) => void)[]>()

export function onCombatEvent(world: World, fn: (e: CombatEvent) => void): () => void {
  const list = listeners.get(world) ?? []
  list.push(fn)
  listeners.set(world, list)
  return () => {
    const i = list.indexOf(fn)
    if (i >= 0) list.splice(i, 1)
  }
}

export function addCombatEvent(world: World, e: CombatEvent): void {
  const list = listeners.get(world)
  if (list) for (const fn of list) fn(e)
}
