import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { unlink, access } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');
const testhelper = require('./helpers.js');

interface FfmpegInst {
  on(event: string, listener: (...args: unknown[]) => unknown): FfmpegInst;
  emit(event: string, ...args: unknown[]): boolean;
  saveToFile(p: string): FfmpegInst;
  takeFrames(n: number): FfmpegInst;
  withVideoCodec(c: string): FfmpegInst;
  withAudioCodec(c: string): FfmpegInst;
  withSize(s: string): FfmpegInst;
}

const ffmpegInPath = testhelper.isCommandInPath('ffmpeg');
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

  // The exact upstream bug shape: a 'progress' event emitted on one
  // command must NOT be received by another command's listener. If the
  // emitter (or the progress chain wired through it) were shared, the
  // event would cross-pollinate and only one of two consecutive commands
  // would appear to "work" from the consumer's POV. Testing the
  // EventEmitter directly catches a regression even if it's introduced
  // outside _ffprobeData (e.g. a hypothetical module-level
  // progress-callback registry).
  it('progress events emitted on one command do not leak to another command', () => {
    const a: FfmpegInst = new Ffmpeg({ source: testfile });
    const b: FfmpegInst = new Ffmpeg({ source: testfile });
    const aProgresses: unknown[] = [];
    const bProgresses: unknown[] = [];
    a.on('progress', (p) => {
      aProgresses.push(p);
    });
    b.on('progress', (p) => {
      bProgresses.push(p);
    });
    a.emit('progress', { frames: 1, timemark: '00:00:01.00' });
    assert.equal(aProgresses.length, 1, 'a must receive its own progress event');
    assert.equal(bProgresses.length, 0, 'progress emitted on a must NOT reach b');
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
          // The upstream regression makes the second command emit ZERO
          // progress events. Counting all events is the right shape for
          // catching it — even ffmpeg's initial frame=0 sentinel is
          // evidence that the per-instance progress chain is wired.
          .on('progress', () => {
            progressCount += 1;
          })
          .on('error', (err: unknown) => reject(testhelper.toError(err)))
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
