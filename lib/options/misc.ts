import path from 'node:path';
import { createRequire } from 'node:module';
import type { FfmpegCommandPrototype, FfmpegCommandThis } from '../types.js';

const requireFromHere = createRequire(__filename);

interface PresetModule {
  load?: (cmd: FfmpegCommandThis) => void;
}

function loadPresetByName(this: FfmpegCommandThis, preset: string): void {
  const modulePath = path.join(this.options.presets ?? '', preset);
  // Match legacy: a single try/catch wraps both the require AND the load() call,
  // so any failure surfaces as 'preset <path> could not be loaded: ...'.
  try {
    const mod = requireFromHere(modulePath) as PresetModule;
    if (typeof mod.load !== 'function') {
      throw new Error(`preset ${modulePath} has no load() function`);
    }
    mod.load(this);
  } catch (err) {
    throw new Error(`preset ${modulePath} could not be loaded: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

function applyMiscOptions(proto: FfmpegCommandPrototype): void {
  proto.usingPreset = proto.preset = function (
    this: FfmpegCommandThis,
    preset: string | ((cmd: FfmpegCommandThis) => void),
  ) {
    if (typeof preset === 'function') {
      preset(this);
    } else {
      loadPresetByName.call(this, preset);
    }
    return this;
  };
}

export = applyMiscOptions;
