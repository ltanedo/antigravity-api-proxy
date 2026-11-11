import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runtime = fileURLToPath(new URL(`../bundled-runtime/${process.platform === 'win32' ? 'bun.exe' : 'bun'}`, import.meta.url));
execFileSync(runtime, ['--eval', `
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  if (db.prepare('select 1 as ok').get().ok !== 1) throw new Error('SQLite smoke check failed');
  db.close();
  console.log('Staged Bun: better-sqlite3 native module loaded and queried successfully.');
`], {
  cwd: fileURLToPath(new URL('../proxy-app/', import.meta.url)),
  stdio: 'inherit', windowsHide: true,
});
