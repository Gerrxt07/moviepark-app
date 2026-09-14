import { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATABASE_PATH = "/opt/moviepark/app/data/moviepark.sqlite";
const RETIRED_RIDE_IDS = new Set([11010]);

export async function GET() {
  try {
    const database = new DatabaseSync(DATABASE_PATH, { readOnly: true });
    try {
      const snapshot = database.prepare(`SELECT snapshot_id, observed_at FROM snapshots ORDER BY unixepoch(observed_at) DESC LIMIT 1`).get();
      if (!snapshot) return Response.json({ observedAt: null, attractions: [] }, { headers: { "Cache-Control": "no-store" } });
      const attractions = database.prepare(`
        SELECT r.ride_id AS id, r.name, r.category, r.indoor, r.family, r.thrill,
               r.water, r.weather_sensitive AS weatherSensitive,
               ro.status, ro.wait_minutes AS waitMinutes, ro.measurement_valid AS measurementValid, ro.source_fresh AS sourceFresh,
               (
                 SELECT old.wait_minutes FROM ride_observations old
                 JOIN snapshots os ON os.snapshot_id=old.snapshot_id
                 WHERE old.ride_id=ro.ride_id AND os.observed_at < ?
                   AND old.status='open' AND old.measurement_valid=1 AND old.source_fresh=1
                 ORDER BY unixepoch(os.observed_at) DESC LIMIT 1
               ) AS previousWaitMinutes,
               (
                 SELECT old.wait_minutes FROM ride_observations old
                 JOIN snapshots os ON os.snapshot_id=old.snapshot_id
                 WHERE old.ride_id=ro.ride_id
                   AND unixepoch(os.observed_at) <= unixepoch(?) - 1500
                   AND old.status='open' AND old.measurement_valid=1 AND old.source_fresh=1
                 ORDER BY unixepoch(os.observed_at) DESC LIMIT 1
               ) AS waitMinutes30Ago
               ,(SELECT COUNT(DISTINCT hs.operating_date) FROM ride_observations ho
                 JOIN snapshots hs ON hs.snapshot_id=ho.snapshot_id
                 WHERE ho.ride_id=r.ride_id AND ho.status='open' AND ho.source_fresh=1) AS confirmedOpenDays
               ,(SELECT ROUND(100.0*AVG(CASE WHEN ho.status='open' AND ho.source_fresh=1 THEN 1.0 ELSE 0.0 END))
                 FROM ride_observations ho JOIN snapshots hs ON hs.snapshot_id=ho.snapshot_id
                 WHERE ho.ride_id=r.ride_id AND hs.operating_date>=date(?,'-9 days')) AS operatingReliability
               ,(SELECT MAX(hs.operating_date) FROM ride_observations ho
                 JOIN snapshots hs ON hs.snapshot_id=ho.snapshot_id
                 WHERE ho.ride_id=r.ride_id AND ho.status='open' AND ho.source_fresh=1) AS lastConfirmedOpenDate
        FROM ride_observations ro
        INNER JOIN rides r ON r.ride_id = ro.ride_id
        WHERE ro.snapshot_id = ?
        ORDER BY CASE WHEN ro.status = 'open' THEN 0 ELSE 1 END, ro.wait_minutes ASC, r.name COLLATE NOCASE ASC
      `).all(snapshot.observed_at, snapshot.observed_at, snapshot.observed_at.slice(0,10), snapshot.snapshot_id).filter((ride)=>!RETIRED_RIDE_IDS.has(Number(ride.id))).map((ride) => {
        const usable = ride.status === "open" && Boolean(ride.measurementValid) && Boolean(ride.sourceFresh) && ride.waitMinutes != null;
        const delta = usable && ride.previousWaitMinutes != null ? Number(ride.waitMinutes) - Number(ride.previousWaitMinutes) : null;
        const delta30 = usable && ride.waitMinutes30Ago != null ? Number(ride.waitMinutes) - Number(ride.waitMinutes30Ago) : null;
        const lifecycle = Number(ride.confirmedOpenDays) > 0 ? "active" : "unconfirmed";
        return { ...ride, lifecycle, recommendationEligible:lifecycle === "active",
          deltaMinutes: delta, delta30Minutes: delta30, trend: delta30 == null ? null : delta30 > 0 ? "up" : delta30 < 0 ? "down" : "unchanged" };
      });
      return Response.json({ observedAt: snapshot.observed_at, attractions, source:{ origin:"Queue-Times", storage:"Lokale SQLite-Datenbank", tables:["snapshots","ride_observations","rides"] } }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    } finally { database.close(); }
  } catch (error) {
    return Response.json({ error: "Attraktionsdaten sind gerade nicht verfügbar.", detail: error.message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
