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
if (result.status !== 0) process.exit(result.status ?? 1);
// Tauri restores its original, unsigned executable after bundling. Sign that final
// release EXE too; the installers already contain the copy signed by signCommand.
if (process.platform === 'win32' && !unsigned) {
  const finalSign = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./sign-windows.ps1', import.meta.url)),
    fileURLToPath(new URL('../src-tauri/target/release/antigravity-proxy-tray.exe', import.meta.url)),
  ], { env, stdio: 'inherit' });
  if (finalSign.error) throw finalSign.error;
  if (finalSign.status !== 0) process.exit(finalSign.status ?? 1);
}
