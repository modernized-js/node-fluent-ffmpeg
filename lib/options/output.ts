import type { Writable } from 'node:stream';
import utils from '../utils.js';
import type { FfmpegCommandPrototype, FfmpegCommandThis, OutputState } from '../types.js';

function isWritable(value: unknown): value is Writable {
  return typeof value === 'object' && value !== null && 'writable' in value;
}

function makeOutputState(
  target?: string | Writable,
  isFile = false,
  pipeopts: Record<string, unknown> = {},
): OutputState {
  const state: OutputState = {
    isFile,
    pipeopts,
    audio: utils.args(),
    audioFilters: utils.args(),
    video: utils.args(),
    videoFilters: utils.args(),
    sizeFilters: utils.args(),
    options: utils.args(),
    flags: {},
  };
  if (target !== undefined) state.target = target;
  return state;
}

function classifyOutput(target: string | Writable): { isFile: boolean } {
  if (typeof target === 'string') {
    const protocol = target.match(/^([a-z]{2,}):/i);
    return { isFile: !protocol || protocol[0] === 'file' };
  }
  if (!isWritable(target) || !target.writable) {
    throw new Error('Invalid output');
  }
  return { isFile: false };
}

function applyOutputOptions(proto: FfmpegCommandPrototype): void {
  proto.addOutput = proto.output = function (
    this: FfmpegCommandThis,
    target?: string | Writable,
    pipeopts?: Record<string, unknown>,
  ) {
    if (!target && this._currentOutput !== undefined) {
      throw new Error('Invalid output');
    }

    const { isFile } = target ? classifyOutput(target) : { isFile: false };
    const current = this._currentOutput;

    if (target && current && !('target' in current)) {
      current.target = target;
      current.isFile = isFile;
      current.pipeopts = pipeopts ?? {};
      return this;
    }

    if (target && typeof target !== 'string') {
      const hasOutputStream = this._outputs.some(
        (output) => output.target !== undefined && typeof output.target !== 'string',
      );
      if (hasOutputStream) {
        throw new Error('Only one output stream is supported');
      }
    }

    const newOutput = makeOutputState(target, isFile, pipeopts ?? {});
    this._currentOutput = newOutput;
    this._outputs.push(newOutput);
    return this;
  };

  proto.seekOutput = proto.seek = function (this: FfmpegCommandThis, seek: string | number) {
    this._currentOutput!.options('-ss', seek);
    return this;
  };

  proto.withDuration =
    proto.setDuration =
    proto.duration =
      function (this: FfmpegCommandThis, duration: string | number) {
        this._currentOutput!.options('-t', duration);
        return this;
      };

  proto.toFormat =
    proto.withOutputFormat =
    proto.outputFormat =
    proto.format =
      function (this: FfmpegCommandThis, format: string) {
        this._currentOutput!.options('-f', format);
        return this;
      };

  proto.map = function (this: FfmpegCommandThis, spec: string) {
    this._currentOutput!.options('-map', spec.replace(utils.streamRegexp, '[$1]'));
    return this;
  };

  proto.updateFlvMetadata = proto.flvmeta = function (this: FfmpegCommandThis) {
    this._currentOutput!.flags.flvmeta = true;
    return this;
  };
}

export = applyOutputOptions;
