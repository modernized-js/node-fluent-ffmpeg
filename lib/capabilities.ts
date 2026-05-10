import { access } from 'node:fs/promises';
import path from 'node:path';
import utils from './utils.js';
import type {
  CodecInfo,
  EncoderInfo,
  FfmpegCommandPrototype,
  FfmpegCommandThis,
  FilterInfo,
  FormatInfo,
  PathCallback,
} from './types.js';

const avCodecRegexp = /^\s*([D ])([E ])([VAS])([S ])([D ])([T ]) ([^ ]+) +(.*)$/;
const ffCodecRegexp = /^\s*([D.])([E.])([VAS])([I.])([L.])([S.]) ([^ ]+) +(.*)$/;
const ffEncodersRegexp = /\(encoders:([^)]+)\)/;
const ffDecodersRegexp = /\(decoders:([^)]+)\)/;
const encodersRegexp = /^\s*([VAS.])([F.])([S.])([X.])([B.])([D.]) ([^ ]+) +(.*)$/;
// The 3rd flag column [d ] is for device demuxers/muxers (e.g. `D d lavfi`)
// — ffmpeg emits a 3-column flag area for those. Optional `[d ]?` consumes it.
const formatRegexp = /^\s*([D ])([E ])[d ]?\s+([^ ]+)\s+(.*)$/;
const lineBreakRegexp = /\r\n|\r|\n/;
const filterRegexp = /^(?: [T.][S.][C.] )?([^ ]+) +(AA?|VV?|\|)->(AA?|VV?|\|) +(.*)$/;

const codecTypeByLetter: Record<string, 'video' | 'audio' | 'subtitle'> = {
  V: 'video',
  A: 'audio',
  S: 'subtitle',
};

const filterTypeByLetter: Record<string, 'audio' | 'video' | 'none'> = {
  A: 'audio',
  V: 'video',
  '|': 'none',
};

interface PathCache {
  ffmpegPath?: string;
  ffprobePath?: string;
  // True only when ffprobePath came from an explicit setFfprobePath()
  // call. Lets setFfmpegPath() invalidate an auto-derived sibling
  // resolution while leaving a caller-declared path intact.
  ffprobePathExplicit?: true;
  flvtoolPath?: string;
  filters?: Record<string, FilterInfo>;
  codecs?: Record<string, CodecInfo>;
  encoders?: Record<string, EncoderInfo>;
  formats?: Record<string, FormatInfo>;
}

const cache: PathCache = {};

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function whichAsync(name: string): Promise<string> {
  return new Promise((resolve) => {
    utils.which(name, (_err, found) => resolve(found ?? ''));
  });
}

async function resolveFromEnv(envVar: string): Promise<string> {
  const fromEnv = process.env[envVar];
  if (!fromEnv) return '';
  return (await fileExists(fromEnv)) ? fromEnv : '';
}

async function resolveFfmpegPath(): Promise<string> {
  const fromEnv = await resolveFromEnv('FFMPEG_PATH');
  if (fromEnv) return fromEnv;
  return whichAsync('ffmpeg');
}

async function resolveFfprobePath(siblingFfmpeg: string): Promise<string> {
  const fromEnv = await resolveFromEnv('FFPROBE_PATH');
  if (fromEnv) return fromEnv;
  const fromPath = await whichAsync('ffprobe');
  if (fromPath) return fromPath;
  if (!siblingFfmpeg) return '';
  const sibling = path.join(
    path.dirname(siblingFfmpeg),
    utils.isWindows ? 'ffprobe.exe' : 'ffprobe',
  );
  return (await fileExists(sibling)) ? sibling : '';
}

async function resolveFlvtoolPath(): Promise<string> {
  const flvmetaEnv = await resolveFromEnv('FLVMETA_PATH');
  if (flvmetaEnv) return flvmetaEnv;
  const flvtoolEnv = await resolveFromEnv('FLVTOOL2_PATH');
  if (flvtoolEnv) return flvtoolEnv;
  const flvmeta = await whichAsync('flvmeta');
  if (flvmeta) return flvmeta;
  return whichAsync('flvtool2');
}

function callbackify<T>(
  promise: Promise<T>,
  callback: (err: Error | null, value?: T) => void,
): void {
  promise.then(
    (value) => callback(null, value),
    (err: unknown) => callback(err instanceof Error ? err : new Error(String(err))),
  );
}

function parseCodecAvLine(line: string, data: Record<string, CodecInfo>): void {
  const match = line.match(avCodecRegexp);
  if (!match || match[7] === '=') return;
  data[match[7]] = {
    type: codecTypeByLetter[match[3]],
    description: match[8],
    canDecode: match[1] === 'D',
    canEncode: match[2] === 'E',
    drawHorizBand: match[4] === 'S',
    directRendering: match[5] === 'D',
    weirdFrameTruncation: match[6] === 'T',
  };
}

function expandCoders(
  codecData: CodecInfo,
  encoders: string[],
  decoders: string[],
  data: Record<string, CodecInfo>,
): void {
  if (encoders.length === 0 && decoders.length === 0) return;
  const coderTemplate: CodecInfo = {
    type: codecData.type,
    description: codecData.description,
    canDecode: false,
    canEncode: false,
    intraFrameOnly: codecData.intraFrameOnly,
    isLossy: codecData.isLossy,
    isLossless: codecData.isLossless,
  };
  encoders.forEach((name) => {
    data[name] = { ...coderTemplate, canEncode: true };
  });
  decoders.forEach((name) => {
    if (name in data) {
      data[name].canDecode = true;
    } else {
      data[name] = { ...coderTemplate, canDecode: true };
    }
  });
}

function parseCodecFfLine(line: string, data: Record<string, CodecInfo>): void {
  const match = line.match(ffCodecRegexp);
  if (!match || match[7] === '=') return;
  const codecData: CodecInfo = {
    type: codecTypeByLetter[match[3]],
    description: match[8],
    canDecode: match[1] === 'D',
    canEncode: match[2] === 'E',
    intraFrameOnly: match[4] === 'I',
    isLossy: match[5] === 'L',
    isLossless: match[6] === 'S',
  };
  data[match[7]] = codecData;

  const encMatch = codecData.description.match(ffEncodersRegexp);
  const decMatch = codecData.description.match(ffDecodersRegexp);
  const encoders = encMatch ? encMatch[1].trim().split(' ') : [];
  const decoders = decMatch ? decMatch[1].trim().split(' ') : [];
  expandCoders(codecData, encoders, decoders, data);
}

function parseFiltersOutput(stdout: string): Record<string, FilterInfo> {
  const data: Record<string, FilterInfo> = {};
  stdout.split('\n').forEach((line) => {
    const match = line.match(filterRegexp);
    if (!match) return;
    data[match[1]] = {
      description: match[4],
      input: filterTypeByLetter[match[2].charAt(0)],
      multipleInputs: match[2].length > 1,
      output: filterTypeByLetter[match[3].charAt(0)],
      multipleOutputs: match[3].length > 1,
    };
  });
  return data;
}

function parseCodecsOutput(stdout: string): Record<string, CodecInfo> {
  const data: Record<string, CodecInfo> = {};
  stdout.split(lineBreakRegexp).forEach((line) => {
    parseCodecAvLine(line, data);
    parseCodecFfLine(line, data);
  });
  return data;
}

function parseEncodersOutput(stdout: string): Record<string, EncoderInfo> {
  const data: Record<string, EncoderInfo> = {};
  stdout.split(lineBreakRegexp).forEach((line) => {
    const match = line.match(encodersRegexp);
    if (!match || match[7] === '=') return;
    data[match[7]] = {
      type: codecTypeByLetter[match[1]],
      description: match[8],
      frameMT: match[2] === 'F',
      sliceMT: match[3] === 'S',
      experimental: match[4] === 'X',
      drawHorizBand: match[5] === 'B',
      directRendering: match[6] === 'D',
    };
  });
  return data;
}

export function parseFormatsOutput(stdout: string): Record<string, FormatInfo> {
  const data: Record<string, FormatInfo> = {};
  stdout.split(lineBreakRegexp).forEach((line) => {
    const match = line.match(formatRegexp);
    if (!match) return;
    match[3].split(',').forEach((format) => {
      if (!(format in data)) {
        data[format] = { description: match[4], canDemux: false, canMux: false };
      }
      if (match[1] === 'D') data[format].canDemux = true;
      if (match[2] === 'E') data[format].canMux = true;
    });
  });
  return data;
}

function findUnavailableFormats(
  containers: { options: { find: (arg: string, count?: number) => unknown[] | undefined } }[],
  formats: Record<string, FormatInfo>,
  predicate: (info: FormatInfo) => boolean,
): string[] {
  return containers.reduce<string[]>((acc, container) => {
    const found = container.options.find('-f', 1);
    if (!found) return acc;
    const head = found[0];
    if (typeof head !== 'string') return acc;
    if (!(head in formats) || !predicate(formats[head])) acc.push(head);
    return acc;
  }, []);
}

function findUnavailableCodecs(
  outputs: {
    audio: { find: (arg: string, count?: number) => unknown[] | undefined };
    video: { find: (arg: string, count?: number) => unknown[] | undefined };
  }[],
  encoders: Record<string, EncoderInfo>,
  kind: 'audio' | 'video',
  flag: string,
): string[] {
  return outputs.reduce<string[]>((acc, output) => {
    const list = kind === 'audio' ? output.audio : output.video;
    const found = list.find(flag, 1);
    if (!found) return acc;
    const head = found[0];
    if (typeof head !== 'string') return acc;
    if (head === 'copy') return acc;
    if (!(head in encoders) || encoders[head].type !== kind) acc.push(head);
    return acc;
  }, []);
}

function unavailableError(label: string, names: string[]): Error | null {
  if (names.length === 0) return null;
  const word = names.length === 1 ? `${label} ${names[0]} is` : `${label}s ${names.join(', ')} are`;
  return new Error(`${word} not available`);
}

function applyCapabilities(proto: FfmpegCommandPrototype): void {
  proto.setFfmpegPath = function (this: FfmpegCommandThis, ffmpegPath: string) {
    cache.ffmpegPath = ffmpegPath;
    // Swapping the binary makes any previously-cached capability table
    // (codecs / encoders / formats / filters) stale — drop them so the
    // next run re-probes the new binary. Use `undefined` rather than
    // `delete` so @typescript-eslint/no-dynamic-delete stays happy.
    cache.codecs = undefined;
    cache.encoders = undefined;
    cache.formats = undefined;
    cache.filters = undefined;
    // Auto-derived ffprobePath is sibling-of-ffmpeg (or env / PATH); a
    // new ffmpeg location invalidates that derivation. Leave an explicit
    // user-supplied ffprobe path alone — that's their declared intent.
    // Path cache uses `'X' in cache` presence checks, so we must `delete`
    // (the no-dynamic-delete rule is off for this file).
    if (!cache.ffprobePathExplicit) {
      delete cache.ffprobePath;
    }
    return this;
  };

  proto.setFfprobePath = function (this: FfmpegCommandThis, ffprobePath: string) {
    cache.ffprobePath = ffprobePath;
    cache.ffprobePathExplicit = true;
    // ffprobe doesn't own the codec / format tables (those come from
    // ffmpeg), but invalidating them on a probe-path swap is symmetrical
    // with setFfmpegPath and avoids surprises if the user runs only the
    // ffprobe sidecar against a mismatched build.
    cache.codecs = undefined;
    cache.formats = undefined;
    return this;
  };

  proto.setFlvtoolPath = function (this: FfmpegCommandThis, flvtool: string) {
    cache.flvtoolPath = flvtool;
    return this;
  };

  proto._forgetPaths = function () {
    delete cache.ffmpegPath;
    delete cache.ffprobePath;
    delete cache.ffprobePathExplicit;
    delete cache.flvtoolPath;
  };

  proto._getFfmpegPath = function (callback: PathCallback) {
    if ('ffmpegPath' in cache) {
      callback(null, cache.ffmpegPath);
      return;
    }
    callbackify(
      resolveFfmpegPath().then((p) => (cache.ffmpegPath = p ?? '')),
      callback,
    );
  };

  proto._getFfprobePath = function (this: FfmpegCommandThis, callback: PathCallback) {
    if ('ffprobePath' in cache) {
      callback(null, cache.ffprobePath);
      return;
    }
    const getFfmpeg = (): Promise<string> =>
      new Promise((resolve, reject) => {
        this._getFfmpegPath((err, p) => (err ? reject(err) : resolve(p ?? '')));
      });
    callbackify(
      (async () => {
        const ffmpegPath = await getFfmpeg();
        const resolved = await resolveFfprobePath(ffmpegPath);
        cache.ffprobePath = resolved;
        return resolved;
      })(),
      callback,
    );
  };

  proto._getFlvtoolPath = function (callback: PathCallback) {
    if ('flvtoolPath' in cache) {
      callback(null, cache.flvtoolPath);
      return;
    }
    callbackify(
      resolveFlvtoolPath().then((p) => (cache.flvtoolPath = p)),
      callback,
    );
  };

  proto.availableFilters = proto.getAvailableFilters = function (
    this: FfmpegCommandThis,
    callback: (err: Error | null, filters?: Record<string, FilterInfo>) => void,
  ) {
    if (cache.filters) {
      callback(null, cache.filters);
      return;
    }
    this._spawnFfmpeg(['-filters'], { captureStdout: true, stdoutLines: 0 }, (err, ring) => {
      if (err || !ring) {
        callback(err);
        return;
      }
      cache.filters = parseFiltersOutput(ring.get());
      callback(null, cache.filters);
    });
  };

  proto.availableCodecs = proto.getAvailableCodecs = function (
    this: FfmpegCommandThis,
    callback: (err: Error | null, codecs?: Record<string, CodecInfo>) => void,
  ) {
    if (cache.codecs) {
      callback(null, cache.codecs);
      return;
    }
    this._spawnFfmpeg(['-codecs'], { captureStdout: true, stdoutLines: 0 }, (err, ring) => {
      if (err || !ring) {
        callback(err);
        return;
      }
      cache.codecs = parseCodecsOutput(ring.get());
      callback(null, cache.codecs);
    });
  };

  proto.availableEncoders = proto.getAvailableEncoders = function (
    this: FfmpegCommandThis,
    callback: (err: Error | null, encoders?: Record<string, EncoderInfo>) => void,
  ) {
    if (cache.encoders) {
      callback(null, cache.encoders);
      return;
    }
    this._spawnFfmpeg(['-encoders'], { captureStdout: true, stdoutLines: 0 }, (err, ring) => {
      if (err || !ring) {
        callback(err);
        return;
      }
      cache.encoders = parseEncodersOutput(ring.get());
      callback(null, cache.encoders);
    });
  };

  proto.availableFormats = proto.getAvailableFormats = function (
    this: FfmpegCommandThis,
    callback: (err: Error | null, formats?: Record<string, FormatInfo>) => void,
  ) {
    if (cache.formats) {
      callback(null, cache.formats);
      return;
    }
    this._spawnFfmpeg(['-formats'], { captureStdout: true, stdoutLines: 0 }, (err, ring) => {
      if (err || !ring) {
        callback(err);
        return;
      }
      cache.formats = parseFormatsOutput(ring.get());
      callback(null, cache.formats);
    });
  };

  proto._checkCapabilities = function (
    this: FfmpegCommandThis,
    callback: (err?: Error | null) => void,
  ) {
    const getFormats = (): Promise<Record<string, FormatInfo>> =>
      new Promise((resolve, reject) => {
        this.availableFormats((err, formats) => (err || !formats ? reject(err) : resolve(formats)));
      });
    const getEncoders = (): Promise<Record<string, EncoderInfo>> =>
      new Promise((resolve, reject) => {
        this.availableEncoders((err, encoders) =>
          err || !encoders ? reject(err) : resolve(encoders),
        );
      });

    (async (): Promise<void> => {
      const formats = await getFormats();
      const badOutFmts = findUnavailableFormats(this._outputs, formats, (i) => i.canMux);
      const outErr = unavailableError('Output format', badOutFmts);
      if (outErr) throw outErr;
      const badInFmts = findUnavailableFormats(this._inputs, formats, (i) => i.canDemux);
      const inErr = unavailableError('Input format', badInFmts);
      if (inErr) throw inErr;

      const encoders = await getEncoders();
      const badAudio = findUnavailableCodecs(this._outputs, encoders, 'audio', '-acodec');
      const audioErr = unavailableError('Audio codec', badAudio);
      if (audioErr) throw audioErr;
      const badVideo = findUnavailableCodecs(this._outputs, encoders, 'video', '-vcodec');
      const videoErr = unavailableError('Video codec', badVideo);
      if (videoErr) throw videoErr;
    })().then(
      () => callback(),
      (err: unknown) => callback(err instanceof Error ? err : new Error(String(err))),
    );
  };
}

export default applyCapabilities;
