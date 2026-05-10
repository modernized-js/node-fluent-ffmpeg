# Changelog

All notable changes to `@modernized/fluent-ffmpeg` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/) with the caveat that 0.x releases treat upstream bug fixes (where prior behaviour was already broken) as `fix` rather than `BREAKING` — see the de-facto behaviour change note for #42 below.

## [Unreleased]

## [0.1.4] - 2026-05-11

### Fixed

- **Type declaration of `mergeToFile(target, tmpFolder?: string)` was a lie.** The implementation never had any `tmpFolder` handling — `mergeToFile`, `concatenate`, and `concat` are aliases for the same unified function that simply forwards its second argument to `output(target, options)` (which expects `PipeOptions`). Callers passing a tmpFolder string (e.g. `cmd.mergeToFile('out.mp4', '/tmp')`) were silently broken at runtime; the second argument was being treated as a `PipeOptions` object. The type now matches reality: `mergeToFile(target, options?: PipeOptions)`. **This is a type-only breaking change** for consumers relying on the old (incorrect) `tmpFolder?: string` signature; runtime behaviour is unchanged. If you actually need an upstream-style `mergeToFile` with intermediate-file semantics, that's a separate feature request.

### Changed

- **`FfmpegCommandThis._getArguments()` return type widened from `(string | number)[]` to `ArgValue[]`** (= `string | number | FilterSpec`) to reflect the implementation's actual return type. `_getArguments` is an internal `_`-prefixed method, but it's part of the exported `FfmpegCommandThis` interface, so this is a **type-only breaking change** for any consumer that explicitly typed an `_getArguments()` return as `(string | number)[]`. Runtime behaviour is unchanged — the implementation has always returned `ArgValue[]`; the previous narrower declaration was inaccurate. `ArgValue` was already exported from the public types module.

### Internal

- `FfmpegCommandPrototype` is now `Partial<FfmpegCommandThis>` instead of `Record<string, unknown>`. The 11 internal `applyXxx(proto: FfmpegCommandPrototype)` patch points across `lib/options/*.ts`, `lib/recipes.ts`, `lib/processor.ts`, `lib/capabilities.ts`, and `lib/ffprobe.ts` now type-check against the real method shapes declared on `FfmpegCommandThis`: typos in method names and signature mismatches between an alias chain and its interface declaration are caught at build time. No public API surface change — `FfmpegCommandPrototype` is not re-exported from the package entry point and was never user-facing. Eliminates one `as unknown as` cast at the prototype-assignment site in `lib/fluent-ffmpeg.ts`.
- Replaced remaining `Record<string, unknown>` and `string | unknown` parameter / return types in internal helpers with their real shapes: the `writeToStream` / `pipe` / `stream` and `mergeToFile` / `concat` / `concatenate` impls in `lib/recipes.ts` now declare `PipeOptions` instead of `Record<string, unknown>`; the `source` parameter of `resolvePercentTimemarks` and `replaceFilenameTokens` is now `string | Readable` instead of `string | unknown`; the structural `{ options: { find: (...) => unknown[] | undefined } }` parameters in `lib/capabilities.ts`'s `findUnavailableFormats` / `findUnavailableCodecs` now use the real `ArgList` shape so `find()` returns `ArgValue[] | undefined` directly. `PipeOptions` is now exported from `lib/types.ts` so internal modules can reference it (it was previously a non-exported `interface` only used inside the same file). No public API surface change; runtime behaviour unchanged.
- `OutputState.pipeopts` and the `addOutput` / `output` impl in `lib/options/output.ts` now declare `PipeOptions` instead of `Record<string, unknown>`. The `addOutput(target, pipeopts?: PipeOptions)` / `output(target?, pipeopts?: PipeOptions)` interface declarations on `FfmpegCommandThis` were already correct; the impl side was the looser one. Same `Record<string, unknown>` → `PipeOptions` cleanup as the recipes-side one above, applied to the central `output()` path.

## [0.1.3] - 2026-05-10

### Added

- **#53** — New chainable `durationInput(d)` (and its `setInputDuration(d)` alias) that mirrors the existing `seekInput(s)` / `setStartTime(s)` pair — applies `-t <duration>` to the **current input** rather than the global output. Lets consumers express the canonical multi-input pattern `ffmpeg -t N -ss S -i input1 -t N -ss S -i input2 …`. Mirrors upstream [fluent-ffmpeg#1247](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1247). The existing output-side `.duration()` is unchanged. (#56)
- **#54** — New `skipMetadata: true` option on `FfmpegCommand` constructor that suppresses the background ffprobe metadata fetch. For remote URL inputs, this avoids the duplicate HTTP probe that fluent-ffmpeg otherwise issues (one ffprobe + one ffmpeg = two GETs to the same resource); useful for large files, slow networks, or metered bandwidth. `progress.percent` is unavailable when set. Mirrors upstream [fluent-ffmpeg#1191](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1191). (#57)

### Fixed

- **#43** — `resolveBundledPresetsDir()` no longer crashes with `ReferenceError: __dirname is not defined` when a downstream tool (SvelteKit / Vite SSR / esbuild ESM mode) re-emits the compiled CJS as part of an ESM bundle. Falls back to the relative `'presets'` string in that case, so module load succeeds and preset resolution surfaces the existing error path. Mirrors upstream [fluent-ffmpeg#1283](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1283). (#48)
- **#37** — `formatRegexp` now consumes the optional 3rd `[d ]?` flag column emitted by ffmpeg for virtual / device demuxers (`lavfi`, `gdigrab`, `iec61883`, …). `inputFormat('lavfi')` no longer raises _"Input format lavfi is not available"_. Mirrors upstream [fluent-ffmpeg#1282](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1282) / [#1262](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1262). (#45)
- **#38** — `inputOptions` (`-headers`, `-rtsp_transport`, `-allowed_extensions`, …) are now forwarded to the ffprobe sidecar via a new `buildFfprobeArgv()` helper, so the duration probe no longer silently 401s on auth-protected URLs / RTSP feeds and `progress.percent` works for those inputs. Mirrors upstream [fluent-ffmpeg#1146](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1146). (#45)
- **#39** — `setFfmpegPath` / `setFfprobePath` now invalidate the cached capability tables (`codecs` / `encoders` / `formats` / `filters`) so a second run after a path swap re-probes the new binary instead of trusting stale data. `setFfmpegPath` additionally clears an auto-derived `ffprobePath` (sibling-of-ffmpeg or `PATH` lookup) while leaving an explicit `setFfprobePath` value intact. Mirrors upstream [fluent-ffmpeg#1285](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1285). (#45)
- **#40** — `pipeOutputStream` now detaches its `close` / `error` listeners on `ffmpegProc.exit`. Consumers piping many short ffmpeg jobs into the same long-lived `Writable` (e.g. a `PassThrough` fed to a media server) no longer accumulate listeners and trip Node's `MaxListenersExceededWarning`. Mirrors upstream [fluent-ffmpeg#1129](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1129). (#46)
- **#41** — `extractProgress` now coerces `bitrate=N/A`, `size=N/A`, and any other non-finite parse to `0` instead of `NaN`. Common scenarios (output to pipe before first frame, copy codec, fragmented mp4, hardware encoders mid-keyframe) no longer render garbage in consumer progress UIs. Mirrors upstream [fluent-ffmpeg#1201](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1201). (#46)
- **#42** — `inputOptions(['-headers', 'Cookie: a=b'])` no longer splits the value on the embedded space. The heuristic now splits an array entry only when it has exactly 2 space-separated parts AND the first part starts with `-` (preserving the legacy preset shape `'-me_method umh'`). Mirrors upstream [fluent-ffmpeg#1151](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1151). (#47)

### Changed

- **De facto behaviour change for `inputOptions` / `outputOptions` array form** (bug-fix direction; see #42): array entries shaped like `[..., 'value with space']` where the value does NOT start with `-` are now passed verbatim instead of being split. Function signatures are unchanged; only the observable argv changes, and only in the direction of "broken → correct". The legacy preset shape (`outputOptions(['-me_method umh', '-subq 5'])`) and the positional vararg shape (`inputOptions('-headers', 'Cookie: a=b')`) are unaffected.
- `extractProgress` now uses `parseFloat` uniformly (via a new `numericFieldOrZero` helper) where it previously used `parseInt` for `frames` / `currentFps` / `targetSize`. `ProgressReport` types these as plain `number` (no integer contract), so a value like `fps=29.97` now reports `29.97` instead of `29` — strictly more accurate.

### Internal

- `lib/capabilities.ts`, `lib/ffprobe.ts`, and `lib/options/custom.ts` switched from `export = applyX` to `export default applyX` so named helpers (`parseFormatsOutput`, `buildFfprobeArgv`, `flattenOptions`) can coexist for unit-test consumption. The internal consumer in `lib/fluent-ffmpeg.ts` continues to work unchanged via `esModuleInterop`. No public API impact.

## [0.1.2] and earlier

Pre-existing releases are not retroactively documented; this changelog starts with the unreleased changes above.
