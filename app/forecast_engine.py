#!/usr/bin/env python3
"""Autonomous seven-day forecasting pipeline for the Movie Park dashboard.

The engine is deliberately safe during cold start: it always creates a versioned
forecast run from the historical median baseline and only promotes an optional
CatBoost challenger after time-based quality gates have passed.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import sqlite3
import statistics
import urllib.request
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
DB_PATH = Path("data/moviepark.sqlite")
PARK_ID = 310
LATITUDE, LONGITUDE = 51.6207, 6.9720
HORIZON_DAYS = 7
BUCKET_MINUTES = 30
OPEN_MINUTE, DEFAULT_CLOSE_MINUTE = 600, 1080
USER_AGENT = "Gerrxt-Movie-Park-Forecast/1.0"
RETIRED_RIDE_IDS = {11010}


def now_local() -> datetime:
    return datetime.now(TZ)


def fetch_json(url: str, timeout: int = 12) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("JSON response is not an object")
    return value


def fetch_text(url: str, timeout: int = 12) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def init_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS forecast_schema_migrations(
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS park_calendar(
      operating_date TEXT PRIMARY KEY, is_open INTEGER NOT NULL, opens_minute INTEGER,
      closes_minute INTEGER, event_name TEXT, crowd_percent REAL, source TEXT NOT NULL,
      source_url TEXT, fetched_at TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS external_forecast_snapshots(
      source TEXT NOT NULL, issued_at TEXT NOT NULL, target_at TEXT NOT NULL,
      payload_json TEXT NOT NULL, fetched_at TEXT NOT NULL,
      PRIMARY KEY(source,issued_at,target_at));
    CREATE TABLE IF NOT EXISTS external_historical_priors(
      source TEXT NOT NULL, park_id INTEGER NOT NULL, ride_id INTEGER NOT NULL,
      granularity TEXT NOT NULL, period_key TEXT NOT NULL, average_wait REAL NOT NULL,
      source_url TEXT NOT NULL, fetched_at TEXT NOT NULL,
      PRIMARY KEY(source,park_id,ride_id,granularity,period_key));
    CREATE TABLE IF NOT EXISTS forecast_runs(
      run_id TEXT PRIMARY KEY, generated_at TEXT NOT NULL, data_as_of TEXT NOT NULL,
      horizon_start TEXT NOT NULL, horizon_end TEXT NOT NULL, model_version TEXT NOT NULL,
      method TEXT NOT NULL, status TEXT NOT NULL, quality_json TEXT NOT NULL,
      source_health_json TEXT NOT NULL, promoted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS forecast_points(
      run_id TEXT NOT NULL, operating_date TEXT NOT NULL, ride_id INTEGER NOT NULL,
      minute_of_day INTEGER NOT NULL, p10 REAL, p50 REAL, p90 REAL,
      open_probability REAL, confidence TEXT NOT NULL, support_days INTEGER NOT NULL,
      support_samples INTEGER NOT NULL, method TEXT NOT NULL, fallback_reason TEXT,
      PRIMARY KEY(run_id,operating_date,ride_id,minute_of_day),
      FOREIGN KEY(run_id) REFERENCES forecast_runs(run_id));
    CREATE INDEX IF NOT EXISTS idx_forecast_points_lookup
      ON forecast_points(operating_date,ride_id,minute_of_day,run_id);
    CREATE TABLE IF NOT EXISTS ride_recommendation_snapshots(
      snapshot_id TEXT PRIMARY KEY, forecast_run_id TEXT NOT NULL,
      operating_date TEXT NOT NULL, ride_id INTEGER NOT NULL, target_minute INTEGER NOT NULL,
      predicted_wait INTEGER NOT NULL, lower_wait INTEGER, upper_wait INTEGER,
      confidence TEXT, method TEXT, model_version TEXT NOT NULL, calculated_at TEXT NOT NULL,
      actual_wait INTEGER, actual_status TEXT, actual_observed_at TEXT, resolved_at TEXT,
      FOREIGN KEY(forecast_run_id) REFERENCES forecast_runs(run_id));
    CREATE INDEX IF NOT EXISTS idx_ride_recommendation_lookup
      ON ride_recommendation_snapshots(ride_id,operating_date,target_minute,calculated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ride_recommendation_version
      ON ride_recommendation_snapshots(operating_date,ride_id,target_minute,predicted_wait,
        COALESCE(lower_wait,-1),COALESCE(upper_wait,-1),model_version);
    CREATE TABLE IF NOT EXISTS park_forecast_days(
      run_id TEXT NOT NULL, operating_date TEXT NOT NULL, is_open INTEGER NOT NULL,
      opens_minute INTEGER, closes_minute INTEGER, crowd_p10 REAL, crowd_p50 REAL,
      crowd_p90 REAL, confidence TEXT NOT NULL, weather_json TEXT,
      event_name TEXT, source TEXT NOT NULL,
      PRIMARY KEY(run_id,operating_date), FOREIGN KEY(run_id) REFERENCES forecast_runs(run_id));
    CREATE TABLE IF NOT EXISTS model_registry(
      model_version TEXT PRIMARY KEY, created_at TEXT NOT NULL, model_type TEXT NOT NULL,
      status TEXT NOT NULL, training_days INTEGER NOT NULL, metrics_json TEXT NOT NULL,
      artifact_path TEXT, promoted_at TEXT);
    CREATE TABLE IF NOT EXISTS data_health(
      component TEXT PRIMARY KEY, checked_at TEXT NOT NULL, status TEXT NOT NULL,
      message TEXT NOT NULL, details_json TEXT NOT NULL);
    INSERT OR IGNORE INTO forecast_schema_migrations VALUES(1,datetime('now'),'initial autonomous forecast schema');
    INSERT OR IGNORE INTO forecast_schema_migrations VALUES(2,datetime('now'),'external historical priors and normalized weather');
    INSERT OR IGNORE INTO forecast_schema_migrations VALUES(3,datetime('now'),'immutable ride recommendation snapshots with actual outcomes');
    """)
    db.commit()


def health(db: sqlite3.Connection, component: str, status: str, message: str, **details: Any) -> None:
    db.execute("""INSERT INTO data_health VALUES(?,?,?,?,?) ON CONFLICT(component) DO UPDATE SET
      checked_at=excluded.checked_at,status=excluded.status,message=excluded.message,details_json=excluded.details_json""",
      (component, now_local().isoformat(), status, message, json.dumps(details, ensure_ascii=False)))


def sync_calendar(db: sqlite3.Connection, start: date) -> dict[str, Any]:
    fetched = now_local().isoformat()
    source_url = "https://www.movieparkgermany.de/oeffnungszeiten-und-preise/oeffnungszeiten"
    good = 0
    errors: list[str] = []
    try:
        page = fetch_text(source_url)
        encoded_year = re.search(rf'id="data-hour-{start.year}"\s+value="([^"]+)"', page)
        encoded_labels = re.search(r'id="data-hour-labels"\s+value="([^"]+)"', page)
        if not encoded_year or not encoded_labels:
            raise ValueError("Offizieller Kalender enthält keine strukturierten Jahresdaten")
        months = json.loads(html.unescape(encoded_year.group(1)))
        label_rows = json.loads(html.unescape(encoded_labels.group(1)))
        labels = {str(key): str(value) for row in label_rows for key, value in row.items()}
    except Exception as exc:
        months, labels = [], {}
        errors.append(f"official-calendar: {exc}")
    for offset in range(HORIZON_DAYS):
        day = start + timedelta(days=offset)
        try:
            codes = str(months[day.month-1][str(day.day)]).split(",")
            texts = [labels.get(code, "") for code in codes]
            hours_text = next((value for value in texts if re.search(r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}", value)), None)
            hours = re.search(r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})", hours_text or "")
            event = next((value for value in texts if value and value != hours_text and "geschlossen" not in value.lower()), None)
            item = {"is_open":int(hours is not None),"opens_minute":int(hours.group(1))*60+int(hours.group(2)) if hours else None,
              "closes_minute":int(hours.group(3))*60+int(hours.group(4)) if hours else None,"event_name":event,
              "crowd_percent":None,"source_url":source_url}
            db.execute("""INSERT INTO park_calendar VALUES(?,?,?,?,?,?,?,?,?,0)
              ON CONFLICT(operating_date) DO UPDATE SET is_open=excluded.is_open,
              opens_minute=excluded.opens_minute,closes_minute=excluded.closes_minute,
              event_name=excluded.event_name,crowd_percent=excluded.crowd_percent,
              source=excluded.source,source_url=excluded.source_url,fetched_at=excluded.fetched_at,stale=0""",
              (day.isoformat(), item["is_open"], item["opens_minute"], item["closes_minute"],
               item["event_name"], item["crowd_percent"], "moviepark-official", item["source_url"], fetched))
            good += 1
        except Exception as exc:
            errors.append(f"{day}: {exc}")
            db.execute("UPDATE park_calendar SET stale=1 WHERE operating_date=?", (day.isoformat(),))
    status = "ok" if good == HORIZON_DAYS else "degraded" if good else "error"
    health(db, "calendar", status, f"{good}/{HORIZON_DAYS} Kalendertage aktualisiert", errors=errors)
    db.commit()
    return {"status": status, "updated": good, "errors": errors}


def sync_weather(db: sqlite3.Connection) -> dict[str, Any]:
    query = urllib.parse.urlencode({
      "latitude": LATITUDE, "longitude": LONGITUDE, "timezone": "Europe/Berlin", "forecast_days": HORIZON_DAYS,
      "hourly": "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m",
      "daily": "temperature_2m_min,temperature_2m_max,precipitation_probability_max",
    })
    fetched = now_local().isoformat()
    try:
        payload = fetch_json("https://api.open-meteo.com/v1/forecast?" + query)
        issued = fetched
        hourly = payload.get("hourly", {})
        times = hourly.get("time", [])
        fields = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "weather_code", "cloud_cover", "wind_speed_10m"]
        for index, target in enumerate(times):
            point = {field: (hourly.get(field, [None] * len(times))[index] if index < len(hourly.get(field, [])) else None) for field in fields}
            db.execute("INSERT OR REPLACE INTO external_forecast_snapshots VALUES(?,?,?,?,?)",
              ("open-meteo", issued, target, json.dumps(point), fetched))
        health(db, "weather", "ok", f"{len(times)} Wetterstunden aktualisiert")
        db.commit()
        return {"status": "ok", "hours": len(times), "issued_at": issued}
    except Exception as exc:
        health(db, "weather", "degraded", "Wetterabruf fehlgeschlagen; letzter Snapshot bleibt aktiv", error=str(exc))
        db.commit()
        return {"status": "degraded", "error": str(exc)}


def sync_queue_times_priors(db: sqlite3.Connection) -> dict[str, Any]:
    """Import public aggregate statistics; never treat them as raw observations."""
    url = f"https://queue-times.com/parks/{PARK_ID}/stats"
    fetched = now_local().isoformat()
    try:
        page = fetch_text(url)
        section = re.split(r"Average maximum queue time", page, maxsplit=1, flags=re.I)[0]
        matches = re.findall(r'href=["\']/parks/310/rides/(\d+)[^"\']*["\'][^>]*>.*?</a>\s*</td>\s*<td[^>]*>\s*(?:<[^>]+>\s*)*(\d+(?:\.\d+)?)', section, re.I | re.S)
        values = {int(ride_id): float(average) for ride_id, average in matches}
        if not values:
            raise ValueError("Keine öffentlichen Ride-Mittelwerte im Statistikdokument gefunden")
        for ride_id, average in values.items():
            db.execute("""INSERT INTO external_historical_priors VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(source,park_id,ride_id,granularity,period_key) DO UPDATE SET
              average_wait=excluded.average_wait,source_url=excluded.source_url,fetched_at=excluded.fetched_at""",
              ("queue-times-public", PARK_ID, ride_id, "all-time-ride-average", "all", average, url, fetched))
        health(db, "queue-times-priors", "ok", f"{len(values)} öffentliche Ride-Mittelwerte aktualisiert", source_url=url)
        db.commit()
        return {"status":"ok", "rides":len(values)}
    except Exception as exc:
        count = db.execute("SELECT COUNT(*) FROM external_historical_priors WHERE source='queue-times-public'").fetchone()[0]
        health(db, "queue-times-priors", "degraded", "Öffentliche Mittelwerte konnten nicht aktualisiert werden; letzter Stand bleibt aktiv", error=str(exc), retained=count)
        db.commit()
        return {"status":"degraded", "error":str(exc), "retained":count}


def nearest_rank(values: list[float], ratio: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return float(ordered[max(0, math.ceil(len(ordered) * ratio) - 1)])


def samples_for(db: sqlite3.Connection, ride_id: int, minute: int, target: date) -> tuple[list[sqlite3.Row], str]:
    common = "status='open' AND measurement_valid=1 AND wait_minutes IS NOT NULL AND operating_date<?"
    rows = db.execute(f"SELECT operating_date,wait_minutes FROM ride_training_rows WHERE ride_id=? AND time_bucket=? AND weekday=? AND {common}",
                      (ride_id, minute, target.weekday(), target.isoformat())).fetchall()
    method = "same_weekday"
    if len({r[0] for r in rows}) < 2:
        rows = db.execute(f"SELECT operating_date,wait_minutes FROM ride_training_rows WHERE ride_id=? AND time_bucket=? AND is_weekend=? AND {common}",
                          (ride_id, minute, int(target.weekday() >= 5), target.isoformat())).fetchall()
        method = "same_day_type"
    if len({r[0] for r in rows}) < 2:
        rows = db.execute(f"SELECT operating_date,wait_minutes FROM ride_training_rows WHERE ride_id=? AND time_bucket=? AND {common}",
                          (ride_id, minute, target.isoformat())).fetchall()
        method = "all_days"
    return rows, method


def weather_condition(code: int | None) -> str:
    if code is None: return "Wetter noch offen"
    if code == 0: return "Sonnig"
    if code <= 3: return "Leicht bewölkt"
    if code in (45,48): return "Neblig"
    if code <= 67: return "Regen"
    if code <= 77: return "Schnee"
    if code <= 82: return "Schauer"
    return "Gewitter"


def latest_weather(db: sqlite3.Connection, day: str) -> dict[str, Any]:
    rows = db.execute("""SELECT target_at,payload_json,issued_at FROM external_forecast_snapshots e
      WHERE source='open-meteo' AND substr(target_at,1,10)=? AND issued_at=(SELECT MAX(issued_at) FROM external_forecast_snapshots WHERE source='open-meteo')
      ORDER BY target_at""", (day,)).fetchall()
    hourly = [{"time": row[0], **json.loads(row[1])} for row in rows]
    temperatures = [float(item["temperature_2m"]) for item in hourly if item.get("temperature_2m") is not None]
    rain = [float(item["precipitation_probability"]) for item in hourly if item.get("precipitation_probability") is not None]
    wind = [float(item["wind_speed_10m"]) for item in hourly if item.get("wind_speed_10m") is not None]
    codes = [int(item["weather_code"]) for item in hourly if item.get("weather_code") is not None]
    result = {"temperatureMin":min(temperatures) if temperatures else None,
      "temperatureMax":max(temperatures) if temperatures else None,
      "precipitationProbability":max(rain) if rain else None,"windSpeedMax":max(wind) if wind else None,
      "weatherCode":statistics.mode(codes) if codes else None,"updatedAt":rows[0][2] if rows else None,"hourly":hourly}
    result["condition"] = weather_condition(result["weatherCode"])
    if day == now_local().date().isoformat():
        try:
            live = db.execute("""SELECT wo.temperature_c,wo.condition,s.observed_at FROM weather_observations wo
              JOIN snapshots s ON s.snapshot_id=wo.snapshot_id ORDER BY unixepoch(s.observed_at) DESC LIMIT 1""").fetchone()
            if live:
                result.update({"currentTemperature":live[0],"currentCondition":live[1],"currentUpdatedAt":live[2]})
        except sqlite3.OperationalError:
            pass
    return result


def external_prior(db: sqlite3.Connection, ride_id: int) -> float | None:
    row = db.execute("""SELECT average_wait FROM external_historical_priors
      WHERE source='queue-times-public' AND park_id=? AND ride_id=? AND granularity='all-time-ride-average'""", (PARK_ID,ride_id)).fetchone()
    return float(row[0]) if row else None


def best_recommendation_points(points: list[sqlite3.Row], opens: int, closes: int, earliest: int) -> list[sqlite3.Row]:
    lower_bound = max(opens + 60, earliest)
    upper_bound = closes - 30
    candidates = sorted(
        (point for point in points if point["p50"] is not None and lower_bound <= int(point["minute_of_day"]) <= upper_bound),
        key=lambda point: (float(point["p50"]), int(point["minute_of_day"])),
    )
    selected: list[sqlite3.Row] = []
    for point in candidates:
        if all(abs(int(existing["minute_of_day"]) - int(point["minute_of_day"])) >= 60 for existing in selected):
            selected.append(point)
        if len(selected) == 3:
            break
    return sorted(selected, key=lambda point: int(point["minute_of_day"]))


def store_recommendation_snapshots(db: sqlite3.Connection, run_id: str, generated: datetime) -> int:
    run = db.execute("SELECT model_version,generated_at FROM forecast_runs WHERE run_id=?", (run_id,)).fetchone()
    if not run:
        return 0
    created = 0
    days = db.execute("SELECT operating_date,opens_minute,closes_minute FROM park_forecast_days WHERE run_id=? AND is_open=1", (run_id,)).fetchall()
    for day in days:
        operating_date, opens, closes = str(day[0]), int(day[1]), int(day[2])
        earliest = generated.hour * 60 + generated.minute + 30 if operating_date == generated.date().isoformat() else 0
        ride_ids = db.execute("SELECT DISTINCT ride_id FROM forecast_points WHERE run_id=? AND operating_date=?", (run_id,operating_date)).fetchall()
        for (ride_id,) in ride_ids:
            points = db.execute("""SELECT minute_of_day,p10,p50,p90,confidence,method FROM forecast_points
              WHERE run_id=? AND operating_date=? AND ride_id=? ORDER BY minute_of_day""", (run_id,operating_date,ride_id)).fetchall()
            for point in best_recommendation_points(points, opens, closes, earliest):
                target_minute = int(point["minute_of_day"])
                snapshot_id = hashlib.sha256(f"{run_id}:{operating_date}:{ride_id}:{target_minute}".encode()).hexdigest()[:24]
                cursor = db.execute("""INSERT OR IGNORE INTO ride_recommendation_snapshots
                  (snapshot_id,forecast_run_id,operating_date,ride_id,target_minute,predicted_wait,lower_wait,upper_wait,
                   confidence,method,model_version,calculated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (snapshot_id,run_id,operating_date,int(ride_id),target_minute,round(float(point["p50"])),
                   None if point["p10"] is None else round(float(point["p10"])),None if point["p90"] is None else round(float(point["p90"])),
                   point["confidence"],point["method"],run["model_version"],run["generated_at"]))
                created += cursor.rowcount
    return created


def resolve_recommendation_actuals(db: sqlite3.Connection, now: datetime) -> int:
    resolved = 0
    today = now.date().isoformat()
    current_minute = now.hour * 60 + now.minute
    pending = db.execute("""SELECT snapshot_id,operating_date,ride_id,target_minute
      FROM ride_recommendation_snapshots WHERE resolved_at IS NULL AND
      (operating_date<? OR (operating_date=? AND target_minute<=?))""", (today,today,current_minute-16)).fetchall()
    for item in pending:
        closest = db.execute("""SELECT s.observed_at,ro.status,ro.wait_minutes,ro.measurement_valid,
            ABS((CAST(substr(s.observed_at,12,2) AS INTEGER)*60+CAST(substr(s.observed_at,15,2) AS INTEGER))-?) AS distance
          FROM ride_observations ro JOIN snapshots s ON s.snapshot_id=ro.snapshot_id
          WHERE ro.ride_id=? AND s.operating_date=?
            AND ABS((CAST(substr(s.observed_at,12,2) AS INTEGER)*60+CAST(substr(s.observed_at,15,2) AS INTEGER))-?)<=16
          ORDER BY CASE WHEN ro.measurement_valid=1 AND ro.wait_minutes IS NOT NULL THEN 0 ELSE 1 END,distance,unixepoch(s.observed_at) LIMIT 1""",
          (item["target_minute"],item["ride_id"],item["operating_date"],item["target_minute"])).fetchone()
        if closest:
            actual_wait = int(closest["wait_minutes"]) if closest["measurement_valid"] and closest["wait_minutes"] is not None else None
            actual_status = "measured" if actual_wait is not None else str(closest["status"] or "unavailable")
            db.execute("""UPDATE ride_recommendation_snapshots SET actual_wait=?,actual_status=?,actual_observed_at=?,resolved_at=?
              WHERE snapshot_id=?""", (actual_wait,actual_status,closest["observed_at"],now.isoformat(),item["snapshot_id"]))
            resolved += 1
        elif item["operating_date"] < today:
            db.execute("UPDATE ride_recommendation_snapshots SET actual_status='no_measurement',resolved_at=? WHERE snapshot_id=?", (now.isoformat(),item["snapshot_id"]))
            resolved += 1
    return resolved


def model_calendar_flags(target: date) -> tuple[int, int, int]:
    """Known-at-prediction-time NRW/NL calendar flags used by model feature v2."""
    def easter(year: int) -> date:
        a=year%19;b=year//100;c=year%100;d=b//4;e=b%4;f=(b+8)//25;g=(b-f+1)//3;h=(19*a+b-d-g+15)%30;i=c//4;k=c%4;l=(32+2*e+2*i-h-k)%7;m=(a+11*h+22*l)//451
        return date(year,(h+l-7*m+114)//31,(h+l-7*m+114)%31+1)
    easter_day=easter(target.year)
    public=int((target.month,target.day) in {(1,1),(5,1),(10,3),(11,1),(12,25),(12,26)} or target in {easter_day-timedelta(days=2),easter_day+timedelta(days=1),easter_day+timedelta(days=39),easter_day+timedelta(days=50),easter_day+timedelta(days=60)})
    nrw={2026:[("2026-03-30","2026-04-11"),("2026-07-20","2026-09-01"),("2026-10-17","2026-10-31"),("2026-12-23","2027-01-06")],2027:[("2027-03-22","2027-04-03"),("2027-07-19","2027-08-31"),("2027-10-23","2027-11-06"),("2027-12-24","2028-01-08")]}
    nl={2026:[("2026-02-14","2026-03-01"),("2026-04-25","2026-05-10"),("2026-07-04","2026-08-30"),("2026-10-10","2026-10-25"),("2026-12-19","2027-01-03")],2027:[("2027-02-13","2027-02-28"),("2027-04-24","2027-05-09"),("2027-07-10","2027-09-05"),("2027-10-16","2027-10-31"),("2027-12-25","2028-01-09")]}
    inside=lambda ranges:int(any(a<=target.isoformat()<=b for a,b in ranges))
    return public,inside(nrw.get(target.year,[])),inside(nl.get(target.year,[]))


def model_feature_vector(ride_id: int, category: str, minute: int, target: date, weather: dict[str, Any],
                         opens: int, closes: int, event_name: str | None, weather_sensitive: int) -> list[Any]:
    event_value=(event_name or "").lower();event="summer-nights" if "summer" in event_value else "halloween" if "halloween" in event_value else "hollywood-christmas" if "christmas" in event_value or "weihnacht" in event_value else "other-event" if event_value.strip() else "none"
    temp=float(weather.get("temperature_2m") or 15);rain=float(weather.get("precipitation") or 0);sensitive=int(weather_sensitive or 0);public,nrw,nl=model_calendar_flags(target)
    return [str(ride_id),str(category or "unknown"),minute,target.weekday(),int(target.weekday()>=5),target.month,target.timetuple().tm_yday,temp,rain,float(weather.get("cloud_cover") or 50),float(weather.get("wind_speed_10m") or 10),event,int(event=="summer-nights"),max(0,closes-opens),max(0,minute-opens),max(0,closes-minute),public,nrw,nl,sensitive,rain*sensitive,max(0,temp-25)*sensitive,max(0,8-temp)*sensitive]


def generate_experimental_run(db: sqlite3.Connection, baseline_run_id: str, generated: datetime,
                              data_as_of: str, start: date, source_health: dict[str, Any],
                              days: int) -> str | None:
    """Materialize the newest CatBoost challenger beside the published baseline.

    Experimental runs are deliberately never promoted and never feed the immutable
    recommendation/accuracy history. They exist only for the user opt-in UI.
    """
    model_row = db.execute("""SELECT model_version,artifact_path,metrics_json,status
      FROM model_registry WHERE status IN ('shadow','rejected') AND artifact_path IS NOT NULL
      ORDER BY datetime(created_at) DESC LIMIT 1""").fetchone()
    if not model_row or not Path(model_row[1]).is_file():
        return None
    try:
        from catboost import CatBoostRegressor
        model = CatBoostRegressor()
        model.load_model(model_row[1])
        metrics = json.loads(model_row[2])
        features = metrics.get("features", [])
        closure_model = None
        closure_path = metrics.get("closureModel", {}).get("artifactPath")
        if closure_path and Path(closure_path).is_file():
            from catboost import CatBoostClassifier
            closure_model = CatBoostClassifier();closure_model.load_model(closure_path)
    except Exception as exc:
        health(db, "experimental-model", "degraded", "Experimentelles Modell konnte nicht geladen werden", error=str(exc))
        return None

    run_id = hashlib.sha256(f"experimental:{generated.isoformat()}:{data_as_of}:{model_row[0]}".encode()).hexdigest()[:20]
    quality = {"trainingDays": days, "stage": "experimental", "modelStatus": model_row[3],
               "baselineRunId": baseline_run_id, "metrics": metrics}
    db.execute("INSERT INTO forecast_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      (run_id, generated.isoformat(), data_as_of, start.isoformat(), (start+timedelta(days=HORIZON_DAYS-1)).isoformat(),
       model_row[0], "catboost-multiquantile-experimental", "ready", json.dumps(quality), json.dumps(source_health), 0))
    db.execute("""INSERT INTO park_forecast_days
      SELECT ?,operating_date,is_open,opens_minute,closes_minute,crowd_p10,crowd_p50,crowd_p90,
             'low',weather_json,event_name,'catboost-experimental'
      FROM park_forecast_days WHERE run_id=?""", (run_id, baseline_run_id))

    rows = db.execute("""SELECT fp.operating_date,fp.ride_id,fp.minute_of_day,fp.open_probability,
      fp.support_days,fp.support_samples,r.category,p.weather_json,p.opens_minute,p.closes_minute,p.event_name,
      COALESCE((SELECT MAX(t.weather_sensitive) FROM ride_training_rows t WHERE t.ride_id=fp.ride_id),0),fp.p10,fp.p50,fp.p90
      FROM forecast_points fp JOIN rides r ON r.ride_id=fp.ride_id
      JOIN park_forecast_days p ON p.run_id=fp.run_id AND p.operating_date=fp.operating_date
      WHERE fp.run_id=? ORDER BY fp.operating_date,fp.ride_id,fp.minute_of_day""", (baseline_run_id,)).fetchall()
    day_values: dict[str, list[float]] = {}
    for row in rows:
        target = date.fromisoformat(row[0]); minute = int(row[2]); weather = json.loads(row[7] or "{}")
        point_weather = min(weather.get("hourly", []), key=lambda item: abs(int(item["time"][11:13])*60+int(item["time"][14:16])-minute), default={})
        basic = [str(row[1]), str(row[6] or "unknown"), minute, target.weekday(), int(target.weekday() >= 5), target.month]
        extended = model_feature_vector(row[1],row[6],minute,target,point_weather,int(row[8] or 600),int(row[9] or 1080),row[10],int(row[11] or 0)) if len(features)>11 else basic+[target.timetuple().tm_yday,float(point_weather.get("temperature_2m") or 15),float(point_weather.get("precipitation") or 0),float(point_weather.get("cloud_cover") or 50),float(point_weather.get("wind_speed_10m") or 10)]
        predicted = model.predict([extended])[0]
        p10, p50, p90 = (round(max(0.0, float(predicted[0]))), round(max(0.0, float(predicted[1]))),
                         round(max(0.0, float(predicted[2]))))
        ride_metrics=metrics.get("perRide",{}).get(str(row[1]),{});calibration=ride_metrics.get("calibration",metrics.get("calibration",{}))
        if ride_metrics.get("strategy")=="baseline":p10,p50,p90=round(row[12]),round(row[13]),round(row[14])
        elif calibration:p10=round(max(0,float(p50)+float(calibration.get("lowerOffset",0))));p90=round(max(float(p50),float(p50)+float(calibration.get("upperOffset",0))))
        open_probability=float(closure_model.predict_proba([extended])[0][1]) if closure_model else row[3]
        day_values.setdefault(row[0], []).append(float(p50))
        db.execute("INSERT INTO forecast_points VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          (run_id,row[0],row[1],minute,p10,p50,p90,open_probability,"low",row[4],row[5],
           "catboost-hybrid-v2-experimental","experimental-not-production"))
    for operating_date, values in day_values.items():
        crowd = min(100.0, statistics.fmean(values) / 40 * 100) if values else None
        if crowd is not None:
            db.execute("""UPDATE park_forecast_days SET crowd_p10=?,crowd_p50=?,crowd_p90=?
              WHERE run_id=? AND operating_date=?""", (max(0,crowd-15),crowd,min(100,crowd+15),run_id,operating_date))
    health(db, "experimental-model", "ok", f"Experimentelle Prognose {run_id} erzeugt",
           model_version=model_row[0], baseline_run_id=baseline_run_id)
    return run_id


def generate(db: sqlite3.Connection, start: date) -> str:
    generated = now_local()
    data_as_of = db.execute("SELECT MAX(observed_at) FROM snapshots").fetchone()[0] or generated.isoformat()
    days = int(db.execute("SELECT COUNT(DISTINCT operating_date) FROM ride_training_rows").fetchone()[0])
    run_id = hashlib.sha256(f"{generated.isoformat()}:{data_as_of}".encode()).hexdigest()[:20]
    source_health = {row[0]: {"status": row[1], "message": row[2]} for row in db.execute("SELECT component,status,message FROM data_health")}
    champion_row = db.execute("SELECT model_version,artifact_path,metrics_json FROM model_registry WHERE status='champion' ORDER BY promoted_at DESC LIMIT 1").fetchone()
    champion = None
    champion_features: list[str] = []
    champion_metrics: dict[str, Any] = {}
    champion_closure = None
    if champion_row and champion_row[1] and Path(champion_row[1]).is_file():
        try:
            from catboost import CatBoostRegressor
            champion=CatBoostRegressor();champion.load_model(champion_row[1]);champion_metrics=json.loads(champion_row[2]);champion_features=champion_metrics.get("features",[])
            closure_path=champion_metrics.get("closureModel",{}).get("artifactPath")
            if closure_path and Path(closure_path).is_file():
                from catboost import CatBoostClassifier
                champion_closure=CatBoostClassifier();champion_closure.load_model(closure_path)
        except Exception as exc:
            health(db,"model","degraded","Champion konnte nicht geladen werden",error=str(exc))
    quality = {"trainingDays": days, "stage": "production-model" if champion else "cold-start" if days < 14 else "shadow" if days < 28 else "gate-pending"}
    model_version = str(champion_row[0]) if champion else "baseline-v3-prior"
    db.execute("INSERT INTO forecast_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      (run_id, generated.isoformat(), data_as_of, start.isoformat(), (start+timedelta(days=HORIZON_DAYS-1)).isoformat(),
       model_version, "catboost-multiquantile" if champion else "historical-quantiles+public-prior", "ready", json.dumps(quality), json.dumps(source_health), 1))
    # Only publish rides whose operation has been confirmed at least once.  The
    # source keeps retired/pre-opening rides indefinitely, but they must not be
    # presented as actionable visitor recommendations.
    rides = db.execute("""SELECT r.ride_id,COALESCE(r.category,'unknown') FROM rides r
      WHERE r.ride_id NOT IN ({}) AND EXISTS(SELECT 1 FROM ride_observations ro
        WHERE ro.ride_id=r.ride_id AND ro.status='open' AND ro.source_fresh=1)
      ORDER BY r.ride_id""".format(",".join("?" for _ in RETIRED_RIDE_IDS)), tuple(sorted(RETIRED_RIDE_IDS))).fetchall()
    current_minute = generated.hour * 60 + generated.minute
    latest_live = {row[0]: float(row[1]) for row in db.execute("""SELECT ro.ride_id,ro.wait_minutes
      FROM ride_observations ro WHERE ro.snapshot_id=(SELECT snapshot_id FROM snapshots ORDER BY unixepoch(observed_at) DESC LIMIT 1)
      AND ro.status='open' AND ro.measurement_valid=1 AND ro.source_fresh=1 AND ro.wait_minutes IS NOT NULL""")}
    for offset in range(HORIZON_DAYS):
        target = start + timedelta(days=offset)
        cal = db.execute("SELECT * FROM park_calendar WHERE operating_date=?", (target.isoformat(),)).fetchone()
        is_open = int(cal[1]) if cal else 1
        opens = cal[2] if cal and cal[2] is not None else OPEN_MINUTE
        closes = cal[3] if cal and cal[3] is not None else DEFAULT_CLOSE_MINUTE
        ride_medians: list[float] = []
        day_weather = latest_weather(db,target.isoformat())
        if is_open:
            for ride_id, category in rides:
                for minute in range(opens, closes + 1, BUCKET_MINUTES):
                    rows, method = samples_for(db, ride_id, minute, target)
                    waits = [float(row[1]) for row in rows]
                    prior = external_prior(db, ride_id)
                    if not waits and prior is None:
                        continue
                    support_days = len({row[0] for row in rows})
                    # During cold start no individual point can be advertised as
                    # highly reliable just because a bucket happened to contain
                    # seven days.  The run maturity remains the upper bound.
                    if days < 14:
                        confidence = "low"
                    elif days < 28:
                        confidence = "low" if support_days < 5 else "medium"
                    else:
                        confidence = "low" if support_days < 3 else "medium" if support_days < 7 else "high"
                    if waits:
                        p10, p50, p90 = nearest_rank(waits, .1), statistics.median(waits), nearest_rank(waits, .9)
                    else:
                        shape = .78 if minute < opens+90 else 1.18 if minute < closes-120 else .9
                        p50 = float(prior) * shape; p10=max(0.0,p50-max(5.0,p50*.4)); p90=p50+max(8.0,p50*.55)
                    if prior is not None and not champion:
                        prior_weight = 3.0
                        local_weight = float(support_days)
                        p50 = (float(p50)*local_weight + prior*prior_weight) / (local_weight+prior_weight)
                        p10 = (float(p10)*local_weight + max(0.0,prior-max(5.0,prior*.4))*prior_weight) / (local_weight+prior_weight)
                        p90 = (float(p90)*local_weight + (prior+max(8.0,prior*.55))*prior_weight) / (local_weight+prior_weight)
                        method += "+queue-times-public-prior"
                    fallback_reason = "insufficient-history" if support_days < 3 else None
                    if champion:
                        baseline_values=(p10,p50,p90)
                        point_weather = min(day_weather.get("hourly",[]),key=lambda item:abs(int(item["time"][11:13])*60+int(item["time"][14:16])-minute),default={})
                        basic=[str(ride_id),str(category),minute,target.weekday(),int(target.weekday()>=5),target.month]
                        weather_sensitive=db.execute("SELECT COALESCE(MAX(weather_sensitive),0) FROM ride_training_rows WHERE ride_id=?",(ride_id,)).fetchone()[0]
                        extended=model_feature_vector(ride_id,category,minute,target,point_weather,opens,closes,cal[4] if cal else None,weather_sensitive) if len(champion_features)>11 else basic+[target.timetuple().tm_yday,float(point_weather.get("temperature_2m") or 15),float(point_weather.get("precipitation") or 0),float(point_weather.get("cloud_cover") or 50),float(point_weather.get("wind_speed_10m") or 10)]
                        predicted=champion.predict([extended if len(champion_features)>6 else basic])[0]
                        p10,p50,p90=(max(0.0,float(predicted[0])),max(0.0,float(predicted[1])),max(0.0,float(predicted[2])))
                        ride_metrics=champion_metrics.get("perRide",{}).get(str(ride_id),{});calibration=ride_metrics.get("calibration",champion_metrics.get("calibration",{}))
                        if ride_metrics.get("strategy")=="baseline":p10,p50,p90=baseline_values
                        elif calibration:p10=max(0,p50+float(calibration.get("lowerOffset",0)));p90=max(p50,p50+float(calibration.get("upperOffset",0)))
                        method="catboost-multiquantile"
                        confidence="high"
                    if offset == 0 and ride_id in latest_live and minute >= current_minute:
                        current_bucket_rows, _ = samples_for(db, ride_id, (current_minute // BUCKET_MINUTES) * BUCKET_MINUTES, target)
                        current_baseline = statistics.median([float(row[1]) for row in current_bucket_rows]) if current_bucket_rows else p50
                        residual = max(-45.0, min(45.0, latest_live[ride_id] - float(current_baseline)))
                        correction = residual * math.exp(-max(0, minute-current_minute) / 90.0)
                        p10, p50, p90 = max(0.0,float(p10)+correction), max(0.0,float(p50)+correction), max(0.0,float(p90)+correction)
                        method += "+live-residual"
                        fallback_reason = fallback_reason or "live-adjusted"
                    p10, p50, p90 = round(p10), round(p50), round(p90)
                    reliability = db.execute("""SELECT
                        AVG(CASE WHEN ro.status='open' AND ro.source_fresh=1 THEN 1.0 ELSE 0.0 END)
                      FROM ride_observations ro JOIN snapshots s ON s.snapshot_id=ro.snapshot_id
                      WHERE ro.ride_id=? AND s.operating_date<?""", (ride_id,target.isoformat())).fetchone()[0]
                    open_probability = max(0.05,min(1.0,float(reliability))) if reliability is not None else 0.5
                    if champion and champion_closure:open_probability=max(0.01,min(1.0,float(champion_closure.predict_proba([extended if len(champion_features)>6 else basic])[0][1])))
                    ride_medians.append(float(p50))
                    db.execute("INSERT INTO forecast_points VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (run_id,target.isoformat(),ride_id,minute,p10,p50,p90,open_probability,confidence,support_days,len(waits),method,
                       fallback_reason))
        external_crowd = float(cal[5]) if cal and cal[5] is not None else None
        own_crowd = min(100.0, statistics.fmean(ride_medians) / 40 * 100) if ride_medians else None
        crowd = external_crowd if days < 14 and external_crowd is not None else own_crowd if own_crowd is not None else external_crowd
        confidence = "low" if days < 14 else "medium" if days < 28 else "high"
        spread = 15 if confidence == "low" else 10 if confidence == "medium" else 7
        db.execute("INSERT INTO park_forecast_days VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          (run_id,target.isoformat(),is_open,opens,closes,max(0,crowd-spread) if crowd is not None else None,crowd,
           min(100,crowd+spread) if crowd is not None else None,confidence,json.dumps(day_weather),
           cal[4] if cal else None,"queue-times-cold-start" if days < 14 and external_crowd is not None else "own-baseline+queue-times-public-prior" if db.execute("SELECT 1 FROM external_historical_priors LIMIT 1").fetchone() else "own-baseline"))
    db.execute("UPDATE forecast_runs SET promoted=0 WHERE run_id<>?", (run_id,))
    experimental_run_id = generate_experimental_run(db, run_id, generated, data_as_of, start, source_health, days)
    stored_recommendations = store_recommendation_snapshots(db, run_id, generated)
    resolved_recommendations = resolve_recommendation_actuals(db, generated)
    health(db, "forecast", "ok", f"Sieben-Tage-Prognose {run_id} erzeugt", training_days=days,
      stored_recommendations=stored_recommendations,resolved_recommendations=resolved_recommendations,
      experimental_run_id=experimental_run_id)
    db.commit()
    return run_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=DB_PATH)
    parser.add_argument("--start-date")
    parser.add_argument("--skip-network", action="store_true")
    args = parser.parse_args()
    start = date.fromisoformat(args.start_date) if args.start_date else now_local().date()
    db = sqlite3.connect(args.database, timeout=300)
    db.execute("PRAGMA busy_timeout=300000")
    db.row_factory = sqlite3.Row
    try:
        init_schema(db)
        if not args.skip_network:
            sync_calendar(db, start)
            sync_weather(db)
            sync_queue_times_priors(db)
        run_id = generate(db, start)
        print(json.dumps({"status": "ok", "runId": run_id, "start": start.isoformat(), "days": HORIZON_DAYS}))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
