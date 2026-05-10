import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');

interface MockableFfmpegCommand {
  options: { skipMetadata?: boolean };
  ffprobe(...args: unknown[]): void;
  on(event: string, listener: (...args: unknown[]) => unknown): MockableFfmpegCommand;
  _checkCapabilities(cb: (err?: Error | null) => void): void;
  _getFfmpegPath(cb: (err: Error | null, p?: string) => void): void;
  _getFlvtoolPath(cb: (err: Error | null, p?: string) => void): void;
  _spawnFfmpeg(...args: unknown[]): void;
  availableEncoders(cb: (err: Error | null, e?: unknown) => void): void;
  _prepare(cb: (err: Error | null, args?: string[]) => void, readMetadata?: boolean): void;
}

// --- Feature for issue #54 / upstream #1191 ---------------------------
//
// Adds `options.skipMetadata` so consumers piping URL inputs (where
// the early ffprobe duplicates an HTTP request) can opt out of the
// background probe. With skipMetadata=true the `progress` event still
// fires but `percent` is undefined.
//
// The tests stub the prototype methods on each instance so no real
// ffmpeg / ffprobe spawn ever runs; they assert how many times
// `cmd.ffprobe` is invoked relative to the `skipMetadata` flag.

function setupCmd(opts: { skipMetadata?: boolean }): {
  cmd: MockableFfmpegCommand;
  probeCount: () => number;
} {
  let count = 0;
  const cmd = new Ffmpeg({ source: 'irrelevant.mp4', ...opts }) as MockableFfmpegCommand;
  cmd._checkCapabilities = (cb) => cb();
  cmd._getFfmpegPath = (cb) => cb(null, '/dummy/ffmpeg');
  cmd._getFlvtoolPath = (cb) => cb(null, '/dummy/flvmeta');
  cmd.availableEncoders = (cb) => cb(null, {});
  cmd._spawnFfmpeg = () => {};
  cmd.ffprobe = (..._args: unknown[]): void => {
    count += 1;
  };
  return { cmd, probeCount: () => count };
}

const SETTLE_MS = 30;

describe('skipMetadata option (issue #54)', () => {
  it('default behaviour: progress listener triggers the early ffprobe', async () => {
    const { cmd, probeCount } = setupCmd({});
    cmd.on('progress', () => {});
    await new Promise<void>((resolve) => cmd._prepare(() => resolve()));
    await new Promise<void>((r) => setTimeout(r, SETTLE_MS));
    assert.equal(probeCount(), 1, 'default behaviour must fire the early ffprobe');
  });

  it('skipMetadata=true: the early ffprobe is NOT fired even with a progress listener', async () => {
    const { cmd, probeCount } = setupCmd({ skipMetadata: true });
    cmd.on('progress', () => {});
    await new Promise<void>((resolve) => cmd._prepare(() => resolve()));
    await new Promise<void>((r) => setTimeout(r, SETTLE_MS));
    assert.equal(probeCount(), 0, 'skipMetadata=true must suppress the early ffprobe entirely');
  });

  it('skipMetadata=false (explicit) keeps the default behaviour', async () => {
    const { cmd, probeCount } = setupCmd({ skipMetadata: false });
    cmd.on('progress', () => {});
    await new Promise<void>((resolve) => cmd._prepare(() => resolve()));
    await new Promise<void>((r) => setTimeout(r, SETTLE_MS));
    assert.equal(probeCount(), 1);
  });

  it('skipMetadata=true with NO progress listener: still no probe (regression — never was one)', async () => {
    const { cmd, probeCount } = setupCmd({ skipMetadata: true });
    await new Promise<void>((resolve) => cmd._prepare(() => resolve()));
    await new Promise<void>((r) => setTimeout(r, SETTLE_MS));
    assert.equal(probeCount(), 0);
  });

  it('options.skipMetadata is reflected on the command instance', () => {
    const cmd = new Ffmpeg({ source: 'foo.mp4', skipMetadata: true }) as MockableFfmpegCommand;
    assert.equal(cmd.options.skipMetadata, true);
  });
});
