import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  pickBiggestVideoStream,
  normaliseScreenshotConfig,
  parseSizeSpec,
  isPercentTimemark,
  fixPattern,
  replaceFilenameTokens,
  replaceSizeTokens,
  generateFilenames,
  type ScreenshotConfig,
  type SizeForTokens,
} from '../lib/recipes.js';
import type { FfprobeData, FfprobeStream } from '../lib/types.js';

const videoStream = (
  width: number,
  height: number,
  extra: Partial<FfprobeStream> = {},
): FfprobeStream => ({
  codec_type: 'video',
  width,
  height,
  ...extra,
});

const audioStream = (extra: Partial<FfprobeStream> = {}): FfprobeStream => ({
  codec_type: 'audio',
  ...extra,
});

const meta = (streams: FfprobeStream[]): FfprobeData => ({
  streams,
  format: {},
  chapters: [],
});

describe('pickBiggestVideoStream', () => {
  it('returns the only video stream when there is one', () => {
    const only = videoStream(640, 480);
    const picked = pickBiggestVideoStream(meta([only]));
    assert.equal(picked, only);
  });

  it('picks the larger-area video stream from two', () => {
    const small = videoStream(320, 240);
    const big = videoStream(1920, 1080);
    const picked = pickBiggestVideoStream(meta([small, big]));
    assert.equal(picked, big);
  });

  it('ignores audio streams even when listed first', () => {
    const audio = audioStream();
    const video = videoStream(640, 480);
    const picked = pickBiggestVideoStream(meta([audio, video]));
    assert.equal(picked, video);
  });

  it('on equal area, keeps the earlier-encountered stream (uses strict >, not >=)', () => {
    const first = videoStream(640, 480);
    const second = videoStream(480, 640);
    const picked = pickBiggestVideoStream(meta([first, second]));
    assert.equal(picked, first);
  });

  it('coerces width/height strings via Number() (ffprobe legacy "string numbers")', () => {
    const small = videoStream(0, 0, { width: '320', height: '240' });
    const big = videoStream(0, 0, { width: '1920', height: '1080' });
    const picked = pickBiggestVideoStream(meta([small, big]));
    assert.equal(picked, big);
  });

  it('returns the zero-sized seed (not undefined) when no video streams exist', () => {
    const picked = pickBiggestVideoStream(meta([audioStream()]));
    assert.equal(picked.width, 0);
    assert.equal(picked.height, 0);
    assert.equal(picked.codec_type, undefined);
  });

  it('returns the seed when the streams array is empty', () => {
    const picked = pickBiggestVideoStream(meta([]));
    assert.equal(picked.width, 0);
    assert.equal(picked.height, 0);
  });

  it('treats missing width/height (NaN comparison) as not-bigger', () => {
    const incomplete = videoStream(0, 0, { width: undefined, height: undefined });
    const real = videoStream(100, 100);
    const picked = pickBiggestVideoStream(meta([incomplete, real]));
    assert.equal(picked, real);
  });

  it('mutating the returned no-video seed does not poison later calls', () => {
    const first = pickBiggestVideoStream(meta([]));
    first.width = 9999;
    const second = pickBiggestVideoStream(meta([]));
    assert.equal(second.width, 0);
    assert.notEqual(first, second);
  });
});

describe('normaliseScreenshotConfig', () => {
  it('coerces a numeric input into { count, timemarks: [%s] }', () => {
    const config = normaliseScreenshotConfig(3);
    assert.equal(config.count, 3);
    assert.deepEqual(config.timemarks, ['25%', '50%', '75%']);
    assert.equal(config.folder, '.');
  });

  it('uses a single 50% timemark when count is 1', () => {
    const config = normaliseScreenshotConfig(1);
    assert.deepEqual(config.timemarks, ['50%']);
  });

  it('synthesizes count=1 (50%) when given undefined', () => {
    const config = normaliseScreenshotConfig(undefined);
    assert.deepEqual(config.timemarks, ['50%']);
  });

  it('honours the folder argument when the config object lacks one', () => {
    const config = normaliseScreenshotConfig({ count: 1 }, '/tmp/shots');
    assert.equal(config.folder, '/tmp/shots');
  });

  it('keeps the folder property from the input over the folder argument', () => {
    const config = normaliseScreenshotConfig({ count: 1, folder: '/explicit' }, '/ignored');
    assert.equal(config.folder, '/explicit');
  });

  it('migrates timestamps onto timemarks (timestamps wins over timemarks)', () => {
    const config = normaliseScreenshotConfig({
      timemarks: ['10%'],
      timestamps: ['20%', '40%'],
    });
    assert.deepEqual(config.timemarks, ['20%', '40%']);
  });

  it('preserves an explicit timemark list and skips count synthesis', () => {
    const config = normaliseScreenshotConfig({ timemarks: [1, 2, 3] });
    assert.deepEqual(config.timemarks, [1, 2, 3]);
    assert.equal(config.count, undefined);
  });

  it('throws when neither count nor timemarks is provided', () => {
    assert.throws(
      () => normaliseScreenshotConfig({}),
      /neither a count nor a timemark list are specified/,
    );
  });

  it('throws when count is 0 and no timemarks are given', () => {
    assert.throws(() => normaliseScreenshotConfig(0), /neither a count nor a timemark list/);
  });
});

describe('parseSizeSpec', () => {
  it('returns all-null for undefined input', () => {
    const r = parseSizeSpec(undefined);
    assert.equal(r.fixedSize, null);
    assert.equal(r.fixedWidth, null);
    assert.equal(r.fixedHeight, null);
    assert.equal(r.percentSize, null);
  });

  it('returns all-null for the empty string (truthy-coerced as falsy)', () => {
    const r = parseSizeSpec('');
    assert.equal(r.fixedSize, null);
  });

  it('matches "WxH" as fixedSize and exposes the captures', () => {
    const r = parseSizeSpec('640x480');
    assert.ok(r.fixedSize);
    assert.equal(r.fixedSize![1], '640');
    assert.equal(r.fixedSize![2], '480');
    assert.equal(r.fixedWidth, null);
  });

  it('matches "Wx?" as fixedWidth', () => {
    const r = parseSizeSpec('320x?');
    assert.ok(r.fixedWidth);
    assert.equal(r.fixedWidth![1], '320');
    assert.equal(r.fixedSize, null);
  });

  it('matches "?xH" as fixedHeight', () => {
    const r = parseSizeSpec('?x240');
    assert.ok(r.fixedHeight);
    assert.equal(r.fixedHeight![1], '240');
  });

  it('matches "N%" as percentSize', () => {
    const r = parseSizeSpec('50%');
    assert.ok(r.percentSize);
    assert.equal(r.percentSize![1], '50');
  });

  it('throws on completely unrecognised strings', () => {
    assert.throws(() => parseSizeSpec('not-a-size'), /Invalid size parameter: not-a-size/);
  });

  it('throws on capital X (regex is case-sensitive)', () => {
    assert.throws(() => parseSizeSpec('640X480'), /Invalid size parameter/);
  });

  it('throws on padded whitespace (regex is anchored)', () => {
    assert.throws(() => parseSizeSpec(' 640x480 '), /Invalid size parameter/);
  });

  it('does NOT match the all-question form "?x?"', () => {
    assert.throws(() => parseSizeSpec('?x?'), /Invalid size parameter/);
  });

  it('accepts leading-zero numerics like "0x0"', () => {
    const r = parseSizeSpec('0x0');
    assert.ok(r.fixedSize);
    assert.equal(r.fixedSize![1], '0');
  });
});

describe('isPercentTimemark', () => {
  it('matches an integer percent string', () => {
    assert.equal(isPercentTimemark('50%'), true);
  });

  it('matches a decimal percent string', () => {
    assert.equal(isPercentTimemark('50.5%'), true);
  });

  it('matches a leading-dot decimal (".5%")', () => {
    assert.equal(isPercentTimemark('.5%'), true);
  });

  it('rejects a numeric input (no "%" once stringified)', () => {
    assert.equal(isPercentTimemark(50), false);
  });

  it('rejects a string without "%"', () => {
    assert.equal(isPercentTimemark('50'), false);
  });

  it('rejects "%" alone (regex requires at least one digit/dot)', () => {
    assert.equal(isPercentTimemark('%'), false);
  });

  it('rejects the empty string', () => {
    assert.equal(isPercentTimemark(''), false);
  });

  it('rejects trailing whitespace ("50% ")', () => {
    assert.equal(isPercentTimemark('50% '), false);
  });

  it('rejects double percent ("50%%")', () => {
    assert.equal(isPercentTimemark('50%%'), false);
  });

  it('accepts uncapped percentages like "150%" (no upper bound enforced)', () => {
    assert.equal(isPercentTimemark('150%'), true);
  });
});

describe('fixPattern', () => {
  const tm1: ScreenshotConfig = { timemarks: [1] };
  const tm3: ScreenshotConfig = { timemarks: [1, 2, 3] };

  it('returns the default tn.png when filename is unset', () => {
    assert.equal(fixPattern(tm1), 'tn.png');
  });

  it('appends .png to a dotless filename', () => {
    assert.equal(fixPattern({ ...tm1, filename: 'snap' }), 'snap.png');
  });

  it('keeps an existing extension as-is', () => {
    assert.equal(fixPattern({ ...tm1, filename: 'snap.jpg' }), 'snap.jpg');
  });

  it('does NOT inject _%i for a single timemark', () => {
    assert.equal(fixPattern({ ...tm1, filename: 'snap.png' }), 'snap.png');
  });

  it('injects _%i before the extension for multiple timemarks', () => {
    assert.equal(fixPattern({ ...tm3, filename: 'snap.png' }), path.join('.', 'snap_%i.png'));
  });

  it('keeps user-supplied %s and skips the _%i injection', () => {
    assert.equal(fixPattern({ ...tm3, filename: 'snap_%s.png' }), 'snap_%s.png');
  });

  it('keeps user-supplied %i and skips the _%i injection', () => {
    assert.equal(fixPattern({ ...tm3, filename: 'shot_%i.png' }), 'shot_%i.png');
  });

  it('keeps user-supplied %0..0i padding (only literal zeros count) and skips the _%i injection', () => {
    assert.equal(fixPattern({ ...tm3, filename: 'shot_%000i.png' }), 'shot_%000i.png');
  });

  it('does NOT recognise %03i as padding — non-zero digits before i make the regex miss', () => {
    assert.equal(
      fixPattern({ ...tm3, filename: 'shot_%03i.png' }),
      path.join('.', 'shot_%03i_%i.png'),
    );
  });

  it('preserves the directory portion when injecting _%i', () => {
    assert.equal(
      fixPattern({ ...tm3, filename: path.join('out', 'shot.png') }),
      path.join('out', 'shot_%i.png'),
    );
  });
});

describe('replaceFilenameTokens', () => {
  it('returns the pattern unchanged when no %f or %b token is present', () => {
    assert.equal(replaceFilenameTokens('shot_%i.png', '/path/to/movie.mp4'), 'shot_%i.png');
  });

  it('replaces %f with the basename of the source', () => {
    assert.equal(replaceFilenameTokens('out/%f.png', '/path/to/movie.mp4'), 'out/movie.mp4.png');
  });

  it('replaces %b with the basename without its extension', () => {
    assert.equal(replaceFilenameTokens('out/%b.png', '/path/to/movie.mp4'), 'out/movie.png');
  });

  it('replaces both %f and %b in the same pattern', () => {
    assert.equal(replaceFilenameTokens('%b/%f', '/path/to/movie.mp4'), 'movie/movie.mp4');
  });

  it('replaces every occurrence of %f (global flag)', () => {
    assert.equal(replaceFilenameTokens('%f-%f.png', '/p/file.txt'), 'file.txt-file.txt.png');
  });

  it('uses the whole filename for %b when there is no extension', () => {
    assert.equal(replaceFilenameTokens('%b.png', '/p/noext'), 'noext.png');
  });

  it('preserves a multi-dot basename for %b (only strips the last extension)', () => {
    assert.equal(replaceFilenameTokens('%b.png', '/p/foo.bar.mp4'), 'foo.bar.png');
  });

  it('throws when the source is not a string and the pattern contains %f', () => {
    assert.throws(
      () => replaceFilenameTokens('%f.png', { kind: 'stream' }),
      /Cannot replace %f or %b when using an input stream/,
    );
  });

  it('does NOT throw when the source is non-string but the pattern is also tokenless', () => {
    assert.equal(replaceFilenameTokens('static.png', { kind: 'stream' }), 'static.png');
  });
});

describe('replaceSizeTokens', () => {
  const size: SizeForTokens = { width: 1920, height: 1080 };

  it('replaces %w and %h with the numeric width / height', () => {
    assert.equal(replaceSizeTokens('%wx%h.png', size), '1920x1080.png');
  });

  it('replaces %r by expanding it to %wx%h first', () => {
    assert.equal(replaceSizeTokens('%r.png', size), '1920x1080.png');
  });

  it('handles a pattern with both %r and standalone %w', () => {
    assert.equal(replaceSizeTokens('%r-%w.png', size), '1920x1080-1920.png');
  });

  it('returns the pattern unchanged when no size tokens are present', () => {
    assert.equal(replaceSizeTokens('static.png', size), 'static.png');
  });

  it('replaces every occurrence of %w (global flag)', () => {
    assert.equal(replaceSizeTokens('%w-%w', size), '1920-1920');
  });

  it('writes -1 for the sentinel "no size needed" payload', () => {
    assert.equal(replaceSizeTokens('%wx%h', { width: -1, height: -1 }), '-1x-1');
  });

  it('writes 0 for zero size without throwing', () => {
    assert.equal(replaceSizeTokens('%wx%h', { width: 0, height: 0 }), '0x0');
  });
});

describe('generateFilenames', () => {
  it('returns one filename per timemark', () => {
    const names = generateFilenames('shot.png', [1, 2, 3]);
    assert.equal(names.length, 3);
  });

  it('returns the empty list for an empty timemark list', () => {
    assert.deepEqual(generateFilenames('shot.png', []), []);
  });

  it('substitutes %i with the 1-based index', () => {
    assert.deepEqual(generateFilenames('shot_%i.png', [1, 2, 3]), [
      'shot_1.png',
      'shot_2.png',
      'shot_3.png',
    ]);
  });

  it('zero-pads %0..0i to (zeros+1) digits — three zeros means width-4', () => {
    assert.deepEqual(generateFilenames('shot_%000i.png', [1, 2, 3]), [
      'shot_0001.png',
      'shot_0002.png',
      'shot_0003.png',
    ]);
  });

  it('handles index overflow by emitting the raw number (no truncation)', () => {
    const names = generateFilenames(
      'shot_%00i.png',
      Array.from({ length: 12 }, (_, i) => i),
    );
    assert.equal(names[9], 'shot_010.png');
    assert.equal(names[11], 'shot_012.png');
  });

  it('does NOT recognise %03i as a padding token — only literal zeros count', () => {
    assert.deepEqual(generateFilenames('shot_%03i.png', [1, 2]), [
      'shot_%03i.png',
      'shot_%03i.png',
    ]);
  });

  it('substitutes %s with timemarkToSeconds of each timemark', () => {
    assert.deepEqual(generateFilenames('shot_%s.png', ['00:00:01', '00:00:02']), [
      'shot_1.png',
      'shot_2.png',
    ]);
  });

  it('substitutes both %s and %i in the same pattern', () => {
    assert.deepEqual(generateFilenames('%i_%s.png', ['00:00:05', 10]), ['1_5.png', '2_10.png']);
  });

  it('returns identical strings when no %s or %i token is present', () => {
    assert.deepEqual(generateFilenames('static.png', [1, 2, 3]), [
      'static.png',
      'static.png',
      'static.png',
    ]);
  });

  it('replaces every %i in the pattern (global flag)', () => {
    assert.deepEqual(generateFilenames('%i-%i.png', [1, 2]), ['1-1.png', '2-2.png']);
  });
});
