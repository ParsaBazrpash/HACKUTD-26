// Makes the pager's ECDH P-256 key pair and prints the two env lines.
// It writes no files. Run it on your own machine:
//
//   node scripts/pager-keys.mjs
//
// PAGER_PRIVATE_KEY (pkcs8, base64url) is a server-only secret: put it in Vercel
// Production as a Secret and nowhere else. NEXT_PUBLIC_PAGER_PUB (raw, 65 bytes,
// base64url) is public: browsers seal phone numbers to it.

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveBits',
]);
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));

console.log(`NEXT_PUBLIC_PAGER_PUB=${b64url(pub)}`);
console.log(`PAGER_PRIVATE_KEY=${b64url(priv)}`);
console.error('\nKeep PAGER_PRIVATE_KEY out of the repo and out of chat. Only the public line is safe to share.');
