// Database tests each make a throwaway Postgres (about 50 MB) in the temp
// folder. Here every run gets one folder of its own that all of them land in,
// removed when the run ends. A run that was killed can't remove its folder, so
// the next run does.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUN_FOLDER = /^profittracker-run-(\d+)-[A-Za-z0-9]{6}$/;

// Windows can hold a file for a moment after Postgres stops, hence the retries.
// A folder still in use is left for the next run; it never fails the tests.
function remove(folder, retries) {
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: retries, retryDelay: 200 });
    return true;
  } catch {
    return false;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

export function sweepFinishedRuns(base) {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const match = entry.isDirectory() && RUN_FOLDER.exec(entry.name);
    if (match && !isRunning(Number(match[1]))) remove(join(base, entry.name), 1);
  }
}

export default function setup() {
  const base = tmpdir();
  sweepFinishedRuns(base);
  const folder = mkdtempSync(join(base, `profittracker-run-${process.pid}-`));
  const names = process.platform === 'win32' ? ['TEMP', 'TMP'] : ['TMPDIR'];
  const before = names.map((name) => [name, process.env[name]]);
  // Test workers inherit this, so os.tmpdir() in a test is the run's folder.
  for (const name of names) process.env[name] = folder;
  return () => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (!remove(folder, 10)) console.warn(`Couldn't remove ${folder} yet; the next test run will.`);
  };
}
