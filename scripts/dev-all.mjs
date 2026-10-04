// Runs the API server and the Vite dev server together (no extra dependencies).
import { spawn } from 'node:child_process';
const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });
const procs = [run(['server/index.js']), run(['node_modules/vite/bin/vite.js', '--host', '--port', '5173', '--strictPort'])];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop); process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
