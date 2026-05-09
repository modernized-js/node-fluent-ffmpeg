import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(__filename);

test('package entrypoint loads', () => {
  const ffmpeg = require('../index.js');
  assert.equal(typeof ffmpeg, 'function');
});

test('FfmpegCommand is constructable without new', () => {
  const ffmpeg = require('../index.js');
  const command = ffmpeg();
  assert.ok(command);
  assert.equal(typeof command.input, 'function');
  assert.equal(typeof command.output, 'function');
});
