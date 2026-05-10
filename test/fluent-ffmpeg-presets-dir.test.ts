import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { resolveBundledPresetsDir } from '../lib/fluent-ffmpeg.js';

// --- Regression for issue #43 / upstream #1283 -------------------------
//
// `lib/fluent-ffmpeg.ts` referenced the CJS-only `__dirname` global
// directly when computing the bundled presets directory. That worked
// for the regular CJS dist (`__dirname` is defined) but threw
// `ReferenceError: __dirname is not defined` when a downstream tool
// re-emitted our compiled CJS as part of an ESM bundle (SvelteKit /
// Vite SSR / esbuild ESM mode).
//
// The fix wraps the lookup in `resolveBundledPresetsDir(dirname?)`:
// - If `dirname` is a non-empty string (the production path: the
//   default arg evaluates `__dirname` if defined), join 'presets'.
// - Otherwise return the relative string 'presets' so the package
//   loads in ESM-bundled scenarios; preset resolution will then fail
//   with the existing 'preset … could not be loaded' error rather
//   than crashing on import.
//
// Both branches are exercised below by passing the parameter directly,
// since `__dirname` cannot be made undefined under our CJS test rig.

describe('resolveBundledPresetsDir (issue #43 — ESM-safe presets path)', () => {
  it('returns a path that ends in "presets" in the CJS dist context', () => {
    const dir = resolveBundledPresetsDir();
    assert.ok(typeof dir === 'string' && dir.length > 0);
    assert.equal(path.basename(dir), 'presets');
  });

  it('returns a path resolving inside our lib/ tree (not the consumer cwd)', () => {
    const dir = resolveBundledPresetsDir();
    // The directory must contain a `lib` segment (TS source) or
    // `dist/lib` segment (compiled), proving we resolved from the
    // module location rather than from process.cwd().
    assert.ok(
      dir.includes(`${path.sep}lib${path.sep}`) || dir.includes(`${path.sep}lib`),
      `expected resolved presets dir to live inside lib/, got: ${dir}`,
    );
  });

  it('points at a real directory containing the bundled preset files', () => {
    const dir = resolveBundledPresetsDir();
    assert.ok(existsSync(dir), `expected presets dir ${dir} to exist on disk`);
    // Sanity: at least one of the canonical bundled presets is there.
    const expectedPresets = ['divx', 'flashvideo', 'podcast'];
    const found = expectedPresets.some(
      (name) =>
        existsSync(path.join(dir, `${name}.ts`)) || existsSync(path.join(dir, `${name}.js`)),
    );
    assert.ok(found, `expected to find one of [${expectedPresets.join(', ')}] in ${dir}`);
  });

  it('produces a stable result across consecutive calls (no per-call state)', () => {
    const a = resolveBundledPresetsDir();
    const b = resolveBundledPresetsDir();
    assert.equal(a, b);
  });

  // Branch coverage via parameter injection. Note: passing `undefined`
  // would re-trigger the default expression (JS default-param
  // semantics), so we pass an empty string to simulate the ESM-bundle
  // case where `__dirname` is undefined — both are falsy and hit the
  // same `if (!dirname)` branch.

  it('joins the supplied dirname with "presets" when given (CJS branch)', () => {
    const result = resolveBundledPresetsDir('/some/explicit/path/lib');
    assert.equal(result, path.join('/some/explicit/path/lib', 'presets'));
  });

  it('returns the relative string "presets" when dirname is falsy (ESM-bundle branch)', () => {
    // The real production trigger is `__dirname` being undefined when
    // a downstream tool re-emits our compiled CJS as part of an ESM
    // bundle. The relative path lets module load succeed; preset
    // loading then surfaces the existing 'preset … could not be
    // loaded' error rather than crashing with ReferenceError.
    assert.equal(resolveBundledPresetsDir(''), 'presets');
  });
});
