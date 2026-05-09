import utils from '../utils.js';
import type { FfmpegCommandPrototype, FfmpegCommandThis, FilterSpec } from '../types.js';

function flattenOptions(args: (string | string[])[], doSplit: boolean): string[] {
  const list = args.length > 1 ? (args as string[]) : Array.isArray(args[0]) ? args[0] : [args[0]];
  return list.reduce<string[]>((acc, option) => {
    const split = String(option).split(' ');
    if (doSplit && split.length === 2) {
      acc.push(split[0], split[1]);
    } else {
      acc.push(option as string);
    }
    return acc;
  }, []);
}

function applyCustomOptions(proto: FfmpegCommandPrototype): void {
  proto.addInputOption =
    proto.addInputOptions =
    proto.withInputOption =
    proto.withInputOptions =
    proto.inputOption =
    proto.inputOptions =
      function (this: FfmpegCommandThis, ...rest: (string | string[])[]) {
        if (!this._currentInput) {
          throw new Error('No input specified');
        }
        const doSplit = rest.length === 1;
        this._currentInput!.options(flattenOptions(rest, doSplit));
        return this;
      };

  proto.addOutputOption =
    proto.addOutputOptions =
    proto.addOption =
    proto.addOptions =
    proto.withOutputOption =
    proto.withOutputOptions =
    proto.withOption =
    proto.withOptions =
    proto.outputOption =
    proto.outputOptions =
      function (this: FfmpegCommandThis, ...rest: (string | string[])[]) {
        const doSplit = rest.length === 1;
        this._currentOutput!.options(flattenOptions(rest, doSplit));
        return this;
      };

  proto.filterGraph = proto.complexFilter = function (
    this: FfmpegCommandThis,
    spec: string | FilterSpec | (string | FilterSpec)[],
    map?: string | string[],
  ) {
    this._complexFilters.clear();
    const specs: (string | FilterSpec)[] = Array.isArray(spec) ? spec : [spec];
    this._complexFilters('-filter_complex', utils.makeFilterStrings(specs).join(';'));

    const mapList = Array.isArray(map) ? map : typeof map === 'string' ? [map] : [];
    mapList.forEach((streamSpec) => {
      this._complexFilters('-map', streamSpec.replace(utils.streamRegexp, '[$1]'));
    });

    return this;
  };
}

export = applyCustomOptions;
