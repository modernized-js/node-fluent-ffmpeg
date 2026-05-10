# Changelog

All notable changes to `@modernized/fluent-ffmpeg` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/) with the caveat that 0.x releases treat upstream bug fixes (where prior behaviour was already broken) as `fix` rather than `BREAKING` — see the de-facto behaviour change note for #42 below.

## [Unreleased]

### Fixed

- **#37** — `formatRegexp` now consumes the optional 3rd `[d ]?` flag column emitted by ffmpeg for virtual / device demuxers (`lavfi`, `gdigrab`, `iec61883`, …). `inputFormat('lavfi')` no longer raises *"Input format lavfi is not available"*. Mirrors upstream [fluent-ffmpeg#1282](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1282) / [#1262](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1262). (#45)
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
