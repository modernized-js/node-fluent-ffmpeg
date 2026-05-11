import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

import type { CodecInfo, EncoderInfo, FilterInfo, FormatInfo } from '../lib/types.js';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');
const testhelper = require('./helpers.js');

const PATH_DELIMITER = path.delimiter;

const ffmpegInPath = testhelper.isCommandInPath('ffmpeg');
const ffprobeInPath = testhelper.isCommandInPath('ffprobe');
const flvtoolInPath =
  process.env.FLVTOOL2_PRESENT !== 'no' &&
  (testhelper.isCommandInPath('flvmeta') || testhelper.isCommandInPath('flvtool2'));

const ffmpegIt = ffmpegInPath ? it : it.skip;
const ffprobeIt = ffprobeInPath ? it : it.skip;
const flvtoolIt = flvtoolInPath ? it : it.skip;

const { ALT_FFMPEG_PATH, ALT_FFPROBE_PATH, ALT_FLVTOOL_PATH } = process.env;

const altFfmpegIt = ffmpegInPath && ALT_FFMPEG_PATH ? it : it.skip;
const altFfprobeIt = ffprobeInPath && ALT_FFPROBE_PATH ? it : it.skip;
const altFlvtoolIt = flvtoolInPath && ALT_FLVTOOL_PATH ? it : it.skip;

type Callback<T> = (err: Error | null, value?: T) => void;

function fromCallback<T>(invoke: (cb: Callback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((err, value) => {
      testhelper.logError(err);
      if (err || value === undefined) reject(err);
      else resolve(value);
    });
  });
}

describe('Capabilities', () => {
  describe('ffmpeg capabilities', () => {
    ffmpegIt('should enable querying for available codecs', async () => {
      const codecs = await fromCallback<Record<string, CodecInfo>>((cb) =>
        new Ffmpeg({ source: '' }).getAvailableCodecs(cb),
      );
      assert.equal(typeof codecs, 'object');
      assert.notEqual(Object.keys(codecs).length, 0);
      assert.ok('pcm_s16le' in codecs);
      assert.ok('type' in codecs.pcm_s16le);
      assert.equal(typeof codecs.pcm_s16le.type, 'string');
      assert.ok('description' in codecs.pcm_s16le);
      assert.equal(typeof codecs.pcm_s16le.description, 'string');
      assert.ok('canEncode' in codecs.pcm_s16le);
      assert.equal(typeof codecs.pcm_s16le.canEncode, 'boolean');
      assert.ok('canDecode' in codecs.pcm_s16le);
      assert.equal(typeof codecs.pcm_s16le.canDecode, 'boolean');
    });

    ffmpegIt('should enable querying for available encoders', async () => {
      const encoders = await fromCallback<Record<string, EncoderInfo>>((cb) =>
        new Ffmpeg({ source: '' }).getAvailableEncoders(cb),
      );
      assert.equal(typeof encoders, 'object');
      assert.notEqual(Object.keys(encoders).length, 0);
      assert.ok('pcm_s16le' in encoders);
      assert.ok('type' in encoders.pcm_s16le);
      assert.equal(typeof encoders.pcm_s16le.type, 'string');
      assert.ok('description' in encoders.pcm_s16le);
      assert.equal(typeof encoders.pcm_s16le.description, 'string');
      assert.ok('experimental' in encoders.pcm_s16le);
      assert.equal(typeof encoders.pcm_s16le.experimental, 'boolean');
    });

    ffmpegIt('should enable querying for available formats', async () => {
      const formats = await fromCallback<Record<string, FormatInfo>>((cb) =>
        new Ffmpeg({ source: '' }).getAvailableFormats(cb),
      );
      assert.equal(typeof formats, 'object');
      assert.notEqual(Object.keys(formats).length, 0);
      assert.ok('wav' in formats);
      assert.ok('description' in formats.wav);
      assert.equal(typeof formats.wav.description, 'string');
      assert.ok('canMux' in formats.wav);
      assert.equal(typeof formats.wav.canMux, 'boolean');
      assert.ok('canDemux' in formats.wav);
      assert.equal(typeof formats.wav.canDemux, 'boolean');
    });

    ffmpegIt('should enable querying for available filters', async () => {
      const filters = await fromCallback<Record<string, FilterInfo>>((cb) =>
        new Ffmpeg({ source: '' }).getAvailableFilters(cb),
      );
      assert.equal(typeof filters, 'object');
      assert.notEqual(Object.keys(filters).length, 0);
      assert.ok('anull' in filters);
      assert.ok('description' in filters.anull);
      assert.equal(typeof filters.anull.description, 'string');
      assert.ok('input' in filters.anull);
      assert.equal(typeof filters.anull.input, 'string');
      assert.ok('output' in filters.anull);
      assert.equal(typeof filters.anull.output, 'string');
      assert.ok('multipleInputs' in filters.anull);
      assert.equal(typeof filters.anull.multipleInputs, 'boolean');
      assert.ok('multipleOutputs' in filters.anull);
      assert.equal(typeof filters.anull.multipleOutputs, 'boolean');
    });

    ffmpegIt('should enable querying capabilities without instanciating a command', async () => {
      const codecs = await fromCallback<Record<string, CodecInfo>>((cb) =>
        Ffmpeg.getAvailableCodecs(cb),
      );
      assert.equal(typeof codecs, 'object');
      assert.notEqual(Object.keys(codecs).length, 0);
      const filters = await fromCallback<Record<string, FilterInfo>>((cb) =>
        Ffmpeg.getAvailableFilters(cb),
      );
      assert.equal(typeof filters, 'object');
      assert.notEqual(Object.keys(filters).length, 0);
      const formats = await fromCallback<Record<string, FormatInfo>>((cb) =>
        Ffmpeg.getAvailableFormats(cb),
      );
      assert.equal(typeof formats, 'object');
      assert.notEqual(Object.keys(formats).length, 0);
    });

    function expectCheckCapabilitiesError(
      build: () => { _checkCapabilities: (cb: (err?: Error) => void) => void },
      pattern: RegExp,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        build()._checkCapabilities((err) => {
          try {
            assert.ok(err);
            assert.match(err!.message, pattern);
            resolve();
          } catch (e) {
            reject(testhelper.toError(e));
          }
        });
      });
    }

    ffmpegIt(
      'should enable checking command arguments for available codecs, formats and encoders',
      async () => {
        // Everything available
        await new Promise<void>((resolve, reject) => {
          new Ffmpeg('/path/to/file.avi')
            .fromFormat('avi')
            .audioCodec('pcm_u16le')
            .videoCodec('png')
            .toFormat('mp4')
            ._checkCapabilities((err: Error | undefined) => (err ? reject(err) : resolve()));
        });

        await expectCheckCapabilitiesError(
          () =>
            new Ffmpeg('/path/to/file.avi')
              .fromFormat('invalid-input-format')
              .audioCodec('pcm_u16le')
              .videoCodec('png')
              .toFormat('mp4'),
          /Input format invalid-input-format is not available/,
        );

        await expectCheckCapabilitiesError(
          () =>
            new Ffmpeg('/path/to/file.avi')
              .fromFormat('avi')
              .audioCodec('pcm_u16le')
              .videoCodec('png')
              .toFormat('invalid-output-format'),
          /Output format invalid-output-format is not available/,
        );

        await expectCheckCapabilitiesError(
          () =>
            new Ffmpeg('/path/to/file.avi')
              .fromFormat('avi')
              .audioCodec('invalid-audio-codec')
              .videoCodec('png')
              .toFormat('mp4'),
          /Audio codec invalid-audio-codec is not available/,
        );

        await expectCheckCapabilitiesError(
          () =>
            new Ffmpeg('/path/to/file.avi')
              .fromFormat('avi')
              .audioCodec('pcm_u16le')
              .videoCodec('invalid-video-codec')
              .toFormat('mp4'),
          /Video codec invalid-video-codec is not available/,
        );

        await expectCheckCapabilitiesError(
          () =>
            new Ffmpeg('/path/to/file.avi')
              .fromFormat('avi')
              .audioCodec('png')
              .videoCodec('png')
              .toFormat('mp4'),
          /Audio codec png is not available/,
        );

        await expectCheckCapabilitiesError(
          () =>
            new Ffmpeg('/path/to/file.avi')
              .fromFormat('avi')
              .audioCodec('pcm_u16le')
              .videoCodec('pcm_u16le')
              .toFormat('mp4'),
          /Video codec pcm_u16le is not available/,
        );
      },
    );

    ffmpegIt('should check capabilities before running a command', async () => {
      await new Promise<void>((resolve, reject) => {
        new Ffmpeg('/path/to/file.avi')
          .on('error', (err: Error) => {
            try {
              assert.match(err.message, /Output format invalid-output-format is not available/);
              resolve();
            } catch (e) {
              reject(testhelper.toError(e));
            }
          })
          .toFormat('invalid-output-format')
          // eslint-disable-next-line sonarjs/publicly-writable-directories -- negative-path: ffmpeg fails before any write
          .saveToFile('/tmp/will-not-be-created.mp4');
      });
    });
  });

  describe('ffmpeg path', () => {
    let savedFfmpegPath: string | undefined;

    beforeEach(() => {
      savedFfmpegPath = process.env.FFMPEG_PATH;
    });
    afterEach(() => {
      if (savedFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = savedFfmpegPath;
    });
    after(() => {
      new Ffmpeg()._forgetPaths();
    });

    it('should allow manual definition of ffmpeg binary path', async () => {
      const ff = new Ffmpeg();
      ff.setFfmpegPath('/doom/di/dom');
      const ffmpeg = await fromCallback<string>((cb) => ff._getFfmpegPath(cb));
      assert.equal(ffmpeg, '/doom/di/dom');
    });

    it('should allow static manual definition of ffmpeg binary path', async () => {
      const ff = new Ffmpeg();
      Ffmpeg.setFfmpegPath('/doom/di/dom2');
      const ffmpeg = await fromCallback<string>((cb) => ff._getFfmpegPath(cb));
      assert.equal(ffmpeg, '/doom/di/dom2');
    });

    ffmpegIt('should look for ffmpeg in the PATH if FFMPEG_PATH is not defined', async () => {
      const ff = new Ffmpeg();
      delete process.env.FFMPEG_PATH;
      ff._forgetPaths();
      const ffmpeg = await fromCallback<string>((cb) => ff._getFfmpegPath(cb));
      assert.ok(typeof ffmpeg === 'string' && ffmpeg.length > 0);
      const paths = process.env.PATH!.split(PATH_DELIMITER);
      assert.ok(paths.indexOf(path.dirname(ffmpeg)) > -1);
    });

    altFfmpegIt('should use FFMPEG_PATH if defined and valid', async () => {
      const ff = new Ffmpeg();
      process.env.FFMPEG_PATH = ALT_FFMPEG_PATH!;
      ff._forgetPaths();
      const ffmpeg = await fromCallback<string>((cb) => ff._getFfmpegPath(cb));
      assert.equal(ffmpeg, ALT_FFMPEG_PATH);
    });

    ffmpegIt('should fall back to searching in the PATH if FFMPEG_PATH is invalid', async () => {
      const ff = new Ffmpeg();
      process.env.FFMPEG_PATH = '/nope/not-here/nothing-to-see-here';
      ff._forgetPaths();
      const ffmpeg = await fromCallback<string>((cb) => ff._getFfmpegPath(cb));
      assert.ok(typeof ffmpeg === 'string' && ffmpeg.length > 0);
      const paths = process.env.PATH!.split(PATH_DELIMITER);
      assert.ok(paths.indexOf(path.dirname(ffmpeg)) > -1);
    });

    ffmpegIt('should remember ffmpeg path', async () => {
      const ff = new Ffmpeg();
      delete process.env.FFMPEG_PATH;
      ff._forgetPaths();
      const ffmpeg1 = await fromCallback<string>((cb) => ff._getFfmpegPath(cb));
      assert.ok(typeof ffmpeg1 === 'string' && ffmpeg1.length > 0);

      // Second call should be synchronous (cached). Confirm by tracking the
      // sequence of post-call state mutations.
      let postCallSync = 0;
      let observedDuringCallback = -1;
      ff._getFfmpegPath((err: Error | null, ffmpeg2?: string) => {
        observedDuringCallback = postCallSync;
        assert.ok(!err);
        assert.ok(typeof ffmpeg2 === 'string' && ffmpeg2.length > 0);
      });
      postCallSync = 1;
      assert.equal(observedDuringCallback, 0);
    });
  });

  describe('ffprobe path', () => {
    let savedFfprobePath: string | undefined;

    beforeEach(() => {
      savedFfprobePath = process.env.FFPROBE_PATH;
    });
    afterEach(() => {
      if (savedFfprobePath === undefined) delete process.env.FFPROBE_PATH;
      else process.env.FFPROBE_PATH = savedFfprobePath;
    });
    after(() => {
      new Ffmpeg()._forgetPaths();
    });

    it('should allow manual definition of ffprobe binary path', async () => {
      const ff = new Ffmpeg();
      ff.setFfprobePath('/doom/di/dom');
      const ffprobe = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.equal(ffprobe, '/doom/di/dom');
    });

    it('should allow static manual definition of ffprobe binary path', async () => {
      const ff = new Ffmpeg();
      Ffmpeg.setFfprobePath('/doom/di/dom2');
      const ffprobe = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.equal(ffprobe, '/doom/di/dom2');
    });

    ffprobeIt('should look for ffprobe in the PATH if FFPROBE_PATH is not defined', async () => {
      const ff = new Ffmpeg();
      delete process.env.FFPROBE_PATH;
      ff._forgetPaths();
      const ffprobe = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.ok(typeof ffprobe === 'string' && ffprobe.length > 0);
      const paths = process.env.PATH!.split(PATH_DELIMITER);
      assert.ok(paths.indexOf(path.dirname(ffprobe)) > -1);
    });

    altFfprobeIt('should use FFPROBE_PATH if defined and valid', async () => {
      const ff = new Ffmpeg();
      process.env.FFPROBE_PATH = ALT_FFPROBE_PATH!;
      ff._forgetPaths();
      const ffprobe = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.equal(ffprobe, ALT_FFPROBE_PATH);
    });

    ffprobeIt('should fall back to searching in the PATH if FFPROBE_PATH is invalid', async () => {
      const ff = new Ffmpeg();
      process.env.FFPROBE_PATH = '/nope/not-here/nothing-to-see-here';
      ff._forgetPaths();
      const ffprobe = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.ok(typeof ffprobe === 'string' && ffprobe.length > 0);
      const paths = process.env.PATH!.split(PATH_DELIMITER);
      assert.ok(paths.indexOf(path.dirname(ffprobe)) > -1);
    });

    ffprobeIt('should remember ffprobe path', async () => {
      const ff = new Ffmpeg();
      delete process.env.FFPROBE_PATH;
      ff._forgetPaths();
      const ffprobe1 = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.ok(typeof ffprobe1 === 'string' && ffprobe1.length > 0);

      let postCallSync = 0;
      let observedDuringCallback = -1;
      ff._getFfprobePath((err: Error | null, ffprobe2?: string) => {
        observedDuringCallback = postCallSync;
        assert.ok(!err);
        assert.ok(typeof ffprobe2 === 'string' && ffprobe2.length > 0);
      });
      postCallSync = 1;
      assert.equal(observedDuringCallback, 0);
    });

    // Regression: an explicit setFfprobePath() must survive a later
    // setFfmpegPath() — the user declared the ffprobe location and a
    // sibling-derivation refresh would surprise them.
    it('keeps an explicit ffprobe path after setFfmpegPath swaps the ffmpeg path', async () => {
      const ff = new Ffmpeg();
      ff._forgetPaths();
      ff.setFfprobePath('/explicit/probe/ffprobe');
      ff.setFfmpegPath('/somewhere/else/ffmpeg');
      const ffprobe = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.equal(ffprobe, '/explicit/probe/ffprobe');
    });

    // Regression: an auto-derived ffprobe path (sibling-of-ffmpeg or
    // FFPROBE_PATH / PATH lookup) MUST be re-resolved after
    // setFfmpegPath; otherwise a stale path leaks across binary swaps.
    // We use process.execPath as a deterministic stand-in for the first
    // resolution (a real existing file the resolver will accept), then
    // change FFPROBE_PATH to an invalid path before swapping ffmpeg.
    // Without the fix, the second call returns the cached execPath.
    // With the fix, the cache is dropped and re-resolution falls
    // through to PATH lookup, returning a real ffprobe — never
    // process.execPath.
    ffprobeIt('re-resolves an auto-derived ffprobe path after setFfmpegPath', async () => {
      const ff = new Ffmpeg();
      ff._forgetPaths();
      process.env.FFPROBE_PATH = process.execPath;
      const probe1 = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.equal(probe1, process.execPath);
      process.env.FFPROBE_PATH = '/nonexistent/ffprobe-shim';
      ff.setFfmpegPath('/somewhere/that/has/no/sibling/ffmpeg');
      const probe2 = await fromCallback<string>((cb) => ff._getFfprobePath(cb));
      assert.notEqual(probe2, process.execPath);
      assert.ok(typeof probe2 === 'string' && probe2.length > 0);
    });
  });

  describe('flvtool path', () => {
    let savedFlvtool2Path: string | undefined;

    beforeEach(() => {
      savedFlvtool2Path = process.env.FLVTOOL2_PATH;
    });
    afterEach(() => {
      if (savedFlvtool2Path === undefined) delete process.env.FLVTOOL2_PATH;
      else process.env.FLVTOOL2_PATH = savedFlvtool2Path;
    });
    after(() => {
      new Ffmpeg()._forgetPaths();
    });

    flvtoolIt('should allow manual definition of fflvtool binary path', async () => {
      const ff = new Ffmpeg();
      ff.setFlvtoolPath('/doom/di/dom');
      const flvtool = await fromCallback<string>((cb) => ff._getFlvtoolPath(cb));
      assert.equal(flvtool, '/doom/di/dom');
    });

    flvtoolIt('should allow static manual definition of fflvtool binary path', async () => {
      const ff = new Ffmpeg();
      Ffmpeg.setFlvtoolPath('/doom/di/dom2');
      const flvtool = await fromCallback<string>((cb) => ff._getFlvtoolPath(cb));
      assert.equal(flvtool, '/doom/di/dom2');
    });

    flvtoolIt('should look for fflvtool in the PATH if FLVTOOL2_PATH is not defined', async () => {
      const ff = new Ffmpeg();
      delete process.env.FLVTOOL2_PATH;
      ff._forgetPaths();
      const flvtool = await fromCallback<string>((cb) => ff._getFlvtoolPath(cb));
      assert.ok(typeof flvtool === 'string' && flvtool.length > 0);
      const paths = process.env.PATH!.split(PATH_DELIMITER);
      assert.ok(paths.indexOf(path.dirname(flvtool)) > -1);
    });

    altFlvtoolIt('should use FLVTOOL2_PATH if defined and valid', async () => {
      const ff = new Ffmpeg();
      process.env.FLVTOOL2_PATH = ALT_FLVTOOL_PATH!;
      ff._forgetPaths();
      const flvtool = await fromCallback<string>((cb) => ff._getFlvtoolPath(cb));
      assert.equal(flvtool, ALT_FLVTOOL_PATH);
    });

    flvtoolIt('should fall back to searching in the PATH if FLVTOOL2_PATH is invalid', async () => {
      const ff = new Ffmpeg();
      process.env.FLVTOOL2_PATH = '/nope/not-here/nothing-to-see-here';
      ff._forgetPaths();
      const flvtool = await fromCallback<string>((cb) => ff._getFlvtoolPath(cb));
      assert.ok(typeof flvtool === 'string' && flvtool.length > 0);
      const paths = process.env.PATH!.split(PATH_DELIMITER);
      assert.ok(paths.indexOf(path.dirname(flvtool)) > -1);
    });

    flvtoolIt('should remember fflvtool path', async () => {
      const ff = new Ffmpeg();
      delete process.env.FLVTOOL2_PATH;
      ff._forgetPaths();
      const flvtool1 = await fromCallback<string>((cb) => ff._getFlvtoolPath(cb));
      assert.ok(typeof flvtool1 === 'string' && flvtool1.length > 0);

      let postCallSync = 0;
      let observedDuringCallback = -1;
      ff._getFlvtoolPath((err: Error | null, flvtool2?: string) => {
        observedDuringCallback = postCallSync;
        assert.ok(!err);
        assert.ok(typeof flvtool2 === 'string' && flvtool2.length > 0);
      });
      postCallSync = 1;
      assert.equal(observedDuringCallback, 0);
    });
  });
});
