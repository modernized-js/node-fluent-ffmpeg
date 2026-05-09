import { expectType, expectAssignable, expectError } from 'tsd';
import ffmpeg from '..';
import type {
  FfmpegCommandThis,
  FfprobeData,
  FfprobeStream,
  FfprobeFormat,
  ScreenshotsConfig,
} from '../lib/types.js';

// --- Chainable methods the consumer reported missing -------------------

expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').inputOptions(['-ss', '00:00:10']));
expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').inputOptions('-ss', '00:00:10'));
expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').inputFormat('mp4'));
expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').outputOptions(['-c:v', 'libx264']));
expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').outputOptions('-c:v', 'libx264'));
expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').format('mp4'));

// Chain composes — each method returns a FfmpegCommand.
expectAssignable<FfmpegCommandThis>(
  ffmpeg('input.mp4').inputOptions(['-ss', '00:00:10']).format('mp4').audioCodec('aac'),
);

// --- Per-field FfprobeStream / FfprobeFormat typing --------------------

ffmpeg.ffprobe('input.mp4', (_err, data) => {
  expectType<FfprobeData>(data);
  expectType<string | undefined>(data.streams[0].codec_type);
  expectType<number | undefined>(data.streams[0].width);
  expectType<number | undefined>(data.streams[0].height);
  expectType<number | undefined>(data.format.duration);
  expectType<string | undefined>(data.format.filename);
  expectAssignable<FfprobeStream>(data.streams[0]);
  expectAssignable<FfprobeFormat>(data.format);
});

// --- ffprobe callback's `data` is non-optional ------------------------

ffmpeg.ffprobe('input.mp4', (err, data) => {
  if (err) return;
  // `data` is FfprobeData (non-optional); no narrowing required.
  expectAssignable<FfprobeStream[]>(data.streams);
});

// --- Common method signatures from upstream ---------------------------

expectAssignable<FfmpegCommandThis>(
  ffmpeg('input.mp4').screenshots({ count: 3, folder: 'out' } satisfies ScreenshotsConfig),
);
expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').size('640x480'));
expectAssignable<FfmpegCommandThis>(ffmpeg('input.mp4').audioCodec('aac').videoCodec('libx264'));

// --- Negative cases (these should fail to type-check) -----------------

// `format(format)` requires the format-name string.
expectError(ffmpeg('input.mp4').format());
// `audioCodec(codec)` requires a string.
expectError(ffmpeg('input.mp4').audioCodec());

// --- Static class methods --------------------------------------------

// `void` is the actual return type of these setters per upstream's
// declarations; the lint rule against `void` in generic position has to
// be relaxed here so tsd can assert the void return.
/* eslint-disable @typescript-eslint/no-invalid-void-type */
expectType<void>(ffmpeg.setFfmpegPath('/usr/bin/ffmpeg'));
expectType<void>(ffmpeg.setFfprobePath('/usr/bin/ffprobe'));
/* eslint-enable @typescript-eslint/no-invalid-void-type */
