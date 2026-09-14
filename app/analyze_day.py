#!/usr/bin/env python3
"""Movie Park Germany Tagesanalyse 3.0.

Liest ausschließlich Raw-Snapshots, erzeugt Tages-/Qualitäts-/Wetterberichte,
vergleicht frühere Wetterprognosen mit später beobachtetem Wetter, pflegt SQLite
und kann die kompakte Tageszusammenfassung an ntfy senden.
"""
from __future__ import annotations
import argparse, csv, json, math, os, sqlite3, statistics, sys, urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

TZ=ZoneInfo("Europe/Berlin")
START=time(9,30); END=time(18,30); INTERVAL_MINUTES=5
DEFAULT_DATA=Path("data")
NTFY_SERVER=os.getenv("NTFY_SERVER","https://ntfy.sh").rstrip("/")
NTFY_TOPIC=os.getenv("NTFY_TOPIC","gerrxt-moviepark-app-channel").strip()
EXCLUDED_RIDE_IDS={11003,10986,13964,15278,11010}
RIDE_NAME_OVERRIDES={10984:"Star Trek: Operation Enterprise"}

class AnalysisError(RuntimeError): pass

def iso(v):
    if not isinstance(v,str): return None
    try:
        d=datetime.fromisoformat(v.replace("Z","+00:00"))
        if d.tzinfo is None: d=d.replace(tzinfo=TZ)
        return d.astimezone(TZ)
    except ValueError: return None
def num(v):
    return float(v) if isinstance(v,(int,float)) and not isinstance(v,bool) else None
def intval(v):
    try: return int(v)
    except (TypeError,ValueError): return None
def all_rides(payload):
    out=[]
    if isinstance(payload,dict):
        if isinstance(payload.get("rides"),list): out += [x for x in payload["rides"] if isinstance(x,dict)]
        for land in payload.get("lands",[]) if isinstance(payload.get("lands"),list) else []:
            if isinstance(land,dict) and isinstance(land.get("rides"),list):
                out += [x for x in land["rides"] if isinstance(x,dict)]
    return out
def normalize_raw_rides(doc):
    obs=doc.get("observations")
    if isinstance(obs,list): return [r for r in obs if intval(r.get("ride_id") or r.get("id")) not in EXCLUDED_RIDE_IDS]
    result=[]
    for r in all_rides(doc.get("payload",{})):
        rid=intval(r.get("id")); name=str(r.get("name") or f"Ride {rid}")
        if rid in EXCLUDED_RIDE_IDS: continue
        op=r.get("is_open"); wait=intval(r.get("wait_time"))
        status="open" if op is True and wait is not None and wait>=0 else ("closed" if op is False else "unknown")
        result.append({"ride_id":rid,"display_name":" ".join(name.split()),"status":status,
                       "wait_time_minutes":wait if status=="open" else None,
                       "measurement_valid":status=="open" and wait is not None and 0<=wait<=240,
                       "source_fresh":True})
    return result

@dataclass
class Snapshot:
    ts: datetime; path: Path; doc: dict; rides: list; weather: dict|None

def load_day(data_dir:Path, day:str):
    folder=data_dir/"raw"/day
    if not folder.is_dir(): raise AnalysisError(f"Raw-Tagesordner fehlt: {folder}")
    snaps=[]; invalid=[]
    for p in sorted(folder.glob("*.json")):
        try:
            doc=json.loads(p.read_text(encoding="utf-8"))
            req=doc.get("request",{})
            ts=iso(req.get("fetched_at_local") or req.get("fetched_at_utc"))
            if not ts: raise ValueError("Zeitstempel fehlt")
            snaps.append(Snapshot(ts,p,doc,normalize_raw_rides(doc),doc.get("weather") if isinstance(doc.get("weather"),dict) else None))
        except Exception as exc: invalid.append(f"{p.name}: {exc}")
    snaps.sort(key=lambda x:x.ts)
    # Keep last file per timestamp
    snaps=list({s.ts:s for s in snaps}.values()); snaps.sort(key=lambda x:x.ts)
    if not snaps: raise AnalysisError("Keine lesbaren Raw-Snapshots gefunden.")
    return snaps,invalid

def load_categories(path:Path):
    try:
        d=json.loads(path.read_text(encoding="utf-8"))
        return d.get("rides",{}) if isinstance(d,dict) else {}
    except (OSError,json.JSONDecodeError): return {}

def day_bounds(day):
    d=date.fromisoformat(day)
    return datetime.combine(d,START,tzinfo=TZ),datetime.combine(d,END,tzinfo=TZ)

def weather_class(w):
    c=w.get("current",{}) if isinstance(w,dict) else {}
    pr=num(c.get("precipitation_mm")) or 0; rain=num(c.get("rain_mm")) or 0; showers=num(c.get("showers_mm")) or 0
    total=max(pr,rain+showers)
    if total>=2: return "starker_niederschlag"
    if total>0: return "nass"
    return "trocken"

def ensure_rides_schema(conn):
    """Migriert ältere rides-Tabellen ohne Verlust vorhandener IDs/Namen."""
    columns = {row[1] for row in conn.execute("PRAGMA table_info(rides)")}
    if not columns:
        return
    required = {
        "ride_id": "INTEGER",
        "name": "TEXT",
        "category": "TEXT",
        "indoor": "INTEGER",
        "water": "INTEGER",
        "family": "INTEGER",
        "thrill": "INTEGER",
        "weather_sensitive": "INTEGER",
    }
    for column, sql_type in required.items():
        if column not in columns:
            conn.execute(f"ALTER TABLE rides ADD COLUMN {column} {sql_type}")


def init_db(conn):
    conn.executescript("""
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS snapshots(
      snapshot_id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, operating_date TEXT NOT NULL,
      raw_path TEXT, http_status INTEGER, duration_ms INTEGER, payload_fresh INTEGER,
      ride_count INTEGER, collector_version TEXT);
    CREATE TABLE IF NOT EXISTS rides(
      ride_id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, indoor INTEGER,
      water INTEGER, family INTEGER, thrill INTEGER, weather_sensitive INTEGER);
    CREATE TABLE IF NOT EXISTS ride_observations(
      snapshot_id TEXT NOT NULL, ride_id INTEGER NOT NULL, status TEXT NOT NULL,
      wait_minutes INTEGER, measurement_valid INTEGER, source_fresh INTEGER,
      PRIMARY KEY(snapshot_id,ride_id), FOREIGN KEY(snapshot_id) REFERENCES snapshots(snapshot_id));
    CREATE TABLE IF NOT EXISTS weather_observations(
      snapshot_id TEXT PRIMARY KEY, temperature_c REAL, apparent_temperature_c REAL,
      humidity_percent REAL, precipitation_mm REAL, rain_mm REAL, showers_mm REAL,
      weather_code INTEGER, condition TEXT, cloud_cover_percent REAL,
      wind_speed_kmh REAL, wind_gusts_kmh REAL,
      FOREIGN KEY(snapshot_id) REFERENCES snapshots(snapshot_id));
    CREATE TABLE IF NOT EXISTS weather_forecasts(
      snapshot_id TEXT NOT NULL, forecast_for TEXT NOT NULL, temperature_c REAL,
      apparent_temperature_c REAL, precipitation_probability REAL, precipitation_mm REAL,
      rain_mm REAL, showers_mm REAL, weather_code INTEGER, condition TEXT,
      cloud_cover_percent REAL, wind_speed_kmh REAL, wind_gusts_kmh REAL,
      PRIMARY KEY(snapshot_id,forecast_for), FOREIGN KEY(snapshot_id) REFERENCES snapshots(snapshot_id));
    CREATE TABLE IF NOT EXISTS daily_summaries(
      operating_date TEXT PRIMARY KEY, created_at TEXT NOT NULL, quality_score REAL,
      snapshot_count INTEGER, expected_snapshots INTEGER, ride_count INTEGER,
      park_avg_wait REAL, max_wait INTEGER, max_wait_ride TEXT, summary_json TEXT);
    """)
    ensure_rides_schema(conn)
    conn.commit()

def import_db(conn,snaps,categories,day):
    for rid,meta in categories.items():
        conn.execute("""INSERT INTO rides
        (ride_id,name,category,indoor,water,family,thrill,weather_sensitive)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(ride_id) DO UPDATE SET name=excluded.name,category=excluded.category,indoor=excluded.indoor,
        water=excluded.water,family=excluded.family,thrill=excluded.thrill,weather_sensitive=excluded.weather_sensitive""",
        (int(rid),meta.get("name",rid),meta.get("category"),int(bool(meta.get("indoor"))),int(bool(meta.get("water"))),
         int(bool(meta.get("family"))),int(bool(meta.get("thrill"))),int(bool(meta.get("weather_sensitive")))))
    for s in snaps:
        sid=s.ts.isoformat()
        q=s.doc.get("data_quality",{}); req=s.doc.get("request",{}); col=s.doc.get("collector",{})
        conn.execute("""INSERT OR REPLACE INTO snapshots VALUES(?,?,?,?,?,?,?,?,?)""",
          (sid,sid,day,str(s.path),intval(req.get("http_status")),intval(req.get("duration_ms")),
           int(bool(q.get("payload_fresh"))),len(s.rides),str(col.get("version") or "")))
        for r in s.rides:
            rid=intval(r.get("ride_id") or r.get("id"))
            if rid is None: continue
            name=str(r.get("display_name") or r.get("source_name") or r.get("name") or f"Ride {rid}")
            conn.execute("INSERT OR IGNORE INTO rides(ride_id,name) VALUES(?,?)",(rid,name))
            conn.execute("""INSERT OR REPLACE INTO ride_observations VALUES(?,?,?,?,?,?)""",
              (sid,rid,str(r.get("status") or "unknown"),intval(r.get("wait_time_minutes")),
               int(bool(r.get("measurement_valid"))),None if r.get("source_fresh") is None else int(bool(r.get("source_fresh")))))
        if s.weather:
            c=s.weather.get("current",{})
            conn.execute("""INSERT OR REPLACE INTO weather_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
              (sid,num(c.get("temperature_c")),num(c.get("apparent_temperature_c")),num(c.get("relative_humidity_percent")),
               num(c.get("precipitation_mm")),num(c.get("rain_mm")),num(c.get("showers_mm")),intval(c.get("weather_code")),
               c.get("condition"),num(c.get("cloud_cover_percent")),num(c.get("wind_speed_kmh")),num(c.get("wind_gusts_kmh"))))
            for f in s.weather.get("remaining_day_hourly",[]) if isinstance(s.weather.get("remaining_day_hourly"),list) else []:
                ft=iso(f.get("time_local"))
                if not ft: continue
                conn.execute("""INSERT OR REPLACE INTO weather_forecasts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (sid,ft.isoformat(),num(f.get("temperature_2m")),num(f.get("apparent_temperature")),
                  num(f.get("precipitation_probability")),num(f.get("precipitation")),num(f.get("rain")),
                  num(f.get("showers")),intval(f.get("weather_code")),f.get("condition"),num(f.get("cloud_cover")),
                  num(f.get("wind_speed_10m")),num(f.get("wind_gusts_10m"))))
    conn.commit()

def quality(snaps,invalid,day):
    start,end=day_bounds(day); expected=int((end-start).total_seconds()//(INTERVAL_MINUTES*60))
    inwin=[s for s in snaps if start<=s.ts<end]
    gaps=[]
    for a,b in zip(inwin,inwin[1:]):
        mins=(b.ts-a.ts).total_seconds()/60
        if mins>INTERVAL_MINUTES*1.5: gaps.append({"from":a.ts.isoformat(),"to":b.ts.isoformat(),"minutes":round(mins,1)})
    counts=[len(s.rides) for s in inwin]
    weather=sum(1 for s in inwin if s.weather)
    fresh=sum(1 for s in inwin if s.doc.get("data_quality",{}).get("payload_fresh") is True)
    completeness=min(100,len(inwin)/expected*100) if expected else 0
    weather_pct=weather/len(inwin)*100 if inwin else 0; fresh_pct=fresh/len(inwin)*100 if inwin else 0
    score=max(0,100-(100-completeness)*0.5-(100-weather_pct)*0.2-(100-fresh_pct)*0.2-len(gaps)*2-len(invalid)*3)
    return {"expected_snapshots":expected,"actual_snapshots":len(inwin),"completeness_percent":round(completeness,1),
      "invalid_files":invalid,"gaps":gaps,"weather_coverage_percent":round(weather_pct,1),
      "fresh_payload_percent":round(fresh_pct,1),"ride_count_min":min(counts) if counts else 0,
      "ride_count_max":max(counts) if counts else 0,"quality_score":round(score,1)}

def analyze_rides(snaps,categories,day):
    start,end=day_bounds(day); byride=defaultdict(list)
    for s in snaps:
        if not(start<=s.ts<end): continue
        for r in s.rides:
            rid=intval(r.get("ride_id") or r.get("id"))
            if rid is not None: byride[rid].append((s,r))
    results=[]
    for rid,items in byride.items():
        items.sort(key=lambda x:x[0].ts); meta=categories.get(str(rid),{})
        name=str(RIDE_NAME_OVERRIDES.get(rid) or meta.get("name") or items[-1][1].get("display_name") or items[-1][1].get("name") or rid)
        durations=defaultdict(float); waits=[]; weighted=0; validsec=0; events=[]; periods=[]; open_start=None
        wx=defaultdict(lambda:{"seconds":0,"weighted":0,"samples":0})
        prev=None
        for i,(s,r) in enumerate(items):
            nxt=items[i+1][0].ts if i+1<len(items) else min(end,s.ts+timedelta(minutes=INTERVAL_MINUTES))
            dur=max(0,(nxt-s.ts).total_seconds()); status=str(r.get("status") or "unknown"); wait=intval(r.get("wait_time_minutes"))
            durations[status]+=dur
            if prev is None or prev[0]!=status or prev[1]!=wait:
                events.append({"time":s.ts.isoformat(),"status":status,"wait_minutes":wait})
            if status=="open" and open_start is None: open_start=s.ts
            if status!="open" and open_start is not None: periods.append((open_start,s.ts)); open_start=None
            valid=status=="open" and r.get("measurement_valid") is True and wait is not None
            if valid:
                waits.append(wait); weighted+=wait*dur; validsec+=dur
                wc=weather_class(s.weather or {}); wx[wc]["seconds"]+=dur; wx[wc]["weighted"]+=wait*dur; wx[wc]["samples"]+=1
            prev=(status,wait)
        if open_start is not None: periods.append((open_start,end))
        weather_stats={k:{"minutes":round(v["seconds"]/60,1),"avg_wait":round(v["weighted"]/v["seconds"],1) if v["seconds"] else None,
                          "samples":v["samples"]} for k,v in wx.items()}
        results.append({"ride_id":rid,"name":name,"category":meta.get("category","uncategorized"),"indoor":bool(meta.get("indoor")),
          "water":bool(meta.get("water")),"first_observed":items[0][0].ts.isoformat(),"last_observed":items[-1][0].ts.isoformat(),
          "first_open":periods[0][0].isoformat() if periods else None,"last_close":events[-1]["time"] if events and events[-1]["status"]=="closed" else None,
          "open_minutes":round(durations["open"]/60,1),"closed_minutes":round(durations["closed"]/60,1),
          "unknown_minutes":round((durations["unknown"]+durations["invalid"])/60,1),
          "open_periods":[{"start":a.isoformat(),"end":b.isoformat(),"minutes":round((b-a).total_seconds()/60,1)} for a,b in periods],
          "min_wait":min(waits) if waits else None,"min_positive_wait":min([x for x in waits if x>0],default=None),
          "max_wait":max(waits) if waits else None,"avg_wait":round(weighted/validsec,1) if validsec else None,
          "median_wait":round(statistics.median(waits),1) if waits else None,
          "p90_wait":sorted(waits)[max(0,math.ceil(.9*len(waits))-1)] if waits else None,
          "weather":weather_stats,"events":events})
    return sorted(results,key=lambda x:x["name"].casefold())

def forecast_accuracy(snaps,day):
    actual={}
    for s in snaps:
        if not s.weather: continue
        c=s.weather.get("current",{}); hour=s.ts.replace(minute=0,second=0,microsecond=0)
        actual[hour]=(num(c.get("temperature_c")), max(num(c.get("precipitation_mm")) or 0,num(c.get("rain_mm")) or 0,num(c.get("showers_mm")) or 0))
    rows=[]
    # One forecast per target hour: earliest forecast of day, approximating morning expectation.
    chosen={}
    for s in snaps:
        if not s.weather: continue
        for f in s.weather.get("remaining_day_hourly",[]) if isinstance(s.weather.get("remaining_day_hourly"),list) else []:
            ft=iso(f.get("time_local"))
            if ft and ft not in chosen and ft in actual:
                chosen[ft]=(s.ts,f)
    for ft,(issued,f) in chosen.items():
        at,ap=actual[ft]; predt=num(f.get("temperature_2m")); predp=num(f.get("precipitation_probability")); predmm=num(f.get("precipitation"))
        rows.append({"forecast_for":ft.isoformat(),"issued_at":issued.isoformat(),"predicted_temperature_c":predt,
          "actual_temperature_c":at,"temperature_error_c":round(predt-at,1) if predt is not None and at is not None else None,
          "predicted_precipitation_probability":predp,"predicted_precipitation_mm":predmm,"actual_precipitation_mm":ap,
          "rain_occurred":ap>0})
    terr=[abs(r["temperature_error_c"]) for r in rows if r["temperature_error_c"] is not None]
    brier=[((r["predicted_precipitation_probability"]/100)-(1 if r["rain_occurred"] else 0))**2 for r in rows if r["predicted_precipitation_probability"] is not None]
    return {"hours":rows,"temperature_mae_c":round(sum(terr)/len(terr),2) if terr else None,
            "precipitation_probability_brier":round(sum(brier)/len(brier),3) if brier else None}

def park_summary(rides):
    valid=[r for r in rides if r["avg_wait"] is not None]
    total=sum(r["open_minutes"] for r in valid)
    avg=round(sum(r["avg_wait"]*r["open_minutes"] for r in valid)/total,1) if total else None
    mx=max(valid,key=lambda r:r["max_wait"] if r["max_wait"] is not None else -1,default=None)
    return {"park_avg_wait":avg,"max_wait":mx["max_wait"] if mx else None,"max_wait_ride":mx["name"] if mx else None,
            "ride_count":len(rides)}

def text_report(day,q,summary,forecast,rides):
    L=["MOVIE PARK GERMANY – TAGESANALYSE 3.0","="*78,f"Datum: {day}",
       f"Raw-Snapshots: {q['actual_snapshots']}/{q['expected_snapshots']} ({q['completeness_percent']} %)",
       f"Quality Score: {q['quality_score']}/100",f"Wetterabdeckung: {q['weather_coverage_percent']} %",
       f"Payload frisch: {q['fresh_payload_percent']} %",f"Attraktionen: {summary['ride_count']}",
       f"Park-Ø Wartezeit: {summary['park_avg_wait']} min",f"Maximum: {summary['max_wait']} min – {summary['max_wait_ride']}",
       f"Prognose Temperatur-MAE: {forecast['temperature_mae_c']} °C",
       f"Regenwahrscheinlichkeit Brier Score: {forecast['precipitation_probability_brier']}","",
       "DATENQUALITÄT","-"*78,f"Fehlende Intervalle: {len(q['gaps'])}",f"Ungültige Dateien: {len(q['invalid_files'])}",
       f"Attraktionsanzahl min/max: {q['ride_count_min']}/{q['ride_count_max']}"]
    for r in rides:
        L += ["","="*78,f"{r['name']} (ID {r['ride_id']}) – {r['category']}",
              f"Erstmals geöffnet: {r['first_open'] or '–'}",f"Betriebsdauer: {r['open_minutes']} min | geschlossen: {r['closed_minutes']} min",
              f"Wartezeit min/Ø/max: {r['min_wait']} / {r['avg_wait']} / {r['max_wait']} min",
              f"Median/P90: {r['median_wait']} / {r['p90_wait']} min",
              "Wetter: "+", ".join(f"{k}: Ø {v['avg_wait']} min ({v['minutes']} min)" for k,v in r["weather"].items())]
        L.append("Betriebsphasen: "+("; ".join(f"{p['start'][11:16]}–{p['end'][11:16]}" for p in r["open_periods"]) or "keine"))
        L.append("Ereignisse:")
        L += [f"  {e['time'][11:19]} {e['status']}"+(f", {e['wait_minutes']} min" if e['wait_minutes'] is not None else "") for e in r["events"]]
    return "\n".join(L)+"\n"

def send_ntfy(title,message):
    if not NTFY_TOPIC: return False
    body=json.dumps({"topic":NTFY_TOPIC,"title":title,"message":message,"priority":3,"tags":["bar_chart","white_check_mark"]}).encode()
    req=urllib.request.Request(NTFY_SERVER,data=body,headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=12) as r: r.read()
        return True
    except Exception as exc:
        print(f"ntfy fehlgeschlagen: {exc}",file=sys.stderr); return False

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("date",nargs="?"); ap.add_argument("--latest",action="store_true")
    ap.add_argument("--data-dir",type=Path,default=DEFAULT_DATA); ap.add_argument("--rides",type=Path,default=Path("rides.json"))
    ap.add_argument("--database",type=Path); ap.add_argument("--notify",action="store_true"); ap.add_argument("--print",action="store_true")
    a=ap.parse_args()
    if a.latest:
        days=sorted(p.name for p in (a.data_dir/"raw").iterdir() if p.is_dir())
        if not days: raise AnalysisError("Keine Raw-Tage vorhanden.")
        day=days[-1]
    else: day=a.date or date.today().isoformat()
    snaps,invalid=load_day(a.data_dir,day); cats=load_categories(a.rides)
    db=a.database or a.data_dir/"moviepark.sqlite"; db.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(db,timeout=300) as conn:
        conn.execute("PRAGMA busy_timeout=300000")
        init_db(conn); import_db(conn,snaps,cats,day)
        q=quality(snaps,invalid,day); rides=analyze_rides(snaps,cats,day); fc=forecast_accuracy(snaps,day); sm=park_summary(rides)
        result={"schema_version":3,"date":day,"quality":q,"summary":sm,"forecast_accuracy":fc,"rides":rides}
        conn.execute("""INSERT OR REPLACE INTO daily_summaries VALUES(?,?,?,?,?,?,?,?,?,?)""",
          (day,datetime.now(TZ).isoformat(),q["quality_score"],q["actual_snapshots"],q["expected_snapshots"],sm["ride_count"],
           sm["park_avg_wait"],sm["max_wait"],sm["max_wait_ride"],json.dumps(result,ensure_ascii=False))); conn.commit()
    out=a.data_dir/"analysis"/day; out.mkdir(parents=True,exist_ok=True)
    (out/f"moviepark_analysis_{day}.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    report=text_report(day,q,sm,fc,rides); (out/f"moviepark_analysis_{day}.txt").write_text(report)
    with (out/f"moviepark_rides_{day}.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=["ride_id","name","category","indoor","water","open_minutes","closed_minutes","min_wait","avg_wait","max_wait","median_wait","p90_wait"])
        w.writeheader()
        for r in rides: w.writerow({k:r.get(k) for k in w.fieldnames})
    quality_text=(f"Quality {q['quality_score']}/100 | Snapshots {q['actual_snapshots']}/{q['expected_snapshots']} "
                  f"({q['completeness_percent']} %) | Wetter {q['weather_coverage_percent']} % | Lücken {len(q['gaps'])}")
    summary_text=(f"Datum: {day}\n{quality_text}\nAttraktionen: {sm['ride_count']}\n"
                  f"Park-Ø: {sm['park_avg_wait']} min\nMaximum: {sm['max_wait']} min – {sm['max_wait_ride']}\n"
                  f"Forecast Temperatur-MAE: {fc['temperature_mae_c']} °C\nDatenbank: {db}")
    if a.notify: send_ntfy("Movie Park: Tagesanalyse & Qualität",summary_text)
    if a.print: print(report)
    print(f"Analyse erstellt: {out}\nDatenbank: {db}")
if __name__=="__main__":
    try: main()
    except AnalysisError as exc: print(f"Fehler: {exc}",file=sys.stderr); sys.exit(2)
