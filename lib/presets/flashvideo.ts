import type { PresetLoader } from './types.js';

export const load: PresetLoader = (ffmpeg) => {
  ffmpeg
    .format('flv')
    .flvmeta()
    .size('320x?')
    .videoBitrate('512k')
    .videoCodec('libx264')
    .fps(24)
    .audioBitrate('96k')
    .audioCodec('aac')
    .audioFrequency(22050)
    .audioChannels(2);
};
