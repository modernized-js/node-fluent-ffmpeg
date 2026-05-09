import { spawn } from 'node:child_process';
import type {
  FfmpegCommandPrototype,
  FfmpegCommandThis,
  FfprobeCallback,
  FfprobeData,
  InputState,
} from './types.js';

const blockEndRegexp = /^\[\/(.+)]$/;
const sectionStartRegexp = /^\[/;
const kvRegexp = /^([^=]+)=(.*)$/;
// Matches bounded ffprobe-emitted numeric strings (e.g. "123" / "123.456");
// the `(\.…)?` alternation is theoretically unbounded but the input is
// fixed-length, so the ReDoS warning isn't actionable here.
// eslint-disable-next-line security/detect-unsafe-regex
const numericRegexp = /^[0-9]+(\.[0-9]+)?$/;
const tagPrefixRegexp = /^TAG:/;
const dispositionPrefixRegexp = /^DISPOSITION:/;
const stdinIgnorableErrors = new Set(['ECONNRESET', 'EPIPE', 'EOF']);

// Loose key/value shape produced by the ffprobe block parser. Both
// FfprobeStream and FfprobeFormat have a `[key: string]: unknown`
// index signature, so a Record<string, unknown> is structurally
// assignable to either.
type FfprobeBlockBody = Record<string, unknown>;

function parseBlockBody(lines: string[], name: string): FfprobeBlockBody {
  const data: FfprobeBlockBody = {};
  while (lines.length > 0) {
    const line = lines.shift()!;
    const closing = line.match(blockEndRegexp);
    if (closing && closing[1] === name) return data;
    if (sectionStartRegexp.test(line)) continue;
    const kv = line.match(kvRegexp);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (!tagPrefixRegexp.test(key) && numericRegexp.test(raw)) {
      data[key] = Number(raw);
    } else {
      data[key] = raw;
    }
  }
  return data;
}

function parseFfprobeOutput(out: string): FfprobeData {
  const lines = out.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const data: FfprobeData = { streams: [], format: {}, chapters: [] };
  while (lines.length > 0) {
    const line = lines.shift()!;
    if (/^\[stream/i.test(line)) data.streams.push(parseBlockBody(lines, 'STREAM'));
    else if (/^\[chapter/i.test(line)) data.chapters.push(parseBlockBody(lines, 'CHAPTER'));
    else if (line.toLowerCase() === '[format]') data.format = parseBlockBody(lines, 'FORMAT');
  }
  return data;
}

function assertsRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected a Record bag, got something else');
  }
}

function liftLegacyKeys(
  target: FfprobeBlockBody,
  prefix: RegExp,
  dest: 'tags' | 'disposition',
): void {
  const matchingKeys = Object.keys(target).filter((k) => prefix.test(k));
  if (matchingKeys.length === 0) return;
  target[dest] ??= {};
  const bag = target[dest];
  // ??= just guaranteed `bag` is at least `{}`; narrow the unknown
  // index-signature value to Record<string, unknown> via an assertion.
  assertsRecord(bag);
  const sliceFrom = dest === 'tags' ? 4 : 12;
  matchingKeys.forEach((key) => {
    bag[key.slice(sliceFrom)] = target[key];
    delete target[key];
  });
}

function normaliseLegacyOutput(data: FfprobeData): void {
  const targets: FfprobeBlockBody[] = [data.format, ...data.streams];
  targets.forEach((target) => {
    if (!target) return;
    liftLegacyKeys(target, tagPrefixRegexp, 'tags');
    liftLegacyKeys(target, dispositionPrefixRegexp, 'disposition');
  });
}

interface FfprobeArgs {
  index: number | null;
  options: string[];
  callback: FfprobeCallback;
}

function parseFfprobeArgs(args: unknown[]): FfprobeArgs {
  // The three `as` casts below stay: the FfmpegCommand.ffprobe overloads
  // (and the static Ffmpeg.ffprobe) declare the parameter shapes, so by
  // contract `args[length-1]` is an `FfprobeCallback`, and the 3-arg form
  // is `(index: number, options: string[], cb)`. Replacing the casts
  // with runtime typeof / Array.isArray throws would change the failure
  // mode for malformed callers (silent drop vs. early TypeError) without
  // a behavioural justification — keep the trust-the-overload pattern.
  const callback = args[args.length - 1] as FfprobeCallback;
  let index: number | null = null;
  let options: string[] = [];
  if (args.length === 3) {
    index = args[0] as number;
    options = args[1] as string[];
  } else if (args.length === 2) {
    if (typeof args[0] === 'number') index = args[0];
    else if (Array.isArray(args[0])) options = args[0];
  }
  return { index, options, callback };
}

function pickInput(
  index: number | null,
  currentInput: InputState | undefined,
  inputs: InputState[],
): { input?: InputState; error?: Error } {
  if (index === null) {
    if (!currentInput) return { error: new Error('No input specified') };
    return { input: currentInput };
  }
  const input = inputs[index];
  if (!input) return { error: new Error('Invalid input index') };
  return { input };
}

// Upstream `@types/fluent-ffmpeg` declares the ffprobe callback as
// `(err: any, data: FfprobeData) => void` — i.e. non-optional `data`.
// At runtime the convention is to pass an empty FfprobeData shape on
// error paths so callers that dereference `data` after a missed `err`
// check do not crash. A factory (not a shared constant) keeps each
// failed call's payload isolated — a consumer that mutates the
// returned object cannot poison subsequent failures.
const emptyFfprobeData = (): FfprobeData => ({ streams: [], format: {}, chapters: [] });

interface SpawnState {
  stdout: string;
  stderr: string;
  stdoutClosed: boolean;
  stderrClosed: boolean;
  processExited: boolean;
  exitError: Error | null;
}

function runFfprobe(
  probePath: string,
  input: InputState,
  options: string[],
  callback: FfprobeCallback,
): void {
  const state: SpawnState = {
    stdout: '',
    stderr: '',
    stdoutClosed: false,
    stderrClosed: false,
    processExited: false,
    exitError: null,
  };
  let ended = false;
  const handleCallback: FfprobeCallback = (err, data) => {
    if (ended) return;
    ended = true;
    callback(err, data);
  };

  const tryFinish = (err?: Error | null): void => {
    if (err) state.exitError = err;
    if (!(state.processExited && state.stdoutClosed && state.stderrClosed)) return;
    if (state.exitError) {
      const finalErr = state.exitError;
      if (state.stderr) finalErr.message += `\n${state.stderr}`;
      handleCallback(finalErr, emptyFfprobeData());
      return;
    }
    const data = parseFfprobeOutput(state.stdout);
    normaliseLegacyOutput(data);
    handleCallback(null, data);
  };

  // `input.isStream` flag alone doesn't narrow the source union for TS;
  // the typeof check picks up the string side without an `as` cast.
  const src = !input.isStream && typeof input.source === 'string' ? input.source : 'pipe:0';
  const child = spawn(probePath, ['-show_streams', '-show_format', ...options, src], {
    windowsHide: true,
  });

  // isStream=true implies source is Readable (caller-side contract);
  // the typeof check narrows the union for TS without an `as` cast.
  if (input.isStream && typeof input.source !== 'string') {
    const source = input.source;
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code && stdinIgnorableErrors.has(err.code)) return;
      handleCallback(err, emptyFfprobeData());
    });
    child.stdin.on('close', () => {
      source.pause();
      source.unpipe(child.stdin);
    });
    source.pipe(child.stdin);
  }

  child.on('error', (err) => handleCallback(err, emptyFfprobeData()));
  child.on('exit', (code, signal) => {
    state.processExited = true;
    if (code) tryFinish(new Error(`ffprobe exited with code ${code}`));
    else if (signal) tryFinish(new Error(`ffprobe was killed with signal ${signal}`));
    else tryFinish();
  });
  child.stdout.on('data', (chunk) => {
    state.stdout += chunk;
  });
  child.stdout.on('close', () => {
    state.stdoutClosed = true;
    tryFinish();
  });
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
  });
  child.stderr.on('close', () => {
    state.stderrClosed = true;
    tryFinish();
  });
}

function applyFfprobe(proto: FfmpegCommandPrototype): void {
  proto.ffprobe = function (this: FfmpegCommandThis, ...args: unknown[]) {
    const { index, options, callback } = parseFfprobeArgs(args);
    const { input, error } = pickInput(index, this._currentInput, this._inputs);
    if (error || !input) {
      callback(error!, emptyFfprobeData());
      return;
    }
    this._getFfprobePath((pathErr, probePath) => {
      if (pathErr) {
        callback(pathErr, emptyFfprobeData());
        return;
      }
      if (!probePath) {
        callback(new Error('Cannot find ffprobe'), emptyFfprobeData());
        return;
      }
      runFfprobe(probePath, input, options, callback);
    });
  };
}

export = applyFfprobe;
