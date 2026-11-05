const test = require('node:test'), assert = require('node:assert/strict');
const password = require('../admin/password.js');
const secret = 'deliberate-fixture-password-2026', token = 'fixture-owner-credential', repo = 'Aryan-Poonacha/Aryan-Poonacha.github.io';
test('static credential encryption', async t => {
  const envelope = await password.seal(secret, token, repo);
  await t.test('correct password recovers the credential', async () => assert.equal(await password.unlock(secret, envelope, repo), token));
  await t.test('published envelope contains neither secret', () => { const value = JSON.stringify(envelope); assert(!value.includes(secret)); assert(!value.includes(token)); });
  await t.test('wrong password cannot recover access', async () => assert.rejects(password.unlock('wrong-password', envelope, repo)));
  await t.test('ciphertext tampering is refused', async () => assert.rejects(password.unlock(secret, { ...envelope, data: (envelope.data[0] === 'A' ? 'B' : 'A') + envelope.data.slice(1) }, repo)));
  await t.test('another repository cannot reuse the envelope', async () => assert.rejects(password.unlock(secret, envelope, 'other/repo')));
  await t.test('invalid work factors are refused', async () => assert.rejects(password.unlock(secret, { ...envelope, iterations: 1 }, repo)));
  await t.test('fresh encryption does not reuse salt or IV', async () => { const next = await password.seal(secret, token, repo); assert.notEqual(next.salt, envelope.salt); assert.notEqual(next.iv, envelope.iv); });
});
