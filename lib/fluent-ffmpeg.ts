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

function applyDefaults(options: FfmpegCommandOptions): void {
  options.stdoutLines = 'stdoutLines' in options ? options.stdoutLines : DEFAULT_STDOUT_LINES;
  options.presets = options.presets ?? options.preset ?? path.join(__dirname, 'presets');
  options.niceness = options.niceness ?? options.priority ?? 0;
}

function FfmpegCommandImpl(
  this: FfmpegCommand,
  input?: FfmpegInput,
  options?: FfmpegCommandOptions,
): FfmpegCommand | undefined {
  if (!(this instanceof FfmpegCommand)) {
    return new (FfmpegCommand as new (i?: FfmpegInput, o?: FfmpegCommandOptions) => FfmpegCommand)(
      input,
      options,
    );
  }
  EventEmitter.call(this);

  let opts: FfmpegCommandOptions;
  if (isOptionsObject(input)) {
    opts = input;
  } else {
    opts = options ?? {};
    if (input !== undefined) opts.source = input as string | Readable;
  }

  this._inputs = [];
  if (opts.source) this.input(opts.source);

  this._outputs = [];
  this.output();

  this._global = utils.args();
  this._complexFilters = utils.args();

  applyDefaults(opts);
  this.options = opts;
  this.logger = opts.logger ?? NULL_LOGGER;
  return undefined;
}

const FfmpegCommand = FfmpegCommandImpl as unknown as FfmpegCommandStatic;

Object.setPrototypeOf(FfmpegCommand.prototype, EventEmitter.prototype);

const proto = FfmpegCommand.prototype as unknown as FfmpegCommandPrototype;
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

export = FfmpegCommand;
