# fix: parse `ffmpeg -filters` from ffmpeg 8 (#82)

## Problem

ffmpeg 8.0 dropped the "Command support" flag column from `-filters` rows
(`fftools/opt_common.c`: `" %c%c%c "` in n7.1.1 → `" %c%c "` in n8.0.1). `filterRegexp`
requires three flags, so `getAvailableFilters` returns an empty table on ffmpeg 8.

## Change

- `filterRegexp`: third flag optional — `(?: [T.][S.][C.]? )?`.
- Export `parseFiltersOutput` (as `parseFormatsOutput` already is) so the parser is testable without an ffmpeg binary.
- `test/capabilities-filters.test.ts`: 7.x rows (3 flags), 8.x rows (2 flags), and the header/legend lines must not parse as filters.

## Out of scope

`N` (dynamic) and 3+-pad I/O rows are unmatched in both versions today; unchanged.
