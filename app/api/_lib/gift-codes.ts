/* Gift codes: the manager makes a code worth N video credits, gives it away,
   and whoever redeems it first gets the credits. One code, one redemption.
   The table is created on first use, so no separate migration has to be run. */

import { HttpError } from "./account";

type Db = { DB: D1Database };

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const MAX_GIFT_CREDITS = 20;
export const MAX_GIFT_BATCH = 20;

let ready = false;
export async function ensureGiftTable(env: Db) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS gift_codes (code TEXT PRIMARY KEY, credits INTEGER NOT NULL, note TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, redeemed_by TEXT, redeemed_at INTEGER)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS gift_codes_created_idx ON gift_codes (created_at)`),
  ]);
  ready = true;
}

export const normalizeCode = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^MW/, "");

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const body = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `MW-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export async function createGiftCodes(env: Db, adminId: string, credits: number, count: number, note: string) {
  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_GIFT_CREDITS) throw new HttpError(400, `Choose 1 to ${MAX_GIFT_CREDITS} videos per code.`);
  if (!Number.isInteger(count) || count < 1 || count > MAX_GIFT_BATCH) throw new HttpError(400, `Make 1 to ${MAX_GIFT_BATCH} codes at a time.`);
  await ensureGiftTable(env);
  const now = Date.now();
  const codes = Array.from({ length: count }, randomCode);
  await env.DB.batch(codes.map((code) => env.DB.prepare(`INSERT INTO gift_codes (code, credits, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).bind(code, credits, note.slice(0, 120) || null, adminId, now)));
  return codes;
}

export async function listGiftCodes(env: Db) {
  await ensureGiftTable(env);
  const result = await env.DB.prepare(`SELECT g.code, g.credits, g.note, g.created_at AS createdAt, g.redeemed_at AS redeemedAt, u.email AS redeemedByEmail FROM gift_codes g LEFT JOIN users u ON u.id = g.redeemed_by ORDER BY g.created_at DESC, g.code LIMIT 200`).all();
  return result.results;
}

/* One transaction: mark the code used, write the ledger row, add the credits.
   Each step only happens if the one before it changed a row, so a code can
   never be redeemed twice, even by two requests at once. */
export async function redeemGiftCode(env: Db, userId: string, rawCode: unknown) {
  const body = normalizeCode(rawCode);
  if (body.length !== 12) throw new HttpError(400, "That code is not valid.");
  const code = `MW-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
  await ensureGiftTable(env);
  const row = await env.DB.prepare(`SELECT credits, redeemed_by AS redeemedBy FROM gift_codes WHERE code = ?`).bind(code).first<{ credits: number; redeemedBy: string | null }>();
  if (!row) throw new HttpError(404, "That code is not valid.");
  if (row.redeemedBy) throw new HttpError(409, "That code has already been used.");
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE gift_codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ? AND redeemed_by IS NULL`).bind(userId, now, code),
    env.DB.prepare(`INSERT INTO credit_ledger (id, owner_id, project_id, render_job_id, amount, type, idempotency_key, note, created_at) SELECT ?, ?, NULL, NULL, credits, 'gift_code', ?, 'Gift code redeemed', ? FROM gift_codes WHERE code = ? AND redeemed_by = ? AND changes() = 1`).bind(crypto.randomUUID(), userId, `gift-code:${code}`, now, code, userId),
    env.DB.prepare(`UPDATE users SET credit_balance = credit_balance + (SELECT credits FROM gift_codes WHERE code = ?), updated_at = ? WHERE id = ? AND changes() = 1`).bind(code, now, userId),
  ]);
  if (results[0]?.meta?.changes !== 1) throw new HttpError(409, "That code has already been used.");
  return row.credits;
}
