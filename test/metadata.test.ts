import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');
const testhelper = require('./helpers.js');

const ffprobeInPath = testhelper.isCommandInPath('ffprobe');
const ffprobeIt = ffprobeInPath ? it : it.skip;

const testfile = path.join(__dirname, 'assets', 'testvideo-43.avi');

interface FfprobeFormat {
  duration?: string | number;
  format_name?: string;
  filename?: string;
  [k: string]: unknown;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: string | number;
  bit_rate?: string;
  [k: string]: unknown;
}

interface FfprobeData {
  format: FfprobeFormat;
  streams: FfprobeStream[];
}

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

describe('Metadata', () => {
  it('should provide an ffprobe entry point', () => {
    assert.equal(typeof Ffmpeg.ffprobe, 'function');
  });

  ffprobeIt('should return ffprobe data as an object', async () => {
    const data = await fromCallback<FfprobeData>((cb) => Ffmpeg.ffprobe(testfile, cb));
    assert.equal(typeof data, 'object');
  });

  ffprobeIt('should provide ffprobe format information', async () => {
    const data = await fromCallback<FfprobeData>((cb) => Ffmpeg.ffprobe(testfile, cb));
    assert.ok('format' in data);
    assert.equal(typeof data.format, 'object');
    assert.equal(Number(data.format.duration), 2);
    assert.equal(data.format.format_name, 'avi');
  });

  ffprobeIt('should provide ffprobe stream information', async () => {
    const data = await fromCallback<FfprobeData>((cb) => Ffmpeg.ffprobe(testfile, cb));
    assert.ok('streams' in data);
    assert.ok(Array.isArray(data.streams));
    assert.equal(data.streams.length, 1);
    assert.equal(data.streams[0].codec_type, 'video');
    assert.equal(data.streams[0].codec_name, 'mpeg4');
    assert.equal(Number(data.streams[0].width), 1024);
  });

  ffprobeIt('should provide ffprobe stream information with units', async () => {
    const data = await fromCallback<FfprobeData>((cb) => Ffmpeg.ffprobe(testfile, ['-unit'], cb));
    assert.ok('streams' in data);
    assert.ok(Array.isArray(data.streams));
    assert.equal(data.streams.length, 1);
    assert.equal(data.streams[0].bit_rate, '322427 bit/s');
  });

  ffprobeIt('should return ffprobe errors', async () => {
    await new Promise<void>((resolve) => {
      Ffmpeg.ffprobe('/path/to/missing/file', (err: Error | null) => {
        assert.ok(err);
        resolve();
      });
    });
  });

  ffprobeIt('should enable calling ffprobe on a command with an input file', async () => {
    const data = await new Promise<FfprobeData>((resolve, reject) => {
      new Ffmpeg({ source: testfile }).ffprobe((err: Error | null, d?: FfprobeData) => {
        testhelper.logError(err);
        if (err || !d) {
          reject(err ?? new Error('no data'));
          return;
        }
        resolve(d);
      });
    });
    assert.equal(typeof data, 'object');
    assert.ok('format' in data);
    assert.equal(typeof data.format, 'object');
    assert.ok('streams' in data);
    assert.ok(Array.isArray(data.streams));
  });

  it('should fail calling ffprobe on a command without input', async () => {
    await new Promise<void>((resolve) => {
      new Ffmpeg().ffprobe((err: Error | null) => {
        assert.ok(err);
        assert.match(err!.message, /No input specified/);
        resolve();
      });
    });
  });

  ffprobeIt('should allow calling ffprobe on stream input', async () => {
    const stream = fs.createReadStream(testfile);
    const data = await new Promise<FfprobeData>((resolve, reject) => {
      new Ffmpeg().addInput(stream).ffprobe((err: Error | null, d?: FfprobeData) => {
        if (err || !d) {
          reject(err ?? new Error('no data'));
          return;
        }
        resolve(d);
      });
    });
    assert.equal(data.streams.length, 1);
    assert.equal(data.format.filename, 'pipe:0');
  });
});
