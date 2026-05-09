# Expose pure helpers in `lib/recipes.ts` as named exports + add unit tests

## Goal

Promote the 8 pure helper functions inside `lib/recipes.ts` to named exports
so they can be unit-tested in isolation, and add edge / corner / boundary /
null / error / regression coverage for each.

## Background

PR #18 expanded `test/utils.test.ts` from 15 → 343 tests covering all 11
public exports of `lib/utils.ts`. The natural follow-up is `lib/recipes.ts`,
which the cross-file survey identified as the highest-leverage remaining
target: 8 pure deterministic helpers, **zero** direct unit tests today, all
currently exercised only through the heavy `takeScreenshots` integration
path.

(Issues are disabled on `modernized-js/node-fluent-ffmpeg`, so this plan
file is the durable issue equivalent.)

## Helpers to expose

| #   | Helper                                     | One-line behaviour                                             |
| --- | ------------------------------------------ | -------------------------------------------------------------- |
| 1   | `pickBiggestVideoStream(meta)`             | Picks the largest-area video stream from ffprobe output        |
| 2   | `normaliseScreenshotConfig(input, folder)` | Coerces the variadic screenshot config into a canonical object |
| 3   | `parseSizeSpec(size)`                      | Parses `WxH` / `Wx?` / `?xH` / `N%` size strings               |
| 4   | `isPercentTimemark(t)`                     | Predicate for `^[\d.]+%$` timemark strings                     |
| 5   | `fixPattern(config)`                       | Adds default extension and `_%i` index marker when needed      |
| 6   | `replaceFilenameTokens(pattern, source)`   | Substitutes `%f` / `%b`                                        |
| 7   | `replaceSizeTokens(pattern, size)`         | Substitutes `%r` / `%w` / `%h`                                 |
| 8   | `generateFilenames(pattern, timemarks)`    | Applies `%s` / `%0*i` per timemark                             |

## Approach

- Promote each helper to a named `export function …` in the same file.
- Switch the module's factory export from `export = applyRecipes` to
  `export default applyRecipes`. TypeScript does not allow named exports
  to coexist with `export =`; ESLint blocks the namespace-merge alternative
  via `@typescript-eslint/no-namespace`. The single internal consumer
  (`lib/fluent-ffmpeg.ts`) already imports via
  `import applyRecipes from './recipes.js'`, so `esModuleInterop` keeps it
  working unchanged. The published shape (`dist/index.js`) is unaffected
  because nothing outside the package depends on the internal module shape.
- While the file is open, replace the pre-existing
  `{ width: 0, height: 0 } as FfprobeStream` cast inside
  `pickBiggestVideoStream` with a properly typed seed (CLAUDE.md: NEVER
  use `as`).
- Add `test/recipes.test.ts` with the standard test pattern: happy / edge /
  corner / boundary / empty / null / invalid-input / error / negative cases
  per helper. Aim for 50+ assertions across the 8 helpers.

## Out of scope

- Refactoring the impure helpers (`probeFfprobe`, `memoizeFfprobe`,
  `resolvePercentTimemarks`, `computeSizeForTokens`, `ensureDirectory`,
  `buildScreenshotFilters`, `attachScreenshotOutputs`).
- The other survey targets (`lib/options/videosize.ts`,
  `lib/capabilities.ts`, `lib/ffprobe.ts`, `lib/processor.ts`) — separate
  follow-up PRs.

## Acceptance

- `lib/recipes.ts` exposes 8 named pure helpers.
- `test/recipes.test.ts` exists with direct unit coverage for each.
- `yarn lint`, `yarn typecheck`, `yarn test`, `yarn format:check`,
  `yarn build` all green.
- Existing `test/processor.test.ts` screenshot integration paths continue
  to pass unchanged.

## Steps

1. Branch `test/recipes-pure-helpers` from `main`.
2. Edit `lib/recipes.ts`:
   - Add `export` to each of the 8 pure helper declarations.
   - Replace `as FfprobeStream` with a typed seed (e.g. a
     `FfprobeStream` const with `width: 0, height: 0`).
   - Change the trailing `export = applyRecipes` to
     `export default applyRecipes`.
3. Verify `lib/fluent-ffmpeg.ts`'s `import applyRecipes from './recipes.js'`
   still resolves to the function (it does, via esModuleInterop).
4. Add `test/recipes.test.ts` with 8 `describe` blocks, one per helper.
5. Run `yarn format && yarn lint && yarn typecheck && yarn test &&
yarn build`. Fix anything red.
6. Commit, push, open PR with the AI-generated-PR template
   (Summary / Items to Confirm / User Prompt / Implementation).
7. Run `/codex-cross-review` until convergence.
