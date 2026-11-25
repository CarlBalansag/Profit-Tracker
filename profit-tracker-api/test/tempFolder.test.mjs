import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sweepFinishedRuns } from './setup/tempFolder.mjs';

describe('temp folder of a test run', () => {
  let base;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'sweep-')); });
  afterEach(() => rmSync(base, { recursive: true, force: true }));
  const folder = (name) => {
    mkdirSync(join(base, name, 'db'), { recursive: true });
    writeFileSync(join(base, name, 'db', 'file'), 'x');
    return join(base, name);
  };

  it("is the run's own folder, not the shared temp folder", () => {
    expect(basename(tmpdir())).toMatch(/^profittracker-run-\d+-[A-Za-z0-9]{6}$/);
  });

  it('removes what a killed run left and nothing else', () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    const left = folder(`profittracker-run-${dead}-abc123`);
    const kept = [
      folder(`profittracker-run-${process.pid}-abc123`), // still running
      folder('profittracker-firebase-browser-abc123'),
      folder('profittracker-run-notes'),
      folder('someone-elses-folder'),
    ];
    writeFileSync(join(base, `profittracker-run-${dead}-def456`), 'a file, not a folder');
    sweepFinishedRuns(base);
    expect(existsSync(left)).toBe(false);
    for (const path of kept) expect(existsSync(join(path, 'db', 'file'))).toBe(true);
    expect(existsSync(join(base, `profittracker-run-${dead}-def456`))).toBe(true);
  });
});
