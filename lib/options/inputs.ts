import type { Readable } from 'node:stream';
import utils from '../utils.js';
import type { FfmpegCommandPrototype, FfmpegCommandThis, InputState } from '../types.js';

function isReadable(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null && 'readable' in value;
}

function classifySource(source: string | Readable): { isFile: boolean; isStream: boolean } {
  if (typeof source === 'string') {
    const protocol = source.match(/^([a-z]{2,}):/i);
    return { isFile: !protocol || protocol[0] === 'file', isStream: false };
  }
  if (!isReadable(source) || !source.readable) {
    throw new Error('Invalid input');
  }
  return { isFile: false, isStream: true };
}

function applyInputsOptions(proto: FfmpegCommandPrototype): void {
  proto.mergeAdd =
    proto.addInput =
    proto.input =
      function (this: FfmpegCommandThis, source: string | Readable) {
        const { isFile, isStream } = classifySource(source);

        if (isStream) {
          const hasInputStream = this._inputs.some((input) => input.isStream);
          if (hasInputStream) {
            throw new Error('Only one input stream is supported');
          }
          // classifySource only sets isStream when source is a Readable;
          // re-narrowing via the type guard avoids `as Readable`.
          if (isReadable(source)) source.pause();
        }

        const newInput: InputState = {
          source,
          isFile,
          isStream,
          options: utils.args(),
        };
        this._currentInput = newInput;
        this._inputs.push(newInput);
        return this;
      };

  proto.withInputFormat =
    proto.inputFormat =
    proto.fromFormat =
      function (this: FfmpegCommandThis, format: string) {
        if (!this._currentInput) {
          throw new Error('No input specified');
        }
        this._currentInput.options('-f', format);
        return this;
      };

  proto.withInputFps =
    proto.withInputFPS =
    proto.withFpsInput =
    proto.withFPSInput =
    proto.inputFPS =
    proto.inputFps =
    proto.fpsInput =
    proto.FPSInput =
      function (this: FfmpegCommandThis, fps: number) {
        if (!this._currentInput) {
          throw new Error('No input specified');
        }
        this._currentInput.options('-r', fps);
        return this;
      };

  proto.nativeFramerate =
    proto.withNativeFramerate =
    proto.native =
      function (this: FfmpegCommandThis) {
        if (!this._currentInput) {
          throw new Error('No input specified');
        }
        this._currentInput.options('-re');
        return this;
      };

  proto.setStartTime = proto.seekInput = function (this: FfmpegCommandThis, seek: string | number) {
    if (!this._currentInput) {
      throw new Error('No input specified');
    }
    const value = typeof seek === 'number' ? utils.formatNumberForCall(seek) : seek;
    this._currentInput.options('-ss', value);
    return this;
  };

  // Mirror of setStartTime / seekInput for the duration `-t` flag —
  // applies to the *current input*, not the global output. Without this,
  // consumers cannot express the canonical ffmpeg pattern of
  // `-t N -ss S -i input1 -t N -ss S -i input2`. See issue #53.
  proto.setInputDuration = proto.durationInput = function (
    this: FfmpegCommandThis,
    duration: string | number,
  ) {
    if (!this._currentInput) {
      throw new Error('No input specified');
    }
    const value = typeof duration === 'number' ? utils.formatNumberForCall(duration) : duration;
    this._currentInput.options('-t', value);
    return this;
  };

  proto.loop = function (this: FfmpegCommandThis, duration?: string | number) {
    if (!this._currentInput) {
      throw new Error('No input specified');
    }
    this._currentInput.options('-loop', '1');
    if (duration !== undefined) {
      this.duration(duration);
    }
    return this;
  };
}

export = applyInputsOptions;
