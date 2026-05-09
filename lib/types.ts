import type { ChildProcess } from 'node:child_process';
import type EventEmitter from 'node:events';
import type { Readable, Writable } from 'node:stream';

export interface FilterSpec {
  filter: string;
  inputs?: string | string[];
  outputs?: string | string[];
  options?: string | number | unknown[] | Record<string, unknown>;
}

export type ArgValue = string | number | FilterSpec;

export interface ArgList {
  (...args: (ArgValue | ArgValue[])[]): void;
  clear(): void;
  get(): ArgValue[];
  find(arg: ArgValue, count?: number): ArgValue[] | undefined;
  remove(arg: ArgValue, count?: number): void;
  clone(): ArgList;
}

export interface InputInfo {
  format: string;
  audio: string;
  video: string;
  duration: string;
  audio_details?: string[];
  video_details?: string[];
}

export interface CodecState {
  inputStack?: InputInfo[];
  inputIndex?: number;
  inInput?: boolean;
}

export interface LinesRing {
  callback(cb: (line: string) => void): void;
  append(str: string | Buffer): void;
  get(): string;
  close(): void;
}

export interface ProgressReport {
  frames: number;
  currentFps: number;
  currentKbps: number;
  targetSize: number;
  timemark: string;
  percent?: number;
}

export interface CommandLike {
  emit(event: string, ...args: unknown[]): boolean;
  _ffprobeData?: FfprobeData;
}

export interface InputState {
  source: string | Readable;
  isFile: boolean;
  isStream: boolean;
  options: ArgList;
}

export interface OutputState {
  target?: string | Writable;
  isFile?: boolean;
  pipeopts?: Record<string, unknown>;
  audio: ArgList;
  audioFilters: ArgList;
  video: ArgList;
  videoFilters: ArgList;
  sizeFilters: ArgList;
  options: ArgList;
  flags: { flvmeta?: boolean };
  sizeData?: { size?: string; aspect?: number; pad?: string | false };
}

export interface Logger {
  warn(message: string): void;
  debug(message: string): void;
  info?(message: string): void;
  error?(message: string): void;
}

export interface FfmpegCommandOptions {
  presets?: string;
  preset?: string;
  source?: string | Readable;
  logger?: Logger;
  niceness?: number;
  priority?: number;
  cwd?: string;
  timeout?: number;
  stdoutLines?: number;
  [key: string]: unknown;
}

export type PathCallback = (err: Error | null, path?: string) => void;

export interface SpawnOptions {
  captureStdout?: boolean;
  stdoutLines?: number;
  niceness?: number;
  cwd?: string;
}

export type SpawnCallback = (err: Error | null, stdoutRing?: LinesRing) => void;

export interface FilterInfo {
  description: string;
  input: 'audio' | 'video' | 'none';
  multipleInputs: boolean;
  output: 'audio' | 'video' | 'none';
  multipleOutputs: boolean;
}

export interface CodecInfo {
  type?: 'video' | 'audio' | 'subtitle';
  description: string;
  canDecode: boolean;
  canEncode: boolean;
  drawHorizBand?: boolean;
  directRendering?: boolean;
  weirdFrameTruncation?: boolean;
  intraFrameOnly?: boolean;
  isLossy?: boolean;
  isLossless?: boolean;
}

export interface EncoderInfo {
  type?: 'video' | 'audio' | 'subtitle';
  description: string;
  frameMT: boolean;
  sliceMT: boolean;
  experimental: boolean;
  drawHorizBand: boolean;
  directRendering: boolean;
}

export interface FormatInfo {
  description: string;
  canDemux: boolean;
  canMux: boolean;
}

export interface FfprobeStream {
  [key: string]: unknown;
  tags?: Record<string, unknown>;
  disposition?: Record<string, unknown>;
}

export interface FfprobeData {
  streams: FfprobeStream[];
  format: FfprobeStream;
  chapters: FfprobeStream[];
}

export type FfprobeCallback = (err: Error | null, data?: FfprobeData) => void;

export type ProcessCallback = (
  proc: ChildProcess,
  stdoutRing: LinesRing,
  stderrRing: LinesRing,
) => void;

export type SpawnEndCallback = (
  err: Error | null,
  stdoutRing?: LinesRing,
  stderrRing?: LinesRing,
) => void;

export type PrepareCallback = (err: Error | null, args?: string[]) => void;

export interface FfmpegCommandThis extends EventEmitter {
  _currentInput?: InputState;
  _currentOutput?: OutputState;
  _inputs: InputState[];
  _outputs: OutputState[];
  _complexFilters: ArgList;
  _global: ArgList;
  _ffprobeData?: FfprobeData;
  options: FfmpegCommandOptions;
  logger: Logger;
  ffmpegProc?: ChildProcess;
  processTimer?: NodeJS.Timeout;

  // capabilities.ts
  setFfmpegPath(p: string): this;
  setFfprobePath(p: string): this;
  setFlvtoolPath(p: string): this;
  _forgetPaths(): void;
  _getFfmpegPath(callback: PathCallback): void;
  _getFfprobePath(callback: PathCallback): void;
  _getFlvtoolPath(callback: PathCallback): void;
  availableFilters(
    callback: (err: Error | null, filters?: Record<string, FilterInfo>) => void,
  ): void;
  availableCodecs(callback: (err: Error | null, codecs?: Record<string, CodecInfo>) => void): void;
  availableEncoders(
    callback: (err: Error | null, encoders?: Record<string, EncoderInfo>) => void,
  ): void;
  availableFormats(
    callback: (err: Error | null, formats?: Record<string, FormatInfo>) => void,
  ): void;
  _checkCapabilities(callback: (err?: Error | null) => void): void;

  // ffprobe.ts
  ffprobe(callback: FfprobeCallback): void;
  ffprobe(index: number, callback: FfprobeCallback): void;
  ffprobe(options: string[], callback: FfprobeCallback): void;
  ffprobe(index: number, options: string[], callback: FfprobeCallback): void;

  // processor.ts
  _spawnFfmpeg(
    args: string[],
    options: SpawnOptions,
    processCB: ProcessCallback,
    endCB: SpawnEndCallback,
  ): void;
  _spawnFfmpeg(args: string[], options: SpawnOptions, endCB: SpawnEndCallback): void;
  _spawnFfmpeg(args: string[], endCB: SpawnEndCallback): void;
  _getArguments(): (string | number)[];
  _prepare(callback: PrepareCallback, readMetadata?: boolean): void;
  run(): this;
  exec(): this;
  execute(): this;
  renice(niceness?: number): this;
  kill(signal?: string): this;

  // options/* (chainable methods called from option modules and recipes)
  duration(d: string | number): this;
  videoFilters(filters: FilterSpec[]): this;
  output(target?: string | Writable, pipeopts?: Record<string, unknown>): this;
  seek(s: string | number): this;
  seekInput(s: string | number): this;
  size(s: string): this;
  complexFilter(spec: string | FilterSpec | (string | FilterSpec)[], map?: string | string[]): this;
  frames(count: number): this;
  map(spec: string): this;
}

export type FfmpegCommandPrototype = Record<string, unknown>;
