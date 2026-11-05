// One password from 1Password. The existing gh session stays on the hub.
// Only typed publishing actions may write. No browser credentials or arbitrary GitHub proxy.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const net = require('node:net'), { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const exec = promisify(execFile), GH = require('../admin/github.js'), S = require('../js/schema.js');
const REPOSITORY = 'Aryan-Poonacha/Aryan-Poonacha.github.io', OWNER = 25931656;
const BRANCHES = ['portfolio-drafts', 'portfolio-live'];
const MAX = 34 * 1024 * 1024;
const COOKIE = '__Host-portfolio-admin', LIFETIME = 30 * 24 * 60 * 60;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://aryan-poonacha.github.io; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function one(req, key) {
  const values = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === key).length;
  if (values !== 1 || typeof req.headers[key] !== 'string') fail(403, 'Unverified connection.');
  return req.headers[key];
}
function proxyRequest(req, policy) {
  const ip = one(req, 'x-forwarded-for'), origin = new URL(policy.origin);
  if (!net.isIP(ip) || one(req, 'host') !== 'localhost' || one(req, 'x-forwarded-proto') !== 'https'
    || one(req, 'x-forwarded-host') !== origin.host) fail(403, 'Unverified connection.');
  return ip;
}
function authorizeWrite(req, policy) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (one(req, 'origin') !== policy.origin || one(req, 'x-portfolio-request') !== '1'
      || one(req, 'content-type').toLowerCase() !== 'application/json') fail(403, 'Open the editor before saving.');
  }
}
function passwordAuth(policy, readPassword) {
  let cached, pending;
  const derive = password => promisify(crypto.scrypt)(password, 'portfolio-admin:' + policy.origin, 32);
  async function key(fresh = false) {
    if (!fresh && cached && Date.now() - cached.at < 60000) return cached.key;
    if (!pending) pending = (async () => {
      const password = await readPassword();
      if (!password || password.length > 4096) fail(503, 'Set the password in your Portfolio Website Admin item in 1Password.');
      const value = await derive(password); cached = { key: value, at: Date.now() }; return value;
    })().finally(() => { pending = null; });
    return pending;
  }
  return {
    async login(password) { return crypto.timingSafeEqual(await derive(password), await key(true)); },
    async cookie() {
      const data = Buffer.from(JSON.stringify({ expires: Math.floor(Date.now() / 1000) + LIFETIME })).toString('base64url');
      const signature = crypto.createHmac('sha256', await key()).update(data).digest('base64url');
      // Top-level navigation from the public site must retain the remembered session.
      // Exact Origin and custom-header checks still protect every write.
      return COOKIE + '=' + data + '.' + signature + '; Path=/; Max-Age=' + LIFETIME + '; Secure; HttpOnly; SameSite=Lax';
    },
    async verified(req) {
      const values = (req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(COOKIE + '='));
      if (values.length !== 1) return false;
      const parts = values[0].slice(COOKIE.length + 1).split('.');
      if (parts.length !== 2 || parts[0].length > 200 || !/^[\w-]{43}$/.test(parts[1])) return false;
      try {
        const expected = crypto.createHmac('sha256', await key()).update(parts[0]).digest();
        if (!crypto.timingSafeEqual(expected, Buffer.from(parts[1], 'base64url'))) return false;
        const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        return Number.isInteger(data.expires) && data.expires > Date.now() / 1000 && data.expires <= Date.now() / 1000 + LIFETIME + 60;
      } catch (_) { return false; }
    }
  };
}
function snapshot(value) {
  return { branch: value.branch, sha: value.sha, tree: value.tree, files: [...value.files.values()] };
}
function canonical(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024) fail(400, 'Invalid draft.');
  let doc; try { doc = JSON.parse(text); } catch (_) { fail(400, 'Draft is not valid JSON.'); }
  const issues = S.check(doc).filter(i => i.level === 'error');
  if (issues.length) fail(400, 'Invalid draft: ' + issues[0].msg);
  return S.format(doc);
}
async function body(req, max = MAX) {
  const size = Number(req.headers['content-length']);
  if (!Number.isInteger(size) || size < 2 || size > max || req.headers['transfer-encoding']) fail(413, 'Request is too large.');
  const chunks = []; let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > size || received > max) fail(413, 'Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function nativeClients(config) {
  let verifiedToken = '', checkedAt = 0;
  return async () => {
    const { stdout } = await exec('gh', ['auth', 'token'], { timeout: 10000, maxBuffer: 4096 });
    const token = stdout.trim();
    const client = new GH.Client(config, token, (url, options) => fetch(url, { ...options, redirect: 'error' }));
    if (token !== verifiedToken || Date.now() - checkedAt > 60000) {
      await client.authorize(); verifiedToken = token; checkedAt = Date.now();
    }
    return client;
  };
}
function createHandler({ root, policy, passwordProvider, clientFactory }) {
  if (new URL(policy.origin).protocol !== 'https:' || new URL(policy.origin).origin !== policy.origin || !/^op:\/\/[^/]+\/[^/]+\/[^/?]+$/.test(policy.passwordRef || '')) throw new Error('Invalid private editor policy.');
  const config = { repository: REPOSITORY, draftBranch: BRANCHES[0], liveBranch: BRANCHES[1], siteUrl: 'https://aryan-poonacha.github.io/' };
  clientFactory ||= nativeClients(config);
  passwordProvider ||= async () => (await exec('op-agent-peer', ['personal', 'read', policy.passwordRef, '--no-newline'], { timeout: 45000, maxBuffer: 16384 })).stdout;
  const auth = passwordAuth(policy, passwordProvider), attempts = new Map();
  let active = 0, writing = false;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
  return async (req, res) => {
    let isWrite = false;
    function send(status, data, type = 'application/json') {
      const body = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
      res.writeHead(status, { 'Content-Type': type + (type.startsWith('text/') || type === 'application/json' ? '; charset=utf-8' : ''), 'Content-Length': body.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (active >= 8) return send(429, { message: 'Editor is busy. Try again shortly.' });
    active++;
    try {
      const ip = proxyRequest(req, policy);
      const target = new URL(req.url, policy.origin);
      if (!req.url.startsWith('/') || req.url.startsWith('//') || /%2f|%5c|%00|%25/i.test(req.url)) fail(400, 'Invalid path.');
      const pathname = decodeURIComponent(target.pathname);
      function redirect(where) { res.writeHead(303, { Location: where, 'Cache-Control': 'no-store' }); res.end(); }
      if (pathname === '/admin/login.js' && ['GET', 'HEAD'].includes(req.method)) {
        return send(200, await fs.promises.readFile(path.join(root, 'admin/login.js')), 'text/javascript');
      }
      if (pathname === '/login' && ['GET', 'HEAD'].includes(req.method)) {
        if (await auth.verified(req)) return redirect('/admin/');
        const error = target.searchParams.has('error') ? 'That password did not match. Try your Portfolio Website Admin item in 1Password.' : '';
        return send(200, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Portfolio editor</title><script src="/admin/login.js" defer></script><style>html{color-scheme:dark}body{margin:0;background:#05060b;color:#ede9e2;font:16px/1.5 system-ui;min-height:100dvh;display:grid;place-items:center}main{width:min(400px,calc(100% - 48px));padding:32px 0}h1{font:48px/1.1 Georgia;margin:16px 0}p{color:#9a958d}label{display:block;margin-top:24px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:7px;font:inherit}input{margin:8px 0 20px;background:#0b0d15;color:inherit;border:1px solid #45424a}button{background:#f2a541;color:#1a1205;border:0;cursor:pointer}a{color:#f2a541}small{color:#f2a541;letter-spacing:.08em}input:focus-visible,button:focus-visible{outline:2px solid #f2a541;outline-offset:3px}.error{color:#ee6c5a}</style><main><small>ARYAN POONACHA</small><h1>Portfolio editor</h1><p>One password. Your edits stay separate until you publish.</p><form method="post" action="/__admin/login"><input type="hidden" name="username" autocomplete="username" value="Aryan-Poonacha"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Open editor</button></form><p class="error" role="status">' + error + '</p><p>Saved in 1Password as <b>Portfolio Website Admin</b>.</p><a href="https://aryan-poonacha.github.io/">Back to the site ↗</a></main></html>', 'text/html');
      }
      if (pathname === '/__admin/login' && req.method === 'POST') {
        if (one(req, 'origin') !== policy.origin || one(req, 'content-type').split(';')[0] !== 'application/x-www-form-urlencoded') fail(403, 'Open the sign-in page first.');
        const record = attempts.get(ip), now = Date.now();
        const count = record && now - record.at < 15 * 60000 ? record.count : 0;
        if (count >= 8) fail(429, 'Too many attempts. Try again in 15 minutes.');
        if (attempts.size > 1024) attempts.delete(attempts.keys().next().value);
        attempts.set(ip, { at: record?.at && count ? record.at : now, count: count + 1 });
        const password = new URLSearchParams(await body(req, 8192)).get('password');
        if (!password || password.length > 4096 || !await auth.login(password)) return redirect('/login?error=1');
        attempts.delete(ip); res.setHeader('Set-Cookie', await auth.cookie()); return redirect('/admin/');
      }
      if (!await auth.verified(req)) {
        if (pathname.startsWith('/__admin/')) fail(401, 'Sign in to open the editor.');
        return redirect('/login');
      }
      authorizeWrite(req, policy);
      if (pathname === '/__admin/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', COOKIE + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && pathname.startsWith('/__admin/actions/')) {
        if (writing) fail(409, 'Another save is in progress. Your browser changes are still here.');
        const action = pathname.slice('/__admin/actions/'.length);
        if (!['connect', 'save', 'upload', 'publish'].includes(action) || target.search) fail(404, 'Unknown editor action.');
        writing = isWrite = true;
        let input; try { input = JSON.parse(await body(req)); } catch (e) { if (e.status) throw e; fail(400, 'Invalid JSON request.'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid editor request.');
        const client = await clientFactory();
        let text;
        if (action === 'save' || action === 'publish') text = canonical(input.text);
        let upload;
        if (action === 'upload') {
          if (typeof input.name !== 'string' || input.name.length > 200 || !/\.(mp4|webm|webp|jpg|jpeg|png|gif|avif|pdf)$/i.test(input.name)
            || typeof input.data !== 'string' || input.data.length > 32 * 1024 * 1024 || input.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) fail(400, 'Invalid media upload.');
          upload = Buffer.from(input.data, 'base64');
          if (!upload.length || upload.length > 24 * 1024 * 1024 || upload.toString('base64') !== input.data) fail(400, 'Invalid media upload.');
        }
        const connected = await client.connect();
        if (action !== 'connect' && input.expectedDraft !== client.draft.sha) fail(409, 'The cloud draft changed. Load cloud draft before saving. Your browser changes are still here.');
        if (action === 'publish' && input.expectedLive !== client.live.sha) fail(409, 'The live branch changed. Reload before publishing.');
        let result;
        if (action === 'save') result = await client.save(text);
        if (action === 'upload') result = await client.upload(new Blob([upload]), input.name);
        if (action === 'publish') result = await client.publish(input.view, text);
        return send(200, { result, draft: snapshot(client.draft), live: snapshot(client.live), ...(action === 'connect' ? { text: connected.draft, release: connected.release } : {}) });
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Method not allowed.');
      if (pathname === '/__admin/session') {
        await clientFactory();
        return send(200, { managedAuth: true, owner: { id: OWNER, login: 'Aryan-Poonacha' }, config: { ...config, managedAuth: true } });
      }
      if (pathname.startsWith('/__admin/github/')) {
        const resource = pathname.slice('/__admin/github'.length), repo = '/repos/' + REPOSITORY;
        const relative = resource.startsWith(repo) ? resource.slice(repo.length) : null;
        const allowed = relative === '' || /^\/git\/ref\/heads\/portfolio-(drafts|live)$/.test(relative || '')
          || /^\/git\/(commits|trees|blobs)\/[a-f0-9]{40}$/.test(relative || '');
        if (!allowed || (target.search && !(target.search === '?recursive=1' && /^\/git\/trees\//.test(relative)))) fail(403, 'Unsupported repository read.');
        const client = await clientFactory();
        return send(200, await client.request(relative + target.search));
      }
      if (pathname.startsWith('/__admin/')) fail(404, 'Not found.');
      if (pathname === '/' || pathname === '/index.html' || pathname === '/legacy.html') {
        res.writeHead(302, { Location: pathname === '/legacy.html' ? config.siteUrl + 'legacy.html' : '/admin/', 'Cache-Control': 'no-store' }); return res.end();
      }
      if (pathname === '/content/publishing.json') return send(200, { ...config, managedAuth: true });
      const file = pathname === '/admin/' ? '/admin/index.html' : pathname;
      const extension = path.extname(file).toLowerCase();
      const allowed = ['/galaxy.html', '/content/galaxy.json', '/content/release.json'].includes(file)
        || /^(\/admin\/|\/js\/|\/css\/|\/assets\/|\/notes\/)/.test(file);
      if (!allowed || !types[extension] || file.includes('..') || file.includes('\\') || (/^\/assets\/media\//.test(file) && ['.svg', '.html', '.js', '.css'].includes(extension))) fail(404, 'Not found.');
      const full = path.resolve(root, '.' + file);
      if (!full.startsWith(path.resolve(root) + path.sep) || !fs.statSync(full).isFile()) fail(404, 'Not found.');
      if (extension === '.pdf') res.setHeader('Content-Disposition', 'attachment');
      return send(200, await fs.promises.readFile(full), types[extension]);
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : 503);
      send(status, { message: error.status ? error.message : 'Editor connection is unavailable. Your work is kept in this browser.' });
    } finally { active--; if (isWrite) writing = false; }
  };
}
async function main() {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
  for (const name of ['--root', '--policy', '--socket']) if (!args.includes(name)) throw new Error('Required: --root --policy --socket');
  const policyFile = option('--policy'), socket = option('--socket'), meta = fs.statSync(policyFile);
  if (!meta.isFile() || meta.uid !== process.getuid() || (meta.mode & 0o077)) throw new Error('Policy must be a private user-owned file.');
  if (fs.existsSync(socket)) {
    const alive = await new Promise(resolve => { const conn = net.connect(socket); conn.on('connect', () => { conn.end(); resolve(true); }); conn.on('error', () => resolve(false)); });
    if (alive) throw new Error('Private editor is already running.');
    if (!fs.lstatSync(socket).isSocket()) throw new Error('Refusing to replace a non-socket.');
    fs.unlinkSync(socket);
  }
  process.umask(0o077);
  const server = http.createServer(createHandler({ root: option('--root'), policy: JSON.parse(fs.readFileSync(policyFile)) }));
  server.requestTimeout = 60000; server.headersTimeout = 10000; server.maxConnections = 12;
  server.listen(socket, () => console.log('Private editor ready on its owner-only Unix socket.'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { fs.unlinkSync(socket); process.exit(0); }));
}
if (require.main === module) main().catch(() => { console.error('Private editor failed to start. Check its policy and socket.'); process.exitCode = 1; });
module.exports = { createHandler, passwordAuth, proxyRequest, canonical };
