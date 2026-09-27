// npm run verify:record -- record.json [base64PublicKey]
// Verifies an exported reputation record's Ed25519 signature. Without a key argument it
// uses the key named in the record, which proves integrity but not who issued it.
import { readFile } from 'node:fs/promises';
import { verifySignedRecord } from '../src/lib/crypto.js';

const [file, key] = process.argv.slice(2);
if (!file) { console.error('Usage: npm run verify:record -- record.json [base64PublicKey]'); process.exit(2); }
const record = JSON.parse(await readFile(file, 'utf8'));
const publicKey = key || record.issuer?.publicKey;
const r = await verifySignedRecord(record, publicKey);
console.log(`${r.valid ? 'VALID' : 'NOT VALID'}: ${r.reason}`);
if (!key) console.log('(Checked against the key inside the record. Pass the issuer’s published key to check who signed it.)');
process.exit(r.valid ? 0 : 1);
