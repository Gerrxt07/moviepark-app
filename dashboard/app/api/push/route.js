import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNTIME_DIR = "/opt/moviepark/dashboard/.runtime";
const CONFIG_PATH = `${RUNTIME_DIR}/push-config.json`;
const DATABASE_PATH = `${RUNTIME_DIR}/push-subscriptions.sqlite`;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "https://moviepark.becloudly.eu";
const rateLimits = new Map();

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
}

function clientAddress(request) {
  return (request.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
}

function allowed(request, limit = 30) {
  const key = clientAddress(request);
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now - entry.startedAt > 60_000) {
    rateLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

function configuration() {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  try {
    const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (saved.publicKey && saved.privateKey) return saved;
  } catch {
    // A fresh local key pair is created on first use.
  }
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(CONFIG_PATH, JSON.stringify(keys), { encoding: "utf8", mode: 0o600 });
  return keys;
}

function database() {
  const db = new DatabaseSync(DATABASE_PATH);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription_json TEXT NOT NULL,
      user_agent TEXT,
      checked_in_until TEXT,
      preferences_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  try { db.exec("ALTER TABLE push_subscriptions ADD COLUMN checked_in_until TEXT"); } catch {}
  try { db.exec("ALTER TABLE push_subscriptions ADD COLUMN preferences_json TEXT"); } catch {}
  return db;
}

function normalizeSubscription(value) {
  if (!value || typeof value !== "object") return null;
  const endpoint = typeof value.endpoint === "string" ? value.endpoint : "";
  const auth = typeof value.keys?.auth === "string" ? value.keys.auth : "";
  const p256dh = typeof value.keys?.p256dh === "string" ? value.keys.p256dh : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2048 || !auth || !p256dh) return null;
  return { endpoint, expirationTime: value.expirationTime ?? null, keys: { auth, p256dh } };
}

function validCheckInUntil(value) {
  if (typeof value !== "string") return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= Date.now() || timestamp > Date.now() + 24 * 60 * 60 * 1000) return null;
  return new Date(timestamp).toISOString();
}

async function sendEnabledNotification(subscription) {
  const keys = configuration();
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  await webpush.sendNotification(subscription, JSON.stringify({
    title: "Benachrichtigungen sind aktiv",
    body: "Du bist eingecheckt und erhältst jetzt wichtige Park-Hinweise.",
    url: "/",
    tag: "push-enabled",
  }));
}

export async function GET(request) {
  if (!allowed(request, 120)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  return json({ publicKey: configuration().publicKey });
}

export async function POST(request) {
  if (!allowed(request, 12)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const subscription = normalizeSubscription(body?.subscription);
  if (!subscription) return json({ error: "Ungültige Push-Subscription." }, 400);
  const checkedInUntil = validCheckInUntil(body?.checkedInUntil);
  const preferences = body?.preferences && typeof body.preferences === "object" ? JSON.stringify(body.preferences) : null;

  const now = new Date().toISOString();
  const db = database();
  try {
    db.prepare(`
      INSERT INTO push_subscriptions(endpoint, subscription_json, user_agent, checked_in_until, preferences_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET subscription_json=excluded.subscription_json, user_agent=excluded.user_agent, checked_in_until=excluded.checked_in_until, preferences_json=COALESCE(excluded.preferences_json,push_subscriptions.preferences_json), updated_at=excluded.updated_at
    `).run(subscription.endpoint, JSON.stringify(subscription), request.headers.get("user-agent")?.slice(0, 500) ?? null, checkedInUntil, preferences, now, now);
  } finally {
    db.close();
  }

  if (checkedInUntil) {
    try {
      await sendEnabledNotification(subscription);
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        const cleanup = database();
        try { cleanup.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(subscription.endpoint); } finally { cleanup.close(); }
        return json({ error: "Die Push-Subscription ist nicht mehr gültig." }, 410);
      }
      return json({ error: "Die Testbenachrichtigung konnte nicht gesendet werden." }, 502);
    }
  }
  return json({ subscribed: true, checkedIn: Boolean(checkedInUntil) }, 201);
}

export async function PATCH(request) {
  if (!allowed(request, 30)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const endpoint = typeof body?.endpoint === "string" && body.endpoint.startsWith("https://") ? body.endpoint : null;
  if (!endpoint) return json({ error: "Ungültiger Endpunkt." }, 400);
  const checkedInUntil = validCheckInUntil(body?.checkedInUntil);
  const threshold = [5,10,15,20,30].includes(Number(body?.preferences?.threshold)) ? Number(body.preferences.threshold) : 15;
  const preferences = body?.preferences ? JSON.stringify({
    favoriteAlerts: Boolean(body.preferences.favoriteAlerts),
    reopenAlerts: Boolean(body.preferences.reopenAlerts),
    showReminders: Boolean(body.preferences.showReminders),
    threshold,
    favorites: Array.isArray(body.preferences.favorites) ? body.preferences.favorites.filter(Number.isSafeInteger).slice(0,100) : [],
  }) : null;
  const db = database();
  let subscription = null;
  let previousCheckInUntil = null;
  try {
    const saved = db.prepare("SELECT subscription_json,checked_in_until FROM push_subscriptions WHERE endpoint=?").get(endpoint);
    previousCheckInUntil = saved?.checked_in_until ?? null;
    if (saved?.subscription_json) {
      try { subscription = normalizeSubscription(JSON.parse(saved.subscription_json)); } catch {}
    }
    db.prepare("UPDATE push_subscriptions SET checked_in_until=?, preferences_json=COALESCE(?,preferences_json), updated_at=? WHERE endpoint=?")
      .run(checkedInUntil, preferences, new Date().toISOString(), endpoint);
  } finally { db.close(); }

  let notificationSent = false;
  if (checkedInUntil && subscription && previousCheckInUntil !== checkedInUntil) {
    try {
      await sendEnabledNotification(subscription);
      notificationSent = true;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        const cleanup = database();
        try { cleanup.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(endpoint); } finally { cleanup.close(); }
      }
    }
  }
  return json({ checkedIn: Boolean(checkedInUntil), checkedInUntil, notificationSent });
}

export async function DELETE(request) {
  if (!allowed(request, 20)) return json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const endpoint = typeof body?.endpoint === "string" && body.endpoint.startsWith("https://") ? body.endpoint : null;
  if (!endpoint) return json({ error: "Ungültiger Endpunkt." }, 400);
  const db = database();
  try { db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(endpoint); } finally { db.close(); }
  return json({ subscribed: false });
}
