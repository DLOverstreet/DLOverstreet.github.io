// Ed25519 signing for exportable reputation records, via WebCrypto (browsers and Node 22).
import { bytesToBase64, base64ToBytes, canonicalJson, textToBytes } from './util.js';

const ALG = { name: 'Ed25519' };

export function ed25519Supported() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

/** Generates a key pair. The private key is non-extractable unless asked otherwise. */
export async function generateSigningKeyPair({ extractable = false } = {}) {
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(ALG, extractable, ['sign', 'verify']));
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyB64: bytesToBase64(raw), keyId: await keyIdFor(raw) };
}

export async function keyIdFor(rawPublicKey) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', rawPublicKey));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function importPublicKey(b64) {
  return crypto.subtle.importKey('raw', base64ToBytes(b64), ALG, true, ['verify']);
}

/** Signs the canonical JSON of `payload` and returns a base64 signature. */
export async function signPayload(privateKey, payload) {
  const sig = await crypto.subtle.sign(ALG, privateKey, textToBytes(canonicalJson(payload)));
  return bytesToBase64(new Uint8Array(sig));
}

/**
 * Verifies a signed record `{ ...payload, signature }` against a base64 public key.
 * @returns {Promise<{valid: boolean, reason: string}>}
 */
export async function verifySignedRecord(record, publicKeyB64) {
  if (!record || typeof record !== 'object' || typeof record.signature !== 'string') {
    return { valid: false, reason: 'The record has no signature field.' };
  }
  const { signature, ...payload } = record;
  let key;
  try { key = await importPublicKey(publicKeyB64); } catch { return { valid: false, reason: 'That public key is not a valid Ed25519 key.' }; }
  let ok;
  try {
    ok = await crypto.subtle.verify(ALG, key, base64ToBytes(signature), textToBytes(canonicalJson(payload)));
  } catch {
    return { valid: false, reason: 'The signature is malformed.' };
  }
  return ok
    ? { valid: true, reason: 'Signature matches. The record has not been changed since it was signed.' }
    : { valid: false, reason: 'Signature does not match. The record was changed, or it was signed with a different key.' };
}
