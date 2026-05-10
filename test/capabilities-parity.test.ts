import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseFormatsOutput } from '../lib/capabilities.js';

// --- Regression for issue #37 / upstream #1282 / #1262 -----------------
//
// `ffmpeg -formats` emits a 3-character flag column for virtual / device
// demuxers (e.g. `lavfi`, `gdigrab`, `iec61883`):
//
//     ` D d lavfi`        // demux + device
//
// The legacy regex only consumed 2 flag columns, so device rows fell off
// the parsed format table and `inputFormat('lavfi')` raised
// "Input format lavfi is not available". The fix widens the regex to
// consume an optional 3rd `[d ]?` slot.
//
// These tests pin both the new device-row branch and the existing
// 2-flag-column rows so the refactor doesn't regress either.

describe('parseFormatsOutput (issue #37 — device demuxer parity)', () => {
  it('parses the canonical 2-flag rows (existing behaviour)', () => {
    const stdout = [
      'File formats:',
      ' D. = Demuxing supported',
      ' .E = Muxing supported',
      ' --',
      ' DE mp4             MP4 (MPEG-4 Part 14)',
      ' D  hls             Apple HTTP Live Streaming',
      '  E mov             QuickTime / MOV',
    ].join('\n');
    const result = parseFormatsOutput(stdout);
    assert.deepEqual(result.mp4, {
      description: 'MP4 (MPEG-4 Part 14)',
      canDemux: true,
      canMux: true,
    });
    assert.deepEqual(result.hls, {
      description: 'Apple HTTP Live Streaming',
      canDemux: true,
      canMux: false,
    });
    assert.deepEqual(result.mov, {
      description: 'QuickTime / MOV',
      canDemux: false,
      canMux: true,
    });
  });

  it('parses 3-flag device-demuxer rows (the lavfi family — fix for #37)', () => {
    const stdout = [
      'File formats:',
      ' D d lavfi           Lavfi',
      '  E lavf             Lavf',
      ' D d gdigrab         GDI API Windows frame grabber',
      ' D d iec61883        libiec61883 (new DV1394) A/V input device',
    ].join('\n');
    const result = parseFormatsOutput(stdout);
    assert.deepEqual(result.lavfi, {
      description: 'Lavfi',
      canDemux: true,
      canMux: false,
    });
    assert.deepEqual(result.gdigrab, {
      description: 'GDI API Windows frame grabber',
      canDemux: true,
      canMux: false,
    });
    assert.deepEqual(result.iec61883, {
      description: 'libiec61883 (new DV1394) A/V input device',
      canDemux: true,
      canMux: false,
    });
  });

  it('keeps comma-separated alias rows working alongside device rows', () => {
    const stdout = [' D  matroska,webm    Matroska / WebM', ' D d lavfi          Lavfi'].join('\n');
    const result = parseFormatsOutput(stdout);
    assert.equal(result.matroska?.description, 'Matroska / WebM');
    assert.equal(result.webm?.description, 'Matroska / WebM');
    assert.equal(result.lavfi?.canDemux, true);
  });

  it('returns an empty record for empty input (regression: no crash)', () => {
    assert.deepEqual(parseFormatsOutput(''), {});
  });

  it('skips header / separator rows', () => {
    const stdout = [
      'File formats:',
      ' D. = Demuxing supported',
      ' .E = Muxing supported',
      ' --',
    ].join('\n');
    assert.deepEqual(parseFormatsOutput(stdout), {});
  });
});
