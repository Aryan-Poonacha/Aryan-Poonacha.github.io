// Run only when configuring/rotating static access, never as a service.
// Secret values are captured in memory; only authenticated ciphertext is written.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const password = require('../admin/password.js'), GH = require('../admin/github.js');
(async () => {
  const reference = process.argv[2];
  if (!/^op:\/\/[^/]+\/[^/]+\/[^/?]+$/.test(reference || '')) throw new Error('Provide the existing 1Password password reference.');
  const file = path.resolve(__dirname, '../content/publishing.json'), config = JSON.parse(fs.readFileSync(file));
  const secret = execFileSync('op-agent-peer', ['personal', 'read', reference, '--no-newline'], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (secret.length < 20 || new Set(secret).size < 10) throw new Error('The saved password must have at least 20 characters and 10 distinct characters.');
  const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await new GH.Client(config, token).authorize();
  config.accessEnvelope = await password.seal(secret, token, config.repository);
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log('Static access configured using the existing 1Password password and owner GitHub credential. No plaintext secrets written.');
})().catch(() => { console.error('Static access configuration failed; no credentials were logged.'); process.exitCode = 1; });
