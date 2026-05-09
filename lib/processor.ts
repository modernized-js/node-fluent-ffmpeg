import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import utils from './utils.js';
import type {
  ArgValue,
  FfmpegCommandPrototype,
  FfmpegCommandThis,
  FfprobeData,
  FilterSpec,
  InputState,
  LinesRing,
  OutputState,
  PrepareCallback,
  ProcessCallback,
  SpawnEndCallback,
  SpawnOptions,
} from './types.js';

const NICENESS_MIN = -20;
const NICENESS_MAX = 20;
const OUTPUT_STREAM_GRACE_MS = 20;
const MS_PER_SECOND = 1000;

interface ReportingError extends Error {
  inputStreamError?: Error;
  outputStreamError?: Error;
}

function isStreamInput(input: InputState): boolean {
  return input.isStream;
}

function isStreamOutput(output: OutputState): boolean {
  return typeof output.target !== 'string' && output.target !== undefined;
}

function runFfprobeIntoCommand(command: FfmpegCommandThis): void {
  const inputProbeIndex = 0;
  if (command._inputs[inputProbeIndex]?.isStream) return;
  command.ffprobe(inputProbeIndex, (_err, data) => {
    if (data) command._ffprobeData = data;
  });
}

function buildInputArgs(inputs: InputState[]): ArgValue[] {
  return inputs.reduce<ArgValue[]>((args, input) => {
    const source = typeof input.source === 'string' ? input.source : 'pipe:0';
    return args.concat(input.options.get(), ['-i', source]);
  }, []);
}

function buildOutputArgs(outputs: OutputState[]): ArgValue[] {
  return outputs.reduce<ArgValue[]>((args, output) => {
    const sizeFilters = utils.makeFilterStrings(output.sizeFilters.get() as FilterSpec[]);
    const audioFilters = output.audioFilters.get() as string[];
    const videoFilters = (output.videoFilters.get() as string[]).concat(sizeFilters);
    const outputArg: string[] =
      output.target === undefined
        ? []
        : typeof output.target === 'string'
          ? [output.target]
          : ['pipe:1'];

    return args.concat(
      output.audio.get(),
      audioFilters.length ? ['-filter:a', audioFilters.join(',')] : [],
      output.video.get(),
      videoFilters.length ? ['-filter:v', videoFilters.join(',')] : [],
      output.options.get(),
      outputArg,
    );
  }, []);
}

interface SpawnCallbacks {
  processCB: ProcessCallback;
  endCB: SpawnEndCallback;
}

function normaliseSpawnArgs(
  options: SpawnOptions | ProcessCallback | SpawnEndCallback,
  processCB?: ProcessCallback | SpawnEndCallback,
  endCB?: SpawnEndCallback,
): { options: SpawnOptions; callbacks: SpawnCallbacks } {
  if (typeof options === 'function') {
    // _spawnFfmpeg(args, endCB) — endCB only
    return {
      options: {},
      callbacks: { processCB: () => {}, endCB: options as SpawnEndCallback },
    };
  }
  if (typeof endCB === 'undefined') {
    // _spawnFfmpeg(args, options, endCB) — no processCB
    return {
      options,
      callbacks: { processCB: () => {}, endCB: processCB as SpawnEndCallback },
    };
  }
  return {
    options,
    callbacks: { processCB: processCB as ProcessCallback, endCB },
  };
}

function applyNiceness(
  command: string,
  args: ArgValue[],
  niceness: number | undefined,
): { command: string; args: ArgValue[] } {
  if (!niceness || niceness === 0 || utils.isWindows) {
    return { command, args };
  }
  return { command: 'nice', args: [`-n${niceness}`, command, ...args] };
}

interface SpawnState {
  exitError: Error | null;
  processExited: boolean;
  stdoutClosed: boolean;
  stderrClosed: boolean;
  captureStdout: boolean;
}

function tryEndSpawn(
  state: SpawnState,
  stdoutRing: LinesRing,
  stderrRing: LinesRing,
  endCB: SpawnEndCallback,
  ended: { value: boolean },
): void {
  if (ended.value) return;
  if (!state.processExited) return;
  if (state.captureStdout && !state.stdoutClosed) return;
  if (!state.stderrClosed) return;
  ended.value = true;
  endCB(state.exitError, stdoutRing, stderrRing);
}

function attachExitHandlers(
  ffmpegProc: ChildProcess,
  state: SpawnState,
  stdoutRing: LinesRing,
  stderrRing: LinesRing,
  endCB: SpawnEndCallback,
  ended: { value: boolean },
): void {
  ffmpegProc.on('error', (err) => endCB(err));
  ffmpegProc.on('exit', (code, signal) => {
    state.processExited = true;
    if (signal) state.exitError = new Error(`ffmpeg was killed with signal ${signal}`);
    else if (code) state.exitError = new Error(`ffmpeg exited with code ${code}`);
    tryEndSpawn(state, stdoutRing, stderrRing, endCB, ended);
  });

  if (state.captureStdout && ffmpegProc.stdout) {
    ffmpegProc.stdout.on('data', (chunk: Buffer) => stdoutRing.append(chunk));
    ffmpegProc.stdout.on('close', () => {
      stdoutRing.close();
      state.stdoutClosed = true;
      tryEndSpawn(state, stdoutRing, stderrRing, endCB, ended);
    });
  }

  if (ffmpegProc.stderr) {
    ffmpegProc.stderr.setEncoding('utf8');
    ffmpegProc.stderr.on('data', (chunk: string) => stderrRing.append(chunk));
    ffmpegProc.stderr.on('close', () => {
      stderrRing.close();
      state.stderrClosed = true;
      tryEndSpawn(state, stdoutRing, stderrRing, endCB, ended);
    });
  }
}

function attachStderrEvents(self: FfmpegCommandThis, stderrRing: LinesRing): void {
  if (self.listeners('stderr').length > 0) {
    stderrRing.callback((line) => self.emit('stderr', line));
  }
  if (self.listeners('codecData').length > 0) {
    let codecDataSent = false;
    const codecObject = {};
    stderrRing.callback((line) => {
      if (!codecDataSent) {
        codecDataSent = utils.extractCodecData(self, line, codecObject);
      }
    });
  }
  if (self.listeners('progress').length > 0) {
    stderrRing.callback((line) => utils.extractProgress(self, line));
  }
}

function pipeInputStream(
  inputStream: InputState,
  ffmpegProc: ChildProcess,
  emitEnd: (err: ReportingError | null, stdout?: string, stderr?: string) => void,
): void {
  const source = inputStream.source as Readable;
  source.on('error', (err) => {
    const reportingErr: ReportingError = new Error(`Input stream error: ${err.message}`);
    reportingErr.inputStreamError = err;
    emitEnd(reportingErr);
    ffmpegProc.kill();
  });
  source.resume();
  source.pipe(ffmpegProc.stdin!);
  // ffmpeg will fail anyway if stdin closes early; swallow to prevent uncaught.
  ffmpegProc.stdin?.on('error', () => {});
}

function pipeOutputStream(
  self: FfmpegCommandThis,
  outputStream: OutputState,
  ffmpegProc: ChildProcess,
  stdoutRing: LinesRing,
  stderrRing: LinesRing,
  emitEnd: (err: ReportingError | null, stdout?: string, stderr?: string) => void,
): void {
  const target = outputStream.target as Writable;
  ffmpegProc.stdout!.pipe(target, outputStream.pipeopts);
  target.on('close', () => {
    self.logger.debug('Output stream closed, scheduling kill for ffmpeg process');
    // Give ffmpeg a chance to exit cleanly first; under load 'exit' sometimes
    // arrives after the output stream's 'close'.
    setTimeout(() => {
      emitEnd(new Error('Output stream closed'));
      ffmpegProc.kill();
    }, OUTPUT_STREAM_GRACE_MS);
  });
  target.on('error', (err) => {
    self.logger.debug('Output stream error, killing ffmpeg process');
    const reportingErr: ReportingError = new Error(`Output stream error: ${err.message}`);
    reportingErr.outputStreamError = err;
    emitEnd(reportingErr, stdoutRing.get(), stderrRing.get());
    ffmpegProc.kill('SIGKILL');
  });
}

function setupTimeout(
  self: FfmpegCommandThis,
  ffmpegProc: ChildProcess,
  stdoutRing: LinesRing,
  stderrRing: LinesRing,
  emitEnd: (err: ReportingError | null, stdout?: string, stderr?: string) => void,
): void {
  if (!self.options.timeout) return;
  const timeout = self.options.timeout;
  self.processTimer = setTimeout(() => {
    const msg = `process ran into a timeout (${timeout}s)`;
    emitEnd(new Error(msg), stdoutRing.get(), stderrRing.get());
    ffmpegProc.kill();
  }, timeout * MS_PER_SECOND);
}

async function runFlvtoolOnOutput(flvtool: string, output: OutputState): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = output.target as string;
    const child = spawn(flvtool, ['-U', target], { windowsHide: true });
    child.on('error', (err) => {
      reject(new Error(`Error running ${flvtool} on ${target}: ${err.message}`));
    });
    child.on('exit', (code, signal) => {
      if (code === 0 && !signal) {
        resolve();
        return;
      }
      const reason = signal ? `received signal ${signal}` : `exited with code ${code}`;
      reject(new Error(`${flvtool} ${reason} when running on ${target}`));
    });
  });
}

function injectStrictExperimental(
  args: ArgValue[],
  encoders: Record<string, { experimental: boolean }>,
): ArgValue[] {
  const out = [...args];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== '-acodec' && out[i] !== '-vcodec') continue;
    const codec = out[i + 1];
    if (typeof codec !== 'string' || !(codec in encoders) || !encoders[codec].experimental)
      continue;
    out.splice(i + 2, 0, '-strict', 'experimental');
    i += 3;
  }
  return out;
}

function startEarlyMetadataProbe(self: FfmpegCommandThis): void {
  if (self.listeners('progress').length > 0) {
    runFfprobeIntoCommand(self);
    return;
  }
  self.once('newListener', function (this: FfmpegCommandThis, event: string) {
    if (event === 'progress') runFfprobeIntoCommand(this);
  });
}

function applyProcessor(proto: FfmpegCommandPrototype): void {
  proto._spawnFfmpeg = function (
    this: FfmpegCommandThis,
    args: ArgValue[],
    options: SpawnOptions | ProcessCallback | SpawnEndCallback,
    processCB?: ProcessCallback | SpawnEndCallback,
    endCB?: SpawnEndCallback,
  ) {
    const { options: opts, callbacks } = normaliseSpawnArgs(options, processCB, endCB);
    const maxLines = opts.stdoutLines ?? this.options.stdoutLines ?? 100;

    this._getFfmpegPath((err, command) => {
      if (err) {
        callbacks.endCB(err);
        return;
      }
      if (!command || command.length === 0) {
        callbacks.endCB(new Error('Cannot find ffmpeg'));
        return;
      }

      const niced = applyNiceness(command, args, opts.niceness);
      const stdoutRing = utils.linesRing(maxLines);
      const stderrRing = utils.linesRing(maxLines);
      const stringArgs = niced.args.map(String);
      const ffmpegProc = spawn(niced.command, stringArgs, opts);

      const state: SpawnState = {
        exitError: null,
        processExited: false,
        stdoutClosed: false,
        stderrClosed: false,
        captureStdout: opts.captureStdout ?? false,
      };
      const ended = { value: false };
      attachExitHandlers(ffmpegProc, state, stdoutRing, stderrRing, callbacks.endCB, ended);

      callbacks.processCB(ffmpegProc, stdoutRing, stderrRing);
    });
  };

  proto._getArguments = function (this: FfmpegCommandThis): ArgValue[] {
    const fileOutput = this._outputs.some((o) => o.isFile === true);
    return ([] as ArgValue[]).concat(
      buildInputArgs(this._inputs),
      this._global.get(),
      fileOutput ? ['-y'] : [],
      this._complexFilters.get(),
      buildOutputArgs(this._outputs),
    );
  };

  proto._prepare = function (
    this: FfmpegCommandThis,
    callback: PrepareCallback,
    readMetadata?: boolean,
  ) {
    const checkCapabilities = (): Promise<void> =>
      new Promise((resolve, reject) => {
        this._checkCapabilities((err) => (err ? reject(err) : resolve()));
      });
    const readFfprobe = (): Promise<void> =>
      new Promise((resolve) => {
        this.ffprobe(0, (_err: Error | null, data?: FfprobeData) => {
          if (data) this._ffprobeData = data;
          resolve();
        });
      });
    const ensureFlvtool = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const needsFlvtool = this._outputs.some((output) => {
          if (output.flags.flvmeta && !output.isFile) {
            this.logger.warn('Updating flv metadata is only supported for files');
            output.flags.flvmeta = false;
          }
          return output.flags.flvmeta;
        });
        if (!needsFlvtool) {
          resolve();
          return;
        }
        this._getFlvtoolPath((err) => (err ? reject(err) : resolve()));
      });
    const fetchEncoders = (): Promise<Record<string, { experimental: boolean }>> =>
      new Promise((resolve, reject) => {
        this.availableEncoders((err, encoders) =>
          err || !encoders ? reject(err) : resolve(encoders),
        );
      });

    (async () => {
      await checkCapabilities();
      if (readMetadata) await readFfprobe();
      await ensureFlvtool();
      const args = this._getArguments();
      const encoders = await fetchEncoders();
      return injectStrictExperimental(args, encoders).map(String);
    })().then(
      (args) => callback(null, args),
      (err) => callback(err as Error),
    );

    if (!readMetadata) startEarlyMetadataProbe(this);
  };

  proto.exec =
    proto.execute =
    proto.run =
      function (this: FfmpegCommandThis) {
        const outputPresent = this._outputs.some((output) => 'target' in output);
        if (!outputPresent) throw new Error('No output specified');

        const outputStream = this._outputs.find(isStreamOutput);
        const inputStream = this._inputs.find(isStreamInput);

        let ended = false;
        const emitEnd = (err: ReportingError | null, stdout?: string, stderr?: string): void => {
          if (ended) return;
          ended = true;
          if (err) this.emit('error', err, stdout, stderr);
          else this.emit('end', stdout, stderr);
        };

        this._prepare((err, args) => {
          if (err || !args) {
            emitEnd(err);
            return;
          }
          this._spawnFfmpeg(
            args,
            {
              captureStdout: !outputStream,
              niceness: this.options.niceness,
              cwd: this.options.cwd,
              windowsHide: true,
            } as SpawnOptions,
            (ffmpegProc, stdoutRing, stderrRing) => {
              this.ffmpegProc = ffmpegProc;
              this.emit('start', `ffmpeg ${args.join(' ')}`);

              if (inputStream) pipeInputStream(inputStream, ffmpegProc, emitEnd);
              setupTimeout(this, ffmpegProc, stdoutRing, stderrRing, emitEnd);
              if (outputStream) {
                pipeOutputStream(this, outputStream, ffmpegProc, stdoutRing, stderrRing, emitEnd);
              }
              attachStderrEvents(this, stderrRing);
            },
            (spawnErr, stdoutRing, stderrRing) => {
              clearTimeout(this.processTimer);
              delete this.ffmpegProc;

              if (spawnErr) {
                if (stderrRing && /ffmpeg exited with code/.test(spawnErr.message)) {
                  spawnErr.message += `: ${utils.extractError(stderrRing.get())}`;
                }
                emitEnd(spawnErr, stdoutRing?.get(), stderrRing?.get());
                return;
              }

              const flvmetaOutputs = this._outputs.filter((o) => o.flags.flvmeta);
              if (flvmetaOutputs.length === 0) {
                emitEnd(null, stdoutRing?.get(), stderrRing?.get());
                return;
              }

              this._getFlvtoolPath((flvErr, flvtool) => {
                if (flvErr || !flvtool) {
                  emitEnd(flvErr ?? new Error('flvtool not found'));
                  return;
                }
                Promise.all(flvmetaOutputs.map((o) => runFlvtoolOnOutput(flvtool, o))).then(
                  () => emitEnd(null, stdoutRing?.get(), stderrRing?.get()),
                  (flvtoolErr: Error) => emitEnd(flvtoolErr),
                );
              });
            },
          );
        });

        return this;
      };

  proto.renice = function (this: FfmpegCommandThis, niceness?: number) {
    if (utils.isWindows) return this;
    let actual = niceness ?? 0;
    if (actual < NICENESS_MIN || actual > NICENESS_MAX) {
      this.logger.warn(
        `Invalid niceness value: ${actual}, must be between ${NICENESS_MIN} and ${NICENESS_MAX}`,
      );
    }
    actual = Math.min(NICENESS_MAX, Math.max(NICENESS_MIN, actual));
    this.options.niceness = actual;

    if (!this.ffmpegProc) return this;
    const logger = this.logger;
    const pid = this.ffmpegProc.pid!;
    const renice = spawn('renice', [String(actual), '-p', String(pid)], { windowsHide: true });
    renice.on('error', (err) => logger.warn(`could not renice process ${pid}: ${err.message}`));
    renice.on('exit', (code, signal) => {
      if (signal) {
        logger.warn(`could not renice process ${pid}: renice was killed by signal ${signal}`);
      } else if (code) {
        logger.warn(`could not renice process ${pid}: renice exited with ${code}`);
      } else {
        logger.info?.(`successfully reniced process ${pid} to ${actual} niceness`);
      }
    });
    return this;
  };

  proto.kill = function (this: FfmpegCommandThis, signal?: string) {
    if (!this.ffmpegProc) {
      this.logger.warn('No running ffmpeg process, cannot send signal');
    } else {
      this.ffmpegProc.kill((signal ?? 'SIGKILL') as NodeJS.Signals);
    }
    return this;
  };
}

export = applyProcessor;
