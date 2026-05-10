import { platform } from 'node:os';
import { execSync } from 'node:child_process';

interface Logger {
  debug(arg: string): void;
  info(arg: string): void;
  warn(arg: string): void;
  error(arg: string): void;
}

function getFfmpegCheck(): string {
  if (!/win(32|64)/.test(platform())) return 'which ffmpeg';
  return 'where /Q ffmpeg';
}

function isCommandInPath(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? `where /Q ${cmd}` : `command -v ${cmd}`;
    // eslint-disable-next-line sonarjs/os-command -- PATH probe: shell builtin with our own cmd arg, used only to skip ffmpeg-dependent tests
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

const COV = process.env.FLUENTFFMPEG_COV === '1';
const log = (level: string, arg: string) => {
  if (!COV) console.log(`          [${level}] ${arg}`);
};

const logger: Logger = {
  debug: (arg) => log('DEBUG', arg),
  info: (arg) => log('INFO', arg),
  warn: (arg) => log('WARN', arg),
  error: (arg) => log('ERROR', arg),
};

interface ErrorWithFfmpeg extends Error {
  ffmpegOut?: string;
  ffmpegErr?: string;
  spawnErr?: Error;
}

function dumpFfmpegError(err: ErrorWithFfmpeg, label = ''): void {
  console.log(`got error: ${err.stack ?? err}`);
  if (err.ffmpegOut) {
    console.log(`---${label}stdout---`);
    console.log(err.ffmpegOut);
  }
  if (err.ffmpegErr) {
    console.log(`---${label}stderr---`);
    console.log(err.ffmpegErr);
  }
  if (err.spawnErr) {
    console.log(`---${label}spawn error---`);
    console.log(err.spawnErr.stack ?? err.spawnErr);
  }
}

function logArgError(err?: ErrorWithFfmpeg | null): void {
  if (!err) return;
  dumpFfmpegError(err);
}

function logError(err?: ErrorWithFfmpeg | null, stdout?: string, stderr?: string): void {
  if (err) dumpFfmpegError(err, 'metadata ');
  if (stdout) {
    console.log('---stdout---');
    console.log(stdout);
  }
  if (stderr) {
    console.log('---stderr---');
    console.log(stderr);
  }
}

function logOutput(stdout?: string, stderr?: string): void {
  if (stdout) {
    console.log('---stdout---');
    console.log(stdout);
  }
  if (stderr) {
    console.log('---stderr---');
    console.log(stderr);
  }
}

const helpers = {
  getFfmpegCheck,
  isCommandInPath,
  logger,
  logArgError,
  logError,
  logOutput,
  toError,
};
export = helpers;
