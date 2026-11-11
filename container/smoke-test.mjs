// Runs against a new, empty, disposable volume; never mounts a real OAuth profile.
// Requires Node >=22.19 and a running Docker Linux engine. No Google login/calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const project = `antigravity-smoke-${randomBytes(5).toString('hex')}`;
const port = Number(process.env.ANTIGRAVITY_TEST_PORT || 18086);
assert(Number.isInteger(port) && port > 1024 && port <= 65535, 'Invalid test port');
const env = { ...process.env, ANTIGRAVITY_HTTP_PORT: String(port) };
function docker(args, timeout = 30_000) {
    return execFileSync('docker', args, {
        cwd, env, encoding: 'utf8', timeout, windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}
const compose = (...args) => docker(['compose', '-p', project, ...args], 600_000);
const base = `http://127.0.0.1:${port}`;
const request = (url, options = {}) => fetch(url, {
    ...options, signal: AbortSignal.timeout(8_000),
});
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

try {
    assert.equal(docker(['info', '--format', '{{.OSType}}'], 15_000), 'linux');
} catch {
    console.error('Docker Linux engine unavailable. Start/fix Docker Desktop before running this test.');
    process.exit(1);
}
compose('config', '--quiet');
console.log('Building image (includes SQLite, OpenAI compatibility and registry tests)...');
compose('build', 'proxy');
let started = false;
try {
    // Setting this before up ensures cleanup even when creation/start only partially succeeds.
    started = true;
    compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '60');
    let id = compose('ps', '-q', 'proxy');
    const run = source => docker(['exec', id, 'bun', '--eval', source]);
    const details = JSON.parse(docker(['inspect', id]))[0];
    assert.equal(details.Config.User, '1000:1000');
    assert.equal(details.HostConfig.ReadonlyRootfs, true);
    assert(details.HostConfig.CapDrop.includes('ALL'));
    assert(details.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    for (const bindings of Object.values(details.HostConfig.PortBindings)) {
        assert(bindings.every(binding => binding.HostIp === '127.0.0.1'));
    }
    assert(!details.Mounts.some(mount => mount.Type === 'bind'));
    assert.equal(details.HostConfig.Memory, 512 * 1024 * 1024);
    assert.equal(details.HostConfig.PidsLimit, 128);

    const health = await (await request(`${base}/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.counts.total, 0);
    assert.equal((await request(`${base}/v1/models`)).status, 503,
        'An empty profile must not advertise placeholder models');
    const invalid = await request(`${base}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.type, 'invalid_request_error');
    assert.match(compose('logs', '--no-color', 'proxy'), /database fallback disabled/i);

    run(`const fs = require('fs');
        try { fs.writeFileSync('/app/write-probe', 'x'); throw Error('Root writable'); }
        catch (e) { if (!['EROFS', 'EACCES'].includes(e.code)) throw e; }
        fs.writeFileSync('/data/smoke-marker', 'persist');`);

    // Verify callback forwarding and cleanup, using cancellation rather than Google OAuth.
    const callbackListening = () => run(`const fs = require('fs');
        const listening = ['tcp','tcp6'].some(name => fs.readFileSync('/proc/net/' + name, 'utf8')
            .split('\\n').slice(1).some(line => {
                const c = line.trim().split(/\\s+/);
                return c[1]?.endsWith(':94C0') && c[3] === '0A';
            })); console.log(listening);`) === 'true';
    assert.equal(callbackListening(), false);
    const auth = await (await request(`${base}/api/auth/url`)).json();
    assert.equal(auth.status, 'ok');
    assert.equal(new URL(auth.url).searchParams.get('redirect_uri'),
        'http://localhost:38080/oauth-callback');
    for (let attempt = 0; attempt < 30 && !callbackListening(); attempt++) await pause();
    assert.equal(callbackListening(), true);
    const cancelled = await request('http://127.0.0.1:38080/oauth-callback?error=access_denied');
    assert.equal(cancelled.status, 400);
    await cancelled.text();
    for (let attempt = 0; attempt < 30 && callbackListening(); attempt++) await pause();
    assert.equal(callbackListening(), false);

    compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '60');
    id = compose('ps', '-q', 'proxy');
    assert.equal(run("console.log(require('fs').readFileSync('/data/smoke-marker', 'utf8'))"), 'persist');
    compose('stop', 'proxy');
    const stopped = JSON.parse(docker(['inspect', id]))[0];
    assert.equal(stopped.State.Running, false);
    assert.equal(stopped.State.ExitCode, 0, 'Proxy should stop gracefully on SIGTERM');
    let closed = false;
    try { await request(`${base}/favicon.svg`); } catch { closed = true; }
    assert(closed, 'HTTP port must be closed after stop');
    console.log('PASS: health, empty accounts, OpenAI route, callback lifecycle, isolation, persistence, shutdown.');
    console.log(docker(['image', 'inspect', 'antigravity-proxy:0.4.0-local',
        '--format', 'Image: {{.Id}}; size: {{.Size}} bytes']));
} finally {
    // Only this randomly named test project's empty profile is removed.
    if (started) compose('down', '--volumes', '--remove-orphans');
}
