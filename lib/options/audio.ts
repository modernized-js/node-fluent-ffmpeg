import utils from '../utils.js';
import type { FfmpegCommandPrototype, FfmpegCommandThis, FilterSpec } from '../types.js';

function applyAudioOptions(proto: FfmpegCommandPrototype): void {
  proto.withNoAudio = proto.noAudio = function (this: FfmpegCommandThis) {
    this._currentOutput!.audio.clear();
    this._currentOutput!.audioFilters.clear();
    this._currentOutput!.audio('-an');
    return this;
  };

  proto.withAudioCodec = proto.audioCodec = function (this: FfmpegCommandThis, codec: string) {
    this._currentOutput!.audio('-acodec', codec);
    return this;
  };

  proto.withAudioBitrate = proto.audioBitrate = function (
    this: FfmpegCommandThis,
    bitrate: string | number,
  ) {
    this._currentOutput!.audio('-b:a', String(bitrate).replace(/k?$/, 'k'));
    return this;
  };

  proto.withAudioChannels = proto.audioChannels = function (
    this: FfmpegCommandThis,
    channels: number,
  ) {
    this._currentOutput!.audio('-ac', channels);
    return this;
  };

  proto.withAudioFrequency = proto.audioFrequency = function (
    this: FfmpegCommandThis,
    freq: number,
  ) {
    this._currentOutput!.audio('-ar', freq);
    return this;
  };

  proto.withAudioQuality = proto.audioQuality = function (
    this: FfmpegCommandThis,
    quality: number,
  ) {
    this._currentOutput!.audio('-aq', quality);
    return this;
  };

  proto.withAudioFilter =
    proto.withAudioFilters =
    proto.audioFilter =
    proto.audioFilters =
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
        this._currentOutput!.audioFilters(utils.makeFilterStrings(flat));
        return this;
      };
}

export = applyAudioOptions;
