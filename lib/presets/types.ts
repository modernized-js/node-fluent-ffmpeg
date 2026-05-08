export interface PresetTarget {
  format(fmt: string): PresetTarget;
  flvmeta(): PresetTarget;
  size(s: string): PresetTarget;
  fps(rate: number): PresetTarget;
  videoBitrate(rate: string): PresetTarget;
  videoCodec(codec: string): PresetTarget;
  audioBitrate(rate: string): PresetTarget;
  audioCodec(codec: string): PresetTarget;
  audioChannels(channels: number): PresetTarget;
  audioFrequency(freq: number): PresetTarget;
  outputOptions(opts: string[]): PresetTarget;
}

export type PresetLoader = (ffmpeg: PresetTarget) => void;
