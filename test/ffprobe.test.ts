import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { buildFfprobeArgv } from '../lib/ffprobe.js';
import utils from '../lib/utils.js';
import type { InputState } from '../lib/types.js';

// --- Regression for issue #38 / upstream #1146 -------------------------
//
// `inputOptions(['-headers', 'Cookie: …'])` or `inputOptions(['-rtsp_transport',
// 'tcp'])` is forwarded to the main ffmpeg invocation but not to the ffprobe
// sidecar. As a result, ffprobe silently 401s on auth-protected URLs / RTSP
// feeds, and `progress.percent` is forever undefined because the duration
// probe never completed.
//
// The fix forwards `input.options` ahead of the standard `-show_streams
// -show_format` flags. Caller-supplied `options` (the `(idx, opts, cb)`
// overload) come last so an explicit override still wins on conflicting
// flags. These tests pin both behaviours.

function makeInput(opts: string[] = [], source = 'rtsp://example/movie.mp4'): InputState {
  const argList = utils.args();
  if (opts.length > 0) argList(opts);
  return {
    source,
    isFile: false,
    isStream: false,
    options: argList,
  };
}

describe('buildFfprobeArgv (issue #38 — input options forwarded to ffprobe)', () => {
  it('embeds the standard -show_streams -show_format pair and the source last', () => {
    const argv = buildFfprobeArgv(makeInput(), [], 'https://example/v.mp4');
    assert.deepEqual(argv, ['-show_streams', '-show_format', 'https://example/v.mp4']);
  });

  it('forwards input options ahead of the standard flags (the fix)', () => {
    const argv = buildFfprobeArgv(
      makeInput(['-headers', 'Cookie: a=b']),
      [],
      'https://example/v.mp4',
    );
    assert.deepEqual(argv, [
      '-headers',
      'Cookie: a=b',
      '-show_streams',
      '-show_format',
      'https://example/v.mp4',
    ]);
  });

  it('forwards multiple input options in their original order', () => {
    const argv = buildFfprobeArgv(
      makeInput(['-rtsp_transport', 'tcp', '-allowed_extensions', 'ALL']),
      [],
      'rtsp://example/feed',
    );
    assert.deepEqual(argv, [
      '-rtsp_transport',
      'tcp',
      '-allowed_extensions',
      'ALL',
      '-show_streams',
      '-show_format',
      'rtsp://example/feed',
    ]);
  });

  it('places caller-supplied options after the standard pair (overrides win)', () => {
    const argv = buildFfprobeArgv(
      makeInput(['-rtsp_transport', 'udp']),
      ['-rtsp_transport', 'tcp', '-loglevel', 'quiet'],
      'rtsp://example/feed',
    );
    // Input opts are first (-rtsp_transport udp), then the standard pair,
    // then caller opts (-rtsp_transport tcp, -loglevel quiet). ffprobe's
    // last-flag-wins semantics make the caller's override effective.
    assert.deepEqual(argv, [
      '-rtsp_transport',
      'udp',
      '-show_streams',
      '-show_format',
      '-rtsp_transport',
      'tcp',
      '-loglevel',
      'quiet',
      'rtsp://example/feed',
    ]);
  });

  it('coerces numeric input-option values to strings (so spawn argv is string-only)', () => {
    const input = makeInput();
    input.options('-probesize', 5_000_000);
    input.options('-analyzeduration', 10_000_000);
    const argv = buildFfprobeArgv(input, [], 'rtsp://example/feed');
    assert.deepEqual(argv, [
      '-probesize',
      '5000000',
      '-analyzeduration',
      '10000000',
      '-show_streams',
      '-show_format',
      'rtsp://example/feed',
    ]);
    assert.ok(
      argv.every((a) => typeof a === 'string'),
      'every argv element must be a string',
    );
  });

  it('produces stable output for stream inputs (caller passes pipe:0 as src)', () => {
    const argList = utils.args();
    argList(['-f', 'matroska']);
    const input: InputState = {
      source: new PassThrough(),
      isFile: false,
      isStream: true,
      options: argList,
    };
    const argv = buildFfprobeArgv(input, [], 'pipe:0');
    assert.deepEqual(argv, ['-f', 'matroska', '-show_streams', '-show_format', 'pipe:0']);
  });
});
