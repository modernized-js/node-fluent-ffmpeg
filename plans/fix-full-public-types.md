# Public TypeScript declarations parity with upstream + which engine fix

## Background

A consumer reported when adopting `@modernized/fluent-ffmpeg`:

1. `which@7.0.0` requires Node `^22.22.2 || ^24.15.0 || >=26.0.0` —
   on Node `24.12.0` the install needs `--ignore-engines`.
2. The TypeScript declarations we ship are missing many public methods
   that the original `@types/fluent-ffmpeg` (DefinitelyTyped) declared:
   `inputOptions`, `outputOptions`, `format`, `inputFormat`, etc.
3. `metadata.streams[i].<field>` is typed `unknown` instead of the
   per-field shapes upstream declares (`codec_type: string | undefined`,
   `width: number | undefined`, …).
4. `ffprobe(callback)` declares `data?: FfprobeData` so consumers must
   guard `if (data)` even on the success path. Upstream declares
   `data: FfprobeData` (non-optional).

`yarn build` against our package produces 13 TS errors in the consumer.
User goal: **100% type compatibility with the original
`@types/fluent-ffmpeg`** ("特に型はオリジナルと100%互換性が欲しい").

## Goal

- Author public type declarations in our TypeScript source that mirror
  upstream `@types/fluent-ffmpeg` (without literally vendoring the file
  — define equivalent interfaces ourselves).
- Pin `which` to `^6.0.1` so Node 22.x / 24.x consumers do not need
  `--ignore-engines`.
- Add `tsd`-style type tests so future regressions on the public API
  surface (the four reported missing methods + the `ffprobe` data-shape
  - `streams[i]` field typing) break the build.

## Scope

### Public API surface (chainable methods)

Mirror every method upstream declares on `FfmpegCommand` (153 unique
names, plus their alias overloads — ~176 signatures). Confirmed via
`grep -oEr "proto\.[a-zA-Z_]+"` that all of them already exist at
runtime in `lib/options/*`, `lib/recipes.ts`, `lib/processor.ts`. This
is purely a typing fix.

### Data shapes

- `FfprobeStream`: enrich with the per-field declarations upstream has
  (`codec_type?: string`, `width?: number`, …). Keep `[key: string]:
unknown` (NOT `any`, per CLAUDE.md) for forward compatibility.
- `FfprobeFormat`: new interface, mirrors upstream
  (`filename?`, `nb_streams?`, `duration?: number`, `tags?`).
- `FfprobeStreamDisposition`: new interface, mirrors upstream.
- `FfprobeData.format` becomes `FfprobeFormat` (currently aliased to
  `FfprobeStream`).
- `FfprobeData.chapters` stays as `FfprobeStream[]` (upstream uses
  `any[]`; our typed array is stricter and still assignable).

### Callback signature

- `FfprobeCallback`: change `(err: Error | null, data?: FfprobeData)`
  → `(err: Error | null, data: FfprobeData)` (non-optional `data`).
  This matches upstream's `(err: any, data: FfprobeData)` — we keep
  `Error | null` for a stricter `err` type than upstream's `any`.

### Event listener overloads

Add typed `on()` overloads for the canonical event names upstream
declares: `start`, `progress`, `stderr`, `codecData`, `error`,
`filenames`, `end`. Keeps backwards-compat with the inherited
`EventEmitter.on(event, listener)` signature via overload fallback.

### Static methods

`FfmpegCommandStatic` already declares the static methods correctly;
adjust the `ffprobe` overloads to use the new non-optional-data
callback shape. No surface change.

### Engine fix

Change `package.json#dependencies.which` from `^7.0.0` to `^6.0.1`.
Verify `lib/utils.ts`'s `which()` wrapper still works (the API surface
of the `which` package between v6 and v7 is the same — both export a
default callable returning a path / a Promise).

## Implementation

1. Branch `fix/full-public-types` (already created).
2. Plan file (this file).
3. `yarn add which@^6.0.1` (replaces `^7.0.0`).
4. `yarn add -D tsd` for type-only tests.
5. Edit `lib/types.ts`:
   - Enrich `FfprobeStream` with per-field declarations.
   - Add `FfprobeFormat`, `FfprobeStreamDisposition`.
   - Change `FfprobeData.format: FfprobeStream` → `: FfprobeFormat`.
   - Add `ScreenshotsConfig`, `AudioVideoFilter`, `PresetFunction`.
   - Change `FfprobeCallback` signature to non-optional `data`.
   - Add the full set of chainable method declarations to
     `FfmpegCommandThis` (or a new `FfmpegCommandPublic` that
     `FfmpegCommandThis extends`).
   - Add the typed `on()` event-listener overloads.
6. Edit `lib/fluent-ffmpeg.ts` `FfmpegCommandStatic`:
   - Adjust `ffprobe` static-method overloads' callback signature.
7. Adjust internal call sites that depended on the old looser shapes:
   - `lib/ffprobe.ts liftLegacyKeys` — relax target type to a union or
     `Record<string, unknown>` so it still accepts both stream and
     format targets.
   - Anywhere `data?: FfprobeData` was relied on for early-return.
8. Add `test-d/types.test-d.ts`:
   - `expectType<FfmpegCommand>(ffmpeg('x').inputOptions(['…']))`
   - `expectType<string | undefined>(streams[0].codec_type)`
   - `expectType<number | undefined>(streams[0].width)`
   - The `ffprobe` callback's `data` is `FfprobeData` (non-optional)
   - `expectError` for clearly invalid usage (e.g. `format()` without
     a string).
9. Wire `tsd` into `yarn test:types` (or a single `yarn test`).
10. Reproduce the consumer scenario from `/tmp/consumer-probe`-style
    probe and confirm zero TS errors after the fix.
11. `yarn format`, `yarn lint`, `yarn typecheck`, `yarn test`,
    `yarn build` all green.

## Out of scope

- Changing the runtime behaviour. This is a type-only PR (plus the
  small `which` version pin).
- Re-exporting upstream types verbatim. We author equivalent
  declarations in our own source, per the user's instruction
  ("いや、本家と同じような方を定義してそれをつかうようにしよう。").

## Acceptance

- The consumer-probe TS sample from this plan compiles with zero
  errors.
- `tsd`-style tests in `test-d/` cover the four reported missing
  methods, the `ffprobe`-callback `data` non-optionality, and the
  per-field typing of `streams[i].codec_type` / `streams[i].width`.
- `yarn add @modernized/fluent-ffmpeg` no longer triggers the
  `which@7.0.0` engines warning on Node 22.x or 24.x.
- All existing tests in `test/**/*.test.ts` still pass.
- Local pipeline (`format`, `lint`, `typecheck`, `test`, `build`)
  green.
