import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');
const utils = require('../lib/utils.js');
const testhelper = require('./helpers.js');

interface FfmpegInstance {
  _getArguments(): unknown[];
  _currentOutput: { sizeFilters: { get(): unknown[] }; videoFilters: { get(): unknown[] } };
}

function tryGetArgs(cmd: FfmpegInstance): { args?: unknown[]; err?: Error } {
  try {
    return { args: cmd._getArguments() };
  } catch (e) {
    return { err: e as Error };
  }
}

function getSizeFilters(cmd: FfmpegInstance): string[] {
  const sizes = utils.makeFilterStrings(cmd._currentOutput.sizeFilters.get()) as string[];
  return sizes.concat(cmd._currentOutput.videoFilters.get() as string[]);
}

// These tests only exercise FfmpegCommand argument-list generation; they don't
// spawn ffmpeg or read the input file, so the legacy 'which ffmpeg' / fs.exists
// before-hook is gone. The testfile constants stay because the FfmpegCommand
// constructor records `source` as an opaque string.
const testfile = path.join(__dirname, 'assets', 'testvideo-43.avi');
const testfilewide = path.join(__dirname, 'assets', 'testvideo-169.avi');

describe('Command', () => {

  describe('Constructor', () => {
    it('should enable calling the constructor without new', () => {
      assert.ok(Ffmpeg() instanceof Ffmpeg);
    });
  });

  describe('usingPreset', () => {
    it('should properly generate the command for the requested preset', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger }).usingPreset(
        'podcast',
      );
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.equal(args!.length, 42);
    });

    it('should properly generate the command for the requested preset in custom folder', () => {
      const cmd = new Ffmpeg({
        source: testfile,
        nolog: true,
        preset: path.join(__dirname, 'assets', 'presets'),
      }).usingPreset('custompreset');
      const { args } = tryGetArgs(cmd);
      assert.equal(args!.length, 42);
    });

    it('should allow using functions as presets', () => {
      let presetArg: unknown;
      function presetFunc(command: {
        withVideoCodec: (c: string) => unknown;
        withAudioFrequency: (n: number) => unknown;
      }) {
        presetArg = command;
        command.withVideoCodec('libx264');
        command.withAudioFrequency(22050);
      }
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger });
      cmd.usingPreset(presetFunc);
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.equal(presetArg, cmd);
      assert.notEqual(args!.join(' ').indexOf('-vcodec libx264'), -1);
      assert.notEqual(args!.join(' ').indexOf('-ar 22050'), -1);
    });

    it('should throw an exception when a preset is not found', () => {
      assert.throws(() => {
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).usingPreset('NOTFOUND');
      }, /NOTFOUND could not be loaded/);
    });

    it('should throw an exception when a preset has no load function', () => {
      assert.throws(() => {
        new Ffmpeg({ presets: '../../lib' }).usingPreset('utils');
      }, /has no load\(\) function/);
    });
  });

  describe('withNoVideo', () => {
    it('should apply the skip video argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withNoVideo(),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-vn') > -1);
    });

    it('should skip any video transformation options', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger })
        .withSize('320x?')
        .withNoVideo()
        .withAudioBitrate('256k');
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-vn') > -1);
      assert.equal(args!.indexOf('-s'), -1);
      assert.ok(args!.indexOf('-b:a') > -1);
    });
  });

  describe('withNoAudio', () => {
    it('should apply the skip audio argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withNoAudio(),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-an') > -1);
    });

    it('should skip any audio transformation options', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger })
        .withAudioChannels(2)
        .withNoAudio()
        .withSize('320x?');
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-an') > -1);
      assert.equal(args!.indexOf('-ac'), -1);
      assert.ok(args!.indexOf('scale=w=320:h=trunc(ow/a/2)*2') > -1);
    });
  });

  describe('withVideoBitrate', () => {
    it('should apply default bitrate argument by default', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withVideoBitrate('256k'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-b:v') > -1);
    });

    it('should apply additional bitrate arguments for constant bitrate', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withVideoBitrate('256k', true),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-b:v') > -1);
      assert.ok(args!.indexOf('-maxrate') > -1);
      assert.ok(args!.indexOf('-minrate') > -1);
      assert.ok(args!.indexOf('-bufsize') > -1);
    });
  });

  describe('withMultiFile', () => {
    it('should allow image2 multi-file input format', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: 'image-%05d.png', logger: testhelper.logger }),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-i') > -1);
      assert.ok(args!.indexOf('image-%05d.png') > -1);
    });
  });

  describe('withFps', () => {
    it('should apply the rate argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withFps(27.77),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-r') > -1);
      assert.ok(args!.indexOf(27.77) > -1);
    });
  });

  describe('withInputFPS', () => {
    it('should apply the rate argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withInputFPS(27.77),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      const i = args!.indexOf('-i');
      const r = args!.indexOf('-r');
      const v = args!.indexOf(27.77);
      assert.ok(r > -1 && r < i);
      assert.ok(v > -1 && v < i);
    });
  });

  describe('native', () => {
    it('should apply the native framerate argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).native(),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      const i = args!.indexOf('-i');
      const re = args!.indexOf('-re');
      assert.ok(re > -1 && re < i);
    });
  });

  describe('addingAdditionalInput', () => {
    it('should allow for additional inputs', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).addInput('soundtrack.mp3'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-i') > -1);
      assert.ok(args!.indexOf('soundtrack.mp3') > -1);
    });

    it('should fail to add invalid inputs', () => {
      assert.throws(() => {
        new Ffmpeg().addInput({});
      }, /Invalid input/);
    });

    it('should refuse to add more than 1 input stream', () => {
      const stream1 = fs.createReadStream(testfile);
      const stream2 = fs.createReadStream(testfilewide);
      const command = new Ffmpeg().addInput(stream1);
      assert.throws(() => {
        command.addInput(stream2);
      }, /Only one input stream is supported/);
      stream1.destroy();
      stream2.destroy();
    });

    it('should fail on input-related options when no input was added', () => {
      assert.throws(() => new Ffmpeg().inputFormat('avi'), /No input specified/);
      assert.throws(() => new Ffmpeg().inputFps(24), /No input specified/);
      assert.throws(() => new Ffmpeg().seekInput(1), /No input specified/);
      assert.throws(() => new Ffmpeg().loop(), /No input specified/);
      assert.throws(() => new Ffmpeg().inputOptions('-anoption'), /No input specified/);
    });
  });

  describe('withVideoCodec', () => {
    it('should apply the video codec argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withVideoCodec('libx264'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-vcodec') > -1);
      assert.ok(args!.indexOf('libx264') > -1);
    });
  });

  describe('withVideoFilter', () => {
    it('should apply the video filter argument', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger })
        .withVideoFilter('scale=123:456')
        .withVideoFilter('pad=1230:4560:100:100:yellow')
        .withVideoFilter('multiple=1', 'filters=2');
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-filter:v') > -1);
      assert.ok(
        args!.indexOf('scale=123:456,pad=1230:4560:100:100:yellow,multiple=1,filters=2') > -1,
      );
    });

    it('should accept filter arrays', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withVideoFilter([
          'multiple=1',
          'filters=2',
        ]),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-filter:v') > -1);
      assert.ok(args!.indexOf('multiple=1,filters=2') > -1);
    });

    it('should enable using filter objects', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger }).withVideoFilter(
        { filter: 'option_string', options: 'opt1=value1:opt2=value2' },
        { filter: 'unnamed_options', options: ['opt1', 'opt2'] },
        { filter: 'named_options', options: { opt1: 'value1', opt2: 'value2' } },
      );
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-filter:v') > -1);
      assert.ok(
        args!.indexOf(
          'option_string=opt1=value1:opt2=value2,unnamed_options=opt1:opt2,named_options=opt1=value1:opt2=value2',
        ) > -1,
      );
    });
  });

  describe('withAudioBitrate', () => {
    it('should apply the audio bitrate argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAudioBitrate(256),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-b:a') > -1);
      assert.ok(args!.indexOf('256k') > -1);
    });
  });

  describe('loop', () => {
    it('should add the -loop 1 argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).loop(),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-loop') !== -1 || args!.indexOf('-loop_output') !== -1);
    });

    it('should add the -loop 1 and a time argument (seconds)', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).loop(120),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-loop') !== -1 || args!.indexOf('-loop_output') !== -1);
      assert.ok(args!.indexOf('-t') > -1);
      assert.ok(args!.indexOf(120) > -1);
    });

    it('should add the -loop 1 and a time argument (timemark)', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).loop('00:06:46.81'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-loop') !== -1 || args!.indexOf('-loop_output') !== -1);
      assert.ok(args!.indexOf('-t') > -1);
      assert.ok(args!.indexOf('00:06:46.81') > -1);
    });
  });

  describe('takeFrames', () => {
    it('should add the -vframes argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).takeFrames(250),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-vframes') > -1);
      assert.ok(args!.indexOf(250) > -1);
    });
  });

  describe('withAudioCodec', () => {
    it('should apply the audio codec argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAudioCodec('mp3'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-acodec') > -1);
      assert.ok(args!.indexOf('mp3') > -1);
    });
  });

  describe('withAudioFilter', () => {
    it('should apply the audio filter argument', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger })
        .withAudioFilter('silencedetect=n=-50dB:d=5')
        .withAudioFilter('volume=0.5')
        .withAudioFilter('multiple=1', 'filters=2');
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-filter:a') > -1);
      assert.ok(args!.indexOf('silencedetect=n=-50dB:d=5,volume=0.5,multiple=1,filters=2') > -1);
    });

    it('should accept filter arrays', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAudioFilter([
          'multiple=1',
          'filters=2',
        ]),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-filter:a') > -1);
      assert.ok(args!.indexOf('multiple=1,filters=2') > -1);
    });

    it('should enable using filter objects', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAudioFilter(
        { filter: 'option_string', options: 'opt1=value1:opt2=value2' },
        { filter: 'unnamed_options', options: ['opt1', 'opt2'] },
        { filter: 'named_options', options: { opt1: 'value1', opt2: 'value2' } },
      );
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-filter:a') > -1);
      assert.ok(
        args!.indexOf(
          'option_string=opt1=value1:opt2=value2,unnamed_options=opt1:opt2,named_options=opt1=value1:opt2=value2',
        ) > -1,
      );
    });
  });

  describe('withAudioChannels', () => {
    it('should apply the audio channels argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAudioChannels(1),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-ac') > -1);
      assert.ok(args!.indexOf(1) > -1);
    });
  });

  describe('withAudioFrequency', () => {
    it('should apply the audio frequency argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAudioFrequency(22500),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-ar') > -1);
      assert.ok(args!.indexOf(22500) > -1);
    });
  });

  describe('withAudioQuality', () => {
    it('should apply the audio quality argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAudioQuality(5),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-aq') > -1);
      assert.ok(args!.indexOf(5) > -1);
    });
  });

  describe('setStartTime', () => {
    it('should apply the start time offset argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).setStartTime('00:00:10'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      const i = args!.indexOf('-i');
      const ss = args!.indexOf('-ss');
      const ts = args!.indexOf('00:00:10');
      assert.ok(ss > -1 && ss < i);
      assert.ok(ts > ss && ts < i);
    });
  });

  describe('setDuration', () => {
    it('should apply the record duration argument', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).setDuration(10),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-t') > -1);
      assert.ok(args!.indexOf(10) > -1);
    });
  });

  describe('addOption(s)', () => {
    it('should apply a single option', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).addOption('-ab', '256k'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-ab') > -1);
      assert.ok(args!.indexOf('256k') > -1);
    });

    it('should apply supplied extra options', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger })
        .addOptions([
          '-flags',
          '+loop',
          '-cmp',
          '+chroma',
          '-partitions',
          '+parti4x4+partp8x8+partb8x8',
        ])
        .addOptions('-single option')
        .addOptions('-multiple', '-options');
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      [
        '-flags',
        '+loop',
        '-cmp',
        '+chroma',
        '-partitions',
        '+parti4x4+partp8x8+partb8x8',
        '-single',
        'option',
        '-multiple',
        '-options',
      ].forEach((tok) => {
        assert.ok(args!.indexOf(tok) > -1);
      });
    });

    it('should apply a single input option', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).addInputOption('-r', '29.97'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      const joined = (args as unknown[]).join(' ');
      const r = joined.indexOf('-r 29.97');
      const i = joined.indexOf('-i ');
      assert.ok(r > -1 && r < i);
    });

    it('should apply multiple input options', () => {
      const cmd = new Ffmpeg({ source: testfile, logger: testhelper.logger })
        .addInputOptions(['-r 29.97', '-f ogg'])
        .addInputOptions('-single option')
        .addInputOptions('-multiple', '-options');
      const { args, err } = tryGetArgs(cmd);
      testhelper.logArgError(err);
      assert.ok(!err);
      const joined = (args as unknown[]).join(' ');
      const i = joined.indexOf('-i');
      ['-r 29.97', '-f ogg', '-single option', '-multiple', '-options'].forEach((tok) => {
        const idx = joined.indexOf(tok);
        assert.ok(idx > -1 && idx < i);
      });
    });
  });

  describe('toFormat', () => {
    it('should apply the target format', () => {
      const { args, err } = tryGetArgs(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).toFormat('mp4'),
      );
      testhelper.logArgError(err);
      assert.ok(!err);
      assert.ok(args!.indexOf('-f') > -1);
      assert.ok(args!.indexOf('mp4') > -1);
    });
  });

  describe('Size calculations', () => {
    it('Should throw an error when an invalid aspect ratio is passed', () => {
      assert.throws(() => new Ffmpeg().aspect('blah'), /Invalid aspect ratio/);
    });

    it('Should add scale and setsar filters when keepPixelAspect was called', () => {
      const filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).keepPixelAspect(true),
      );
      assert.equal(filters.length, 2);
      assert.equal(filters[0], "scale=w='if(gt(sar,1),iw*sar,iw)':h='if(lt(sar,1),ih/sar,ih)'");
      assert.equal(filters[1], 'setsar=1');
    });

    it('Should throw an error when an invalid size was requested', () => {
      assert.throws(() => new Ffmpeg().withSize('aslkdbasd'), /Invalid size specified/);
    });

    it('Should not add scale filters when withSize was not called', () => {
      assert.equal(
        getSizeFilters(new Ffmpeg({ source: testfile, logger: testhelper.logger })).length,
        0,
      );
      assert.equal(
        getSizeFilters(
          new Ffmpeg({ source: testfile, logger: testhelper.logger }).withAspect(4 / 3),
        ).length,
        0,
      );
      assert.equal(
        getSizeFilters(
          new Ffmpeg({ source: testfile, logger: testhelper.logger }).applyAutopadding(
            true,
            'white',
          ),
        ).length,
        0,
      );
    });

    it('Should add proper scale filter when withSize was called with a percent value', () => {
      const cases = [
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withSize('42%'),
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('42%')
          .withAspect(4 / 3),
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('42%')
          .applyAutopadding(true, 'white'),
      ];
      for (const cmd of cases) {
        const filters = getSizeFilters(cmd);
        assert.equal(filters.length, 1);
        assert.equal(filters[0], 'scale=w=trunc(iw*0.42/2)*2:h=trunc(ih*0.42/2)*2');
      }
    });

    it('Should add proper scale filter when withSize was called with a fixed size', () => {
      let filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withSize('100x200'),
      );
      assert.equal(filters.length, 1);
      assert.equal(filters[0], 'scale=w=100:h=200');

      filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x200')
          .withAspect(4 / 3),
      );
      assert.equal(filters.length, 1);
      assert.equal(filters[0], 'scale=w=100:h=200');
    });

    it('Should add proper scale filter when withSize was called with a "?" and no aspect ratio is specified', () => {
      const expectations: Array<[() => unknown, string]> = [
        [
          () => new Ffmpeg({ source: testfile, logger: testhelper.logger }).withSize('100x?'),
          'scale=w=100:h=trunc(ow/a/2)*2',
        ],
        [
          () =>
            new Ffmpeg({ source: testfile, logger: testhelper.logger })
              .withSize('100x?')
              .applyAutopadding(true, 'white'),
          'scale=w=100:h=trunc(ow/a/2)*2',
        ],
        [
          () => new Ffmpeg({ source: testfile, logger: testhelper.logger }).withSize('?x200'),
          'scale=w=trunc(oh*a/2)*2:h=200',
        ],
        [
          () =>
            new Ffmpeg({ source: testfile, logger: testhelper.logger })
              .withSize('?x200')
              .applyAutopadding(true, 'white'),
          'scale=w=trunc(oh*a/2)*2:h=200',
        ],
      ];
      for (const [makeCmd, expected] of expectations) {
        const filters = getSizeFilters(makeCmd() as FfmpegInstance);
        assert.equal(filters.length, 1);
        assert.equal(filters[0], expected);
      }
    });

    it('Should add proper scale filter when withSize was called with a "?" and an aspect ratio is specified', () => {
      let filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x?')
          .withAspect(0.5),
      );
      assert.equal(filters.length, 1);
      assert.equal(filters[0], 'scale=w=100:h=200');

      filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withSize('?x100').withAspect(2),
      );
      assert.equal(filters.length, 1);
      assert.equal(filters[0], 'scale=w=200:h=100');
    });

    it('Should add scale and pad filters when withSize was called with a "?", aspect ratio and auto padding are specified', () => {
      let filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x?')
          .withAspect(0.5)
          .applyAutopadding(true, 'white'),
      );
      assert.equal(filters.length, 2);
      assert.equal(
        filters[0],
        "scale=w='if(gt(a,0.5),100,trunc(200*a/2)*2)':h='if(lt(a,0.5),200,trunc(100/a/2)*2)'",
      );
      assert.equal(
        filters[1],
        "pad=w=100:h=200:x='if(gt(a,0.5),0,(100-iw)/2)':y='if(lt(a,0.5),0,(200-ih)/2)':color=white",
      );

      filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('?x100')
          .withAspect(2)
          .applyAutopadding(true, 'white'),
      );
      assert.equal(filters.length, 2);
      assert.equal(
        filters[0],
        "scale=w='if(gt(a,2),200,trunc(100*a/2)*2)':h='if(lt(a,2),100,trunc(200/a/2)*2)'",
      );
      assert.equal(
        filters[1],
        "pad=w=200:h=100:x='if(gt(a,2),0,(200-iw)/2)':y='if(lt(a,2),0,(100-ih)/2)':color=white",
      );
    });

    it('Should add scale and pad filters when withSize was called with a fixed size and auto padding is specified', () => {
      const small1 = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x200')
          .applyAutopadding(true, 'white'),
      );
      assert.equal(small1.length, 2);
      assert.equal(
        small1[0],
        "scale=w='if(gt(a,0.5),100,trunc(200*a/2)*2)':h='if(lt(a,0.5),200,trunc(100/a/2)*2)'",
      );
      assert.equal(
        small1[1],
        "pad=w=100:h=200:x='if(gt(a,0.5),0,(100-iw)/2)':y='if(lt(a,0.5),0,(200-ih)/2)':color=white",
      );

      const small2 = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x200')
          .withAspect(4 / 3)
          .applyAutopadding(true, 'white'),
      );
      assert.equal(small2.length, 2);
      assert.equal(
        small2[0],
        "scale=w='if(gt(a,0.5),100,trunc(200*a/2)*2)':h='if(lt(a,0.5),200,trunc(100/a/2)*2)'",
      );
      assert.equal(
        small2[1],
        "pad=w=100:h=200:x='if(gt(a,0.5),0,(100-iw)/2)':y='if(lt(a,0.5),0,(200-ih)/2)':color=white",
      );

      const wide1 = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('200x100')
          .applyAutopadding(true, 'white'),
      );
      assert.equal(wide1.length, 2);
      assert.equal(
        wide1[0],
        "scale=w='if(gt(a,2),200,trunc(100*a/2)*2)':h='if(lt(a,2),100,trunc(200/a/2)*2)'",
      );
      assert.equal(
        wide1[1],
        "pad=w=200:h=100:x='if(gt(a,2),0,(200-iw)/2)':y='if(lt(a,2),0,(100-ih)/2)':color=white",
      );

      const wide2 = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('200x100')
          .withAspect(4 / 3)
          .applyAutopadding(true, 'white'),
      );
      assert.equal(wide2.length, 2);
      assert.equal(
        wide2[0],
        "scale=w='if(gt(a,2),200,trunc(100*a/2)*2)':h='if(lt(a,2),100,trunc(200/a/2)*2)'",
      );
      assert.equal(
        wide2[1],
        "pad=w=200:h=100:x='if(gt(a,2),0,(200-iw)/2)':y='if(lt(a,2),0,(100-ih)/2)':color=white",
      );
    });

    it('Should round sizes to multiples of 2', () => {
      const aspect = 102 / 202;

      let filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger }).withSize('101x201'),
      );
      assert.equal(filters.length, 1);
      assert.equal(filters[0], 'scale=w=102:h=202');

      filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('101x201')
          .applyAutopadding(true, 'white'),
      );
      assert.equal(filters.length, 2);
      assert.equal(
        filters[0],
        `scale=w='if(gt(a,${aspect}),102,trunc(202*a/2)*2)':h='if(lt(a,${aspect}),202,trunc(102/a/2)*2)'`,
      );
      assert.equal(
        filters[1],
        `pad=w=102:h=202:x='if(gt(a,${aspect}),0,(102-iw)/2)':y='if(lt(a,${aspect}),0,(202-ih)/2)':color=white`,
      );

      filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('101x?')
          .withAspect('1:2'),
      );
      assert.equal(filters.length, 1);
      assert.equal(filters[0], 'scale=w=102:h=202');

      filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('?x201')
          .withAspect('1:2'),
      );
      assert.equal(filters.length, 1);
      assert.equal(filters[0], 'scale=w=102:h=202');
    });

    it('Should apply autopadding when no boolean argument was passed to applyAutopadding', () => {
      const filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x?')
          .withAspect(0.5)
          .applyAutopadding('white'),
      );
      assert.equal(filters.length, 2);
      assert.equal(
        filters[1],
        "pad=w=100:h=200:x='if(gt(a,0.5),0,(100-iw)/2)':y='if(lt(a,0.5),0,(200-ih)/2)':color=white",
      );
    });

    it('Should default to black padding', () => {
      let filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x?')
          .withAspect(0.5)
          .applyAutopadding(),
      );
      assert.equal(filters.length, 2);
      assert.equal(
        filters[1],
        "pad=w=100:h=200:x='if(gt(a,0.5),0,(100-iw)/2)':y='if(lt(a,0.5),0,(200-ih)/2)':color=black",
      );

      filters = getSizeFilters(
        new Ffmpeg({ source: testfile, logger: testhelper.logger })
          .withSize('100x?')
          .withAspect(0.5)
          .applyAutopadding(true),
      );
      assert.equal(filters.length, 2);
      assert.equal(
        filters[1],
        "pad=w=100:h=200:x='if(gt(a,0.5),0,(100-iw)/2)':y='if(lt(a,0.5),0,(200-ih)/2)':color=black",
      );
    });
  });

  describe('complexFilter', () => {
    it('should generate a complex filter from a single filter', () => {
      const filters = (
        new Ffmpeg().complexFilter('filterstring') as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 2);
      assert.equal(filters[0], '-filter_complex');
      assert.equal(filters[1], 'filterstring');
    });

    it('should generate a complex filter from a filter array', () => {
      const filters = (
        new Ffmpeg().complexFilter(['filter1', 'filter2']) as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 2);
      assert.equal(filters[1], 'filter1;filter2');
    });

    it('should support filter objects', () => {
      const filters = (
        new Ffmpeg().complexFilter(['filter1', { filter: 'filter2' }]) as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 2);
      assert.equal(filters[1], 'filter1;filter2');
    });

    it('should support filter options', () => {
      const filters = (
        new Ffmpeg().complexFilter([
          { filter: 'filter1', options: 'optionstring' },
          { filter: 'filter2', options: ['opt1', 'opt2', 'opt3'] },
          { filter: 'filter3', options: { opt1: 'value1', opt2: 'value2' } },
        ]) as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 2);
      assert.equal(
        filters[1],
        'filter1=optionstring;filter2=opt1:opt2:opt3;filter3=opt1=value1:opt2=value2',
      );
    });

    it('should escape filter options with ambiguous characters', () => {
      const filters = (
        new Ffmpeg().complexFilter([
          { filter: 'filter1', options: 'optionstring' },
          { filter: 'filter2', options: ['op,t1', 'op,t2', 'op,t3'] },
          { filter: 'filter3', options: { opt1: 'val,ue1', opt2: 'val,ue2' } },
        ]) as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 2);
      assert.equal(
        filters[1],
        "filter1=optionstring;filter2='op,t1':'op,t2':'op,t3';filter3=opt1='val,ue1':opt2='val,ue2'",
      );
    });

    it('should support filter input streams', () => {
      const filters = (
        new Ffmpeg().complexFilter([
          { filter: 'filter1', inputs: 'input' },
          { filter: 'filter2', inputs: '[input]' },
          { filter: 'filter3', inputs: ['[input1]', 'input2'] },
        ]) as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 2);
      assert.equal(filters[1], '[input]filter1;[input]filter2;[input1][input2]filter3');
    });

    it('should support filter output streams', () => {
      const filters = (
        new Ffmpeg().complexFilter([
          { filter: 'filter1', options: 'opt', outputs: 'output' },
          { filter: 'filter2', options: 'opt', outputs: '[output]' },
          { filter: 'filter3', options: 'opt', outputs: ['[output1]', 'output2'] },
        ]) as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 2);
      assert.equal(
        filters[1],
        'filter1=opt[output];filter2=opt[output];filter3=opt[output1][output2]',
      );
    });

    it('should support an additional mapping argument', () => {
      let filters = (
        new Ffmpeg().complexFilter(['filter1', 'filter2'], 'output') as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 4);
      assert.equal(filters[2], '-map');
      assert.equal(filters[3], '[output]');

      filters = (
        new Ffmpeg().complexFilter(['filter1', 'filter2'], '[output]') as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 4);
      assert.equal(filters[2], '-map');
      assert.equal(filters[3], '[output]');

      filters = (
        new Ffmpeg().complexFilter(
          ['filter1', 'filter2'],
          ['[output1]', 'output2'],
        ) as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 6);
      assert.equal(filters[2], '-map');
      assert.equal(filters[3], '[output1]');
      assert.equal(filters[4], '-map');
      assert.equal(filters[5], '[output2]');
    });

    it('should override any previously set complex filtergraphs', () => {
      const filters = (
        new Ffmpeg()
          .complexFilter(['filter1a', 'filter1b'], 'output1')
          .complexFilter(['filter2a', 'filter2b'], 'output2') as FfmpegInstance
      )._getArguments();
      assert.equal(filters.length, 4);
      assert.equal(filters[1], 'filter2a;filter2b');
      assert.equal(filters[2], '-map');
      assert.equal(filters[3], '[output2]');
    });
  });

  describe('clone', () => {
    it('should return a new FfmpegCommand instance', () => {
      const command = new Ffmpeg({ source: testfile, logger: testhelper.logger });
      const clone = command.clone();
      assert.ok(clone instanceof Ffmpeg);
      assert.notEqual(clone, command);
    });

    it('should duplicate FfmpegCommand options at the time of the call', () => {
      const command = new Ffmpeg({ source: testfile, logger: testhelper.logger }).preset(
        'flashvideo',
      );
      const clone = command.clone();
      const original = tryGetArgs(command).args!;
      const cloneArgs = tryGetArgs(clone).args!;
      assert.equal(cloneArgs.length, original.length);
      original.forEach((arg, idx) => assert.equal(cloneArgs[idx], arg));
    });

    it('should have separate argument lists', () => {
      const command = new Ffmpeg({ source: testfile, logger: testhelper.logger }).preset(
        'flashvideo',
      );
      const clone = command.clone().audioFrequency(22050);
      const original = tryGetArgs(command).args!;
      const cloneArgs = tryGetArgs(clone).args!;
      assert.equal(cloneArgs.length, original.length + 2);
    });
  });
});
