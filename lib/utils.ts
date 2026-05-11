import { platform } from 'node:os';
import which from 'which';
import type {
  ArgList,
  ArgValue,
  CodecState,
  CommandLike,
  FilterSpec,
  LinesRing,
  ProgressReport,
} from './types.js';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const isWindows = /win(32|64)/.test(platform());
const streamRegexp = /^\[?(.*?)\]?$/;
const filterEscapeRegexp = /[,]/;
const nlRegexp = /\r\n|\r|\n/g;

const whichCache: Record<string, string> = {};

type WhichCallback = (err: null, path: string) => void;

function copy<S extends Record<string, unknown>>(source: S, dest: Record<string, unknown>): void {
  Object.keys(source).forEach((key) => {
    dest[key] = source[key];
  });
}

function makeArgList(): ArgList {
  // The legacy semantic is intentional and observable: a single array
  // argument is spread into the list, but multiple arguments (each of
  // which may be an array) are appended as-is — array elements stay as
  // nested arrays rather than being flattened. The two `as` casts below
  // are kept because removing them would force ArgList's element type
  // to become `ArgValue | ArgValue[]`, which propagates through every
  // consumer of get/find/clone.
  let list: ArgValue[] = [];

  const argfunc = ((...args: (ArgValue | ArgValue[])[]) => {
    if (args.length === 1 && Array.isArray(args[0])) {
      list = list.concat(args[0]);
    } else {
      list = list.concat(args as ArgValue[]);
    }
  }) as ArgList;

  argfunc.clear = () => {
    list = [];
  };
  argfunc.get = () => list;
  argfunc.find = (arg, count = 0) => {
    const i = list.indexOf(arg);
    return i === -1 ? undefined : list.slice(i + 1, i + 1 + count);
  };
  argfunc.remove = (arg, count = 0) => {
    const i = list.indexOf(arg);
    if (i !== -1) list.splice(i, count + 1);
  };
  argfunc.clone = () => {
    const cloned = makeArgList();
    cloned(list);
    return cloned;
  };

  return argfunc;
}

function streamSpecsToBrackets(spec: string | string[] | undefined): string {
  if (spec === undefined) return '';
  const list = Array.isArray(spec) ? spec : [spec];
  return list.map((s) => s.replace(streamRegexp, '[$1]')).join('');
}

function escapeFilterValue(value: unknown): string {
  if (typeof value === 'string' && filterEscapeRegexp.test(value)) {
    return `'${value}'`;
  }
  return String(value);
}

function filterOptionsToString(options: FilterSpec['options']): string {
  if (options === undefined || options === null) return '';
  if (typeof options === 'string' || typeof options === 'number') return `=${options}`;
  if (Array.isArray(options)) return `=${options.map(escapeFilterValue).join(':')}`;
  const entries = Object.entries(options);
  if (entries.length === 0) return '';
  const body = entries.map(([k, v]) => `${k}=${escapeFilterValue(v)}`).join(':');
  return `=${body}`;
}

function filterSpecToString(spec: string | FilterSpec): string {
  if (typeof spec === 'string') return spec;
  return (
    streamSpecsToBrackets(spec.inputs) +
    spec.filter +
    filterOptionsToString(spec.options) +
    streamSpecsToBrackets(spec.outputs)
  );
}

function makeFilterStrings(filters: (string | FilterSpec)[]): string[] {
  return filters.map(filterSpecToString);
}

function whichCached(name: string, callback: WhichCallback): void {
  if (name in whichCache) {
    callback(null, whichCache[name]);
    return;
  }
  which(name)
    .then((result) => {
      whichCache[name] = result;
      callback(null, result);
    })
    .catch(() => {
      whichCache[name] = '';
      callback(null, '');
    });
}

function timemarkToSeconds(timemark: string | number): number {
  if (typeof timemark === 'number') return timemark;
  if (!timemark.includes(':') && timemark.includes('.')) return Number(timemark);

  const parts = timemark.split(':').map(Number);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds;
}

const inputPattern = /Input #[0-9]+, ([^ ]+),/;
const durPattern = /Duration: ([^,]+)/;
const audioPattern = /Audio: (.*)/;
const videoPattern = /Video: (.*)/;
const outputStartPattern = /Output #\d+/;
const codecDataDonePattern = /Stream mapping:|Press (\[q\]|ctrl-c) to stop/;

function ensureCodecState(state: CodecState): asserts state is Required<CodecState> {
  state.inputStack ??= [];
  state.inputIndex ??= -1;
  state.inInput ??= false;
}

function tryStartInput(line: string, state: Required<CodecState>): boolean {
  const match = line.match(inputPattern);
  if (!match) return false;
  state.inInput = true;
  state.inputIndex += 1;
  // Initialise audio_details / video_details up-front so consumers that
  // destructure them on the `codecData` event always see an array, even
  // for inputs that have no audio or no video stream. Mirrors upstream
  // fluent-ffmpeg#1301.
  state.inputStack[state.inputIndex] = {
    format: match[1],
    audio: '',
    audio_details: [],
    video: '',
    video_details: [],
    duration: '',
  };
  return true;
}

function applyDuration(line: string, state: Required<CodecState>): boolean {
  const match = line.match(durPattern);
  if (!match) return false;
  state.inputStack[state.inputIndex].duration = match[1];
  return true;
}

function applyAudio(line: string, state: Required<CodecState>): boolean {
  const match = line.match(audioPattern);
  if (!match) return false;
  const parts = match[1].split(', ');
  const slot = state.inputStack[state.inputIndex];
  slot.audio = parts[0];
  slot.audio_details = parts;
  return true;
}

function applyVideo(line: string, state: Required<CodecState>): boolean {
  const match = line.match(videoPattern);
  if (!match) return false;
  const parts = match[1].split(', ');
  const slot = state.inputStack[state.inputIndex];
  slot.video = parts[0];
  slot.video_details = parts;
  return true;
}

function extractCodecData(
  command: CommandLike,
  stderrLine: string,
  codecsObject: CodecState,
): boolean {
  ensureCodecState(codecsObject);
  const state = codecsObject;

  if (tryStartInput(stderrLine, state)) return false;
  if (state.inInput) {
    if (applyDuration(stderrLine, state)) return false;
    if (applyAudio(stderrLine, state)) return false;
    if (applyVideo(stderrLine, state)) return false;
  }
  if (outputStartPattern.test(stderrLine)) {
    state.inInput = false;
    return false;
  }
  if (codecDataDonePattern.test(stderrLine)) {
    command.emit('codecData', ...state.inputStack);
    return true;
  }
  return false;
}

// `-loglevel +level` prepends `[level]` (e.g. `[info]`, `[warning]`,
// `[error]`) to every stderr line. Strip it before key=value parsing
// so progress events still fire under that loglevel. Mirrors upstream
// fluent-ffmpeg#928.
const loglevelPrefixRegexp = /^\[[a-z]+\]\s*/;

function parseProgressLine(line: string): Record<string, string> | null {
  const stripped = line.replace(loglevelPrefixRegexp, '');
  const trimmed = stripped.replace(/=\s+/g, '=').trim();
  const progress: Record<string, string> = {};
  const allValid = trimmed.split(' ').every((part) => {
    const [key, value] = part.split('=', 2);
    if (value === undefined) return false;
    progress[key] = value;
    return true;
  });
  return allValid ? progress : null;
}

// Avoid scientific notation when forwarding numeric seek / duration
// arguments to ffmpeg — ffmpeg's CLI rejects values like `1e-7`.
// Plain-number formatting with up to 10 fractional digits matches
// upstream fluent-ffmpeg#1131 (covers high-sample-rate audio /
// frame-accurate seeks without losing precision).
const FF_NUMBER_MAX_FRACTION_DIGITS = 10;
const flatNumberFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumFractionDigits: FF_NUMBER_MAX_FRACTION_DIGITS,
});

function formatNumberForCall(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return flatNumberFormatter.format(value);
}

// Coerce ffmpeg's progress-line numeric fields to a finite number.
// Modern ffmpeg emits `bitrate=N/A`, `size=N/A`, etc. for several common
// scenarios (output to pipe before first frame, copy codec, fragmented mp4,
// hardware encoders mid-keyframe). The legacy parseInt/parseFloat returned
// `NaN` in those cases, which propagated to consumer progress UIs as
// garbage. Map `N/A` and any other non-finite parse to `0`.
function numericFieldOrZero(value: string | undefined): number {
  if (!value) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function extractProgress(command: CommandLike, stderrLine: string): void {
  const progress = parseProgressLine(stderrLine);
  if (!progress) return;

  const ret: ProgressReport = {
    frames: numericFieldOrZero(progress.frame),
    currentFps: numericFieldOrZero(progress.fps),
    currentKbps: progress.bitrate ? numericFieldOrZero(progress.bitrate.replace('kbits/s', '')) : 0,
    targetSize: numericFieldOrZero(progress.size ?? progress.Lsize),
    timemark: progress.time,
  };

  const duration = Number(command._ffprobeData?.format?.duration);
  if (!Number.isNaN(duration)) {
    ret.percent = (timemarkToSeconds(ret.timemark) / duration) * 100;
  }
  command.emit('progress', ret);
}

function extractError(stderr: string): string {
  return stderr
    .split(nlRegexp)
    .reduce<string[]>((messages, message) => {
      const head = message.charAt(0);
      if (head === ' ' || head === '[') return [];
      messages.push(message);
      return messages;
    }, [])
    .join('\n');
}

function makeLinesRing(maxLines: number): LinesRing {
  const cbs: ((line: string) => void)[] = [];
  const lines: string[] = [];
  let current: string | null = null;
  let closed = false;
  const max = maxLines - 1;

  const emit = (line: string) => cbs.forEach((cb) => cb(line));

  const trimToMax = () => {
    if (max > -1 && lines.length > max) {
      lines.splice(0, lines.length - max);
    }
  };

  const recordLine = (line: string) => {
    emit(line);
    lines.push(line);
  };

  const appendString = (str: string) => {
    const newLines = str.split(nlRegexp);
    if (newLines.length === 1) {
      current = (current ?? '') + newLines.shift();
      return;
    }
    if (current !== null) {
      recordLine(current + newLines.shift());
    }
    current = newLines.pop() ?? null;
    newLines.forEach(recordLine);
    trimToMax();
  };

  return {
    callback(cb) {
      lines.forEach((l) => cb(l));
      cbs.push(cb);
    },
    append(strOrBuf) {
      if (closed) return;
      const str: string = typeof strOrBuf === 'string' ? strOrBuf : strOrBuf.toString();
      if (str.length === 0) return;
      appendString(str);
    },
    get() {
      return current === null ? lines.join('\n') : lines.concat([current]).join('\n');
    },
    close() {
      if (closed) return;
      if (current !== null) {
        recordLine(current);
        if (max > -1 && lines.length > max) lines.shift();
        current = null;
      }
      closed = true;
    },
  };
}

const utils = {
  isWindows,
  streamRegexp,
  copy,
  args: makeArgList,
  makeFilterStrings,
  which: whichCached,
  timemarkToSeconds,
  formatNumberForCall,
  extractCodecData,
  extractProgress,
  extractError,
  linesRing: makeLinesRing,
};

export = utils;
