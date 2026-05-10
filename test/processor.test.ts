import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { access, unlink, rmdir, stat, readdir } from 'node:fs/promises';
import stream from 'node:stream';
import EventEmitter from 'node:events';
import { exec, execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(__filename);
const FfmpegCommand = require('../index.js');
const testhelper = require('./helpers.js');

function isCommandInPath(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? `where /Q ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ffmpegInPath = isCommandInPath('ffmpeg');
const ffmpegIt = ffmpegInPath ? it : it.skip;

const skipNiceness = /win(32|64)/.test(process.platform);
const niceIt = ffmpegInPath && !skipNiceness ? it : it.skip;

const testdir = path.join(__dirname, 'assets');
const testfileName = 'testvideo-43.avi';
const testfile = path.join(testdir, testfileName);
const testfilewide = path.join(testdir, 'testvideo-169.avi');
const testfilebig = path.join(testdir, 'testvideo-5m.mpg');
const testfilespecial = path.join(testdir, "te[s]t_ video ' _ .flv");
const testfileaudio1 = path.join(testdir, 'testaudio-one.wav');
const testfileaudio2 = path.join(testdir, 'testaudio-two.wav');
const testfileaudio3 = path.join(testdir, 'testaudio-three.wav');

interface FfmpegProc {
  pid?: number;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

interface FfmpegInst extends EventEmitter {
  ffmpegProc: FfmpegProc;
  usingPreset: (name: string) => FfmpegInst;
  saveToFile: (p: string) => FfmpegInst;
  takeScreenshots: (config: unknown, folder?: string) => FfmpegInst;
  writeToStream: (s?: unknown, opts?: unknown) => unknown;
  mergeAdd: (p: string) => FfmpegInst;
  mergeToFile: (p: string) => FfmpegInst;
  output: (p: string) => FfmpegInst;
  withAudioCodec: (c: string) => FfmpegInst;
  withVideoCodec: (c: string) => FfmpegInst;
  withSize: (s: string) => FfmpegInst;
  takeFrames: (n: number) => FfmpegInst;
  addOption: (...a: unknown[]) => FfmpegInst;
  renice: (n: number) => FfmpegInst;
  kill: (signal?: string) => FfmpegInst;
  run: () => FfmpegInst;
  options: { niceness: number };
  input: (p: unknown) => FfmpegInst;
}

let processes: FfmpegProc[] = [];
let outputs: [string | undefined, string | undefined][] = [];
let files: string[] = [];
let dirs: string[] = [];

function makeCommand(args?: unknown): FfmpegInst {
  const cmd = new FfmpegCommand(args);
  cmd.on('start', () => {
    // Capture proc here — by the time 'exit' fires, processor.ts has already
    // deleted cmd.ffmpegProc in its endCB, so a deferred lookup misses the splice.
    const proc = cmd.ffmpegProc;
    processes.push(proc);
    proc.on('exit', () => {
      const idx = processes.indexOf(proc);
      if (idx !== -1) processes.splice(idx, 1);
    });
  });
  return cmd;
}

function saveOutput(stdout: string | undefined, stderr: string | undefined): void {
  outputs.unshift([stdout, stderr]);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('Processor', () => {
  beforeEach(() => {
    processes = [];
    outputs = [];
    files = [];
    dirs = [];
  });

  afterEach(async () => {
    if (processes.length && outputs.length) {
      testhelper.logOutput(outputs[0][0], outputs[0][1]);
    }
    assert.equal(processes.length, 0, `${processes.length} processes still running after test`);

    for (const file of files) {
      if (await exists(file)) {
        await unlink(file);
      } else if (outputs.length) {
        testhelper.logOutput(outputs[0][0], outputs[0][1]);
        throw new Error(`Expected created file ${file}`);
      } else {
        throw new Error(`Expected created file ${file}`);
      }
    }
    for (const dir of dirs) {
      if (await exists(dir)) {
        await rmdir(dir);
      } else if (outputs.length) {
        testhelper.logOutput(outputs[0][0], outputs[0][1]);
        throw new Error(`Expected created directory ${dir}`);
      } else {
        throw new Error(`Expected created directory ${dir}`);
      }
    }
  });

  describe('Process controls', () => {
    niceIt('should properly limit niceness', () => {
      const cmd = makeCommand({
        source: testfile,
        logger: testhelper.logger,
        timeout: 0.02,
      });
      cmd.renice(100);
      assert.equal(cmd.options.niceness, 20);
    });

    ffmpegIt('should change the working directory', async () => {
      const testFile = path.join(testdir, 'testvideo.avi');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfileName, logger: testhelper.logger, cwd: testdir })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => resolve())
          .saveToFile(testFile);
      });
    });

    ffmpegIt('should kill the process on timeout', async () => {
      const testFile = path.join(testdir, 'testProcessKillTimeout.avi');
      files.push(testFile);
      // Sub-second timeout: a 1-second budget was racy on fast hardware
      // (M-series Mac could finish a divx encode of testfilebig before the
      // timer fired and emit `end` instead of `error`). 100 ms is tight
      // enough that no platform completes the encode in that window.
      const command = makeCommand({
        source: testfilebig,
        logger: testhelper.logger,
        timeout: 0.1,
      });

      await new Promise<void>((resolve, reject) => {
        command
          .usingPreset('divx')
          .on('start', () => {
            command.ffmpegProc.on('exit', () => resolve());
          })
          .on('error', (err: Error, stdout: string, stderr: string) => {
            saveOutput(stdout, stderr);
            try {
              assert.notEqual(err.message.indexOf('timeout'), -1);
            } catch (e) {
              reject(e as Error);
            }
          })
          .on('end', () => reject(new Error('end was called, expected a timeout')))
          .saveToFile(testFile);
      });
    });

    // Process-leak regression: spawn a fresh `node` that requires the built
    // dist entrypoint and runs ffmpeg to completion; if the parent never exits
    // (because of an uncleared timer or open handle), exec's 1s timeout kills
    // it and reports an error. Skips when dist/ hasn't been built (run after
    // `yarn build`); CI always builds before running tests.
    const distEntry = path.resolve(__dirname, '..', 'dist', 'index.js');
    const distExists = fs.existsSync(distEntry);
    const leakIt = ffmpegInPath && distExists ? it : it.skip;
    leakIt('should not keep node process running on completion', async () => {
      const script = [
        `var ffmpeg = require(${JSON.stringify(distEntry)});`,
        `ffmpeg(${JSON.stringify(testfilebig)}, { timeout: 60 })`,
        `  .addOption('-t', '1')`,
        `  .addOption('-f', 'null')`,
        `  .saveToFile('/dev/null');`,
      ].join('\n');
      await new Promise<void>((resolve, reject) => {
        exec(
          `node -e "${script.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`,
          { timeout: 1000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    });

    ffmpegIt('should kill the process with .kill', async () => {
      const testFile = path.join(testdir, 'testProcessKill.avi');
      files.push(testFile);
      const ffmpegJob = makeCommand({ source: testfilebig, logger: testhelper.logger }).usingPreset(
        'divx',
      );

      let startCalled = false;
      let errorCalled = false;

      await new Promise<void>((resolve, reject) => {
        ffmpegJob
          .on('start', () => {
            startCalled = true;
            setTimeout(() => ffmpegJob.kill(), 500);
            ffmpegJob.ffmpegProc.on('exit', () => {
              setTimeout(() => {
                try {
                  assert.equal(errorCalled, true);
                  resolve();
                } catch (e) {
                  reject(e as Error);
                }
              }, 1000);
            });
          })
          .on('error', (err: Error) => {
            try {
              assert.notEqual(err.message.indexOf('ffmpeg was killed with signal SIGKILL'), -1);
              assert.equal(startCalled, true);
              errorCalled = true;
            } catch (e) {
              reject(e as Error);
            }
          })
          .on('end', () => reject(new Error('end was called, expected an error')))
          .saveToFile(testFile);
      });
    });

    ffmpegIt('should send the process custom signals with .kill(signal)', async () => {
      const testFile = path.join(testdir, 'testProcessKillCustom.avi');
      files.push(testFile);
      const ffmpegJob = makeCommand({
        source: testfilebig,
        logger: testhelper.logger,
        timeout: 2,
      }).usingPreset('divx');

      let startCalled = false;
      let errorCalled = false;

      await new Promise<void>((resolve, reject) => {
        ffmpegJob
          .on('start', () => {
            startCalled = true;
            setTimeout(() => ffmpegJob.kill('SIGSTOP'), 500);
            ffmpegJob.ffmpegProc.on('exit', () => {
              try {
                assert.equal(errorCalled, true);
                resolve();
              } catch (e) {
                reject(e as Error);
              }
            });
          })
          .on('error', (err: Error) => {
            try {
              assert.equal(startCalled, true);
              assert.notEqual(err.message.indexOf('timeout'), -1);
            } catch (e) {
              reject(e as Error);
              return;
            }
            errorCalled = true;
            ffmpegJob.kill('SIGCONT');
          })
          .on('end', () => reject(new Error('end was called, expected a timeout')))
          .saveToFile(testFile);
      });
    });
  });

  describe('Events', () => {
    ffmpegIt("should report codec data through 'codecData' event", async () => {
      const testFile = path.join(testdir, 'testOnCodecData.avi');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfilebig, logger: testhelper.logger })
          .on('codecData', (data: { audio?: string; video?: string }) => {
            try {
              assert.ok('audio' in data);
              assert.ok('video' in data);
            } catch (e) {
              reject(e as Error);
            }
          })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => resolve())
          .saveToFile(testFile);
      });
    });

    ffmpegIt("should report codec data through 'codecData' event on piped inputs", async () => {
      const testFile = path.join(testdir, 'testOnCodecData.avi');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: fs.createReadStream(testfilebig), logger: testhelper.logger })
          .on('codecData', (data: { audio?: string; video?: string }) => {
            try {
              assert.ok('audio' in data);
              assert.ok('video' in data);
            } catch (e) {
              reject(e as Error);
            }
          })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => resolve())
          .saveToFile(testFile);
      });
    });

    ffmpegIt("should report codec data through 'codecData' for multiple inputs", async () => {
      const testFile = path.join(testdir, 'testOnCodecData.wav');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ logger: testhelper.logger })
          .input(testfileaudio1)
          .input(testfileaudio2)
          .on('codecData', (data1: { audio?: string }, data2: { audio?: string }) => {
            try {
              assert.ok('audio' in data1);
              assert.ok('audio' in data2);
            } catch (e) {
              reject(e as Error);
            }
          })
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => resolve())
          .mergeToFile(testFile);
      });
    });

    ffmpegIt("should report progress through 'progress' event", async () => {
      const testFile = path.join(testdir, 'testOnProgress.avi');
      files.push(testFile);
      let gotProgress = false;
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfilebig, logger: testhelper.logger })
          .on('progress', () => {
            gotProgress = true;
          })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => {
            try {
              assert.equal(gotProgress, true);
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .saveToFile(testFile);
      });
    });

    ffmpegIt("should report start of ffmpeg process through 'start' event", async () => {
      const testFile = path.join(testdir, 'testStart.avi');
      files.push(testFile);
      let startCalled = false;
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfilebig, logger: testhelper.logger })
          .on('start', (cmdline: string) => {
            startCalled = true;
            try {
              assert.equal(cmdline.indexOf('ffmpeg'), 0);
              assert.notEqual(cmdline.indexOf('testvideo-5m'), -1);
              assert.notEqual(cmdline.indexOf('-b:a 128k'), -1);
            } catch (e) {
              reject(e as Error);
            }
          })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => {
            try {
              assert.equal(startCalled, true);
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .saveToFile(testFile);
      });
    });

    ffmpegIt("should report output lines through 'stderr' event", async () => {
      const testFile = path.join(testdir, 'testStderr.avi');
      files.push(testFile);
      const lines: string[] = [];
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfile, logger: testhelper.logger })
          .on('stderr', (line: string) => lines.push(line))
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => {
            try {
              assert.ok(lines.length > 0);
              assert.ok(lines[0].startsWith('ffmpeg version'));
              assert.ok(lines.filter((l) => l.indexOf('Press [q]') === 0).length > 0);
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .saveToFile(testFile);
      });
    });
  });

  describe('Output limiting', () => {
    ffmpegIt('should limit stdout/stderr lines', async () => {
      const testFile = path.join(testdir, 'testLimit10.avi');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ stdoutLines: 10, source: testfile, logger: testhelper.logger })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', (stdout: string, stderr: string) => {
            try {
              assert.ok(stdout.split('\n').length < 11);
              assert.ok(stderr.split('\n').length < 11);
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .saveToFile(testFile);
      });
    });
  });

  describe('takeScreenshots', () => {
    interface ShotConfig {
      timemarks?: (number | string)[];
      timestamps?: (number | string)[];
      count?: number;
      filename?: string;
      size?: string;
    }
    function runScreenshotsCase(
      name: string,
      config: ShotConfig,
      expected: string[],
    ): Promise<void> {
      const testFolder = path.join(testdir, `screenshots_${name}`);
      expected.forEach((f) => files.push(path.join(testFolder, f)));
      dirs.push(testFolder);

      return new Promise<void>((resolve, reject) => {
        let filenamesCalled = false;
        makeCommand({ source: testfile, logger: testhelper.logger })
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('filenames', (filenames: string[]) => {
            filenamesCalled = true;
            try {
              assert.equal(filenames.length, expected.length);
              filenames.forEach((file, idx) => assert.equal(file, expected[idx]));
            } catch (e) {
              reject(e as Error);
            }
          })
          .on('end', async () => {
            try {
              assert.equal(filenamesCalled, true);
              const content = await readdir(testFolder);
              const tnCount = content.filter((f) => f.indexOf('.png') > -1).length;
              assert.equal(tnCount, expected.length);
              expected.forEach((f) => assert.notEqual(content.indexOf(f), -1));
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .takeScreenshots(config, testFolder);
      });
    }

    const screenshotCases: [string, string, ShotConfig, string[]][] = [
      [
        'should take screenshots from a list of number timemarks',
        'timemarks_num',
        { timemarks: [0.5, 1] },
        ['tn_1.png', 'tn_2.png'],
      ],
      [
        'should take screenshots from a list of string timemarks',
        'timemarks_string',
        { timemarks: ['0.5', '1'] },
        ['tn_1.png', 'tn_2.png'],
      ],
      [
        'should take screenshots from a list of hms timemarks',
        'timemarks_hms',
        { timemarks: ['00:00:00.500', '00:01'] },
        ['tn_1.png', 'tn_2.png'],
      ],
      [
        'should support "timestamps" instead of "timemarks"',
        'timestamps',
        { timestamps: [0.5, 1] },
        ['tn_1.png', 'tn_2.png'],
      ],
      [
        'should replace %i with the screenshot index',
        'filename_i',
        { timemarks: [0.5, 1], filename: 'shot_%i.png' },
        ['shot_1.png', 'shot_2.png'],
      ],
      [
        'should replace %000i with the padded screenshot index',
        'filename_0i',
        { timemarks: [0.5, 1], filename: 'shot_%000i.png' },
        ['shot_0001.png', 'shot_0002.png'],
      ],
      [
        'should replace %s with the screenshot timestamp',
        'filename_s',
        { timemarks: [0.5, '40%', 1], filename: 'shot_%s.png' },
        ['shot_0.5.png', 'shot_0.8.png', 'shot_1.png'],
      ],
      [
        'should replace %f with the input filename',
        'filename_f',
        { timemarks: [0.5, 1], filename: 'shot_%f_%i.png' },
        ['shot_testvideo-43.avi_1.png', 'shot_testvideo-43.avi_2.png'],
      ],
      [
        'should replace %b with the input basename',
        'filename_b',
        { timemarks: [0.5, 1], filename: 'shot_%b_%i.png' },
        ['shot_testvideo-43_1.png', 'shot_testvideo-43_2.png'],
      ],
      [
        'should replace %r with the output resolution',
        'filename_r',
        { timemarks: [0.5, 1], filename: 'shot_%r_%i.png' },
        ['shot_1024x768_1.png', 'shot_1024x768_2.png'],
      ],
      [
        'should replace %w and %h with the output resolution',
        'filename_wh',
        { timemarks: [0.5, 1], filename: 'shot_%wx%h_%i.png' },
        ['shot_1024x768_1.png', 'shot_1024x768_2.png'],
      ],
      [
        'should automatically add %i when no variable replacement is present',
        'filename_add_i',
        { timemarks: [0.5, 1], filename: 'shot_%b.png' },
        ['shot_testvideo-43_1.png', 'shot_testvideo-43_2.png'],
      ],
      [
        'should automatically compute timestamps from the "count" option',
        'count',
        { count: 3, filename: 'shot_%s.png' },
        ['shot_0.5.png', 'shot_1.png', 'shot_1.5.png'],
      ],
      [
        'should enable setting screenshot size',
        'size',
        { count: 3, filename: 'shot_%r.png', size: '150x?' },
        ['shot_150x112_1.png', 'shot_150x112_2.png', 'shot_150x112_3.png'],
      ],
      [
        'a single screenshot should not have a _1 file name suffix',
        'no_suffix',
        { timemarks: [0.5] },
        ['tn.png'],
      ],
    ];

    for (const [title, name, config, expected] of screenshotCases) {
      ffmpegIt(title, () => runScreenshotsCase(name, config, expected));
    }
  });

  describe('saveToFile', () => {
    async function expectFileWritten(testFile: string, command: FfmpegInst): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        command
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', async () => {
            try {
              assert.ok(await exists(testFile));
              const stats = await stat(testFile);
              assert.ok(stats.size > 0);
              assert.ok(stats.isFile());
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .saveToFile(testFile);
      });
    }

    ffmpegIt('should save the output file properly to disk', async () => {
      const testFile = path.join(testdir, 'testConvertToFile.avi');
      files.push(testFile);
      await expectFileWritten(
        testFile,
        makeCommand({ source: testfile, logger: testhelper.logger }),
      );
    });

    ffmpegIt('should save an output file with special characters properly to disk', async () => {
      const testFile = path.join(testdir, 'te[s]t video \' " .avi');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfile, logger: testhelper.logger })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', () => resolve())
          .saveToFile(testFile);
      });
    });

    ffmpegIt('should save output files with special characters', async () => {
      const testFile = path.join(testdir, '[test "special \' char*cters \n.avi');
      files.push(testFile);
      await expectFileWritten(
        testFile,
        makeCommand({ source: testfile, logger: testhelper.logger }),
      );
    });

    ffmpegIt('should accept a stream as its source', async () => {
      const testFile = path.join(testdir, 'testConvertFromStreamToFile.avi');
      files.push(testFile);
      const instream = fs.createReadStream(testfile);
      await expectFileWritten(
        testFile,
        makeCommand({ source: instream, logger: testhelper.logger }),
      );
    });

    ffmpegIt('should pass input stream errors through to error handler', async () => {
      const readError = new Error('Read Error');
      const instream = new stream.Readable({
        read() {
          process.nextTick(() => this.emit('error', readError));
        },
      });

      const command = makeCommand({ source: instream, logger: testhelper.logger });
      let startCalled = false;

      await new Promise<void>((resolve, reject) => {
        command
          .usingPreset('divx')
          .on('start', () => {
            startCalled = true;
            command.ffmpegProc.on('exit', async () => {
              try {
                assert.equal(await exists('/tmp/will-not-be-created.avi'), false);
                resolve();
              } catch (e) {
                reject(e as Error);
              }
            });
          })
          .on(
            'error',
            (err: Error & { inputStreamError?: Error }, stdout: string, stderr: string) => {
              saveOutput(stdout, stderr);
              try {
                assert.equal(startCalled, true);
                assert.ok(err);
                assert.equal(err.message.indexOf('Input stream error: '), 0);
                assert.equal(err.inputStreamError, readError);
              } catch (e) {
                reject(e as Error);
              }
            },
          )
          .on('end', () => reject(new Error('end was called, expected an error')))
          .saveToFile('/tmp/will-not-be-created.avi');
      });
    });
  });

  describe('mergeToFile', () => {
    ffmpegIt('should merge multiple files', async () => {
      const testFile = path.join(testdir, 'testMergeAddOption.wav');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfileaudio1, logger: testhelper.logger })
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', async () => {
            try {
              assert.ok(await exists(testFile));
              const stats = await stat(testFile);
              assert.ok(stats.size > 0);
              assert.ok(stats.isFile());
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .mergeAdd(testfileaudio2)
          .mergeAdd(testfileaudio3)
          .mergeToFile(testFile);
      });
    });
  });

  describe('writeToStream', () => {
    ffmpegIt('should save the output file properly to disk using a stream', async () => {
      const testFile = path.join(testdir, 'testConvertToStream.avi');
      files.push(testFile);
      const outstream = fs.createWriteStream(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfile, logger: testhelper.logger })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', async () => {
            try {
              assert.ok(await exists(testFile));
              const stats = await stat(testFile);
              assert.ok(stats.size > 0);
              assert.ok(stats.isFile());
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .writeToStream(outstream, { end: true });
      });
    });

    ffmpegIt('should accept a stream as its source', async () => {
      const testFile = path.join(testdir, 'testConvertFromStreamToStream.avi');
      files.push(testFile);
      const instream = fs.createReadStream(testfile);
      const outstream = fs.createWriteStream(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: instream, logger: testhelper.logger })
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', async () => {
            try {
              assert.ok(await exists(testFile));
              const stats = await stat(testFile);
              assert.ok(stats.size > 0);
              assert.ok(stats.isFile());
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .writeToStream(outstream);
      });
    });

    ffmpegIt('should return a PassThrough stream when called with no arguments', async () => {
      const testFile = path.join(testdir, 'testConvertToStream.avi');
      files.push(testFile);
      const outstream = fs.createWriteStream(testFile);
      const command = makeCommand({ source: testfile, logger: testhelper.logger });

      await new Promise<void>((resolve, reject) => {
        command
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', async () => {
            try {
              assert.ok(await exists(testFile));
              const stats = await stat(testFile);
              assert.ok(stats.size > 0);
              assert.ok(stats.isFile());
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          });

        const passthrough = command.writeToStream({ end: true });
        assert.ok(passthrough instanceof stream.PassThrough);
        (passthrough as stream.PassThrough).pipe(outstream);
      });
    });

    ffmpegIt('should pass output stream errors through to error handler', async () => {
      const writeError = new Error('Write Error');
      const outstream = new stream.Writable({
        write(_chunk, _encoding, callback) {
          callback(writeError);
        },
      });

      const command = makeCommand({ source: testfile, logger: testhelper.logger });
      let startCalled = false;

      await new Promise<void>((resolve, reject) => {
        command
          .usingPreset('divx')
          .on('start', () => {
            startCalled = true;
            command.ffmpegProc.on('exit', () => resolve());
          })
          .on(
            'error',
            (err: Error & { outputStreamError?: Error }, stdout: string, stderr: string) => {
              saveOutput(stdout, stderr);
              try {
                assert.equal(startCalled, true);
                assert.ok(err);
                assert.equal(err.message.indexOf('Output stream error: '), 0);
                assert.equal(err.outputStreamError, writeError);
              } catch (e) {
                reject(e as Error);
              }
            },
          )
          .on('end', () => reject(new Error('end was called, expected an error')))
          .writeToStream(outstream);
      });
    });

    // Regression: on Windows the legacy 20ms grace between target.on('close')
    // and ffmpegProc.on('exit') consistently lost the race, surfacing a
    // spurious 'Output stream closed' error after a successful run.
    // The fix re-checks ffmpegProc.exitCode/killed inside the grace timeout
    // and bumps the grace to 250ms; this test pins both behaviours by
    // running a complete pipe-to-stream encode and asserting that 'end'
    // fires without a trailing 'error'.
    ffmpegIt(
      'should not emit "Output stream closed" after a successful pipe completion',
      async () => {
        const sink = new stream.PassThrough();
        const chunks: Buffer[] = [];
        sink.on('data', (chunk: Buffer) => chunks.push(chunk));

        const command = makeCommand({ source: testfile, logger: testhelper.logger })
          .takeFrames(5)
          .withVideoCodec('mjpeg')
          .addOption('-f', 'image2pipe');

        let endFired = false;
        let trailingError: Error | undefined;

        await new Promise<void>((resolve, reject) => {
          command
            .on('error', (err: Error) => {
              if (endFired) trailingError = err;
              else reject(err);
            })
            .on('end', () => {
              endFired = true;
            })
            .writeToStream(sink);
          sink.on('end', () => resolve());
        });

        // Wait past the OUTPUT_STREAM_GRACE_MS window so a stale timeout
        // body would have fired an 'error' by now if the guard were broken.
        const POST_END_QUIET_MS = 400;
        await new Promise<void>((resolve) => setTimeout(resolve, POST_END_QUIET_MS));

        assert.equal(endFired, true, '"end" event must fire on a successful pipe');
        assert.equal(trailingError, undefined, 'no "error" event must fire after "end"');
        assert.ok(chunks.length > 0, 'sink must receive at least one ffmpeg chunk');
      },
    );

    // Regression for issue #40 / upstream #1129. Repeatedly piping ffmpeg
    // jobs into the same long-lived Writable used to leak `'close'` /
    // `'error'` listeners (one pair per run), eventually triggering Node's
    // MaxListenersExceededWarning. The fix detaches both listeners on
    // `ffmpegProc.exit`; this test runs several short encodes against a
    // shared sink and asserts the listener count never exceeds 1 of each.
    ffmpegIt('should not leak target close/error listeners across consecutive pipes', async () => {
      const sink = new stream.PassThrough();
      sink.on('data', () => {});
      const ENCODE_COUNT = 5;
      const MAX_LISTENERS_PER_EVENT = 1;

      for (let i = 0; i < ENCODE_COUNT; i++) {
        await new Promise<void>((resolve, reject) => {
          const command = makeCommand({ source: testfile, logger: testhelper.logger })
            .takeFrames(2)
            .withVideoCodec('mjpeg')
            .addOption('-f', 'image2pipe');
          command
            .on('error', (err: Error) => reject(err))
            .on('end', () => resolve())
            .writeToStream(sink, { end: false });
        });
        // Allow the post-exit detach hook to fire before checking.
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        assert.ok(
          sink.listenerCount('close') <= MAX_LISTENERS_PER_EVENT,
          `close listeners leaked after run ${i + 1}: ${sink.listenerCount('close')}`,
        );
        assert.ok(
          sink.listenerCount('error') <= MAX_LISTENERS_PER_EVENT,
          `error listeners leaked after run ${i + 1}: ${sink.listenerCount('error')}`,
        );
      }
    });
  });

  describe('Outputs', () => {
    ffmpegIt('should create multiple outputs', async () => {
      const testFile1 = path.join(testdir, 'testMultipleOutput1.avi');
      const testFile2 = path.join(testdir, 'testMultipleOutput2.avi');
      const testFile3 = path.join(testdir, 'testMultipleOutput3.mp4');
      [testFile1, testFile2, testFile3].forEach((f) => files.push(f));

      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfilebig, logger: testhelper.logger })
          .output(testFile1)
          .withAudioCodec('vorbis')
          .withVideoCodec('copy')
          .output(testFile2)
          .withAudioCodec('libmp3lame')
          .withVideoCodec('copy')
          .output(testFile3)
          .withSize('160x120')
          .withAudioCodec('aac')
          .withVideoCodec('libx264')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', async () => {
            try {
              for (const file of [testFile1, testFile2, testFile3]) {
                assert.ok(await exists(file), `${file} not created`);
                const stats = await stat(file);
                assert.ok(stats.size > 0);
                assert.ok(stats.isFile());
              }
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .run();
      });
    });
  });

  describe('Inputs', () => {
    ffmpegIt('should take input from a file with special characters', async () => {
      const testFile = path.join(testdir, 'testSpecialInput.avi');
      files.push(testFile);
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfilespecial, logger: testhelper.logger, timeout: 10 })
          .takeFrames(50)
          .usingPreset('divx')
          .on('error', (err: unknown, stdout: unknown, stderr: unknown) => {
            testhelper.logError(err, stdout, stderr);
            reject(err);
          })
          .on('end', async () => {
            try {
              assert.ok(await exists(testFile));
              const stats = await stat(testFile);
              assert.ok(stats.size > 0);
              assert.ok(stats.isFile());
              resolve();
            } catch (e) {
              reject(e as Error);
            }
          })
          .saveToFile(testFile);
      });
    });
  });

  // Remote I/O tests are intentionally skipped — the legacy suite did the same;
  // they require an ffserver instance and a live RTSP/HTTP/RTP setup.
  describe('Remote I/O', () => {
    it.skip('should take input from a RTSP stream', () => {
      // testfilewide is referenced by future RTSP tests; keep the binding live.
      [testfilewide].forEach(() => {});
    });
  });

  describe('Errors', () => {
    ffmpegIt('should report an error when ffmpeg has been killed', async () => {
      // Killing ffmpeg with SIGKILL early enough that no output is written —
      // do not register the path with `files`, otherwise the afterEach
      // cleanup demands it exist.
      const testFile = path.join(testdir, 'testErrorKill.avi');
      const command = makeCommand({ source: testfilebig, logger: testhelper.logger });

      let errorAsserted = false;
      let exited = false;
      await new Promise<void>((resolve, reject) => {
        const tryFinish = () => {
          if (errorAsserted && exited) resolve();
        };
        command
          .usingPreset('divx')
          .on('start', () => {
            // SIGKILL must arrive while ffmpeg is still encoding — on fast
            // local hardware the 5-minute divx encode can finish within ~1s,
            // so kill early. CI runners stay well above this even at 50ms.
            setTimeout(() => command.kill('SIGKILL'), 50);
            command.ffmpegProc.on('exit', () => {
              exited = true;
              tryFinish();
            });
          })
          .on('error', (err: Error) => {
            try {
              assert.match(err.message, /ffmpeg was killed with signal SIGKILL/);
              errorAsserted = true;
              tryFinish();
            } catch (e) {
              reject(e as Error);
            }
          })
          .on('end', () => reject(new Error('expected error, got end')))
          .saveToFile(testFile);
      });
    });

    ffmpegIt('should report ffmpeg errors', async () => {
      await new Promise<void>((resolve, reject) => {
        makeCommand({ source: testfilebig, logger: testhelper.logger })
          .addOption('-invalidoption')
          .on('error', (err: Error) => {
            try {
              assert.match(err.message, /Unrecognized option 'invalidoption'/);
              setTimeout(resolve, 1000);
            } catch (e) {
              reject(e as Error);
            }
          })
          .saveToFile('/will/not/be/created/anyway');
      });
    });
  });
});
