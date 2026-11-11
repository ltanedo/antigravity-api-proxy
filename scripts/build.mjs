import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const unsigned = process.argv.includes('--unsigned');
const env = { ...process.env };
// A regular build always signs, even if an unsigned development flag was inherited.
delete env.ANTIGRAVITY_UNSIGNED_BUILD;
if (unsigned) env.ANTIGRAVITY_UNSIGNED_BUILD = '1';
else if (process.platform === 'win32') {
  const check = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./sign-windows.ps1', import.meta.url)), '-CheckConfiguration',
  ], { env, stdio: 'inherit' });
  if (check.error) throw check.error;
  if (check.status !== 0) process.exit(check.status ?? 1);
}
const result = spawnSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'build'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
