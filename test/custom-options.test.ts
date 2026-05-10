import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { flattenOptions } from '../lib/options/custom.js';

// --- Regression for issue #42 / upstream #1151 -------------------------
//
// `inputOptions(['-headers', 'Cookie: a=b'])` historically had its second
// entry split on the embedded space, producing
// `['-headers', 'Cookie:', 'a=b']` — three argv tokens — which mangles the
// HTTP header value. The fix splits an array entry only when its first
// part starts with `-` (i.e. it really is a flag-value pair). Raw values
// like `'Cookie: a=b'` or `'rgba(0,0,0,0.5) blah'` survive intact.
//
// Critical: the legacy preset shape — `outputOptions(['-me_method umh',
// '-subq 5', …])` — still splits, so the bundled presets keep working.
// The heuristic distinguishes them by inspecting the first split part.

describe('flattenOptions (issue #42 — array entries with embedded spaces)', () => {
  it('preserves a header value with a space — the bug fix', () => {
    assert.deepEqual(flattenOptions([['-headers', 'Cookie: a=b']]), ['-headers', 'Cookie: a=b']);
  });

  it('preserves a value-with-space whose first token does not look like a flag', () => {
    assert.deepEqual(flattenOptions([['-metadata', 'comment=hello world']]), [
      '-metadata',
      'comment=hello world',
    ]);
  });

  it('still splits legacy preset entries that ARE flag-value pairs (regression)', () => {
    assert.deepEqual(
      flattenOptions([
        ['-flags', '+loop', '-me_method umh', '-subq 5', '-bufsize 2M', '-qcomp 0.6'],
      ]),
      ['-flags', '+loop', '-me_method', 'umh', '-subq', '5', '-bufsize', '2M', '-qcomp', '0.6'],
    );
  });

  it('splits a single positional string with a space (legacy `-flag value`)', () => {
    assert.deepEqual(flattenOptions(['-ss 00:00:10']), ['-ss', '00:00:10']);
  });

  it('keeps multiple positional args separate (each is already an argv token)', () => {
    assert.deepEqual(flattenOptions(['-c:v', 'libx264']), ['-c:v', 'libx264']);
  });

  it('returns an empty array for an empty array input', () => {
    assert.deepEqual(flattenOptions([[]]), []);
  });

  it('returns an empty array for no positional args', () => {
    assert.deepEqual(flattenOptions([]), []);
  });

  it('keeps simple flag-only array entries intact (no spaces, no split)', () => {
    assert.deepEqual(flattenOptions([['-y', '-shortest', '-nostdin']]), [
      '-y',
      '-shortest',
      '-nostdin',
    ]);
  });

  it('does NOT split entries with three or more space-separated parts', () => {
    // Three+ parts means "this is a free-form value, not a flag-value
    // pair" — preserve verbatim. Catches drawtext, complex filter
    // strings, etc.
    assert.deepEqual(flattenOptions([['-vf', 'drawtext=text=Hello World:fontsize=24']]), [
      '-vf',
      'drawtext=text=Hello World:fontsize=24',
    ]);
  });
});
