#!/usr/bin/env node
import { runCli } from '../src/cli/index.js';

const code = await runCli(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
});
process.exitCode = code;
