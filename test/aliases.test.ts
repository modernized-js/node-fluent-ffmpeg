import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const Ffmpeg = require('../index.js');

type AliasCategory = Record<string, string[]>;

const aliases: Record<string, AliasCategory> = {
  audio: {
    withNoAudio: ['noAudio'],
    withAudioCodec: ['audioCodec'],
    withAudioBitrate: ['audioBitrate'],
    withAudioChannels: ['audioChannels'],
    withAudioFrequency: ['audioFrequency'],
    withAudioQuality: ['audioQuality'],
    withAudioFilter: ['withAudioFilters', 'audioFilter', 'audioFilters'],
  },
  custom: {
    addInputOption: [
      'addInputOptions',
      'withInputOption',
      'withInputOptions',
      'inputOption',
      'inputOptions',
    ],
    addOutputOption: [
      'addOutputOptions',
      'addOption',
      'addOptions',
      'withOutputOption',
      'withOutputOptions',
      'withOption',
      'withOptions',
      'outputOption',
      'outputOptions',
    ],
    complexFilter: ['filterGraph'],
  },
  inputs: {
    addInput: ['input', 'mergeAdd'],
    fromFormat: ['withInputFormat', 'inputFormat'],
    withInputFps: [
      'withInputFPS',
      'withFpsInput',
      'withFPSInput',
      'inputFPS',
      'inputFps',
      'fpsInput',
      'FPSInput',
    ],
    native: ['withNativeFramerate', 'nativeFramerate'],
    setStartTime: ['seekInput'],
  },
  misc: {
    usingPreset: ['preset'],
  },
  output: {
    addOutput: ['output'],
    withDuration: ['duration', 'setDuration'],
    toFormat: ['withOutputFormat', 'outputFormat', 'format'],
    seek: ['seekOutput'],
    updateFlvMetadata: ['flvmeta'],
  },
  video: {
    withNoVideo: ['noVideo'],
    withVideoCodec: ['videoCodec'],
    withVideoBitrate: ['videoBitrate'],
    withVideoFilter: ['withVideoFilters', 'videoFilter', 'videoFilters'],
    withOutputFps: [
      'withOutputFPS',
      'withFpsOutput',
      'withFPSOutput',
      'withFps',
      'withFPS',
      'outputFPS',
      'outputFps',
      'fpsOutput',
      'FPSOutput',
      'fps',
      'FPS',
    ],
    takeFrames: ['withFrames', 'frames'],
  },
  videosize: {
    keepPixelAspect: ['keepDisplayAspect', 'keepDisplayAspectRatio', 'keepDAR'],
    withSize: ['setSize', 'size'],
    withAspect: ['withAspectRatio', 'setAspect', 'setAspectRatio', 'aspect', 'aspectRatio'],
    applyAutopadding: [
      'applyAutoPadding',
      'applyAutopad',
      'applyAutoPad',
      'withAutopadding',
      'withAutoPadding',
      'withAutopad',
      'withAutoPad',
      'autoPad',
      'autopad',
    ],
  },
  processing: {
    saveToFile: ['save'],
    writeToStream: ['stream', 'pipe'],
    run: ['exec', 'execute'],
    concat: ['concatenate', 'mergeToFile'],
    screenshots: ['screenshot', 'thumbnails', 'thumbnail', 'takeScreenshots'],
  },
};

describe('Method aliases', () => {
  for (const [category, methods] of Object.entries(aliases)) {
    describe(`${category} methods`, () => {
      for (const [method, methodAliases] of Object.entries(methods)) {
        describe(`FfmpegCommand#${method}`, () => {
          for (const alias of methodAliases) {
            it(`should have a '${alias}' alias`, () => {
              const ff = new Ffmpeg();
              assert.equal(typeof ff[method], 'function');
              assert.equal(ff[method], ff[alias]);
            });
          }
        });
      }
    });
  }
});
