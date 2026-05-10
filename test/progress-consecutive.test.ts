import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { unlink, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');

interface FfmpegInst {
  on(event: string, listener: (...args: unknown[]) => unknown): FfmpegInst;
  saveToFile(p: string): FfmpegInst;
  takeFrames(n: number): FfmpegInst;
  withVideoCodec(c: string): FfmpegInst;
  withAudioCodec(c: string): FfmpegInst;
  withSize(s: string): FfmpegInst;
}

interface ProgressReport {
  frames: number;
  currentFps: number;
  currentKbps: number;
  targetSize: number;
  timemark: string;
  percent?: number;
}

function isCommandInPath(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? `where /Q ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ffmpegInPath = isCommandInPath('ffmpeg');
const ffmpegIt = ffmpegInPath ? it : it.skip;

const testdir = path.join(__dirname, 'assets');
const testfile = path.join(testdir, 'testvideo-43.avi');

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// --- Verification for upstream #935 / #979 -----------------------------
//
// upstream 2018 / 2020 reports: when two consecutive ffmpeg commands are
// created with `progress` listeners on each, only the first command
// emits progress events. Our TypeScript port computes
// `_ffprobeData` and the progress callbacks per-command instance, so the
// state is not shared. This test runs two short transcodes back-to-back
// and asserts BOTH emit at least one progress event.

describe('Progress event regression for upstream #935 / #979', () => {
  let toCleanup: string[] = [];

  beforeEach(() => {
    toCleanup = [];
  });

  afterEach(async () => {
    for (const p of toCleanup) {
      if (await exists(p)) await unlink(p);
    }
  });

  it('FfmpegCommand instances are independent (per-instance _ffprobeData)', () => {
    const a: { _ffprobeData?: unknown } = new Ffmpeg({ source: testfile });
    const b: { _ffprobeData?: unknown } = new Ffmpeg({ source: testfile });
    a._ffprobeData = { sentinel: 'a' };
    assert.notEqual(a._ffprobeData, b._ffprobeData);
    assert.equal(b._ffprobeData, undefined);
  });

  ffmpegIt('emits progress events on each of two consecutive commands', async () => {
    const out1 = path.join(testdir, 'progressFirst.mp4');
    const out2 = path.join(testdir, 'progressSecond.mp4');
    toCleanup.push(out1, out2);

    const runOne = async (output: string): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        let progressCount = 0;
        const cmd: FfmpegInst = new Ffmpeg({ source: testfile });
        cmd
          .takeFrames(10)
          .withVideoCodec('mpeg4')
          .withSize('320x240')
          .on('progress', (p: unknown) => {
            const report = p as ProgressReport;
            // Only count progress reports that are non-trivial (some
            // ffmpeg builds emit a leading frame=0 event before any
            // real work).
            if (typeof report.timemark === 'string' && report.timemark.length > 0) {
              progressCount += 1;
            }
          })
          .on('error', (err: unknown) => reject(err as Error))
          .on('end', () => resolve(progressCount))
          .saveToFile(output);
      });

    const firstCount = await runOne(out1);
    const secondCount = await runOne(out2);

    assert.ok(
      firstCount >= 1,
      `first command must emit at least one progress event, got ${firstCount}`,
    );
    assert.ok(
      secondCount >= 1,
      `second command must emit at least one progress event, got ${secondCount}`,
    );
    assert.ok(await exists(out1), 'first output file must exist');
    assert.ok(await exists(out2), 'second output file must exist');
  });
});
