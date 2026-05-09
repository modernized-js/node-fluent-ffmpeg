import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getScalePadFilters,
  percentScaleFilter,
  fixedSizeFilters,
  partialSizeFilters,
} from '../lib/options/videosize.js';
import type { FilterSpec, OutputState } from '../lib/types.js';

type SizeData = NonNullable<OutputState['sizeData']>;

const matchWidth = (s: string): RegExpMatchArray | null => s.match(/([0-9]+)x\?/);
const matchHeight = (s: string): RegExpMatchArray | null => s.match(/\?x([0-9]+)/);

function assertIsRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected an options Record, got ${typeof value}`);
  }
}

function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Expected a string, got ${typeof value}`);
  }
}

function options(filter: FilterSpec): Record<string, unknown> {
  assertIsRecord(filter.options);
  return filter.options;
}

function stringOption(filter: FilterSpec, key: string): string {
  const opts = options(filter);
  const value = opts[key];
  assertIsString(value);
  return value;
}

describe('getScalePadFilters', () => {
  it('returns exactly the scale + pad pair, in that order', () => {
    const filters = getScalePadFilters(1920, 1080, 16 / 9, 'black');
    assert.equal(filters.length, 2);
    assert.equal(filters[0].filter, 'scale');
    assert.equal(filters[1].filter, 'pad');
  });

  it('embeds the supplied width / height as literal pad-canvas size', () => {
    const filters = getScalePadFilters(640, 480, 4 / 3, 'black');
    const opts = options(filters[1]);
    assert.equal(opts.w, 640);
    assert.equal(opts.h, 480);
  });

  it('threads the supplied aspect into both branches of the scale expressions', () => {
    const filters = getScalePadFilters(1920, 1080, 2.0, 'black');
    assert.match(stringOption(filters[0], 'w'), /gt\(a,2\)/);
    assert.match(stringOption(filters[0], 'h'), /lt\(a,2\)/);
  });

  it('threads the supplied aspect into the pad x / y centring expressions', () => {
    const filters = getScalePadFilters(1920, 1080, 2.0, 'black');
    assert.match(stringOption(filters[1], 'x'), /gt\(a,2\)/);
    assert.match(stringOption(filters[1], 'y'), /lt\(a,2\)/);
  });

  it('passes the color through verbatim (no validation, no escaping)', () => {
    const filters = getScalePadFilters(640, 480, 4 / 3, '#ff00aa');
    assert.equal(options(filters[1]).color, '#ff00aa');
  });

  it('passes a comma-bearing color through verbatim (caller-side concern)', () => {
    const filters = getScalePadFilters(640, 480, 4 / 3, 'rgba(0,0,0,0.5)');
    assert.equal(options(filters[1]).color, 'rgba(0,0,0,0.5)');
  });

  it('builds the trunc(... /2)*2 even-rounding clauses on both axes', () => {
    const filters = getScalePadFilters(800, 600, 4 / 3, 'black');
    assert.match(stringOption(filters[0], 'w'), /trunc\(600\*a\/2\)\*2/);
    assert.match(stringOption(filters[0], 'h'), /trunc\(800\/a\/2\)\*2/);
  });

  it('handles a square aspect (1) without special-casing', () => {
    const filters = getScalePadFilters(500, 500, 1, 'black');
    assert.match(stringOption(filters[0], 'w'), /gt\(a,1\)/);
    assert.match(stringOption(filters[0], 'h'), /lt\(a,1\)/);
  });
});

describe('percentScaleFilter', () => {
  it('returns exactly one scale filter', () => {
    const filters = percentScaleFilter('50');
    assert.equal(filters.length, 1);
    assert.equal(filters[0].filter, 'scale');
  });

  it('embeds the percent / 100 ratio in both axes', () => {
    const filters = percentScaleFilter('50');
    assert.match(stringOption(filters[0], 'w'), /trunc\(iw\*0\.5\/2\)\*2/);
    assert.match(stringOption(filters[0], 'h'), /trunc\(ih\*0\.5\/2\)\*2/);
  });

  it('handles 100 as the identity ratio', () => {
    const filters = percentScaleFilter('100');
    assert.match(stringOption(filters[0], 'w'), /trunc\(iw\*1\/2\)\*2/);
  });

  it('handles values above 100 (no upper bound enforced)', () => {
    const filters = percentScaleFilter('200');
    assert.match(stringOption(filters[0], 'w'), /trunc\(iw\*2\/2\)\*2/);
  });

  it('handles 0 as a zero ratio (downstream is responsible for rejecting)', () => {
    const filters = percentScaleFilter('0');
    assert.match(stringOption(filters[0], 'w'), /trunc\(iw\*0\/2\)\*2/);
  });

  it('emits NaN in the template when given a non-numeric string (no throw)', () => {
    const filters = percentScaleFilter('abc');
    assert.match(stringOption(filters[0], 'w'), /trunc\(iw\*NaN\/2\)\*2/);
  });

  it('treats the empty string as Number("")=0', () => {
    const filters = percentScaleFilter('');
    assert.match(stringOption(filters[0], 'w'), /trunc\(iw\*0\/2\)\*2/);
  });
});

describe('fixedSizeFilters', () => {
  it('returns a single scale filter when pad is false', () => {
    const filters = fixedSizeFilters(640, 480, false);
    assert.equal(filters.length, 1);
    assert.equal(filters[0].filter, 'scale');
    assert.deepEqual(filters[0].options, { w: 640, h: 480 });
  });

  it('returns scale + pad when pad is a colour string', () => {
    const filters = fixedSizeFilters(1920, 1080, 'black');
    assert.equal(filters.length, 2);
    assert.equal(filters[1].filter, 'pad');
  });

  it('uses width/height as the pad-target aspect (width / height)', () => {
    const filters = fixedSizeFilters(1600, 800, 'black');
    assert.match(stringOption(filters[0], 'w'), /gt\(a,2\)/);
  });

  it('treats the empty string as falsy (no pad chain)', () => {
    const filters = fixedSizeFilters(640, 480, '');
    assert.equal(filters.length, 1);
    assert.equal(filters[0].filter, 'scale');
  });

  it('passes 0x0 with pad=false through verbatim (no NaN risk)', () => {
    const filters = fixedSizeFilters(0, 0, false);
    assert.deepEqual(filters[0].options, { w: 0, h: 0 });
  });

  it('passes the colour into the pad chain when pad is a non-empty string', () => {
    const filters = fixedSizeFilters(640, 480, '#abcdef');
    assert.equal(options(filters[1]).color, '#abcdef');
  });
});

describe('partialSizeFilters', () => {
  it('with aspect + fixedWidth: rounds width and computes height from aspect, even-rounded', () => {
    const data: SizeData = { aspect: 2 };
    const filters = partialSizeFilters(matchWidth('320x?'), null, data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 320);
    assert.equal(opts.h, 160);
  });

  it('with aspect + fixedHeight: rounds height and computes width from aspect, even-rounded', () => {
    const data: SizeData = { aspect: 2 };
    const filters = partialSizeFilters(null, matchHeight('?x240'), data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 480);
    assert.equal(opts.h, 240);
  });

  it('with aspect + odd computed value: even-rounds to the nearest 2 (legacy double-round)', () => {
    const data: SizeData = { aspect: 1 / 3 };
    const filters = partialSizeFilters(null, matchHeight('?x300'), data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 100);
    assert.equal(opts.h, 300);
  });

  it('with aspect + pad: produces the scale + pad chain', () => {
    const data: SizeData = { aspect: 2, pad: 'black' };
    const filters = partialSizeFilters(matchWidth('320x?'), null, data);
    assert.equal(filters.length, 2);
    assert.equal(filters[1].filter, 'pad');
  });

  it('without aspect + fixedWidth: scales to (rounded W, trunc(ow/a/2)*2)', () => {
    const data: SizeData = {};
    const filters = partialSizeFilters(matchWidth('321x?'), null, data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 322);
    assert.equal(opts.h, 'trunc(ow/a/2)*2');
  });

  it('without aspect + fixedHeight: scales to (trunc(oh*a/2)*2, rounded H)', () => {
    const data: SizeData = {};
    const filters = partialSizeFilters(null, matchHeight('?x481'), data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 'trunc(oh*a/2)*2');
    assert.equal(opts.h, 482);
  });

  it('returns a single scale filter when no aspect is set (no pad even when pad is in data)', () => {
    const data: SizeData = { pad: 'black' };
    const filters = partialSizeFilters(matchWidth('320x?'), null, data);
    assert.equal(filters.length, 1);
    assert.equal(filters[0].filter, 'scale');
  });

  it('with aspect, pad=false: stays in the single-scale form', () => {
    const data: SizeData = { aspect: 2, pad: false };
    const filters = partialSizeFilters(matchWidth('320x?'), null, data);
    assert.equal(filters.length, 1);
    assert.equal(filters[0].filter, 'scale');
  });

  it('zero-width input with aspect: derives a zero height too', () => {
    const data: SizeData = { aspect: 2 };
    const filters = partialSizeFilters(matchWidth('0x?'), null, data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 0);
    assert.equal(opts.h, 0);
  });

  it('odd-width input with aspect=1 rounds the cross-axis to the nearest even pixel', () => {
    const data: SizeData = { aspect: 1 };
    const filters = partialSizeFilters(matchWidth('321x?'), null, data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 322);
    assert.equal(opts.h, 322);
  });

  it('width=1 with aspect=2 rounds up to the nearest even pixel (Math.round(0.5)=1, *2=2)', () => {
    const data: SizeData = { aspect: 2 };
    const filters = partialSizeFilters(matchWidth('1x?'), null, data);
    const opts = options(filters[0]);
    assert.equal(opts.w, 2);
  });
});
