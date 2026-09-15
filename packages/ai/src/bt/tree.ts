/**
 * Behaviour tree runtime.
 *
 * Used for *how* a Pokémon executes a chosen goal ("flee to cover" decomposes
 * into find-cover, path-to-it, hide, peek). The choice of which goal to pursue
 * is made by the utility scorer instead — see `utility/scorer.ts`.
 *
 * Splitting it this way is the key architectural decision in the AI. A pure
 * behaviour tree needs every priority decision expressed as node ordering,
 * which becomes unmaintainable once a creature weighs hunger against fear
 * against curiosity against territory. A pure utility system, conversely, is
 * bad at multi-step sequences. Utility picks the goal; the tree runs it.
 *
 * The runtime supports long-running nodes: a node returns `Running` and is
 * resumed next tick from the same position, so a chase can span many seconds
 * without re-evaluating the whole tree every frame.
 */
import type { Blackboard } from '@alola/core';

export const NodeStatus = {
  Success: 0,
  Failure: 1,
  Running: 2,
} as const;

export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

/** Per-agent execution context handed to every node. */
export interface BtContext<A> {
  agent: A;
  blackboard: Blackboard;
  /** Seconds since this agent's last behaviour tick (not the frame delta —
   *  reduced-LOD agents tick less often and must integrate correctly). */
  dt: number;
  /** Absolute simulation time. */
  now: number;
}

export interface BtNode<A> {
  readonly name: string;
  tick(ctx: BtContext<A>): NodeStatus;
  /** Called when a node that was Running is abandoned, so it can clean up. */
  abort?(ctx: BtContext<A>): void;
}

// ---------------------------------------------------------------- leaves

/** Runs a function. The workhorse leaf. */
export function action<A>(name: string, fn: (ctx: BtContext<A>) => NodeStatus): BtNode<A> {
  return { name, tick: fn };
}

/** Succeeds or fails based on a predicate. Never runs. */
export function condition<A>(name: string, fn: (ctx: BtContext<A>) => boolean): BtNode<A> {
  return {
    name,
    tick: (ctx) => (fn(ctx) ? NodeStatus.Success : NodeStatus.Failure),
  };
}

/** Always succeeds immediately. Useful as a fallback branch. */
export function succeed<A>(name = 'succeed'): BtNode<A> {
  return { name, tick: () => NodeStatus.Success };
}

/** Waits for a duration, then succeeds. State is kept per-agent on the blackboard. */
export function wait<A>(name: string, seconds: number | ((ctx: BtContext<A>) => number)): BtNode<A> {
  const key = `__wait_${name}`;
  return {
    name,
    tick: (ctx) => {
      const agentKey = ctx.agent as object;
      let agentMap = waitState.get(agentKey);
      if (!agentMap) {
        agentMap = new Map();
        waitState.set(agentKey, agentMap);
      }
      const elapsed = (agentMap.get(key) ?? 0) + ctx.dt;
      const target = typeof seconds === 'function' ? seconds(ctx) : seconds;
      if (elapsed >= target) {
        agentMap.delete(key);
        return NodeStatus.Success;
      }
      agentMap.set(key, elapsed);
      return NodeStatus.Running;
    },
    abort: (ctx) => {
      waitState.get(ctx.agent as object)?.delete(key);
    },
  };
}

/** Per-agent timer storage, keyed weakly so despawned agents are collected. */
const waitState = new WeakMap<object, Map<string, number>>();

// ------------------------------------------------------------- composites

/**
 * Sequence: runs children in order until one fails.
 * Remembers its position across ticks, so a Running child resumes rather than
 * restarting the sequence from the beginning.
 */
export function sequence<A>(name: string, children: readonly BtNode<A>[]): BtNode<A> {
  const indexKey = new WeakMap<object, number>();
  return {
    name,
    tick: (ctx) => {
      let i = indexKey.get(ctx.agent as object) ?? 0;
      while (i < children.length) {
        const status = children[i].tick(ctx);
        if (status === NodeStatus.Running) {
          indexKey.set(ctx.agent as object, i);
          return NodeStatus.Running;
        }
        if (status === NodeStatus.Failure) {
          indexKey.delete(ctx.agent as object);
          return NodeStatus.Failure;
        }
        i++;
      }
      indexKey.delete(ctx.agent as object);
      return NodeStatus.Success;
    },
    abort: (ctx) => {
      const i = indexKey.get(ctx.agent as object);
      if (i !== undefined) children[i]?.abort?.(ctx);
      indexKey.delete(ctx.agent as object);
    },
  };
}

/** Selector: tries children in order until one succeeds. */
export function selector<A>(name: string, children: readonly BtNode<A>[]): BtNode<A> {
  const indexKey = new WeakMap<object, number>();
  return {
    name,
    tick: (ctx) => {
      let i = indexKey.get(ctx.agent as object) ?? 0;
      while (i < children.length) {
        const status = children[i].tick(ctx);
        if (status === NodeStatus.Running) {
          indexKey.set(ctx.agent as object, i);
          return NodeStatus.Running;
        }
        if (status === NodeStatus.Success) {
          indexKey.delete(ctx.agent as object);
          return NodeStatus.Success;
        }
        i++;
      }
      indexKey.delete(ctx.agent as object);
      return NodeStatus.Failure;
    },
    abort: (ctx) => {
      const i = indexKey.get(ctx.agent as object);
      if (i !== undefined) children[i]?.abort?.(ctx);
      indexKey.delete(ctx.agent as object);
    },
  };
}

/**
 * Parallel: ticks every child each frame.
 * Succeeds when `successThreshold` children succeed; fails when enough fail
 * that the threshold is unreachable. Used for "flee while calling for help".
 */
export function parallel<A>(
  name: string,
  children: readonly BtNode<A>[],
  successThreshold = 1,
): BtNode<A> {
  return {
    name,
    tick: (ctx) => {
      let succeeded = 0;
      let failed = 0;
      for (const child of children) {
        const status = child.tick(ctx);
        if (status === NodeStatus.Success) succeeded++;
        else if (status === NodeStatus.Failure) failed++;
      }
      if (succeeded >= successThreshold) return NodeStatus.Success;
      if (children.length - failed < successThreshold) return NodeStatus.Failure;
      return NodeStatus.Running;
    },
    abort: (ctx) => {
      for (const child of children) child.abort?.(ctx);
    },
  };
}

// ------------------------------------------------------------- decorators

/** Inverts Success and Failure. Running passes through. */
export function invert<A>(child: BtNode<A>): BtNode<A> {
  return {
    name: `not(${child.name})`,
    tick: (ctx) => {
      const s = child.tick(ctx);
      if (s === NodeStatus.Success) return NodeStatus.Failure;
      if (s === NodeStatus.Failure) return NodeStatus.Success;
      return s;
    },
    abort: (ctx) => child.abort?.(ctx),
  };
}

/** Converts Failure to Success. Keeps a sequence going past an optional step. */
export function alwaysSucceed<A>(child: BtNode<A>): BtNode<A> {
  return {
    name: `always(${child.name})`,
    tick: (ctx) => {
      const s = child.tick(ctx);
      return s === NodeStatus.Running ? s : NodeStatus.Success;
    },
    abort: (ctx) => child.abort?.(ctx),
  };
}

/** Gates a subtree behind a predicate, re-checked every tick. */
export function guard<A>(name: string, predicate: (ctx: BtContext<A>) => boolean, child: BtNode<A>): BtNode<A> {
  return {
    name: `guard:${name}`,
    tick: (ctx) => {
      if (!predicate(ctx)) {
        child.abort?.(ctx);
        return NodeStatus.Failure;
      }
      return child.tick(ctx);
    },
    abort: (ctx) => child.abort?.(ctx),
  };
}

/** Fails a Running child after a time limit. Prevents a stuck chase forever. */
export function timeout<A>(seconds: number, child: BtNode<A>): BtNode<A> {
  const startTimes = new WeakMap<object, number>();
  return {
    name: `timeout(${child.name})`,
    tick: (ctx) => {
      const key = ctx.agent as object;
      let start = startTimes.get(key);
      if (start === undefined) {
        start = ctx.now;
        startTimes.set(key, start);
      }
      if (ctx.now - start > seconds) {
        child.abort?.(ctx);
        startTimes.delete(key);
        return NodeStatus.Failure;
      }
      const s = child.tick(ctx);
      if (s !== NodeStatus.Running) startTimes.delete(key);
      return s;
    },
    abort: (ctx) => {
      startTimes.delete(ctx.agent as object);
      child.abort?.(ctx);
    },
  };
}

/** Repeats a child until it fails, or `count` times. */
export function repeat<A>(count: number, child: BtNode<A>): BtNode<A> {
  const counts = new WeakMap<object, number>();
  return {
    name: `repeat(${child.name})`,
    tick: (ctx) => {
      const key = ctx.agent as object;
      let n = counts.get(key) ?? 0;
      const s = child.tick(ctx);
      if (s === NodeStatus.Running) return NodeStatus.Running;
      if (s === NodeStatus.Failure) {
        counts.delete(key);
        return NodeStatus.Failure;
      }
      n++;
      if (n >= count) {
        counts.delete(key);
        return NodeStatus.Success;
      }
      counts.set(key, n);
      return NodeStatus.Running;
    },
    abort: (ctx) => {
      counts.delete(ctx.agent as object);
      child.abort?.(ctx);
    },
  };
}

/** Runs a subtree at most once every `seconds`, returning the cached result. */
export function throttle<A>(seconds: number, child: BtNode<A>): BtNode<A> {
  const lastRun = new WeakMap<object, { at: number; status: NodeStatus }>();
  return {
    name: `throttle(${child.name})`,
    tick: (ctx) => {
      const key = ctx.agent as object;
      const prev = lastRun.get(key);
      if (prev && ctx.now - prev.at < seconds && prev.status !== NodeStatus.Running) {
        return prev.status;
      }
      const status = child.tick(ctx);
      lastRun.set(key, { at: ctx.now, status });
      return status;
    },
    abort: (ctx) => child.abort?.(ctx),
  };
}

/** Runs a tree and reports the leaf path taken — for the AI debug overlay. */
export function traceTick<A>(root: BtNode<A>, ctx: BtContext<A>, path: string[]): NodeStatus {
  path.push(root.name);
  return root.tick(ctx);
}
