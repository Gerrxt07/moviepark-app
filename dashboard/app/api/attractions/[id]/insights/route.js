import { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATABASE_PATH = "/opt/moviepark/app/data/moviepark.sqlite";
const PARK_TIME_ZONE = "Europe/Berlin";

function parkParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const dateValue = `${value("year")}-${value("month")}-${value("day")}`;
  const weekday = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(value("weekday"));
  return { date: dateValue, weekday, minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

function nextDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const ordered = [...values].sort((a,b) => a-b);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)];
}

function minuteAtPark(timestamp) {
  return parkParts(new Date(timestamp)).minute;
}

function closureIntervals(points) {
  const intervals = [];
  let start = null;
  let previousAt = null;
  for (const point of points) {
    const at = new Date(point.observedAt).getTime();
    const gap = previousAt == null ? 0 : (at - previousAt) / 60000;
    if (gap > 15) start = null;
    if (point.status === "closed") {
      if (start == null) start = minuteAtPark(point.observedAt);
    } else if (start != null) {
      intervals.push({ startMinute:start, endMinute:minuteAtPark(point.observedAt) });
      start = null;
    }
    previousAt = at;
  }
  if (start != null && points.length) intervals.push({ startMinute:start, endMinute:minuteAtPark(points.at(-1).observedAt) + 5, ongoing:true });
  return intervals.filter(item => item.endMinute > item.startMinute);
}

function recommendations(points, opensMinute, closesMinute, earliestMinute) {
  const lowerBound = Math.max((opensMinute ?? 600) + 60, earliestMinute ?? 0);
  const upperBound = (closesMinute ?? 1080) - 30;
  const candidates = points.filter(point => Number.isFinite(point.predicted) && point.minute >= lowerBound && point.minute <= upperBound)
    .sort((a,b) => a.predicted-b.predicted || a.minute-b.minute);
  const selected = [];
  for (const point of candidates) {
    if (selected.every(existing => Math.abs(existing.minute-point.minute) >= 60)) selected.push(point);
    if (selected.length === 3) break;
  }
  return selected.sort((a,b) => a.minute-b.minute);
}

function predictionFor(db, rideId, targetDate, targetWeekday, runId, mode="baseline") {
  const central = db.prepare(`SELECT fp.minute_of_day AS minute,fp.p50 AS predicted,fp.p10 AS lower,fp.p90 AS upper,
      fp.support_days AS supportDays,fp.support_samples AS supportSamples,fp.method,fp.confidence,fp.open_probability AS openProbability,fr.model_version AS modelVersion
    FROM forecast_points fp JOIN forecast_runs fr ON fr.run_id=fp.run_id
    WHERE fr.run_id=? AND fr.status='ready' AND fp.ride_id=? AND fp.operating_date=?
    ORDER BY fp.minute_of_day`).all(runId,rideId,targetDate);
  if (central.length) return central.map(point=>({ ...point,
    predicted:Math.round(Number(point.predicted)), lower:Math.round(Number(point.lower)), upper:Math.round(Number(point.upper)),
    time:`${String(Math.floor(point.minute/60)).padStart(2,"0")}:${String(point.minute%60).padStart(2,"0")}`,
    modelVersion:point.modelVersion }));
  if(mode==="experimental")return [];
  const targetWeekend = targetWeekday >= 5 ? 1 : 0;
  const points = [];
  for (let minute = 570; minute <= 1080; minute += 30) {
    let rows = db.prepare(`SELECT operating_date,wait_minutes FROM ride_training_rows
      WHERE ride_id=? AND time_bucket=? AND weekday=? AND operating_date<?
        AND status='open' AND measurement_valid=1 AND wait_minutes IS NOT NULL`)
      .all(rideId, minute, targetWeekday, targetDate);
    let method = "Gleicher Wochentag";
    if (new Set(rows.map(row => row.operating_date)).size < 2) {
      rows = db.prepare(`SELECT operating_date,wait_minutes FROM ride_training_rows
        WHERE ride_id=? AND time_bucket=? AND is_weekend=? AND operating_date<?
          AND status='open' AND measurement_valid=1 AND wait_minutes IS NOT NULL`)
        .all(rideId, minute, targetWeekend, targetDate);
      method = targetWeekend ? "Vergleichbare Wochenendtage" : "Vergleichbare Werktage";
    }
    if (new Set(rows.map(row => row.operating_date)).size < 2) {
      rows = db.prepare(`SELECT operating_date,wait_minutes FROM ride_training_rows
        WHERE ride_id=? AND time_bucket=? AND operating_date<?
          AND status='open' AND measurement_valid=1 AND wait_minutes IS NOT NULL`)
        .all(rideId, minute, targetDate);
      method = "Alle bisherigen Parktage";
    }
    if (!rows.length) continue;
    const waits = rows.map(row => Number(row.wait_minutes));
    const days = new Set(rows.map(row => row.operating_date)).size;
    points.push({
      minute, time: `${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`,
      predicted: percentile(waits,.5), lower: percentile(waits,.25), upper: percentile(waits,.75),
      supportDays: days, supportSamples: rows.length, method,
    });
  }
  return points;
}

export async function GET(request, { params }) {
  const { id: rawId } = await params;
  const rideId = Number(rawId);
  if (!Number.isSafeInteger(rideId) || rideId <= 0) return Response.json({ error:"Ungültige Attraktion." }, { status:400 });
  const db = new DatabaseSync(DATABASE_PATH, { readOnly:true });
  try {
    const ride = db.prepare(`SELECT r.ride_id AS id,r.name,r.category,r.indoor,r.water,r.family,r.thrill,r.weather_sensitive AS weatherSensitive,
      (SELECT COUNT(DISTINCT s.operating_date) FROM ride_observations ro JOIN snapshots s ON s.snapshot_id=ro.snapshot_id WHERE ro.ride_id=r.ride_id AND ro.status='open' AND ro.source_fresh=1) AS confirmedOpenDays,
      (SELECT ROUND(100.0*AVG(CASE WHEN ro.status='open' AND ro.source_fresh=1 THEN 1.0 ELSE 0.0 END)) FROM ride_observations ro JOIN snapshots s ON s.snapshot_id=ro.snapshot_id WHERE ro.ride_id=r.ride_id AND s.operating_date>=date('now','-9 days')) AS operatingReliability
      FROM rides r WHERE r.ride_id=?`).get(rideId);
    if (!ride) return Response.json({ error:"Attraktion nicht gefunden." }, { status:404 });
    const now = parkParts();
    const tomorrow = nextDate(now.date);
    const tomorrowWeekday = (now.weekday + 1) % 7;
    const current = db.prepare(`SELECT ro.status,ro.wait_minutes AS waitMinutes,ro.measurement_valid AS measurementValid,
      ro.source_fresh AS sourceFresh,s.observed_at AS observedAt FROM ride_observations ro
      JOIN snapshots s ON s.snapshot_id=ro.snapshot_id WHERE ro.ride_id=? ORDER BY unixepoch(s.observed_at) DESC LIMIT 1`).get(rideId);
    const history = db.prepare(`SELECT s.observed_at AS observedAt,ro.status,ro.wait_minutes AS waitMinutes,
      ro.measurement_valid AS measurementValid FROM ride_observations ro JOIN snapshots s ON s.snapshot_id=ro.snapshot_id
      WHERE ro.ride_id=? AND s.operating_date=? ORDER BY unixepoch(s.observed_at)`).all(rideId, now.date);
    const requestedMode="experimental";
    const baselineRun=db.prepare("SELECT run_id AS runId,model_version AS modelVersion,method,generated_at AS generatedAt,data_as_of AS dataAsOf,quality_json AS qualityJson,horizon_start AS horizonStart FROM forecast_runs WHERE promoted=1 AND status='ready' ORDER BY generated_at DESC LIMIT 1").get();
    const testRun=baselineRun?db.prepare("SELECT run_id AS runId,model_version AS modelVersion,method,generated_at AS generatedAt,data_as_of AS dataAsOf,quality_json AS qualityJson FROM forecast_runs WHERE promoted=0 AND status='ready' AND method='catboost-multiquantile-experimental' AND horizon_start=? ORDER BY generated_at DESC LIMIT 1").get(baselineRun.horizonStart):null;
    if(!testRun)return Response.json({error:"Die Hybrid-Prognose ist derzeit nicht verfügbar. Es wird nicht unbemerkt auf die Standardprognose zurückgeschaltet."},{status:503});
    const activeRun=testRun;
    const activeMode="experimental";
    const activeRunId=activeRun?.runId;
    const todayPark = activeRunId ? db.prepare(`SELECT is_open AS isOpen,opens_minute AS opensMinute,closes_minute AS closesMinute
      FROM park_forecast_days WHERE run_id=? AND operating_date=?`).get(activeRunId,now.date) : null;
    const todayFinished = Boolean(todayPark?.isOpen && todayPark.closesMinute!=null && now.minute>=todayPark.closesMinute);
    const pastDates = db.prepare(`SELECT DISTINCT s.operating_date AS date FROM ride_observations ro
      JOIN snapshots s ON s.snapshot_id=ro.snapshot_id
      WHERE ro.ride_id=? AND (s.operating_date<? OR (?=1 AND s.operating_date=?))
      ORDER BY s.operating_date DESC LIMIT 5`).all(rideId, now.date, todayFinished?1:0, now.date);
    const pastDays = pastDates.map(({ date }) => {
      const weekday = parkParts(new Date(`${date}T12:00:00Z`)).weekday;
      const points = db.prepare(`SELECT s.observed_at AS observedAt,ro.status,ro.wait_minutes AS waitMinutes,
        ro.measurement_valid AS measurementValid FROM ride_observations ro JOIN snapshots s ON s.snapshot_id=ro.snapshot_id
        WHERE ro.ride_id=? AND s.operating_date=? ORDER BY unixepoch(s.observed_at)`).all(rideId, date);
      const prediction = predictionFor(db, rideId, date, weekday,activeRunId,activeMode);
      const calendar = activeRunId ? db.prepare("SELECT opens_minute AS opensMinute,closes_minute AS closesMinute FROM park_forecast_days WHERE run_id=? AND operating_date=?").get(activeRunId,date) : null;
      return { date, points, closureIntervals:closureIntervals(points), prediction,
        recommendations:recommendations(prediction,calendar?.opensMinute,calendar?.closesMinute,0) };
    });
    const distinctDays = Number(db.prepare("SELECT COUNT(DISTINCT operating_date) AS count FROM ride_training_rows WHERE ride_id=? AND measurement_valid=1 AND wait_minutes IS NOT NULL").get(rideId)?.count ?? 0);
    const openDays = activeRunId ? db.prepare(`SELECT operating_date AS date,opens_minute AS opensMinute,closes_minute AS closesMinute
      FROM park_forecast_days WHERE run_id=? AND operating_date>=? AND is_open=1 ORDER BY operating_date LIMIT 7`).all(activeRunId,now.date) : [];
    const nextOpenDay = openDays.find(day=>day.date>now.date || (day.date===now.date && day.closesMinute!=null && now.minute<day.closesMinute)) ?? null;
    const isOpenNow = Boolean(todayPark?.isOpen && todayPark.opensMinute!=null && todayPark.closesMinute!=null && now.minute>=todayPark.opensMinute && now.minute<todayPark.closesMinute);
    const nextOpenWeekday = nextOpenDay ? parkParts(new Date(`${nextOpenDay.date}T12:00:00Z`)).weekday : null;
    const todayPrediction = predictionFor(db, rideId, now.date, now.weekday,activeRunId,activeMode);
    const tomorrowPrediction = predictionFor(db, rideId, tomorrow, tomorrowWeekday,activeRunId,activeMode);
    const nextOpenPrediction = nextOpenDay ? predictionFor(db, rideId, nextOpenDay.date, nextOpenWeekday,activeRunId,activeMode) : [];
    const todayRecommendations = recommendations(todayPrediction,todayPark?.opensMinute,todayPark?.closesMinute,now.minute+30);
    const nextRecommendations = recommendations(nextOpenPrediction,nextOpenDay?.opensMinute,nextOpenDay?.closesMinute,
      nextOpenDay?.date===now.date ? now.minute+30 : 0);
    let recommendationHistory=[];
    const hasRecommendationHistory=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ride_recommendation_snapshots'").get();
    if(hasRecommendationHistory){
      const rows=db.prepare(`SELECT snapshot_id AS snapshotId,operating_date AS date,target_minute AS targetMinute,
        predicted_wait AS predicted,lower_wait AS lower,upper_wait AS upper,confidence,method,model_version AS modelVersion,
        calculated_at AS calculatedAt,actual_wait AS actual,actual_status AS actualStatus,
        actual_observed_at AS actualObservedAt,resolved_at AS resolvedAt
        FROM ride_recommendation_snapshots WHERE ride_id=?
        ORDER BY operating_date DESC,target_minute DESC,calculated_at DESC LIMIT 240`).all(rideId);
      const seen=new Set();
      recommendationHistory=rows.filter(row=>{const key=`${row.date}:${row.targetMinute}`;if(seen.has(key))return false;seen.add(key);return true}).slice(0,24).map(row=>({
        ...row,time:`${String(Math.floor(row.targetMinute/60)).padStart(2,"0")}:${String(row.targetMinute%60).padStart(2,"0")}`,
        actualTime:row.actualObservedAt?new Intl.DateTimeFormat("de-DE",{timeZone:PARK_TIME_ZONE,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(row.actualObservedAt)):null,
        difference:row.actual==null?null:Number(row.actual)-Number(row.predicted),
      }));
    }
    const accuracy=db.prepare(`SELECT COUNT(*) AS comparisons,ROUND(AVG(ABS(actual_wait-predicted_wait)),1) AS mae,
      ROUND(100.0*AVG(CASE WHEN actual_wait BETWEEN lower_wait AND upper_wait THEN 1.0 ELSE 0.0 END),1) AS intervalCoverage
      FROM ride_recommendation_snapshots WHERE ride_id=? AND actual_wait IS NOT NULL`).get(rideId);
    const lifecycle=Number(ride.confirmedOpenDays)>0?"active":"unconfirmed";
    return Response.json({
      generatedAt:new Date().toISOString(), timeZone:PARK_TIME_ZONE, ride, current, history,
      closureIntervals:closureIntervals(history), pastDays,
      park:{ isOpenToday:Boolean(todayPark?.isOpen), isOpenNow, todayFinished, nextOpenDate:nextOpenDay?.date??null,
        nextOpensAt:nextOpenDay?.opensMinute==null?null:`${String(Math.floor(nextOpenDay.opensMinute/60)).padStart(2,"0")}:${String(nextOpenDay.opensMinute%60).padStart(2,"0")}`,
        nextClosesAt:nextOpenDay?.closesMinute==null?null:`${String(Math.floor(nextOpenDay.closesMinute/60)).padStart(2,"0")}:${String(nextOpenDay.closesMinute%60).padStart(2,"0")}` },
      predictions:{ today:{ date:now.date, points:todayPrediction, recommendations:todayRecommendations }, tomorrow:{ date:tomorrow, points:tomorrowPrediction }, nextOpen:{ date:nextOpenDay?.date??null, points:nextOpenPrediction, recommendations:nextRecommendations } },
      bestUpcoming:todayRecommendations[0]??null, forecastMode:activeMode,requestedMode,forecastFallback:requestedMode==="experimental"&&activeMode!=="experimental",forecastRun:activeRun ? { ...activeRun, quality:JSON.parse(activeRun.qualityJson), qualityJson:undefined } : null,
      recommendationHistory,lifecycle,accuracy,
      sources:{
        live:{origin:"Queue-Times",storage:"Lokale SQLite-Datenbank",tables:["snapshots","ride_observations"]},
        history:{origin:"Queue-Times",storage:"Lokale SQLite-Datenbank",tables:["snapshots","ride_observations","ride_training_rows"]},
        forecast:{kind:activeMode==="experimental"?"test":"standard",label:activeMode==="experimental"?"CatBoost-Testmodell":activeRun?.method==="catboost-multiquantile"?"Freigegebenes CatBoost-Modell":"Standard-Baseline aus historischen Vergleichswerten",version:activeRun?.modelVersion??null,method:activeRun?.method??null,storage:"forecast_runs und forecast_points"},
        calendar:{origin:"Offizieller Movie-Park-Kalender",storage:"park_calendar / park_forecast_days"}
      },
      readiness:{ distinctDays, status:distinctDays<14?"experimental":distinctDays<28?"shadow":"model-ready",
        message:lifecycle!=="active"?"Für diese Attraktion wurde noch kein bestätigter Betrieb gemessen. Sie erscheint deshalb nicht als Besuchsempfehlung.":distinctDays<14?"Für diese Attraktion liegen erst wenige geöffnete Vergleichstage vor. Nutze die Schätzung nur als grobe Orientierung.":distinctDays<28?"Die Datengrundlage wächst. Frühere Vorhersagen werden weiterhin automatisch mit den später gemessenen Werten verglichen.":"Für diese Attraktion liegen genügend vergangene Parktage für die reguläre Qualitätsprüfung vor." },
    }, { headers:{ "Cache-Control":"no-store, max-age=0" } });
  } finally { db.close(); }
}
