/**
 * Server entry point.
 *
 * Boots the authoritative world simulation and reports its health. The
 * transport layer (WebSocket in production) attaches to `WorldServer` via its
 * `handle` / `drain` interface; this entry point runs the loop and, when given
 * `--selftest`, drives it with synthetic clients so the whole netcode path can
 * be exercised in CI without a browser.
 */
import { WorldServer } from './world-server.ts';
import { PROTOCOL_VERSION, type ClientMessage } from '@alola/net';

interface Options {
  seed: number;
  tickRate: number;
  selftest: boolean;
  seconds: number;
  clients: number;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    seed: 20251115, tickRate: 20, selftest: false, seconds: 20, clients: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') opts.seed = Number(argv[++i]);
    else if (argv[i] === '--tick-rate') opts.tickRate = Number(argv[++i]);
    else if (argv[i] === '--selftest') opts.selftest = true;
    else if (argv[i] === '--seconds') opts.seconds = Number(argv[++i]);
    else if (argv[i] === '--clients') opts.clients = Number(argv[++i]);
  }
  return opts;
}

function bar(value: number, max: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║             PROJECT ALOLA — authoritative server              ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  protocol v${PROTOCOL_VERSION}   seed ${opts.seed}   tick rate ${opts.tickRate}Hz`);
  console.log('');

  const server = new WorldServer({
    worldSeed: opts.seed,
    tickRate: opts.tickRate,
    snapshotRate: opts.tickRate,
    wildlifePerPlayer: 50,
  });

  if (!opts.selftest) {
    console.log('  Server constructed. Attach a transport and call handle()/drain().');
    console.log('  Run with --selftest to exercise the full loop with synthetic clients.');
    console.log('');
    return;
  }

  // ---------------------------------------------------------- self-test
  console.log(`  ▸ connecting ${opts.clients} synthetic clients`);
  const clientIds: string[] = [];
  for (let i = 0; i < opts.clients; i++) {
    const id = `player-${i + 1}`;
    const reply = server.handle(id, {
      t: 'hello', protocol: PROTOCOL_VERSION, playerId: id,
      displayName: `Trainer ${i + 1}`, saveHash: 'test',
    });
    if (reply?.t === 'welcome') clientIds.push(id);
    else console.log(`    ✗ ${id} rejected: ${reply?.t === 'reject' ? reply.detail : 'unknown'}`);
  }
  console.log(`    ${clientIds.length} connected`);

  // Verify the protocol gate actually rejects a mismatched client.
  const badReply = server.handle('bad-client', {
    t: 'hello', protocol: PROTOCOL_VERSION + 99, playerId: 'bad-client',
    displayName: 'Stale Build', saveHash: 'x',
  });
  console.log(
    badReply?.t === 'reject'
      ? `    ✓ protocol mismatch correctly rejected`
      : `    ✗ protocol mismatch was NOT rejected`,
  );

  console.log('');
  console.log('  ▸ running simulation');
  console.log('');

  const dt = 1 / opts.tickRate;
  const totalTicks = opts.seconds * opts.tickRate;
  let seq = 1;
  let totalBytes = 0;
  let totalSnapshots = 0;
  let totalEntities = 0;
  let replayRejected = 0;

  for (let tick = 0; tick < totalTicks; tick++) {
    // Each client sends an input: walk in a slow circle.
    for (let i = 0; i < clientIds.length; i++) {
      const angle = (tick / 40) + i * 1.6;
      server.handle(clientIds[i], {
        t: 'input',
        seq: seq,
        dt,
        move: { x: Math.cos(angle), z: Math.sin(angle) },
        yaw: angle,
        actions: 1, // sprinting
      } satisfies ClientMessage);
    }
    seq++;

    // Every 50 ticks, replay an old input to confirm the server rejects it.
    if (tick > 0 && tick % 50 === 0) {
      const before = server.playerPosition(clientIds[0]);
      const beforeX = before?.x ?? 0;
      server.handle(clientIds[0], {
        t: 'input', seq: 1, dt, move: { x: 1, z: 0 }, yaw: 0, actions: 0,
      });
      const after = server.playerPosition(clientIds[0]);
      if ((after?.x ?? 0) === beforeX) replayRejected++;
    }

    server.step(dt);

    // Drain each client's outbox, as a transport would.
    for (const id of clientIds) {
      for (const message of server.drain(id)) {
        totalBytes += JSON.stringify(message).length;
        if (message.t === 'snapshot') {
          totalSnapshots++;
          totalEntities += message.entities.length;
        }
      }
    }

    if (tick % Math.floor(totalTicks / 8) === 0) {
      const pct = (tick / totalTicks) * 100;
      console.log(
        `  ${bar(pct, 100)} ${pct.toFixed(0).padStart(3)}%  ` +
        `tick ${String(server.tick).padStart(5)}  ` +
        `players ${server.playerCount}  ` +
        `wildlife ${String(server.wildlifeCount).padStart(4)}  ` +
        `${server.metrics.tickMs.toFixed(2)}ms/tick`,
      );
    }
  }

  const seconds = opts.seconds;
  const bytesPerClientPerSecond = totalBytes / Math.max(1, clientIds.length) / seconds;

  console.log('');
  console.log('  ────────────────────────────────────────────────────────────────');
  console.log('   RESULTS');
  console.log('  ────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`   ticks simulated      ${server.tick}`);
  console.log(`   players              ${server.playerCount}`);
  console.log(`   wildlife simulated   ${server.wildlifeCount}`);
  console.log(`   mean tick time       ${server.metrics.tickMs.toFixed(3)} ms`);
  console.log(`   peak tick time       ${server.metrics.peakTickMs.toFixed(3)} ms`);
  console.log(`   tick budget          ${(1000 / opts.tickRate).toFixed(1)} ms at ${opts.tickRate}Hz`);
  console.log('');
  console.log(`   snapshots sent       ${totalSnapshots}`);
  console.log(`   entities per snapshot ${(totalEntities / Math.max(1, totalSnapshots)).toFixed(1)}`);
  console.log(`   bandwidth per client  ${(bytesPerClientPerSecond / 1024).toFixed(1)} KB/s (uncompressed JSON)`);
  console.log(`   replayed inputs rejected ${replayRejected}`);
  console.log('');

  const problems: string[] = [];
  if (server.playerCount !== opts.clients) problems.push('not every client stayed connected');
  if (server.wildlifeCount === 0) problems.push('no wildlife was simulated');
  if (totalSnapshots === 0) problems.push('no snapshots were produced');
  if (server.metrics.peakTickMs > 1000 / opts.tickRate) {
    problems.push(
      `peak tick time ${server.metrics.peakTickMs.toFixed(1)}ms exceeds the ` +
      `${(1000 / opts.tickRate).toFixed(1)}ms budget`,
    );
  }
  if (replayRejected === 0) problems.push('replayed inputs were NOT rejected — speed hack possible');

  if (problems.length > 0) {
    console.log('  ✗ PROBLEMS');
    for (const p of problems) console.log(`      • ${p}`);
    console.log('');
    process.exitCode = 1;
  } else {
    console.log('  ✓ Server healthy: within tick budget, replication working, replays rejected.');
    console.log('');
  }
}

main().catch((error: unknown) => {
  console.error('Server failed:', error);
  process.exitCode = 1;
});
