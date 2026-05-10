import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { Readable } from 'node:stream';

import utils from './utils.js';
import applyInputs from './options/inputs.js';
import applyAudio from './options/audio.js';
import applyVideo from './options/video.js';
import applyVideoSize from './options/videosize.js';
import applyOutput from './options/output.js';
import applyCustom from './options/custom.js';
import applyMisc from './options/misc.js';
import applyProcessor from './processor.js';
import applyCapabilities from './capabilities.js';
import applyFfprobe from './ffprobe.js';
import applyRecipes from './recipes.js';

import type {
  CodecInfo,
  EncoderInfo,
  FfmpegCommandOptions,
  FfmpegCommandPrototype,
  FfmpegCommandThis,
  FfprobeCallback,
  FilterInfo,
  FormatInfo,
  Logger,
  OutputState,
} from './types.js';

const DEFAULT_STDOUT_LINES = 100;

const NULL_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

type FfmpegInput = string | Readable | FfmpegCommandOptions | undefined;

interface FfmpegCommand extends FfmpegCommandThis {
  clone(): FfmpegCommand;
}

interface FfmpegCommandStatic {
  new (input?: FfmpegInput, options?: FfmpegCommandOptions): FfmpegCommand;
  (input?: FfmpegInput, options?: FfmpegCommandOptions): FfmpegCommand;
  prototype: FfmpegCommand;
  setFfmpegPath(p: string): void;
  setFfprobePath(p: string): void;
  setFlvtoolPath(p: string): void;
  availableFilters(
    callback: (err: Error | null, filters?: Record<string, FilterInfo>) => void,
  ): void;
  getAvailableFilters(
    callback: (err: Error | null, filters?: Record<string, FilterInfo>) => void,
  ): void;
  availableCodecs(callback: (err: Error | null, codecs?: Record<string, CodecInfo>) => void): void;
  getAvailableCodecs(
    callback: (err: Error | null, codecs?: Record<string, CodecInfo>) => void,
  ): void;
  availableFormats(
    callback: (err: Error | null, formats?: Record<string, FormatInfo>) => void,
  ): void;
  getAvailableFormats(
    callback: (err: Error | null, formats?: Record<string, FormatInfo>) => void,
  ): void;
  availableEncoders(
    callback: (err: Error | null, encoders?: Record<string, EncoderInfo>) => void,
  ): void;
  getAvailableEncoders(
    callback: (err: Error | null, encoders?: Record<string, EncoderInfo>) => void,
  ): void;
  ffprobe(file: string, callback: FfprobeCallback): void;
  ffprobe(file: string, options: string[], callback: FfprobeCallback): void;
  ffprobe(file: string, index: number, callback: FfprobeCallback): void;
  ffprobe(file: string, index: number, options: string[], callback: FfprobeCallback): void;
}

function isOptionsObject(value: unknown): value is FfmpegCommandOptions {
  return typeof value === 'object' && value !== null && !('readable' in value);
}

function resolveCommandOptions(
  input: FfmpegInput,
  options: FfmpegCommandOptions | undefined,
): FfmpegCommandOptions {
  if (isOptionsObject(input)) return input;
  // Match legacy: unconditional source assignment, including undefined,
  // so `new FfmpegCommand(undefined, { source: 'foo' })` clears `source`
  // exactly the way the legacy constructor did.
  const opts = options ?? {};
  opts.source = input;
  return opts;
}

/**
 * Resolve the bundled `presets/` directory path in a way that survives
 * both the regular CJS dist (where `__dirname` is defined) and the
 * ESM-bundler scenario (SvelteKit / Vite SSR / esbuild ESM mode) where
 * a downstream tool re-emits our compiled CJS as part of an ESM bundle
 * and `__dirname` is undefined. See issue #43 / upstream #1283.
 *
 * The `dirname` parameter exists for testability — production callers
 * pass the default (current `__dirname` if defined, else undefined).
 *
 * In the ESM-bundle branch we return the relative string `'presets'`
 * rather than trying to recover the absolute path from `import.meta`:
 * indirect-`eval` of an `import.meta` reference is parsed as Script and
 * always SyntaxErrors, so any such recovery is dead code in practice.
 * The relative-path fallback lets module load succeed; preset loading
 * will surface the existing 'preset … could not be loaded' error
 * instead of crashing the import with `ReferenceError`.
 */
export function resolveBundledPresetsDir(
  dirname: string | undefined = typeof __dirname !== 'undefined' ? __dirname : undefined,
): string {
  if (dirname) {
    return path.join(dirname, 'presets');
  }
  return 'presets';
}

function applyDefaults(options: FfmpegCommandOptions): void {
  options.stdoutLines = 'stdoutLines' in options ? options.stdoutLines : DEFAULT_STDOUT_LINES;
  // Legacy used `||` (falsy fallback). Keep that exactly so '' presets and
  // niceness:0 with a priority set still inherit the right value.
  options.presets = options.presets || options.preset || resolveBundledPresetsDir();
  options.niceness = options.niceness || options.priority || 0;
}

function FfmpegCommandImpl(
  this: FfmpegCommand,
  input?: FfmpegInput,
  options?: FfmpegCommandOptions,
): FfmpegCommand | undefined {
  // Three structural `as` casts remain in this file (here, line 134, line
  // 138). They wire a function `FfmpegCommandImpl` up to the
  // `FfmpegCommandStatic` shape (callable + `new`-able + static methods),
  // which TypeScript cannot express without converting the whole factory
  // to a class — a refactor that would also lose the legacy "callable
  // without new" semantic that consumers depend on.
  if (!(this instanceof FfmpegCommand)) {
    return new (FfmpegCommand as new (i?: FfmpegInput, o?: FfmpegCommandOptions) => FfmpegCommand)(
      input,
      options,
    );
  }
  EventEmitter.call(this);

  const opts = resolveCommandOptions(input, options);

  this._inputs = [];
  if (opts.source) this.input(opts.source);

  this._outputs = [];
  this.output();

  this._global = utils.args();
  this._complexFilters = utils.args();

  applyDefaults(opts);
  this.options = opts;
  // Legacy used `||`: any falsy logger (false / '' / 0 / null / undefined)
  // falls back to the no-op logger so internal .debug/.warn calls don't crash.
  this.logger = opts.logger || NULL_LOGGER;
  return undefined;
}

const FfmpegCommand = FfmpegCommandImpl as unknown as FfmpegCommandStatic;

Object.setPrototypeOf(FfmpegCommand.prototype, EventEmitter.prototype);

const proto: FfmpegCommandPrototype = FfmpegCommand.prototype;
applyInputs(proto);
applyAudio(proto);
applyVideo(proto);
applyVideoSize(proto);
applyOutput(proto);
applyCustom(proto);
applyMisc(proto);
applyProcessor(proto);
applyCapabilities(proto);
applyFfprobe(proto);
applyRecipes(proto);

function cloneFirstOutput(src: OutputState | undefined): OutputState | undefined {
  if (!src) return undefined;
  const dest: OutputState = {
    flags: { ...src.flags },
    audio: src.audio.clone(),
    audioFilters: src.audioFilters.clone(),
    video: src.video.clone(),
    videoFilters: src.videoFilters.clone(),
    sizeFilters: src.sizeFilters.clone(),
    options: src.options.clone(),
  };
  if (src.sizeData) dest.sizeData = { ...src.sizeData };
  return dest;
}

FfmpegCommand.prototype.clone = function (this: FfmpegCommand): FfmpegCommand {
  const c = new FfmpegCommand();
  c.options = this.options;
  c.logger = this.logger;

  c._inputs = this._inputs.map((input) => ({
    source: input.source,
    isFile: input.isFile,
    isStream: input.isStream,
    options: input.options.clone(),
  }));

  if (this._outputs[0] && 'target' in this._outputs[0]) {
    c._outputs = [];
    c.output();
  } else {
    const cloned = cloneFirstOutput(this._outputs[0])!;
    c._outputs = [cloned];
    c._currentOutput = cloned;
  }

  c._global = this._global.clone();
  c._complexFilters = this._complexFilters.clone();
  return c;
};

FfmpegCommand.setFfmpegPath = (p: string) => {
  new FfmpegCommand().setFfmpegPath(p);
};
FfmpegCommand.setFfprobePath = (p: string) => {
  new FfmpegCommand().setFfprobePath(p);
};
FfmpegCommand.setFlvtoolPath = (p: string) => {
  new FfmpegCommand().setFlvtoolPath(p);
};
FfmpegCommand.availableFilters = FfmpegCommand.getAvailableFilters = (cb) => {
  new FfmpegCommand().availableFilters(cb);
};
FfmpegCommand.availableCodecs = FfmpegCommand.getAvailableCodecs = (cb) => {
  new FfmpegCommand().availableCodecs(cb);
};
FfmpegCommand.availableFormats = FfmpegCommand.getAvailableFormats = (cb) => {
  new FfmpegCommand().availableFormats(cb);
};
FfmpegCommand.availableEncoders = FfmpegCommand.getAvailableEncoders = (cb) => {
  new FfmpegCommand().availableEncoders(cb);
};
FfmpegCommand.ffprobe = function (file: string, ...args: unknown[]): void {
  const inst = new FfmpegCommand(file);
  (inst.ffprobe as (...a: unknown[]) => void)(...args);
};

export default FfmpegCommand;
