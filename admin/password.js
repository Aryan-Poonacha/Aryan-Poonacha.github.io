/* Static password unlock: only ciphertext is published. GitHub authorizes every write. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PortfolioPassword = factory();
})(this, function () {
  const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const base64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
  async function key(password, salt, iterations) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function seal(password, token, repository) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iterations = 600000;
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(repository) }, await key(password, salt, iterations), new TextEncoder().encode(token));
    return { version: 1, iterations, salt: base64(salt), iv: base64(iv), data: base64(data) };
  }
  async function unlock(password, envelope, repository) {
    try {
      if (envelope.version !== 1 || envelope.iterations !== 600000 || envelope.data.length > 16384) throw new Error();
      const salt = bytes(envelope.salt), iv = bytes(envelope.iv);
      if (salt.length !== 16 || iv.length !== 12) throw new Error();
      const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(repository) }, await key(password, salt, envelope.iterations), bytes(envelope.data));
      return new TextDecoder().decode(data);
    } catch (e) { throw new Error("That password did not match. Use Portfolio Website Admin in 1Password."); }
  }
  return { seal, unlock };
});
