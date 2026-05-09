import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type {
  FfmpegCommandPrototype,
  FfmpegCommandThis,
  FfprobeCallback,
  FfprobeData,
  FfprobeStream,
  InputState,
} from './types.js';

const blockEndRegexp = /^\[\/(.+)]$/;
const sectionStartRegexp = /^\[/;
const kvRegexp = /^([^=]+)=(.*)$/;
const numericRegexp = /^[0-9]+(\.[0-9]+)?$/;
const tagPrefixRegexp = /^TAG:/;
const dispositionPrefixRegexp = /^DISPOSITION:/;
const stdinIgnorableErrors = new Set(['ECONNRESET', 'EPIPE', 'EOF']);

function parseBlockBody(lines: string[], name: string): FfprobeStream {
  const data: FfprobeStream = {};
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

function liftLegacyKeys(target: FfprobeStream, prefix: RegExp, dest: 'tags' | 'disposition'): void {
  const matchingKeys = Object.keys(target).filter((k) => prefix.test(k));
  if (matchingKeys.length === 0) return;
  target[dest] ??= {};
  const bag = target[dest] as Record<string, unknown>;
  const sliceFrom = dest === 'tags' ? 4 : 12;
  matchingKeys.forEach((key) => {
    bag[key.slice(sliceFrom)] = target[key];
    delete target[key];
  });
}

function normaliseLegacyOutput(data: FfprobeData): void {
  [data.format, ...data.streams].forEach((target) => {
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
      handleCallback(finalErr);
      return;
    }
    const data = parseFfprobeOutput(state.stdout);
    normaliseLegacyOutput(data);
    handleCallback(null, data);
  };

  const src = input.isStream ? 'pipe:0' : (input.source as string);
  const child = spawn(probePath, ['-show_streams', '-show_format', ...options, src], {
    windowsHide: true,
  });

  if (input.isStream) {
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code && stdinIgnorableErrors.has(err.code)) return;
      handleCallback(err);
    });
    child.stdin.on('close', () => {
      const stream = input.source as Readable;
      stream.pause();
      stream.unpipe(child.stdin);
    });
    (input.source as Readable).pipe(child.stdin);
  }

  child.on('error', (err) => handleCallback(err));
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
      callback(error!);
      return;
    }
    this._getFfprobePath((pathErr, probePath) => {
      if (pathErr) return callback(pathErr);
      if (!probePath) return callback(new Error('Cannot find ffprobe'));
      runFfprobe(probePath, input, options, callback);
    });
  };
}

export = applyFfprobe;
