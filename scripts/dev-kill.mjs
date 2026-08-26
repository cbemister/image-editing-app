#!/usr/bin/env node
/**
 * Stop whatever is holding the dev port.
 *
 * `pkill -f vite` does not work on Windows: the server runs as node.exe and
 * the pattern never matches, so a "cleanup" step can appear to succeed while
 * leaving the server running. This finds the process by the port it holds,
 * which is the thing actually in the way, and works the same on every OS.
 *
 *   npm run dev:kill          # frees the default port
 *   npm run dev:kill -- 5180  # frees a specific one
 */

import { execFileSync } from 'node:child_process';

const DEFAULT_PORT = 5173;
const port = Number(process.argv[2] ?? DEFAULT_PORT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`dev-kill: "${process.argv[2]}" is not a valid port.`);
  process.exit(1);
}

/** Run a command, returning stdout; '' when the command fails or finds nothing. */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** The port at the end of a netstat local-address column, or NaN. */
function portOf(address) {
  // Handles both "0.0.0.0:5173" and the IPv6 form "[::1]:5173".
  return Number(address.slice(address.lastIndexOf(':') + 1));
}

/** PIDs listening on the port. */
function findPids() {
  if (process.platform === 'win32') {
    const pids = new Set();
    for (const line of run('netstat', ['-ano']).split('\n')) {
      if (!line.includes('LISTENING')) continue;
      // Columns: Proto | Local Address | Foreign Address | State | PID.
      // Parsed by column rather than by a regex over the whole line, so the
      // port matches exactly and 5173 never also matches 51730.
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      if (portOf(cols[1]) !== port) continue;
      const pid = cols[cols.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    return [...pids];
  }
  return run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

const pids = findPids();

if (pids.length === 0) {
  console.log(`dev-kill: nothing listening on ${port}.`);
  process.exit(0);
}

for (const pid of pids) {
  if (process.platform === 'win32') {
    run('taskkill', ['/F', '/PID', pid]);
  } else {
    run('kill', ['-9', pid]);
  }
  console.log(`dev-kill: stopped PID ${pid} on port ${port}.`);
}
