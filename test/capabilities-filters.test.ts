import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseFiltersOutput } from '../lib/capabilities.js';

// --- Regression for issue #82 -----------------------------------------
//
// ffmpeg 8.0 dropped the "Command support" flag column from `ffmpeg -filters`
// rows (fftools/opt_common.c: `" %c%c%c "` in n7.1.1, `" %c%c "` in n8.0.1).
// A parser that requires three flag columns finds no filter at all on ffmpeg 8.
// The ffmpeg 7 rows below are real `ffmpeg -hide_banner -filters` output (7.1.1);
// the ffmpeg 8 rows are the same filters printed with ffmpeg 8's row format.

const legend = (withCommandColumn: boolean): string[] => [
  'Filters:',
  '  T.. = Timeline support',
  '  .S. = Slice threading',
  ...(withCommandColumn ? ['  ..C = Command support'] : []),
  '  A = Audio input/output',
  '  V = Video input/output',
  '  N = Dynamic number and/or type of input/output',
  '  | = Source or sink filter',
];

const ffmpeg7 = [
  ...legend(true),
  ' TSC aap               AA->A      Apply Affine Projection algorithm to first audio stream.',
  ' ... anull             A->A       Pass the source unchanged to the output.',
  ' ..C amix              N->A       Audio mixing.',
  ' ... anullsink         A->|       Do absolutely nothing with the input audio.',
  ' TSC overlay           VV->V      Overlay a video source on top of the input.',
  ' ..C scale             V->V       Scale the input video size and/or convert the image format.',
  ' ... nullsrc           |->V       Null video source, return unprocessed video frames.',
].join('\n');

const ffmpeg8 = [
  ...legend(false),
  ' TS aap               AA->A      Apply Affine Projection algorithm to first audio stream.',
  ' .. anull             A->A       Pass the source unchanged to the output.',
  ' .. amix              N->A       Audio mixing.',
  ' .. anullsink         A->|       Do absolutely nothing with the input audio.',
  ' TS overlay           VV->V      Overlay a video source on top of the input.',
  ' .. scale             V->V       Scale the input video size and/or convert the image format.',
  ' .. nullsrc           |->V       Null video source, return unprocessed video frames.',
].join('\n');

// `amix` (N->A) is absent on purpose: dynamic-pad rows are not matched in either version (issue #82, out of scope).
const expectedNames = ['aap', 'anull', 'anullsink', 'nullsrc', 'overlay', 'scale'];

describe('parseFiltersOutput (issue #82 — ffmpeg 8 row format)', () => {
  for (const [version, stdout] of [
    ['ffmpeg 7 (three flag columns)', ffmpeg7],
    ['ffmpeg 8 (two flag columns)', ffmpeg8],
  ] as const) {
    it(`parses every filter row and nothing else — ${version}`, () => {
      assert.deepEqual(Object.keys(parseFiltersOutput(stdout)).sort(), expectedNames);
    });

    it(`reads pads and descriptions — ${version}`, () => {
      const filters = parseFiltersOutput(stdout);
      assert.deepEqual(filters.anull, {
        description: 'Pass the source unchanged to the output.',
        input: 'audio',
        multipleInputs: false,
        output: 'audio',
        multipleOutputs: false,
      });
      assert.equal(filters.overlay.multipleInputs, true);
      assert.equal(filters.overlay.output, 'video');
      assert.equal(filters.nullsrc.input, 'none');
      assert.equal(filters.anullsink.output, 'none');
    });
  }

  it('returns an empty table for output with no filter rows', () => {
    assert.deepEqual(parseFiltersOutput(legend(false).join('\n')), {});
    assert.deepEqual(parseFiltersOutput(''), {});
  });
});
