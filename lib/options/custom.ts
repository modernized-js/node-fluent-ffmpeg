import utils from '../utils.js';
import type { FfmpegCommandPrototype, FfmpegCommandThis, FilterSpec } from '../types.js';

/**
 * Normalise the variadic shape of `inputOptions` / `outputOptions` /
 * `addOption` / etc. into a flat string[] suitable for ffmpeg argv.
 *
 * Three invocation forms (preserved from upstream `fluent-ffmpeg`):
 *
 *   cmd.inputOption('-ss 00:00:10')                // single string with space
 *   cmd.inputOptions('-c:v', 'libx264')            // positional varargs
 *   cmd.inputOptions(['-flag1 val1', '-flag2 v2']) // array of flag-value pairs
 *   cmd.inputOptions(['-headers', 'Cookie: a=b'])  // array of pre-split tokens
 *
 * The legacy split-on-space behaviour for array entries was over-eager:
 * `['-headers', 'Cookie: a=b']` had its second item split into
 * `['Cookie:', 'a=b']`, mangling the header value (upstream issue
 * #1151, open since 2021). The fix below splits an entry only when
 * its first part starts with `-` — distinguishing a flag-value pair
 * (`'-me_method umh'`, valid preset shape) from a value-with-space
 * (`'Cookie: a=b'`, raw user data).
 */
export function flattenOptions(args: (string | string[])[]): string[] {
  const splitIfFlagValuePair = (raw: string): string[] => {
    const parts = raw.split(' ');
    if (parts.length === 2 && parts[0].startsWith('-')) return parts;
    return [raw];
  };

  // Array form: split each entry conditionally (legacy preset shape
  // `'-me_method umh'` still splits, raw values like `'Cookie: a=b'` do not).
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0].flatMap(splitIfFlagValuePair);
  }
  // Positional form: a single string with one space splits (legacy
  // `'-ss 00:00:10'`); multiple positional args are each an argv token.
  if (args.length === 1) {
    const only = args[0];
    return Array.isArray(only) ? [...only] : splitIfFlagValuePair(only);
  }
  return args.reduce<string[]>((acc, raw) => {
    if (Array.isArray(raw)) acc.push(...raw);
    else acc.push(raw);
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
        this._currentInput!.options(flattenOptions(rest));
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
        this._currentOutput!.options(flattenOptions(rest));
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

export default applyCustomOptions;
