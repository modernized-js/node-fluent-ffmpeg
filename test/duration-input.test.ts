import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import type { FfmpegCommandThis } from '../lib/types.js';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');

type FfmpegInst = FfmpegCommandThis;

// --- Feature for issue #53 / upstream #1247 -----------------------------
//
// Adds `durationInput()` and its `setInputDuration()` alias — apply
// `-t <duration>` to the *current input* rather than the global output.
// Mirrors the existing `seekInput()` shape so consumers can build
// `-t N -ss S -i input1 -t N -ss S -i input2` argv patterns.

describe('durationInput / setInputDuration (issue #53)', () => {
  it('appends -t <duration> to the current input options', () => {
    const cmd: FfmpegInst = new Ffmpeg().input('first.mp4').durationInput(10);
    const argv = cmd._inputs[0].options.get();
    assert.deepEqual(argv, ['-t', 10]);
  });

  it('exposes setInputDuration as a synonym (matches setStartTime / seekInput pair)', () => {
    const cmd: FfmpegInst = new Ffmpeg().input('first.mp4').setInputDuration('00:00:10');
    const argv = cmd._inputs[0].options.get();
    assert.deepEqual(argv, ['-t', '00:00:10']);
  });

  it('chains with seekInput in either order', () => {
    const a: FfmpegInst = new Ffmpeg().input('a.mp4').seekInput(5).durationInput(10);
    const b: FfmpegInst = new Ffmpeg().input('b.mp4').durationInput(10).seekInput(5);
    assert.deepEqual(a._inputs[0].options.get(), ['-ss', 5, '-t', 10]);
    assert.deepEqual(b._inputs[0].options.get(), ['-t', 10, '-ss', 5]);
  });

  it('applies independently to multiple inputs', () => {
    const cmd: FfmpegInst = new Ffmpeg()
      .input('first.mp4')
      .seekInput(0)
      .durationInput(10)
      .input('second.mp4')
      .seekInput(100)
      .durationInput(15);
    assert.deepEqual(cmd._inputs[0].options.get(), ['-ss', 0, '-t', 10]);
    assert.deepEqual(cmd._inputs[1].options.get(), ['-ss', 100, '-t', 15]);
  });

  it('throws "No input specified" when called before .input() (consistent with seekInput)', () => {
    assert.throws(() => new Ffmpeg().durationInput(10), /No input specified/);
    assert.throws(() => new Ffmpeg().setInputDuration(10), /No input specified/);
  });

  it('appears in the assembled argv ahead of -i for each input', () => {
    const cmd: FfmpegInst = new Ffmpeg()
      .input('a.mp4')
      .durationInput(10)
      .input('b.mp4')
      .durationInput(20)
      .output('out.mp4');
    const argv = cmd._getArguments();
    // Locate the two `-i` markers and assert the preceding flags are
    // the per-input -t values, not interleaved with the global output.
    const i1 = argv.indexOf('-i');
    const i2 = argv.indexOf('-i', i1 + 1);
    assert.notEqual(i1, -1);
    assert.notEqual(i2, -1);
    assert.deepEqual(argv.slice(i1 - 2, i1), ['-t', 10]);
    assert.deepEqual(argv.slice(i2 - 2, i2), ['-t', 20]);
  });
});
