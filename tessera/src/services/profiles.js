// Contributor profiles, and reputation that belongs to the contributor: an exportable
// record signed with the platform's Ed25519 key that anyone can verify.
import { UserError, must, getUser, profileOf } from './core.js';
import { s } from '../lib/schema.js';
import { ENUMS } from '../db/schema.js';
import { summarizeReputation, REP_REASONS } from '../domain/reputation.js';
import { userEarnings } from '../domain/ledger.js';
import { generateSigningKeyPair, signPayload, verifySignedRecord } from '../lib/crypto.js';

const ProfileSchema = s.object({
  skills: s.array(s.object({ tag: s.string().regex(/^[a-z0-9-]+$/, 'skill tags are kebab-case'), selfLevel: s.int().min(1).max(5) })).min(1),
  languages: s.array(s.string().regex(/^[a-z]{2}$/, 'use two-letter language codes')).min(1),
  tools: s.array(s.string()).default([]),
  timezone: s.string().min(1),
  availability: s.array(s.object({ day: s.int().min(0).max(6), start: s.string().regex(/^\d{2}:\d{2}$/), end: s.string().regex(/^\d{2}:\d{2}$/) })),
  weeklyHoursCap: s.int().min(1).max(60),
  payFloorCents: s.int().min(0).max(100000),
  llmMode: s.enum(ENUMS.LlmMode),
  briefStyle: s.enum(ENUMS.BriefStyle),
  briefLanguage: s.string().optional(),
  llm: s.object({
    provider: s.enum(['anthropic', 'openai']).default('anthropic'),
    model: s.string().optional(),
    baseUrl: s.string().optional(),
    ollamaUrl: s.string().optional(),
    ollamaModel: s.string().optional(),
  }).default({ provider: 'anthropic' }),
});

export function updateProfile(T, actorId, profile) {
  const parsed = ProfileSchema.safeParse(profile);
  if (!parsed.success) throw new UserError(`Check your profile: ${parsed.error.message}`);
  const p = parsed.data;
  const tags = p.skills.map((x) => x.tag);
  if (new Set(tags).size !== tags.length) throw new UserError('Each skill can be listed once.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: p.timezone }); } catch { throw new UserError(`Unknown time zone "${p.timezone}".`); }
  return T.db.tx((tx) => {
    getUser(tx, actorId);
    const existing = profileOf(tx, actorId);
    tx.update('User', actorId, { isContributor: true });
    if (existing) return tx.update('ContributorProfile', existing.id, p);
    return tx.insert('ContributorProfile', { userId: actorId, ...p });
  }, { actor: actorId });
}

/** Loads or creates this instance's signing key and publishes its public half in the world. */
export async function ensureSigningKey(T) {
  let key = await T.keystore.get();
  if (!key) {
    key = await generateSigningKeyPair({ extractable: false });
    key.createdAt = Date.now();
    await T.keystore.put(key);
  }
  const published = T.db.meta.signingKey;
  if (!published || published.keyId !== key.keyId) {
    T.db.tx((tx) => tx.setMeta({ signingKey: { keyId: key.keyId, publicKeyB64: key.publicKeyB64, createdAt: key.createdAt } }));
  }
  return key;
}

export async function exportReputation(T, userId) {
  const user = getUser(T.db, userId);
  const now = T.clock.now();
  const events = T.db.filter('ReputationEvent', (e) => e.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  const summary = summarizeReputation(events, userId, now);
  const key = await ensureSigningKey(T);
  const payload = {
    type: 'tessera.reputation.v1',
    issuer: { name: 'Tessera (demo instance)', keyId: key.keyId, publicKey: key.publicKeyB64, algorithm: 'Ed25519' },
    subject: { id: user.id, name: user.name },
    issuedAt: new Date(now).toISOString(),
    method: 'Per-skill smoothed acceptance rate R = (accepted + 2) / (attempts + 4); events older than 12 months count half.',
    skills: Object.values(summary.skills).sort((a, b) => b.accepted - a.accepted).map((x) => ({
      tag: x.tag, accepted: x.accepted, attempts: x.attempts, score: Math.round(x.score * 1000) / 1000, highestTier: x.highestTier,
    })),
    totals: { acceptedWork: summary.totalAccepted, earningsCents: userEarnings(T.db.all('LedgerEntry'), userId) },
    events: events.map((e) => ({ at: new Date(e.createdAt).toISOString(), skill: e.skillTag, reason: e.reason, label: REP_REASONS[e.reason]?.label, delta: e.delta, tier: e.tier, tileId: e.tileId })),
  };
  const signature = await signPayload(key.privateKey, payload);
  return { ...payload, signature };
}

export function verifyRecord(record, publicKeyB64) {
  return verifySignedRecord(record, publicKeyB64);
}

export function requireProfile(db, userId) {
  return must(profileOf(db, userId), 'Set up a contributor profile first.');
}
