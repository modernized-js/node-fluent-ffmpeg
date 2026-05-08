import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import utils from '../lib/utils.js';

describe('Utilities', () => {
  describe('Argument list helper', () => {
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
  });

  describe('timemarkToSeconds', () => {
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
  });

  describe('Lines ring buffer', () => {
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
  });
});
