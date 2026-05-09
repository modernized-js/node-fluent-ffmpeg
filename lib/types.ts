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

// Per-field declarations modelled after the original `@types/fluent-ffmpeg`
// (DefinitelyTyped, MIT) so consumer code that targeted that package
// keeps type-checking against this fork.

export interface FfprobeStreamDisposition {
  [key: string]: unknown;
  default?: number;
  dub?: number;
  original?: number;
  comment?: number;
  lyrics?: number;
  karaoke?: number;
  forced?: number;
  hearing_impaired?: number;
  visual_impaired?: number;
  clean_effects?: number;
  attached_pic?: number;
  timed_thumbnails?: number;
}

export interface FfprobeStream {
  [key: string]: unknown;
  index?: number;
  codec_name?: string;
  codec_long_name?: string;
  profile?: number;
  codec_type?: string;
  codec_time_base?: string;
  codec_tag_string?: string;
  codec_tag?: string;
  width?: number;
  height?: number;
  coded_width?: number;
  coded_height?: number;
  has_b_frames?: number;
  sample_aspect_ratio?: string;
  display_aspect_ratio?: string;
  pix_fmt?: string;
  level?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  chroma_location?: string;
  field_order?: string;
  timecode?: string;
  refs?: number;
  id?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  time_base?: string;
  start_pts?: number;
  start_time?: number;
  duration_ts?: string;
  duration?: string;
  bit_rate?: string;
  max_bit_rate?: string;
  bits_per_raw_sample?: string;
  nb_frames?: string;
  nb_read_frames?: string;
  nb_read_packets?: string;
  sample_fmt?: string;
  sample_rate?: number;
  channels?: number;
  channel_layout?: string;
  bits_per_sample?: number;
  rotation?: string | number;
  tags?: Record<string, unknown>;
  disposition?: FfprobeStreamDisposition;
}

export interface FfprobeFormat {
  [key: string]: unknown;
  filename?: string;
  nb_streams?: number;
  nb_programs?: number;
  format_name?: string;
  format_long_name?: string;
  start_time?: number;
  duration?: number;
  size?: number;
  bit_rate?: number;
  probe_score?: number;
  tags?: Record<string, string | number>;
}

export interface FfprobeData {
  streams: FfprobeStream[];
  format: FfprobeFormat;
  chapters: FfprobeStream[];
}

export type FfprobeCallback = (err: Error | null, data: FfprobeData) => void;

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

export interface ScreenshotsConfig {
  count?: number;
  folder?: string;
  filename?: string;
  timemarks?: number[] | string[];
  timestamps?: number[] | string[];
  fastSeek?: boolean;
  size?: string;
}

export interface AudioVideoFilter {
  filter: string;
  options: string | string[] | Record<string, unknown>;
}

export type PresetFunction = (command: FfmpegCommandThis) => void;

type AudioVideoFilterArg = string | string[] | AudioVideoFilter[];
type FilterSpecArg = string | FilterSpec | (string | FilterSpec)[];
interface PipeOptions {
  end?: boolean;
}
type StringOptionsArg = string | string[];

// Public-API surface mirrored after the original `@types/fluent-ffmpeg`
// (DefinitelyTyped, MIT). Every method below is a thin chainable wrapper
// patched onto FfmpegCommand.prototype by one of the lib/options/*.ts /
// lib/recipes.ts / lib/processor.ts / lib/capabilities.ts modules.
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

  // options/inputs
  mergeAdd(source: string | Readable): this;
  addInput(source: string | Readable): this;
  input(source: string | Readable): this;
  withInputFormat(format: string): this;
  inputFormat(format: string): this;
  fromFormat(format: string): this;
  withInputFps(fps: number): this;
  withInputFPS(fps: number): this;
  withFpsInput(fps: number): this;
  withFPSInput(fps: number): this;
  inputFPS(fps: number): this;
  inputFps(fps: number): this;
  fpsInput(fps: number): this;
  FPSInput(fps: number): this;
  nativeFramerate(): this;
  withNativeFramerate(): this;
  native(): this;
  setStartTime(seek: string | number): this;
  seekInput(seek: string | number): this;
  loop(duration?: string | number): this;

  // options/audio
  withNoAudio(): this;
  noAudio(): this;
  withAudioCodec(codec: string): this;
  audioCodec(codec: string): this;
  withAudioBitrate(bitrate: string | number): this;
  audioBitrate(bitrate: string | number): this;
  withAudioChannels(channels: number): this;
  audioChannels(channels: number): this;
  withAudioFrequency(freq: number): this;
  audioFrequency(freq: number): this;
  withAudioQuality(quality: number): this;
  audioQuality(quality: number): this;
  withAudioFilter(filters: AudioVideoFilterArg): this;
  withAudioFilters(filters: AudioVideoFilterArg): this;
  audioFilter(filters: AudioVideoFilterArg): this;
  audioFilters(filters: AudioVideoFilterArg): this;

  // options/video
  withNoVideo(): this;
  noVideo(): this;
  withVideoCodec(codec: string): this;
  videoCodec(codec: string): this;
  withVideoBitrate(bitrate: string | number, constant?: boolean): this;
  videoBitrate(bitrate: string | number, constant?: boolean): this;
  withVideoFilter(filters: AudioVideoFilterArg): this;
  withVideoFilters(filters: AudioVideoFilterArg): this;
  videoFilter(filters: AudioVideoFilterArg): this;
  videoFilters(filters: AudioVideoFilterArg): this;
  withOutputFps(fps: number): this;
  withOutputFPS(fps: number): this;
  withFpsOutput(fps: number): this;
  withFPSOutput(fps: number): this;
  withFps(fps: number): this;
  withFPS(fps: number): this;
  outputFPS(fps: number): this;
  outputFps(fps: number): this;
  fpsOutput(fps: number): this;
  FPSOutput(fps: number): this;
  fps(fps: number): this;
  FPS(fps: number): this;
  takeFrames(frames: number): this;
  withFrames(frames: number): this;
  frames(frames: number): this;

  // options/videosize
  keepPixelAspect(): this;
  keepDisplayAspect(): this;
  keepDisplayAspectRatio(): this;
  keepDAR(): this;
  withSize(size: string): this;
  setSize(size: string): this;
  size(size: string): this;
  withAspect(aspect: string | number): this;
  withAspectRatio(aspect: string | number): this;
  setAspect(aspect: string | number): this;
  setAspectRatio(aspect: string | number): this;
  aspect(aspect: string | number): this;
  aspectRatio(aspect: string | number): this;
  applyAutopadding(pad?: boolean, color?: string): this;
  applyAutoPadding(pad?: boolean, color?: string): this;
  applyAutopad(pad?: boolean, color?: string): this;
  applyAutoPad(pad?: boolean, color?: string): this;
  withAutopadding(pad?: boolean, color?: string): this;
  withAutoPadding(pad?: boolean, color?: string): this;
  withAutopad(pad?: boolean, color?: string): this;
  withAutoPad(pad?: boolean, color?: string): this;
  autoPad(pad?: boolean, color?: string): this;
  autopad(pad?: boolean, color?: string): this;

  // options/output
  addOutput(target: string | Writable, pipeopts?: PipeOptions): this;
  output(target?: string | Writable, pipeopts?: PipeOptions): this;
  seekOutput(seek: string | number): this;
  seek(seek: string | number): this;
  withDuration(duration: string | number): this;
  setDuration(duration: string | number): this;
  duration(duration: string | number): this;
  toFormat(format: string): this;
  withOutputFormat(format: string): this;
  outputFormat(format: string): this;
  format(format: string): this;
  map(spec: string): this;
  updateFlvMetadata(): this;
  flvmeta(): this;

  // options/custom
  addInputOption(options: string[]): this;
  addInputOption(...options: string[]): this;
  addInputOptions(options: string[]): this;
  addInputOptions(...options: string[]): this;
  withInputOption(options: string[]): this;
  withInputOption(...options: string[]): this;
  withInputOptions(options: string[]): this;
  withInputOptions(...options: string[]): this;
  inputOption(options: string[]): this;
  inputOption(...options: string[]): this;
  inputOptions(options: string[]): this;
  inputOptions(...options: string[]): this;
  addOutputOption(options: string[]): this;
  addOutputOption(...options: string[]): this;
  addOutputOptions(options: string[]): this;
  addOutputOptions(...options: string[]): this;
  addOption(options: string[]): this;
  addOption(...options: string[]): this;
  addOptions(options: string[]): this;
  addOptions(...options: string[]): this;
  withOutputOption(options: string[]): this;
  withOutputOption(...options: string[]): this;
  withOutputOptions(options: string[]): this;
  withOutputOptions(...options: string[]): this;
  withOption(options: string[]): this;
  withOption(...options: string[]): this;
  withOptions(options: string[]): this;
  withOptions(...options: string[]): this;
  outputOption(options: string[]): this;
  outputOption(...options: string[]): this;
  outputOptions(options: string[]): this;
  outputOptions(...options: string[]): this;
  filterGraph(spec: FilterSpecArg, map?: StringOptionsArg): this;
  complexFilter(spec: FilterSpecArg, map?: StringOptionsArg): this;

  // options/misc
  usingPreset(preset: string | PresetFunction): this;
  preset(preset: string | PresetFunction): this;

  // processor
  renice(niceness?: number): this;
  kill(signal?: string): this;
  run(): this;
  exec(): this;
  execute(): this;
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

  // capabilities
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
  getAvailableFilters(
    callback: (err: Error | null, filters?: Record<string, FilterInfo>) => void,
  ): void;
  availableCodecs(callback: (err: Error | null, codecs?: Record<string, CodecInfo>) => void): void;
  getAvailableCodecs(
    callback: (err: Error | null, codecs?: Record<string, CodecInfo>) => void,
  ): void;
  availableEncoders(
    callback: (err: Error | null, encoders?: Record<string, EncoderInfo>) => void,
  ): void;
  getAvailableEncoders(
    callback: (err: Error | null, encoders?: Record<string, EncoderInfo>) => void,
  ): void;
  availableFormats(
    callback: (err: Error | null, formats?: Record<string, FormatInfo>) => void,
  ): void;
  getAvailableFormats(
    callback: (err: Error | null, formats?: Record<string, FormatInfo>) => void,
  ): void;
  _checkCapabilities(callback: (err?: Error | null) => void): void;

  // ffprobe
  ffprobe(callback: FfprobeCallback): void;
  ffprobe(index: number, callback: FfprobeCallback): void;
  ffprobe(options: string[], callback: FfprobeCallback): void;
  ffprobe(index: number, options: string[], callback: FfprobeCallback): void;

  // recipes
  saveToFile(output: string): this;
  save(output: string): this;
  writeToStream(stream: Writable, options?: PipeOptions): Writable;
  pipe(stream?: Writable, options?: PipeOptions): Writable;
  stream(stream: Writable, options?: PipeOptions): Writable;
  takeScreenshots(config: number | ScreenshotsConfig, folder?: string): this;
  thumbnail(config: number | ScreenshotsConfig, folder?: string): this;
  thumbnails(config: number | ScreenshotsConfig, folder?: string): this;
  screenshot(config: number | ScreenshotsConfig, folder?: string): this;
  screenshots(config: number | ScreenshotsConfig, folder?: string): this;
  mergeToFile(target: string | Writable, tmpFolder?: string): this;
  concatenate(target: string | Writable, options?: PipeOptions): this;
  concat(target: string | Writable, options?: PipeOptions): this;

  // typed event listeners (mirrors upstream `@types/fluent-ffmpeg`)
  on(event: 'start', listener: (command: string) => void): this;
  on(event: 'progress', listener: (progress: ProgressReport) => void): this;
  on(event: 'stderr', listener: (line: string) => void): this;
  on(event: 'codecData', listener: (codecData: InputInfo) => void): this;
  on(
    event: 'error',
    listener: (error: Error, stdout: string | null, stderr: string | null) => void,
  ): this;
  on(event: 'filenames', listener: (filenames: string[]) => void): this;
  on(event: 'end', listener: (stdout: string | null, stderr: string | null) => void): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

export type FfmpegCommandPrototype = Record<string, unknown>;
