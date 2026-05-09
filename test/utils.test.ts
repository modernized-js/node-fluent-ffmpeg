import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import utils from '../lib/utils.js';
import type { CodecState, ProgressReport } from '../lib/types.js';

describe('utils.isWindows', () => {
  it('is a boolean reflecting the host platform', () => {
    assert.equal(typeof utils.isWindows, 'boolean');
    assert.equal(utils.isWindows, /win(32|64)/.test(process.platform));
  });
});

describe('utils.streamRegexp', () => {
  it('strips a single bracket pair from a stream specifier', () => {
    assert.equal('input'.replace(utils.streamRegexp, '[$1]'), '[input]');
    assert.equal('[input]'.replace(utils.streamRegexp, '[$1]'), '[input]');
  });

  it('handles an empty specifier', () => {
    assert.equal(''.replace(utils.streamRegexp, '[$1]'), '[]');
  });

  it('only strips outer brackets, not inner ones', () => {
    assert.equal('[a[b]c]'.replace(utils.streamRegexp, '[$1]'), '[a[b]c]');
  });
});

describe('utils.copy', () => {
  it('copies all enumerable keys from source to dest', () => {
    const dest: Record<string, unknown> = {};
    utils.copy({ a: 1, b: 'x', c: true }, dest);
    assert.deepEqual(dest, { a: 1, b: 'x', c: true });
  });

  it('overwrites existing keys in dest', () => {
    const dest: Record<string, unknown> = { a: 999, untouched: 'yes' };
    utils.copy({ a: 1, b: 'x' }, dest);
    assert.deepEqual(dest, { a: 1, b: 'x', untouched: 'yes' });
  });

  it('is a shallow copy (does not deep-clone nested values)', () => {
    const inner = { nested: 'shared' };
    const dest: Record<string, unknown> = {};
    utils.copy({ outer: inner }, dest);
    assert.equal(dest.outer, inner);
  });

  it('handles an empty source', () => {
    const dest: Record<string, unknown> = { a: 1 };
    utils.copy({}, dest);
    assert.deepEqual(dest, { a: 1 });
  });

  it('treats undefined values as actual values to copy', () => {
    const dest: Record<string, unknown> = { x: 'before' };
    utils.copy({ x: undefined }, dest);
    assert.ok('x' in dest);
    assert.equal(dest.x, undefined);
  });

  it('does not copy non-enumerable keys', () => {
    const source = {};
    Object.defineProperty(source, 'hidden', { value: 1, enumerable: false });
    const dest: Record<string, unknown> = {};
    utils.copy(source, dest);
    assert.equal('hidden' in dest, false);
  });
});

describe('utils.args (argument list helper)', () => {
  it('Should add arguments to the list', () => {
    const args = utils.args();
    args('-one');
    args('-two', 'two-param');
    args('-three', 'three-param1', 'three-param2');
    args(['-four', 'four-param', '-five', '-five-param']);
    assert.equal(args.get().length, 10);
  });

  it('Should return the argument list', () => {
    const args = utils.args();
    args('-one');
    args('-two', 'two-param');
    args('-three', 'three-param1', 'three-param2');
    args(['-four', 'four-param', '-five', '-five-param']);

    const arr = args.get();
    assert.ok(Array.isArray(arr));
    assert.equal(arr.length, 10);
    assert.equal(arr.indexOf('-three'), 3);
    assert.equal(arr.indexOf('four-param'), 7);
  });

  it('Should clear the argument list', () => {
    const args = utils.args();
    args('-one');
    args('-two', 'two-param');
    args('-three', 'three-param1', 'three-param2');
    args(['-four', 'four-param', '-five', '-five-param']);
    args.clear();
    assert.equal(args.get().length, 0);
  });

  it('Should retrieve arguments from the list', () => {
    const args = utils.args();
    args('-one');
    args('-two', 'two-param');
    args('-three', 'three-param1', 'three-param2');
    args(['-four', 'four-param', '-five', '-five-param']);

    const one = args.find('-one');
    assert.ok(Array.isArray(one));
    assert.equal(one!.length, 0);

    const two = args.find('-two', 1);
    assert.ok(Array.isArray(two));
    assert.equal(two!.length, 1);
    assert.equal(two![0], 'two-param');

    const three = args.find('-three', 2);
    assert.ok(Array.isArray(three));
    assert.equal(three!.length, 2);
    assert.equal(three![0], 'three-param1');
    assert.equal(three![1], 'three-param2');

    const nope = args.find('-nope', 2);
    assert.equal(typeof nope, 'undefined');
  });

  it('Should remove arguments from the list', () => {
    const args = utils.args();
    args('-one');
    args('-two', 'two-param');
    args('-three', 'three-param1', 'three-param2');
    args(['-four', 'four-param', '-five', '-five-param']);

    args.remove('-four', 1);
    let arr = args.get();
    assert.equal(arr.length, 8);
    assert.equal(arr[5], 'three-param2');
    assert.equal(arr[6], '-five');

    args.remove('-one');
    arr = args.get();
    assert.equal(arr.length, 7);
    assert.equal(arr[0], '-two');

    args.remove('-three', 2);
    arr = args.get();
    assert.equal(arr.length, 4);
    assert.equal(arr[1], 'two-param');
    assert.equal(arr[2], '-five');
  });

  it('starts empty', () => {
    const args = utils.args();
    assert.deepEqual(args.get(), []);
  });

  it('accepts numeric values alongside strings', () => {
    const args = utils.args();
    args('-r', 30);
    args('-vframes', 100);
    assert.deepEqual(args.get(), ['-r', 30, '-vframes', 100]);
  });

  it('treats a single-array argument as the whole list (not as one element)', () => {
    const args = utils.args();
    args(['-x', '1', '-y', '2']);
    assert.deepEqual(args.get(), ['-x', '1', '-y', '2']);
  });

  it('treats multiple arrays as concatenated list elements (the ambiguous case)', () => {
    const args = utils.args();
    // Two arrays in one call → falls through to the .concat(args) branch,
    // pushing the arrays themselves as nested elements (matches legacy behaviour).
    args(['-a'], ['-b']);
    const out = args.get();
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], ['-a']);
    assert.deepEqual(out[1], ['-b']);
  });

  it('find with count larger than the remaining list returns whatever is left', () => {
    const args = utils.args();
    args('-flag', 'a', 'b');
    assert.deepEqual(args.find('-flag', 100), ['a', 'b']);
  });

  it('find at the end of the list with no following items returns []', () => {
    const args = utils.args();
    args('-trailing');
    assert.deepEqual(args.find('-trailing', 5), []);
  });

  it('remove with no count drops only the matched item', () => {
    const args = utils.args();
    args('-a', '1', '-b', '2');
    args.remove('-a');
    assert.deepEqual(args.get(), ['1', '-b', '2']);
  });

  it('remove with count larger than the remaining list trims to end', () => {
    const args = utils.args();
    args('-flag', 'a');
    args.remove('-flag', 100);
    assert.deepEqual(args.get(), []);
  });

  it('remove of a missing item is a no-op', () => {
    const args = utils.args();
    args('-a', '1');
    args.remove('-missing', 5);
    assert.deepEqual(args.get(), ['-a', '1']);
  });

  it('clone produces an independent copy of the current state', () => {
    const args = utils.args();
    args('-a', 'one');
    const clone = args.clone();
    args('-b', 'two');
    assert.deepEqual(clone.get(), ['-a', 'one']);
    assert.deepEqual(args.get(), ['-a', 'one', '-b', 'two']);
  });

  it('clone of an empty list is also empty and independent', () => {
    const args = utils.args();
    const clone = args.clone();
    args('-a');
    assert.deepEqual(clone.get(), []);
    assert.deepEqual(args.get(), ['-a']);
  });
});

describe('utils.makeFilterStrings', () => {
  it('returns plain strings unchanged', () => {
    assert.deepEqual(utils.makeFilterStrings(['scale=320:240', 'volume=0.5']), [
      'scale=320:240',
      'volume=0.5',
    ]);
  });

  it('emits filter name only when no inputs/outputs/options are given', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'anull' }]), ['anull']);
  });

  it('formats a filter with a string options payload', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'scale', options: '320:240' }]), [
      'scale=320:240',
    ]);
  });

  it('formats a filter with a numeric options payload', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'split', options: 3 }]), ['split=3']);
  });

  it('formats a filter with an unnamed-options array', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'foo', options: ['a', 'b', 'c'] }]), [
      'foo=a:b:c',
    ]);
  });

  it('formats a filter with a named-options object', () => {
    assert.deepEqual(
      utils.makeFilterStrings([{ filter: 'pad', options: { w: 320, h: 240, color: 'black' } }]),
      ['pad=w=320:h=240:color=black'],
    );
  });

  it('escapes commas inside an unnamed-options array', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'f', options: ['a,b', 'c'] }]), [
      "f='a,b':c",
    ]);
  });

  it('escapes commas inside a named-options object value', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'f', options: { x: 'a,b', y: 'c' } }]), [
      "f=x='a,b':y=c",
    ]);
  });

  it('treats an empty options object as no options', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'foo', options: {} }]), ['foo']);
  });

  it('wraps a single inputs string in brackets', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'foo', inputs: 'in' }]), ['[in]foo']);
  });

  it('wraps every entry of an inputs array in brackets', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'concat', inputs: ['a', 'b'] }]), [
      '[a][b]concat',
    ]);
  });

  it('preserves outer brackets if already present in an inputs entry', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'foo', inputs: '[in]' }]), ['[in]foo']);
  });

  it('wraps outputs the same way as inputs', () => {
    assert.deepEqual(utils.makeFilterStrings([{ filter: 'split', outputs: ['o1', 'o2'] }]), [
      'split[o1][o2]',
    ]);
  });

  it('combines inputs + filter + options + outputs in that order', () => {
    assert.deepEqual(
      utils.makeFilterStrings([
        { filter: 'overlay', inputs: ['a', 'b'], options: '0:0', outputs: 'out' },
      ]),
      ['[a][b]overlay=0:0[out]'],
    );
  });

  it('returns an empty array for an empty filter list', () => {
    assert.deepEqual(utils.makeFilterStrings([]), []);
  });

  it('handles a mixed list of strings and FilterSpec objects', () => {
    assert.deepEqual(
      utils.makeFilterStrings(['verbatim=1', { filter: 'scale', options: '320:240' }]),
      ['verbatim=1', 'scale=320:240'],
    );
  });
});

describe('utils.timemarkToSeconds', () => {
  it('should correctly convert a simple timestamp', () => {
    assert.equal(utils.timemarkToSeconds('00:02:00.00'), 120);
  });
  it('should correctly convert a complex timestamp', () => {
    assert.equal(utils.timemarkToSeconds('00:08:09.10'), 489.1);
  });
  it('should correctly convert a simple float string timestamp', () => {
    assert.equal(utils.timemarkToSeconds('132.44'), 132.44);
  });
  it('should correctly convert a simple float timestamp', () => {
    assert.equal(utils.timemarkToSeconds(132.44), 132.44);
  });

  it('returns zero for "00:00:00"', () => {
    assert.equal(utils.timemarkToSeconds('00:00:00'), 0);
  });

  it('returns zero for the numeric input 0', () => {
    assert.equal(utils.timemarkToSeconds(0), 0);
  });

  it('passes negative numbers through verbatim', () => {
    assert.equal(utils.timemarkToSeconds(-1.5), -1.5);
  });

  it('handles MM:SS form (no hours)', () => {
    assert.equal(utils.timemarkToSeconds('02:30'), 150);
  });

  it('handles HH:MM:SS form with a multi-hour value', () => {
    assert.equal(utils.timemarkToSeconds('10:00:00'), 36000);
  });

  it('treats a fractional-only string ("0.5") as seconds', () => {
    assert.equal(utils.timemarkToSeconds('0.5'), 0.5);
  });

  it('keeps fractional seconds in HH:MM:SS.xxx form', () => {
    assert.equal(utils.timemarkToSeconds('00:00:01.250'), 1.25);
  });

  it('returns NaN for a non-numeric colon-form input', () => {
    assert.equal(Number.isNaN(utils.timemarkToSeconds('aa:bb:cc')), true);
  });
});

describe('utils.extractError', () => {
  it('returns lines that do not start with space or [', () => {
    const stderr = ['error one', 'error two', 'error three'].join('\n');
    assert.equal(utils.extractError(stderr), 'error one\nerror two\nerror three');
  });

  it('resets the accumulator when a line starts with a space', () => {
    const stderr = ['kept', '  noisy detail', 'kept-after-reset'].join('\n');
    assert.equal(utils.extractError(stderr), 'kept-after-reset');
  });

  it('resets the accumulator when a line starts with [', () => {
    const stderr = ['old', '[bracketed]', 'new'].join('\n');
    assert.equal(utils.extractError(stderr), 'new');
  });

  it('handles \\r\\n line endings', () => {
    assert.equal(utils.extractError('a\r\nb\r\nc'), 'a\nb\nc');
  });

  it('handles a single line', () => {
    assert.equal(utils.extractError('only line'), 'only line');
  });

  it('returns the empty string when given the empty string', () => {
    assert.equal(utils.extractError(''), '');
  });

  it('handles multiple consecutive resets', () => {
    const stderr = ['first', ' reset', '[reset]', '  also-reset', 'final'].join('\n');
    assert.equal(utils.extractError(stderr), 'final');
  });

  it('treats an empty line as a kept entry', () => {
    // charAt(0) on '' is '', so the line is kept rather than reset.
    assert.equal(utils.extractError('a\n\nb'), 'a\n\nb');
  });
});

describe('utils.linesRing', () => {
  it('should append lines', () => {
    const ring = utils.linesRing(100);
    ring.append('foo\nbar\nbaz\n');
    ring.append('foo\nbar\nbaz\n');
    assert.equal(ring.get(), 'foo\nbar\nbaz\nfoo\nbar\nbaz\n');
  });

  it('should append partial lines', () => {
    const ring = utils.linesRing(100);
    ring.append('foo');
    ring.append('bar\nbaz');
    ring.append('moo');
    assert.equal(ring.get(), 'foobar\nbazmoo');
  });

  it('should call line callbacks', () => {
    const lines: string[] = [];
    const lines2: string[] = [];

    const ring = utils.linesRing(100);
    ring.callback((l) => lines.push(l));
    ring.callback((l) => lines2.push(l));

    ring.append('foo\nbar\nbaz');
    assert.deepEqual(lines, ['foo', 'bar']);
    assert.deepEqual(lines2, ['foo', 'bar']);

    ring.append('moo\nmeow\n');
    assert.deepEqual(lines, ['foo', 'bar', 'bazmoo', 'meow']);
    assert.deepEqual(lines2, ['foo', 'bar', 'bazmoo', 'meow']);
  });

  it('should close correctly', () => {
    const lines: string[] = [];
    const ring = utils.linesRing(100);
    ring.callback((l) => lines.push(l));

    ring.append('foo\nbar\nbaz');
    assert.deepEqual(lines, ['foo', 'bar']);

    ring.close();
    assert.deepEqual(lines, ['foo', 'bar', 'baz']);

    ring.append('moo\nmeow\n');
    assert.deepEqual(lines, ['foo', 'bar', 'baz']);
    assert.equal(ring.get(), 'foo\nbar\nbaz');
  });

  it('should limit lines', () => {
    const ring = utils.linesRing(2);
    ring.append('foo\nbar\nbaz');
    assert.equal(ring.get(), 'bar\nbaz');
    ring.append('foo\nbar');
    assert.equal(ring.get(), 'bazfoo\nbar');
  });

  it('should allow unlimited lines', () => {
    const ring = utils.linesRing(0);
    ring.append('foo\nbar\nbaz');
    assert.equal(ring.get(), 'foo\nbar\nbaz');
    ring.append('foo\nbar');
    assert.equal(ring.get(), 'foo\nbar\nbazfoo\nbar');
  });

  it('keeps no completed lines when maxLines is 1 (the "max=maxLines-1=0" quirk)', () => {
    // The legacy formula `max = maxLines - 1` means maxLines=1 caps the
    // committed-line history at 0 — only the not-yet-newlined `current`
    // buffer survives. Documented here so the corner is pinned.
    const ring = utils.linesRing(1);
    ring.append('a\nb\nc\n');
    assert.equal(ring.get(), '');
  });

  it('replays historical lines to a callback registered after data arrived', () => {
    const ring = utils.linesRing(100);
    ring.append('a\nb\nc');
    const seen: string[] = [];
    ring.callback((l) => seen.push(l));
    assert.deepEqual(seen, ['a', 'b']);
  });

  it('accepts Buffer input', () => {
    const ring = utils.linesRing(100);
    ring.append(Buffer.from('hello\nworld'));
    assert.equal(ring.get(), 'hello\nworld');
  });

  it('handles \\r\\n line endings', () => {
    const ring = utils.linesRing(100);
    ring.append('a\r\nb\r\nc');
    assert.equal(ring.get(), 'a\nb\nc');
  });

  it('handles \\r line endings', () => {
    const ring = utils.linesRing(100);
    ring.append('a\rb\rc');
    assert.equal(ring.get(), 'a\nb\nc');
  });

  it('ignores empty appends', () => {
    const ring = utils.linesRing(100);
    ring.append('');
    ring.append('seed');
    ring.append('');
    assert.equal(ring.get(), 'seed');
  });

  it('ignores appends after close', () => {
    const ring = utils.linesRing(100);
    ring.append('a\nb');
    ring.close();
    ring.append('c\nd');
    assert.equal(ring.get(), 'a\nb');
  });

  it('close is idempotent', () => {
    const seen: string[] = [];
    const ring = utils.linesRing(100);
    ring.callback((l) => seen.push(l));
    ring.append('a\nb');
    ring.close();
    ring.close();
    assert.deepEqual(seen, ['a', 'b']);
  });

  it('close flushes the trailing-newline empty buffer as a final line', () => {
    // The trailing '\n' in 'a\nb\n' leaves current = '' (an empty 'fragment
    // after the last newline'). close() emits that empty fragment, which the
    // join then re-attaches as a trailing newline.
    const ring = utils.linesRing(100);
    ring.append('a\nb\n');
    ring.close();
    assert.equal(ring.get(), 'a\nb\n');
  });
});

describe('utils.extractCodecData', () => {
  interface RecordedEvent {
    event: string;
    args: unknown[];
  }
  interface MockEmitter {
    events: RecordedEvent[];
    emit: (event: string, ...args: unknown[]) => boolean;
  }
  function makeEmitter(): MockEmitter {
    const events: RecordedEvent[] = [];
    return {
      events,
      emit: (event, ...args) => {
        events.push({ event, args });
        return true;
      },
    };
  }

  it('returns false and stays silent on a line that matches no pattern', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    assert.equal(utils.extractCodecData(command, '   noise', state), false);
    assert.deepEqual(command.events, []);
  });

  it('starts an input record on an "Input #0, fmt," line', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, mov,mp4,m4a, from foo.mp4', state);
    assert.deepEqual(state, {
      inputStack: [{ format: 'mov,mp4,m4a', audio: '', video: '', duration: '' }],
      inputIndex: 0,
      inInput: true,
    });
  });

  it('captures duration on a Duration: line while inInput', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, avi, from foo.avi:', state);
    utils.extractCodecData(command, '  Duration: 00:00:10.00, start: 0.000000', state);
    assert.equal(state.inputStack?.[0]?.duration, '00:00:10.00');
  });

  it('captures audio details on an Audio: line while inInput', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, avi, from foo.avi:', state);
    utils.extractCodecData(command, '  Stream #0:0: Audio: aac, 44100 Hz, stereo', state);
    assert.equal(state.inputStack?.[0]?.audio, 'aac');
    assert.deepEqual(state.inputStack?.[0]?.audio_details, ['aac', '44100 Hz', 'stereo']);
  });

  it('captures video details on a Video: line while inInput', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, avi, from foo.avi:', state);
    utils.extractCodecData(command, '  Stream #0:1: Video: h264, yuv420p, 1024x768', state);
    assert.equal(state.inputStack?.[0]?.video, 'h264');
    assert.deepEqual(state.inputStack?.[0]?.video_details, ['h264', 'yuv420p', '1024x768']);
  });

  it('flips inInput off when an "Output #" line arrives', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, avi, from foo.avi:', state);
    utils.extractCodecData(command, 'Output #0, mp4, to bar.mp4', state);
    assert.equal(state.inInput, false);
  });

  it('emits codecData and returns true on the "Press [q] to stop" marker', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, mov, from foo.mp4', state);
    const done = utils.extractCodecData(command, 'Press [q] to stop, [?] for help', state);
    assert.equal(done, true);
    assert.equal(command.events.length, 1);
    assert.equal(command.events[0].event, 'codecData');
    assert.equal(command.events[0].args.length, 1);
  });

  it('emits codecData on a "Stream mapping:" marker', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, mov, from foo.mp4', state);
    const done = utils.extractCodecData(command, 'Stream mapping:', state);
    assert.equal(done, true);
    assert.equal(command.events[0].event, 'codecData');
  });

  it('handles multiple inputs and emits all entries on done', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    utils.extractCodecData(command, 'Input #0, avi, from a.avi', state);
    utils.extractCodecData(command, 'Input #1, avi, from b.avi', state);
    utils.extractCodecData(command, 'Stream mapping:', state);
    assert.equal(command.events.length, 1);
    assert.equal(command.events[0].args.length, 2);
  });

  it('skips Audio/Video/Duration lines outside an input block', () => {
    const command = makeEmitter();
    const state: CodecState = {};
    // No "Input #" yet, so inInput is false. The line should be ignored.
    utils.extractCodecData(command, '  Audio: aac, 44100 Hz', state);
    assert.deepEqual(state.inputStack ?? [], []);
  });
});

describe('utils.extractProgress', () => {
  function isProgressReport(value: unknown): value is ProgressReport {
    return (
      typeof value === 'object' &&
      value !== null &&
      'frames' in value &&
      'currentFps' in value &&
      'timemark' in value
    );
  }

  interface MockCommand {
    progresses: ProgressReport[];
    emit: (event: string, ...args: unknown[]) => boolean;
    _ffprobeData?: {
      format: { duration?: string | number };
      streams: never[];
      chapters: never[];
    };
  }

  function makeCommand(duration?: string | number): MockCommand {
    const progresses: ProgressReport[] = [];
    return {
      progresses,
      emit: (event, ...args) => {
        if (event === 'progress' && isProgressReport(args[0])) {
          progresses.push(args[0]);
        }
        return true;
      },
      _ffprobeData:
        duration === undefined
          ? undefined
          : {
              format: { duration },
              streams: [],
              chapters: [],
            },
    };
  }

  it('emits a progress event with parsed numeric fields on a complete line', () => {
    const command = makeCommand();
    utils.extractProgress(
      command,
      'frame=120 fps=30 q=20.0 size=1024kB time=00:00:04.00 bitrate=2000kbits/s speed=1.0x',
    );
    assert.equal(command.progresses.length, 1);
    const [data] = command.progresses;
    assert.equal(data.frames, 120);
    assert.equal(data.currentFps, 30);
    assert.equal(data.currentKbps, 2000);
    assert.equal(data.targetSize, 1024);
    assert.equal(data.timemark, '00:00:04.00');
  });

  it('does not emit when the line is missing the key=value shape', () => {
    const command = makeCommand();
    utils.extractProgress(command, 'irrelevant log line');
    assert.equal(command.progresses.length, 0);
  });

  it('falls back to Lsize when size is absent', () => {
    const command = makeCommand();
    utils.extractProgress(command, 'frame=1 fps=1 Lsize=42 time=00:00:00.10 bitrate=1kbits/s');
    const [data] = command.progresses;
    assert.equal(data.targetSize, 42);
  });

  it('treats absent bitrate as 0 kbps', () => {
    const command = makeCommand();
    utils.extractProgress(command, 'frame=1 fps=1 size=1 time=00:00:00.10 dummy=x');
    const [data] = command.progresses;
    assert.equal(data.currentKbps, 0);
  });

  it('parses bitrate even when the value lacks the kbits/s suffix', () => {
    const command = makeCommand();
    utils.extractProgress(command, 'frame=1 fps=1 size=1 time=00:00:00.10 bitrate=512');
    const [data] = command.progresses;
    assert.equal(data.currentKbps, 512);
  });

  it('omits percent when no ffprobe duration is available', () => {
    const command = makeCommand();
    utils.extractProgress(command, 'frame=1 fps=1 size=1 time=00:00:01.00 bitrate=1kbits/s');
    const [data] = command.progresses;
    assert.equal('percent' in data, false);
  });

  it('computes percent when ffprobe duration is available', () => {
    const command = makeCommand(10);
    utils.extractProgress(command, 'frame=1 fps=1 size=1 time=00:00:05.00 bitrate=1kbits/s');
    const [data] = command.progresses;
    assert.equal(data.percent, 50);
  });

  it('NaN ffprobe duration disables percent computation', () => {
    const command = makeCommand('not a number');
    utils.extractProgress(command, 'frame=1 fps=1 size=1 time=00:00:05.00 bitrate=1kbits/s');
    const [data] = command.progresses;
    assert.equal('percent' in data, false);
  });

  it('handles ffmpeg "key= value" output (whitespace after =)', () => {
    const command = makeCommand();
    utils.extractProgress(
      command,
      'frame= 24 fps= 12 size= 100 time=00:00:01.00 bitrate= 8kbits/s',
    );
    const [data] = command.progresses;
    assert.equal(data.frames, 24);
    assert.equal(data.currentFps, 12);
    assert.equal(data.targetSize, 100);
    assert.equal(data.currentKbps, 8);
  });
});

describe('utils.which (callback wrapper around which@7)', () => {
  // The wrapper resolves a binary name against the user's PATH, never errors
  // (failures resolve to '' so the lookup still completes), and caches the
  // result so a second call for the same name is synchronous.

  it('resolves a known-present binary to a non-empty absolute-ish string', async () => {
    // node is on PATH in any environment we run tests in.
    const found = await new Promise<string>((resolve) => {
      utils.which('node', (_err, path) => resolve(path));
    });
    assert.equal(typeof found, 'string');
    assert.ok(found.length > 0);
  });

  it('resolves an unknown binary name to the empty string (does not throw)', async () => {
    const found = await new Promise<string>((resolve) => {
      utils.which(`__definitely_missing_${Date.now()}__`, (_err, path) => resolve(path));
    });
    assert.equal(found, '');
  });

  it('caches the lookup so repeat calls fire the callback synchronously', async () => {
    // Prime the cache.
    await new Promise<string>((resolve) => {
      utils.which('node', (_err, path) => resolve(path));
    });

    // Second call: fire and observe whether the callback runs before the next
    // line. The legacy capabilities.test.ts uses this exact 'after = 0; ...; after = 1'
    // trick to assert synchronous resolution.
    let postCallSync = 0;
    let observedDuringCallback = -1;
    let cachedValue = '';
    utils.which('node', (_err, path) => {
      observedDuringCallback = postCallSync;
      cachedValue = path;
    });
    postCallSync = 1;
    assert.equal(observedDuringCallback, 0, 'cached lookup must be synchronous');
    assert.ok(cachedValue.length > 0);
  });

  it('caches misses so a repeat lookup of an unknown binary is also synchronous', async () => {
    // The wrapper turns failures into '' rather than errors, and caches that
    // empty result the same as a hit. A regression that only re-invoked
    // which@7 on cache-misses would still pass the positive-hit sync test,
    // so we have to lock the failure-cache branch down explicitly.
    const missing = `__definitely_missing_${Date.now()}__`;
    await new Promise<string>((resolve) => {
      utils.which(missing, (_err, path) => resolve(path));
    });

    let postCallSync = 0;
    let observedDuringCallback = -1;
    let cachedValue: string | null = null;
    utils.which(missing, (_err, path) => {
      observedDuringCallback = postCallSync;
      cachedValue = path;
    });
    postCallSync = 1;
    assert.equal(observedDuringCallback, 0, 'cached miss must be synchronous');
    assert.equal(cachedValue, '');
  });
});
