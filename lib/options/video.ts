import utils from '../utils.js';
import type { FfmpegCommandPrototype, FfmpegCommandThis, FilterSpec } from '../types.js';

function applyVideoOptions(proto: FfmpegCommandPrototype): void {
  proto.withNoVideo = proto.noVideo = function (this: FfmpegCommandThis) {
    this._currentOutput!.video.clear();
    this._currentOutput!.videoFilters.clear();
    this._currentOutput!.video('-vn');
    return this;
  };

  proto.withVideoCodec = proto.videoCodec = function (this: FfmpegCommandThis, codec: string) {
    this._currentOutput!.video('-vcodec', codec);
    return this;
  };

  proto.withVideoBitrate = proto.videoBitrate = function (
    this: FfmpegCommandThis,
    bitrate: string | number,
    constant?: boolean,
  ) {
    const rate = String(bitrate).replace(/k?$/, 'k');
    this._currentOutput!.video('-b:v', rate);
    if (constant) {
      this._currentOutput!.video('-maxrate', rate, '-minrate', rate, '-bufsize', '3M');
    }
    return this;
  };

  proto.withVideoFilter =
    proto.withVideoFilters =
    proto.videoFilter =
    proto.videoFilters =
      function (
        this: FfmpegCommandThis,
        ...rest: (string | FilterSpec | (string | FilterSpec)[])[]
      ) {
        const flat: (string | FilterSpec)[] =
          rest.length > 1
            ? (rest as (string | FilterSpec)[])
            : Array.isArray(rest[0])
              ? rest[0]
              : [rest[0]];
        this._currentOutput!.videoFilters(utils.makeFilterStrings(flat));
        return this;
      };

  proto.withOutputFps =
    proto.withOutputFPS =
    proto.withFpsOutput =
    proto.withFPSOutput =
    proto.withFps =
    proto.withFPS =
    proto.outputFPS =
    proto.outputFps =
    proto.fpsOutput =
    proto.FPSOutput =
    proto.fps =
    proto.FPS =
      function (this: FfmpegCommandThis, fps: number) {
        this._currentOutput!.video('-r', fps);
        return this;
      };

  proto.takeFrames =
    proto.withFrames =
    proto.frames =
      function (this: FfmpegCommandThis, frames: number) {
        this._currentOutput!.video('-vframes', frames);
        return this;
      };
}

export = applyVideoOptions;
