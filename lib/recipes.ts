import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import utils from './utils.js';
import type {
  FfmpegCommandPrototype,
  FfmpegCommandThis,
  FfprobeData,
  FfprobeStream,
  FilterSpec,
  PipeOptions,
} from './types.js';

const PERCENT_BASE = 100;
const PIXEL_ROUND_STEP = 2;

export interface ScreenshotConfig {
  count?: number;
  folder?: string;
  filename?: string;
  timemarks?: (string | number)[];
  timestamps?: (string | number)[];
  fastSeek?: boolean;
  size?: string;
}

export interface ResolvedSize {
  fixedSize: RegExpMatchArray | null;
  fixedWidth: RegExpMatchArray | null;
  fixedHeight: RegExpMatchArray | null;
  percentSize: RegExpMatchArray | null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function pickBiggestVideoStream(meta: FfprobeData): FfprobeStream {
  // Fresh seed per call: a shared singleton would let a caller poison later
  // lookups by mutating the returned stream object.
  const seed: FfprobeStream = { width: 0, height: 0 };
  return meta.streams.reduce<FfprobeStream>((biggest, stream) => {
    if (
      stream.codec_type === 'video' &&
      Number(stream.width) * Number(stream.height) > Number(biggest.width) * Number(biggest.height)
    ) {
      return stream;
    }
    return biggest;
  }, seed);
}

function probeFfprobe(self: FfmpegCommandThis): Promise<FfprobeData> {
  return new Promise((resolve, reject) => {
    self.ffprobe((err, data) => (err || !data ? reject(err) : resolve(data)));
  });
}

function memoizeFfprobe(self: FfmpegCommandThis): () => Promise<FfprobeData> {
  let cached: FfprobeData | undefined;
  return async () => {
    if (cached) return cached;
    cached = await probeFfprobe(self);
    return cached;
  };
}

export function normaliseScreenshotConfig(
  input: number | ScreenshotConfig | undefined,
  folder?: string,
): ScreenshotConfig {
  const config: ScreenshotConfig =
    typeof input === 'number' ? { count: input } : { ...(input ?? { count: 1 }) };
  if (!('folder' in config)) config.folder = folder ?? '.';
  if (config.timestamps !== undefined) config.timemarks = config.timestamps;

  if (!config.timemarks) {
    if (!config.count) {
      throw new Error('Cannot take screenshots: neither a count nor a timemark list are specified');
    }
    const interval = PERCENT_BASE / (1 + config.count);
    config.timemarks = Array.from({ length: config.count }, (_, i) => `${interval * (i + 1)}%`);
  }
  return config;
}

export function parseSizeSpec(size: string | undefined): ResolvedSize {
  if (!size) return { fixedSize: null, fixedWidth: null, fixedHeight: null, percentSize: null };
  const fixedSize = size.match(/^(\d+)x(\d+)$/);
  const fixedWidth = size.match(/^(\d+)x\?$/);
  const fixedHeight = size.match(/^\?x(\d+)$/);
  const percentSize = size.match(/^(\d+)%$/);
  if (!fixedSize && !fixedWidth && !fixedHeight && !percentSize) {
    throw new Error(`Invalid size parameter: ${size}`);
  }
  return { fixedSize, fixedWidth, fixedHeight, percentSize };
}

export function isPercentTimemark(t: string | number): boolean {
  return /^[\d.]+%$/.test(String(t));
}

async function resolvePercentTimemarks(
  config: ScreenshotConfig,
  source: string | Readable,
  getMetadata: () => Promise<FfprobeData>,
): Promise<void> {
  if (!config.timemarks!.some(isPercentTimemark)) return;
  if (typeof source !== 'string') {
    throw new Error(
      'Cannot compute screenshot timemarks with an input stream, please specify fixed timemarks',
    );
  }
  const meta = await getMetadata();
  const vstream = pickBiggestVideoStream(meta);
  if (Number(vstream.width) === 0) {
    throw new Error('No video stream in input, cannot take screenshots');
  }
  let duration = Number(vstream.duration);
  if (Number.isNaN(duration)) duration = Number(meta.format.duration);
  if (Number.isNaN(duration)) {
    throw new Error('Could not get input duration, please specify fixed timemarks');
  }
  config.timemarks = config.timemarks!.map((mark) => {
    const m = String(mark).match(/^([\d.]+)%$/);
    return m ? (duration * parseFloat(m[1])) / PERCENT_BASE : mark;
  });
}

export function fixPattern(config: ScreenshotConfig): string {
  let pattern = config.filename ?? 'tn.png';
  if (!pattern.includes('.')) pattern += '.png';
  if (config.timemarks!.length > 1 && !/%(s|0*i)/.test(pattern)) {
    const ext = path.extname(pattern);
    pattern = path.join(path.dirname(pattern), `${path.basename(pattern, ext)}_%i${ext}`);
  }
  return pattern;
}

export function replaceFilenameTokens(pattern: string, source: string | Readable): string {
  if (!/%[bf]/.test(pattern)) return pattern;
  if (typeof source !== 'string') {
    throw new Error('Cannot replace %f or %b when using an input stream');
  }
  return pattern
    .replace(/%f/g, path.basename(source))
    .replace(/%b/g, path.basename(source, path.extname(source)));
}

export interface SizeForTokens {
  width: number;
  height: number;
}

async function computeSizeForTokens(
  pattern: string,
  resolvedSize: ResolvedSize,
  getMetadata: () => Promise<FfprobeData>,
): Promise<SizeForTokens> {
  if (!/%[whr]/.test(pattern)) return { width: -1, height: -1 };
  const { fixedSize, fixedWidth, fixedHeight, percentSize } = resolvedSize;
  if (fixedSize) return { width: Number(fixedSize[1]), height: Number(fixedSize[2]) };

  let meta: FfprobeData;
  try {
    meta = await getMetadata();
  } catch {
    throw new Error('Could not determine video resolution to replace %w, %h or %r');
  }
  const vstream = pickBiggestVideoStream(meta);
  if (Number(vstream.width) === 0) {
    throw new Error('No video stream in input, cannot replace %w, %h or %r');
  }
  let width = Number(vstream.width);
  let height = Number(vstream.height);

  if (fixedWidth) {
    height = (height * Number(fixedWidth[1])) / width;
    width = Number(fixedWidth[1]);
  } else if (fixedHeight) {
    width = (width * Number(fixedHeight[1])) / height;
    height = Number(fixedHeight[1]);
  } else if (percentSize) {
    const ratio = Number(percentSize[1]) / PERCENT_BASE;
    width *= ratio;
    height *= ratio;
  }
  return {
    width: Math.round(width / PIXEL_ROUND_STEP) * PIXEL_ROUND_STEP,
    height: Math.round(height / PIXEL_ROUND_STEP) * PIXEL_ROUND_STEP,
  };
}

export function replaceSizeTokens(pattern: string, size: SizeForTokens): string {
  return pattern
    .replace(/%r/g, '%wx%h')
    .replace(/%w/g, String(size.width))
    .replace(/%h/g, String(size.height));
}

export function generateFilenames(pattern: string, timemarks: (string | number)[]): string[] {
  return timemarks.map((t, i) =>
    pattern
      .replace(/%s/g, String(utils.timemarkToSeconds(t)))
      .replace(/%(0*)i/g, (_match, padding: string) => {
        const idx = String(i + 1);
        return padding.slice(0, Math.max(0, padding.length + 1 - idx.length)) + idx;
      }),
  );
}

async function ensureDirectory(folder: string): Promise<void> {
  if (await fileExists(folder)) return;
  await mkdir(folder);
}

interface SplitFilter extends FilterSpec {
  filter: 'split';
  options: number;
  outputs: string[];
  inputs?: string;
}

function buildScreenshotFilters(
  self: FfmpegCommandThis,
  config: ScreenshotConfig,
): { filters: FilterSpec[]; split: SplitFilter } {
  const count = config.timemarks!.length;
  const split: SplitFilter = { filter: 'split', options: count, outputs: [] };
  let filters: FilterSpec[] = [split];

  if (config.size !== undefined) {
    self.size(config.size);
    // The `as FilterSpec[]` cast stays until ArgList becomes generic in
    // its element type. Here sizeFilters' callsite stores FilterSpec
    // entries; ArgList.get() returns the union ArgValue[].
    const sizeFilters = (self._currentOutput!.sizeFilters.get() as FilterSpec[]).map((f, i) => {
      if (i > 0) f.inputs = `size${i - 1}`;
      f.outputs = `size${i}`;
      return f;
    });
    split.inputs = `size${sizeFilters.length - 1}`;
    filters = [...sizeFilters, split];
    self._currentOutput!.sizeFilters.clear();
  }
  return { filters, split };
}

function attachScreenshotOutputs(
  self: FfmpegCommandThis,
  config: ScreenshotConfig,
  filenames: string[],
  split: SplitFilter,
): void {
  let first = 0;
  config.timemarks!.forEach((mark, i) => {
    const stream = `screen${i}`;
    split.outputs.push(stream);
    if (i === 0) {
      first = Number(mark);
      self.seekInput(first);
    }
    self.output(path.join(config.folder!, filenames[i])).frames(1).map(stream);
    if (i > 0) self.seek(Number(mark) - first);
  });
}

function applyRecipes(proto: FfmpegCommandPrototype): void {
  proto.saveToFile = proto.save = function (this: FfmpegCommandThis, output: string) {
    this.output(output).run();
    return this;
  };

  proto.writeToStream =
    proto.pipe =
    proto.stream =
      function (
        this: FfmpegCommandThis,
        streamArg?: Writable | PipeOptions,
        options?: PipeOptions,
      ) {
        // Distinguish a Writable-stream argument from a plain options
        // object via duck-typing on `.pipe`. `'writable' in X` alone
        // does not narrow the union for TypeScript, so a type predicate
        // is required.
        const isWritableStream = (v: unknown): v is Writable => {
          if (typeof v !== 'object' || v === null) return false;
          if (!('pipe' in v)) return false;
          return typeof v.pipe === 'function';
        };

        let stream: Writable | undefined;
        let opts = options;
        if (isWritableStream(streamArg)) {
          stream = streamArg;
        } else if (streamArg) {
          opts = streamArg;
        }
        if (!stream) stream = new PassThrough();
        this.output(stream, opts).run();
        return stream;
      };

  proto.takeScreenshots =
    proto.thumbnail =
    proto.thumbnails =
    proto.screenshot =
    proto.screenshots =
      function (this: FfmpegCommandThis, configArg?: number | ScreenshotConfig, folder?: string) {
        const source = this._currentInput!.source;
        const config = normaliseScreenshotConfig(configArg, folder);
        const resolvedSize = parseSizeSpec(config.size);
        const getMetadata = memoizeFfprobe(this);

        (async () => {
          await resolvePercentTimemarks(config, source, getMetadata);
          config.timemarks = config
            .timemarks!.map((m) => utils.timemarkToSeconds(m))
            .sort((a, b) => a - b);

          let pattern = fixPattern(config);
          pattern = replaceFilenameTokens(pattern, source);
          const size = await computeSizeForTokens(pattern, resolvedSize, getMetadata);
          pattern = replaceSizeTokens(pattern, size);
          const filenames = generateFilenames(pattern, config.timemarks);
          this.emit('filenames', filenames);
          await ensureDirectory(config.folder!);
          return filenames;
        })().then(
          (filenames) => {
            const { filters, split } = buildScreenshotFilters(this, config);
            attachScreenshotOutputs(this, config, filenames, split);
            this.complexFilter(filters);
            this.run();
          },
          (err: Error) => this.emit('error', err),
        );

        return this;
      };

  proto.mergeToFile =
    proto.concatenate =
    proto.concat =
      function (this: FfmpegCommandThis, target: string | Writable, options?: PipeOptions) {
        const fileInput = this._inputs.find((input) => !input.isStream);
        if (!fileInput) {
          this.emit('error', new Error('No file input for concat'));
          return this;
        }
        this.ffprobe(this._inputs.indexOf(fileInput), (err, data) => {
          if (err || !data) {
            this.emit('error', err);
            return;
          }
          const hasAudio = data.streams.some((s) => s.codec_type === 'audio');
          const hasVideo = data.streams.some((s) => s.codec_type === 'video');
          this.output(target, options)
            .complexFilter({
              filter: 'concat',
              options: { n: this._inputs.length, v: hasVideo ? 1 : 0, a: hasAudio ? 1 : 0 },
            })
            .run();
        });
        return this;
      };
}

export default applyRecipes;
