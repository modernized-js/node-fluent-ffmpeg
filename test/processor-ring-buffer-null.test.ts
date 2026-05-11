import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import type {
  EncoderInfo,
  FfprobeCallback,
  PathCallback,
  ProcessCallback,
  ReportingError,
  SpawnEndCallback,
  SpawnOptions,
} from '../lib/types.js';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');

interface MockableFfmpegCommand {
  _checkCapabilities: (cb: (err?: Error | null) => void) => void;
  _getFfmpegPath: (cb: PathCallback) => void;
  _getFlvtoolPath: (cb: PathCallback) => void;
  _spawnFfmpeg: (
    args: string[],
    options: SpawnOptions,
    processCB: ProcessCallback,
    endCB: SpawnEndCallback,
  ) => void;
  output: (target: string) => MockableFfmpegCommand;
  on: {
    (
      event: 'error',
      listener: (err: ReportingError, stdout: string | null, stderr: string | null) => void,
    ): MockableFfmpegCommand;
    (event: 'end', listener: () => void): MockableFfmpegCommand;
    (event: string, listener: (...args: unknown[]) => void): MockableFfmpegCommand;
  };
  availableEncoders: (
    cb: (err: Error | null, encoders?: Record<string, EncoderInfo>) => void,
  ) => void;
  run: () => void;
  ffprobe: (callback: FfprobeCallback) => void;
}

// --- Regression for issue #44 / upstream #861 / #1316 ----------------
//
// `_spawnFfmpeg` invokes its endCB(err) before the stdout/stderr ring
// buffers are constructed when the underlying `_getFfmpegPath` lookup
// fails or returns an empty path. Upstream's legacy code crashed because
// the `_prepare` consumer site did `stdoutRing.get()` / `stderrRing.get()`
// on undefined rings; this fork's `lib/processor.ts:498` already uses
// optional chaining (`stdoutRing?.get()`, `stderrRing?.get()`), making
// the failure surface as a clean `'error'` event.
//
// This test pins that contract by stubbing the prototype methods so an
// actual ffmpeg spawn never runs — we drive `_spawnFfmpeg`'s endCB with
// undefined rings directly and assert the consumer's `'error'` listener
// receives the error without a synchronous crash.

describe('processor: ring-buffer null safety in endCB (issue #44)', () => {
  it('emits a clean "error" event when _spawnFfmpeg endCB fires with undefined rings', async () => {
    const cmd: MockableFfmpegCommand = new Ffmpeg({ source: 'irrelevant.mp4' });

    // Bypass the capability and path checks so the run() flow reaches
    // _spawnFfmpeg directly.
    cmd._checkCapabilities = (cb) => cb();
    cmd._getFfmpegPath = (cb) => cb(null, '/dummy/ffmpeg');
    cmd._getFlvtoolPath = (cb) => cb(null, '/dummy/flvmeta');

    // Stub _spawnFfmpeg to drive the rings-undefined branch:
    //   the spawn-end callback fires with an Error and no rings,
    //   matching what runs at lib/processor.ts line 358 in the real
    //   "Cannot find ffmpeg" path.
    cmd._spawnFfmpeg = (_args, _opts, _processCB, endCB) => {
      endCB(new Error('Cannot find ffmpeg'), undefined, undefined);
    };

    // The `availableEncoders` static path inside _prepare also uses
    // _spawnFfmpeg via callbackify — stub it to short-circuit.
    cmd.availableEncoders = (cb) => cb(null, {});

    let errorEvent: { err: Error; stdout: string | null; stderr: string | null } | undefined;
    let endEvent = false;

    const result = await new Promise<'error' | 'end' | 'timeout'>((resolve) => {
      // Defensive timeout in case neither event ever fires. Captured so
      // we can clear it on resolution — without that, every successful
      // run keeps the event loop alive for the full second and the
      // suite slow-walks unnecessarily.
      const timeoutHandle = setTimeout(() => resolve('timeout'), 1000);
      const finish = (outcome: 'error' | 'end' | 'timeout'): void => {
        clearTimeout(timeoutHandle);
        resolve(outcome);
      };
      cmd.on('error', (err, stdout, stderr) => {
        errorEvent = { err, stdout, stderr };
        finish('error');
      });
      cmd.on('end', () => {
        endEvent = true;
        finish('end');
      });
      cmd.output('/dev/null').run();
    });

    assert.equal(result, 'error', `expected 'error' event, got ${result}`);
    assert.ok(errorEvent, 'error listener must have received the error');
    assert.equal(errorEvent!.err.message, 'Cannot find ffmpeg');
    // The undefined-ring path produces undefined stdout / stderr — the
    // optional chaining at processor.ts:498 turned `ring?.get()` into
    // undefined rather than crashing.
    assert.equal(errorEvent!.stdout, undefined);
    assert.equal(errorEvent!.stderr, undefined);
    assert.equal(endEvent, false, '"end" must not fire on the error path');
  });
});
