import type {
  FfmpegCommandPrototype,
  FfmpegCommandThis,
  FilterSpec,
  OutputState,
} from '../types.js';

function getScalePadFilters(
  width: number,
  height: number,
  aspect: number,
  color: string,
): FilterSpec[] {
  return [
    {
      filter: 'scale',
      options: {
        w: `if(gt(a,${aspect}),${width},trunc(${height}*a/2)*2)`,
        h: `if(lt(a,${aspect}),${height},trunc(${width}/a/2)*2)`,
      },
    },
    {
      filter: 'pad',
      options: {
        w: width,
        h: height,
        x: `if(gt(a,${aspect}),0,(${width}-iw)/2)`,
        y: `if(lt(a,${aspect}),0,(${height}-ih)/2)`,
        color,
      },
    },
  ];
}

function percentScaleFilter(percent: string): FilterSpec[] {
  const ratio = Number(percent) / 100;
  return [
    {
      filter: 'scale',
      options: {
        w: `trunc(iw*${ratio}/2)*2`,
        h: `trunc(ih*${ratio}/2)*2`,
      },
    },
  ];
}

function fixedSizeFilters(width: number, height: number, pad: string | false): FilterSpec[] {
  if (pad) {
    return getScalePadFilters(width, height, width / height, pad);
  }
  return [{ filter: 'scale', options: { w: width, h: height } }];
}

function partialSizeFilters(
  fixedWidth: RegExpMatchArray | null,
  fixedHeight: RegExpMatchArray | null,
  data: NonNullable<OutputState['sizeData']>,
): FilterSpec[] {
  const widthSpec = fixedWidth ? Number(fixedWidth[1]) : undefined;
  const heightSpec = fixedHeight ? Number(fixedHeight[1]) : undefined;

  if (data.aspect !== undefined) {
    const w = Math.round((widthSpec ?? heightSpec! * data.aspect) / 2) * 2;
    const h = Math.round((heightSpec ?? widthSpec! / data.aspect) / 2) * 2;
    return fixedSizeFilters(w, h, data.pad ?? false);
  }

  if (widthSpec !== undefined) {
    return [
      {
        filter: 'scale',
        options: { w: Math.round(widthSpec / 2) * 2, h: 'trunc(ow/a/2)*2' },
      },
    ];
  }
  return [
    {
      filter: 'scale',
      options: { w: 'trunc(oh*a/2)*2', h: Math.round(heightSpec! / 2) * 2 },
    },
  ];
}

function createSizeFilters(
  output: OutputState,
  key: 'size' | 'aspect' | 'pad',
  value: string | number | false,
): FilterSpec[] {
  output.sizeData ??= {};
  const data = output.sizeData;
  data[key] = value as never;

  if (data.size === undefined) return [];

  const fixedSize = data.size.match(/([0-9]+)x([0-9]+)/);
  const fixedWidth = data.size.match(/([0-9]+)x\?/);
  const fixedHeight = data.size.match(/\?x([0-9]+)/);
  const percentRatio = data.size.match(/\b([0-9]{1,3})%/);

  if (percentRatio) return percentScaleFilter(percentRatio[1]);
  if (fixedSize) {
    const w = Math.round(Number(fixedSize[1]) / 2) * 2;
    const h = Math.round(Number(fixedSize[2]) / 2) * 2;
    return fixedSizeFilters(w, h, data.pad ?? false);
  }
  if (fixedWidth || fixedHeight) {
    return partialSizeFilters(fixedWidth, fixedHeight, data);
  }
  throw new Error(`Invalid size specified: ${data.size}`);
}

function applySizeFilters(output: OutputState, filters: FilterSpec[]): void {
  output.sizeFilters.clear();
  output.sizeFilters(filters);
}

function applyVideoSizeOptions(proto: FfmpegCommandPrototype): void {
  proto.keepPixelAspect =
    proto.keepDisplayAspect =
    proto.keepDisplayAspectRatio =
    proto.keepDAR =
      function (this: FfmpegCommandThis) {
        return this.videoFilters([
          {
            filter: 'scale',
            options: {
              w: 'if(gt(sar,1),iw*sar,iw)',
              h: 'if(lt(sar,1),ih/sar,ih)',
            },
          },
          { filter: 'setsar', options: '1' },
        ]);
      };

  proto.withSize =
    proto.setSize =
    proto.size =
      function (this: FfmpegCommandThis, size: string) {
        applySizeFilters(
          this._currentOutput!,
          createSizeFilters(this._currentOutput!, 'size', size),
        );
        return this;
      };

  proto.withAspect =
    proto.withAspectRatio =
    proto.setAspect =
    proto.setAspectRatio =
    proto.aspect =
    proto.aspectRatio =
      function (this: FfmpegCommandThis, aspect: string | number) {
        let a = Number(aspect);
        if (Number.isNaN(a)) {
          const match = String(aspect).match(/^(\d+):(\d+)$/);
          if (!match) {
            throw new Error(`Invalid aspect ratio: ${aspect}`);
          }
          a = Number(match[1]) / Number(match[2]);
        }
        applySizeFilters(
          this._currentOutput!,
          createSizeFilters(this._currentOutput!, 'aspect', a),
        );
        return this;
      };

  proto.applyAutopadding =
    proto.applyAutoPadding =
    proto.applyAutopad =
    proto.applyAutoPad =
    proto.withAutopadding =
    proto.withAutoPadding =
    proto.withAutopad =
    proto.withAutoPad =
    proto.autoPad =
    proto.autopad =
      function (this: FfmpegCommandThis, pad?: boolean | string, color?: string) {
        let enabled: boolean;
        let actualColor = color;
        if (typeof pad === 'string') {
          actualColor = pad;
          enabled = true;
        } else {
          enabled = pad ?? true;
        }
        const value: string | false = enabled ? (actualColor ?? 'black') : false;
        applySizeFilters(
          this._currentOutput!,
          createSizeFilters(this._currentOutput!, 'pad', value),
        );
        return this;
      };
}

export = applyVideoSizeOptions;
