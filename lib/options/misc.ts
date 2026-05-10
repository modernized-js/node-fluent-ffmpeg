import path from 'node:path';
import { createRequire } from 'node:module';
import type { FfmpegCommandPrototype, FfmpegCommandThis } from '../types.js';

// `__filename` is undefined when our compiled CJS is re-emitted as ESM
// by a downstream bundler (SvelteKit / Vite SSR / esbuild ESM mode —
// the same scenario as issue #43). Without the guard, the package
// fails to import with `ReferenceError: __filename is not defined`
// before the user can construct any FfmpegCommand. The cwd-anchored
// fallback lets module load succeed; preset loading will surface the
// existing 'preset … could not be loaded' error if it can't resolve.
const requireAnchor =
  typeof __filename !== 'undefined' ? __filename : path.join(process.cwd(), 'esm-fallback.cjs');
const requireFromHere = createRequire(requireAnchor);

interface PresetModule {
  load?: (cmd: FfmpegCommandThis) => void;
}

function isPresetModule(value: unknown): value is PresetModule {
  return typeof value === 'object' && value !== null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadPresetByName(this: FfmpegCommandThis, preset: string): void {
  const modulePath = path.join(this.options.presets ?? '', preset);
  // Match legacy: a single try/catch wraps both the require AND the load() call,
  // so any failure surfaces as 'preset <path> could not be loaded: ...'.
  try {
    const mod: unknown = requireFromHere(modulePath);
    if (!isPresetModule(mod) || typeof mod.load !== 'function') {
      throw new Error(`preset ${modulePath} has no load() function`);
    }
    mod.load(this);
  } catch (err) {
    throw new Error(`preset ${modulePath} could not be loaded: ${errorMessage(err)}`, {
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
