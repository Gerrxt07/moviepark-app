import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATABASE_PATH = "/opt/moviepark/dashboard/.runtime/favorites-sync.sqlite";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_PATTERN = /^[A-Z2-9]{8}$/;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rateLimits = new Map();

function clientAddress(request) { return (request.headers.get("x-forwarded-for") || "local").split(",")[0].trim(); }
function allowed(request, limit = 180) {
  const key = clientAddress(request);
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now - entry.startedAt > 60000) { rateLimits.set(key, { startedAt: now, count: 1 }); return true; }
  entry.count += 1;
  return entry.count <= limit;
}
function tokenHash(token) { return createHash("sha256").update(token).digest("hex"); }
function normalizedPairingCode(value) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function readToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return TOKEN_PATTERN.test(token) ? token : null;
}
function normalizeFavorites(value) {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter((id) => Number.isSafeInteger(id) && id > 0))];
  return ids.length <= 100 ? ids : null;
}
function database() {
  const db = new DatabaseSync(DATABASE_PATH);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS favorite_sets (token_hash TEXT PRIMARY KEY, favorites_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS favorite_pairings (code_hash TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL);
  `);
  return db;
}
function json(payload, status = 200) { return Response.json(payload, { status, headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } }); }

function createPairing(db, token) {
  db.prepare("DELETE FROM favorite_pairings WHERE expires_at<=? OR token=?").run(new Date().toISOString(), token);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const bytes = randomBytes(8);
    const code = [...bytes].map((byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join("");
    try {
      db.prepare("INSERT INTO favorite_pairings(code_hash,token,expires_at) VALUES(?,?,?)").run(tokenHash(code), token, expiresAt);
      return { pairingCode: code, pairingExpiresAt: expiresAt };
    } catch {}
  }
  throw new Error("Pairing-Code konnte nicht erstellt werden.");
}

export async function POST(request) {
  if (!allowed(request, 20)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  let body; try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const pairingCode = normalizedPairingCode(body?.pairingCode);
  if (pairingCode) {
    if (!PAIRING_PATTERN.test(pairingCode)) return json({ error: "Der Pairing-Code ist ungültig." }, 400);
    const db = database();
    try {
      db.prepare("DELETE FROM favorite_pairings WHERE expires_at<=?").run(new Date().toISOString());
      const pairing = db.prepare("SELECT token FROM favorite_pairings WHERE code_hash=? AND expires_at>?").get(tokenHash(pairingCode), new Date().toISOString());
      if (!pairing?.token) return json({ error: "Der Pairing-Code ist abgelaufen oder unbekannt." }, 404);
      const set = db.prepare("SELECT favorites_json,updated_at FROM favorite_sets WHERE token_hash=?").get(tokenHash(pairing.token));
      if (!set) return json({ error: "Das Favoriten-Backup wurde nicht gefunden." }, 404);
      db.prepare("DELETE FROM favorite_pairings WHERE code_hash=?").run(tokenHash(pairingCode));
      return json({ token: pairing.token, favorites: JSON.parse(set.favorites_json), updatedAt: set.updated_at });
    } finally { db.close(); }
  }
  const favorites = normalizeFavorites(body?.favorites);
  if (!favorites) return json({ error: "Ungültige Favoritenliste." }, 400);
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const db = database();
  let pairing;
  try {
    db.prepare("INSERT INTO favorite_sets(token_hash,favorites_json,created_at,updated_at) VALUES(?,?,?,?)").run(tokenHash(token), JSON.stringify(favorites), now, now);
    pairing = createPairing(db, token);
  } finally { db.close(); }
  return json({ token, favorites, updatedAt: now, ...pairing }, 201);
}

export async function PATCH(request) {
  if (!allowed(request, 20)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  const token = readToken(request);
  if (!token) return json({ error: "Ungültiger Sync-Schlüssel." }, 401);
  const db = database();
  try {
    if (!db.prepare("SELECT 1 FROM favorite_sets WHERE token_hash=?").get(tokenHash(token))) {
      return json({ error: "Sync-Schlüssel nicht gefunden." }, 404);
    }
    return json(createPairing(db, token));
  } finally { db.close(); }
}

export async function GET(request) {
  if (!allowed(request)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  const token = readToken(request);
  if (!token) return json({ error: "Ungültiger Sync-Schlüssel." }, 401);
  const db = database();
  let row; try { row = db.prepare("SELECT favorites_json,updated_at FROM favorite_sets WHERE token_hash=?").get(tokenHash(token)); } finally { db.close(); }
  if (!row) return json({ error: "Sync-Schlüssel nicht gefunden." }, 404);
  return json({ favorites: JSON.parse(row.favorites_json), updatedAt: row.updated_at });
}

export async function PUT(request) {
  if (!allowed(request, 120)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  const token = readToken(request);
  if (!token) return json({ error: "Ungültiger Sync-Schlüssel." }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const favorites = normalizeFavorites(body?.favorites);
  if (!favorites) return json({ error: "Ungültige Favoritenliste." }, 400);
  const now = new Date().toISOString();
  const db = database();
  let result; try { result = db.prepare("UPDATE favorite_sets SET favorites_json=?,updated_at=? WHERE token_hash=?").run(JSON.stringify(favorites), now, tokenHash(token)); } finally { db.close(); }
  if (!result.changes) return json({ error: "Sync-Schlüssel nicht gefunden." }, 404);
  return json({ favorites, updatedAt: now });
}

export async function DELETE(request) {
  if (!allowed(request, 20)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  const token = readToken(request);
  if (!token) return json({ error: "Ungültiger Sync-Schlüssel." }, 401);
  const db = database();
  try {
    db.prepare("DELETE FROM favorite_pairings WHERE token=?").run(token);
    const result = db.prepare("DELETE FROM favorite_sets WHERE token_hash=?").run(tokenHash(token));
    if (!result.changes) return json({ error: "Favoriten-Backup nicht gefunden." }, 404);
  } finally { db.close(); }
  return json({ deleted: true });
}
