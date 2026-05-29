import fs from 'fs';
import os from 'os';
import path from 'path';
import selfsigned from 'selfsigned';

const CERT_DIR = process.env.HTTPS_CERT_DIR || path.join(
    os.homedir(),
    '.config',
    'antigravity-proxy',
    'https'
);

const CERT_PATH = path.join(CERT_DIR, 'localhost.crt');
const KEY_PATH = path.join(CERT_DIR, 'localhost.key');

async function createCertificate() {
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const generated = await selfsigned.generate(attrs, {
        algorithm: 'sha256',
        days: 3650,
        keySize: 2048,
        extensions: [{
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
                { type: 7, ip: '::1' }
            ]
        }]
    });

    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.writeFileSync(CERT_PATH, generated.cert, { mode: 0o644 });
    fs.writeFileSync(KEY_PATH, generated.private, { mode: 0o600 });
}

export async function getLocalHttpsCredentials() {
    if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
        await createCertificate();
    }

    return {
        cert: fs.readFileSync(CERT_PATH),
        key: fs.readFileSync(KEY_PATH),
        certPath: CERT_PATH,
        keyPath: KEY_PATH
    };
}
