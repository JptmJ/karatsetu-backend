/**
 * The private screen: opened from the Billing icon with its own password.
 * The password lives only on the server, as a scrypt hash in the shop's settings.
 */
import { z } from 'zod';
import { defineRoute } from '../core/http/route-registry.js';
import { transaction } from '../core/db/client.js';
import { CONFIG } from '../core/config/definitions.js';
import { getConfig, setConfig } from '../core/config/config-service.js';
import { BusinessRuleError } from '../core/errors/app-error.js';
import { hashPassword, verifyPassword } from '../modules/identity/auth.service.js';
import { errorEnvelope, record } from './schemas.js';

const DAY = '2026-10-01';
const added = (note: string) => [{ date: DAY, kind: 'added' as const, note }];
const P = '/api/private-screen';

/** Five wrong tries lock a user out of the screen for five minutes (per server process). */
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60_000;
const tries = new Map<string, { count: number; until: number }>();

async function check(tx: Parameters<Parameters<typeof transaction>[0]>[0], password: string) {
  const who = `${tx.context.tenantId}:${tx.context.userId}`;
  const t = tries.get(who);
  if (t && t.until > Date.now()) {
    throw new BusinessRuleError(`Too many wrong passwords. Try again in ${Math.ceil((t.until - Date.now()) / 60_000)} minute(s).`, 'rate_limited');
  }
  if (await verifyPassword(password, await getConfig(tx, CONFIG.privateScreenPassword))) { tries.delete(who); return; }
  const count = (t && t.until === 0 ? t.count : 0) + 1; // an expired lock starts the count again
  tries.set(who, { count, until: count >= MAX_TRIES ? Date.now() + LOCK_MS : 0 });
  throw new BusinessRuleError('That password is not right.', 'password_invalid');
}

defineRoute({
  method: 'post', path: `${P}/unlock`, module: 'core', summary: 'Open the private screen',
  description: 'Checks the private screen password. Five wrong tries lock the user out for five minutes.',
  body: z.object({ password: z.string().min(1).max(200) }),
  responses: [{ status: 200, description: 'Right password.', schema: record }, { status: 422, description: 'Wrong password, or locked out.', schema: errorEnvelope }],
  changelog: added('Private screen.'),
  handler: async (req) => transaction(async (tx) => { await check(tx, req.body.password); return { ok: true }; }),
});

defineRoute({
  method: 'post', path: `${P}/password`, module: 'core', summary: 'Change the private screen password',
  permission: 'settings.config.update',
  body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) }),
  responses: [{ status: 200, description: 'Changed.', schema: record }, { status: 422, description: 'Current password wrong.', schema: errorEnvelope }],
  changelog: added('Change the private screen password.'),
  handler: async (req) => transaction(async (tx) => {
    await check(tx, req.body.currentPassword);
    await setConfig(tx, CONFIG.privateScreenPassword.key, await hashPassword(req.body.newPassword), { allowSecret: true, reason: 'Private screen password changed' });
    return { ok: true };
  }),
});
