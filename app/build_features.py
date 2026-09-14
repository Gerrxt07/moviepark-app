#!/usr/bin/env python3
"""Feature Engineering und Baseline-Prognosen für das Movie-Park-System.

Das Skript:
1. liest die vorhandene SQLite-Datenbank,
2. erzeugt reproduzierbare Snapshot- und Tagesmerkmale,
3. speichert Trainingszeilen für spätere ML-Modelle,
4. bewertet die Datenreife,
5. erzeugt robuste Median-Baselines für einen Zieltagesverlauf,
6. schreibt JSON/CSV/Text-Berichte,
7. kann eine kompakte Zusammenfassung an ntfy senden.

Es verwendet ausschließlich die Python-Standardbibliothek.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sqlite3
import statistics
import sys
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
DEFAULT_DB = Path("data/moviepark.sqlite")
DEFAULT_OUTPUT = Path("data/features")
NTFY_SERVER = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "gerrxt-moviepark-app-channel").strip()

MIN_DAYS_EXPERIMENTAL = 3
MIN_DAYS_USABLE = 7
MIN_DAYS_RECOMMENDED = 14
TIME_BUCKET_MINUTES = 30
EXCLUDED_RIDE_IDS = {11003, 10986, 13964, 15278, 11010}


class FeatureError(RuntimeError):
    pass


@dataclass(frozen=True)
class SnapshotFeature:
    snapshot_id: str
    observed_at: str
    operating_date: str
    minute_of_day: int
    time_bucket: int
    weekday: int
    is_weekend: int
    open_ride_count: int
    valid_wait_count: int
    park_avg_wait: float | None
    park_median_wait: float | None
    park_p90_wait: float | None
    high_wait_share: float | None
    temperature_c: float | None
    apparent_temperature_c: float | None
    precipitation_mm: float | None
    cloud_cover_percent: float | None
    wind_speed_kmh: float | None
    park_load_index: float | None


def parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    return parsed.astimezone(TZ)


def percentile_nearest_rank(values: list[int], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return float(ordered[rank - 1])


def finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS snapshot_features(
            snapshot_id TEXT PRIMARY KEY,
            observed_at TEXT NOT NULL,
            operating_date TEXT NOT NULL,
            minute_of_day INTEGER NOT NULL,
            time_bucket INTEGER NOT NULL,
            weekday INTEGER NOT NULL,
            is_weekend INTEGER NOT NULL,
            open_ride_count INTEGER NOT NULL,
            valid_wait_count INTEGER NOT NULL,
            park_avg_wait REAL,
            park_median_wait REAL,
            park_p90_wait REAL,
            high_wait_share REAL,
            temperature_c REAL,
            apparent_temperature_c REAL,
            precipitation_mm REAL,
            cloud_cover_percent REAL,
            wind_speed_kmh REAL,
            park_load_index REAL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_snapshot_features_date_time
            ON snapshot_features(operating_date, minute_of_day);

        CREATE TABLE IF NOT EXISTS ride_training_rows(
            snapshot_id TEXT NOT NULL,
            operating_date TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            ride_id INTEGER NOT NULL,
            ride_name TEXT NOT NULL,
            category TEXT,
            indoor INTEGER,
            water INTEGER,
            family INTEGER,
            thrill INTEGER,
            weather_sensitive INTEGER,
            minute_of_day INTEGER NOT NULL,
            time_bucket INTEGER NOT NULL,
            weekday INTEGER NOT NULL,
            is_weekend INTEGER NOT NULL,
            temperature_c REAL,
            apparent_temperature_c REAL,
            precipitation_mm REAL,
            cloud_cover_percent REAL,
            wind_speed_kmh REAL,
            open_ride_count INTEGER NOT NULL,
            park_load_index REAL,
            status TEXT NOT NULL,
            wait_minutes INTEGER,
            measurement_valid INTEGER NOT NULL,
            PRIMARY KEY(snapshot_id, ride_id)
        );

        CREATE INDEX IF NOT EXISTS idx_training_ride_date_time
            ON ride_training_rows(ride_id, operating_date, minute_of_day);

        CREATE TABLE IF NOT EXISTS engineered_daily_features(
            operating_date TEXT PRIMARY KEY,
            weekday INTEGER NOT NULL,
            is_weekend INTEGER NOT NULL,
            snapshot_count INTEGER NOT NULL,
            first_snapshot_at TEXT,
            last_snapshot_at TEXT,
            avg_open_rides REAL,
            min_open_rides INTEGER,
            max_open_rides INTEGER,
            park_avg_wait REAL,
            park_median_wait REAL,
            park_p90_wait REAL,
            peak_wait REAL,
            peak_wait_at TEXT,
            avg_temperature_c REAL,
            min_temperature_c REAL,
            max_temperature_c REAL,
            precipitation_total_mm REAL,
            avg_cloud_cover_percent REAL,
            avg_wind_speed_kmh REAL,
            avg_load_index REAL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS baseline_predictions(
            target_date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            ride_id INTEGER NOT NULL,
            ride_name TEXT NOT NULL,
            minute_of_day INTEGER NOT NULL,
            predicted_wait_minutes REAL,
            lower_minutes REAL,
            upper_minutes REAL,
            support_days INTEGER NOT NULL,
            support_samples INTEGER NOT NULL,
            method TEXT NOT NULL,
            PRIMARY KEY(target_date, ride_id, minute_of_day)
        );

        CREATE TABLE IF NOT EXISTS model_readiness(
            checked_at TEXT PRIMARY KEY,
            distinct_days INTEGER NOT NULL,
            total_training_rows INTEGER NOT NULL,
            valid_training_rows INTEGER NOT NULL,
            rides_with_data INTEGER NOT NULL,
            status TEXT NOT NULL,
            recommendation TEXT NOT NULL,
            details_json TEXT NOT NULL
        );
        """
    )
    conn.commit()


def list_source_days(conn: sqlite3.Connection) -> list[str]:
    return [
        str(row[0])
        for row in conn.execute(
            "SELECT DISTINCT operating_date FROM snapshots ORDER BY operating_date"
        )
        if row[0]
    ]


def build_snapshot_features(
    conn: sqlite3.Connection, selected_days: set[str] | None
) -> list[SnapshotFeature]:
    where = ""
    params: tuple[Any, ...] = ()
    if selected_days:
        marks = ",".join("?" for _ in selected_days)
        where = f"WHERE s.operating_date IN ({marks})"
        params = tuple(sorted(selected_days))

    rows = conn.execute(
        f"""
        SELECT
            s.snapshot_id,
            s.observed_at,
            s.operating_date,
            w.temperature_c,
            w.apparent_temperature_c,
            w.precipitation_mm,
            w.cloud_cover_percent,
            w.wind_speed_kmh
        FROM snapshots s
        LEFT JOIN weather_observations w ON w.snapshot_id = s.snapshot_id
        {where}
        ORDER BY s.observed_at
        """,
        params,
    ).fetchall()

    result: list[SnapshotFeature] = []
    now = datetime.now(TZ).isoformat()

    for (
        snapshot_id,
        observed_at,
        operating_date,
        temperature,
        apparent_temperature,
        precipitation,
        cloud_cover,
        wind_speed,
    ) in rows:
        stamp = parse_iso(str(observed_at))
        waits = [
            int(row[0])
            for row in conn.execute(
                """
                SELECT wait_minutes
                FROM ride_observations
                WHERE snapshot_id=?
                  AND status='open'
                  AND measurement_valid=1
                  AND wait_minutes IS NOT NULL
                  AND wait_minutes BETWEEN 0 AND 240
                """,
                (snapshot_id,),
            )
        ]
        open_count = int(
            conn.execute(
                "SELECT COUNT(*) FROM ride_observations WHERE snapshot_id=? AND status='open'",
                (snapshot_id,),
            ).fetchone()[0]
        )
        avg_wait = statistics.fmean(waits) if waits else None
        median_wait = statistics.median(waits) if waits else None
        p90_wait = percentile_nearest_rank(waits, 0.90)
        high_share = (
            sum(1 for value in waits if value >= 30) / len(waits) if waits else None
        )

        # Interpretierbarer Park-Lastindex 0..100:
        # 60 % mittlere Wartezeit, 25 % P90, 15 % Anteil >=30 Minuten.
        # Die Kappungen verhindern, dass einzelne Extremwerte dominieren.
        if avg_wait is None or p90_wait is None or high_share is None:
            load_index = None
        else:
            avg_component = min(avg_wait / 40.0, 1.0)
            p90_component = min(p90_wait / 60.0, 1.0)
            load_index = 100.0 * (
                0.60 * avg_component
                + 0.25 * p90_component
                + 0.15 * min(high_share, 1.0)
            )

        minute = stamp.hour * 60 + stamp.minute
        feature = SnapshotFeature(
            snapshot_id=str(snapshot_id),
            observed_at=stamp.isoformat(),
            operating_date=str(operating_date),
            minute_of_day=minute,
            time_bucket=(minute // TIME_BUCKET_MINUTES) * TIME_BUCKET_MINUTES,
            weekday=stamp.weekday(),
            is_weekend=int(stamp.weekday() >= 5),
            open_ride_count=open_count,
            valid_wait_count=len(waits),
            park_avg_wait=round(avg_wait, 3) if avg_wait is not None else None,
            park_median_wait=round(float(median_wait), 3)
            if median_wait is not None
            else None,
            park_p90_wait=round(float(p90_wait), 3) if p90_wait is not None else None,
            high_wait_share=round(high_share, 5) if high_share is not None else None,
            temperature_c=finite(temperature),
            apparent_temperature_c=finite(apparent_temperature),
            precipitation_mm=finite(precipitation),
            cloud_cover_percent=finite(cloud_cover),
            wind_speed_kmh=finite(wind_speed),
            park_load_index=round(load_index, 3) if load_index is not None else None,
        )
        result.append(feature)

        conn.execute(
            """
            INSERT INTO snapshot_features(
                snapshot_id, observed_at, operating_date, minute_of_day, time_bucket,
                weekday, is_weekend, open_ride_count, valid_wait_count,
                park_avg_wait, park_median_wait, park_p90_wait, high_wait_share,
                temperature_c, apparent_temperature_c, precipitation_mm,
                cloud_cover_percent, wind_speed_kmh, park_load_index, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(snapshot_id) DO UPDATE SET
                observed_at=excluded.observed_at,
                operating_date=excluded.operating_date,
                minute_of_day=excluded.minute_of_day,
                time_bucket=excluded.time_bucket,
                weekday=excluded.weekday,
                is_weekend=excluded.is_weekend,
                open_ride_count=excluded.open_ride_count,
                valid_wait_count=excluded.valid_wait_count,
                park_avg_wait=excluded.park_avg_wait,
                park_median_wait=excluded.park_median_wait,
                park_p90_wait=excluded.park_p90_wait,
                high_wait_share=excluded.high_wait_share,
                temperature_c=excluded.temperature_c,
                apparent_temperature_c=excluded.apparent_temperature_c,
                precipitation_mm=excluded.precipitation_mm,
                cloud_cover_percent=excluded.cloud_cover_percent,
                wind_speed_kmh=excluded.wind_speed_kmh,
                park_load_index=excluded.park_load_index,
                created_at=excluded.created_at
            """,
            (
                feature.snapshot_id,
                feature.observed_at,
                feature.operating_date,
                feature.minute_of_day,
                feature.time_bucket,
                feature.weekday,
                feature.is_weekend,
                feature.open_ride_count,
                feature.valid_wait_count,
                feature.park_avg_wait,
                feature.park_median_wait,
                feature.park_p90_wait,
                feature.high_wait_share,
                feature.temperature_c,
                feature.apparent_temperature_c,
                feature.precipitation_mm,
                feature.cloud_cover_percent,
                feature.wind_speed_kmh,
                feature.park_load_index,
                now,
            ),
        )

    conn.commit()
    return result


def build_training_rows(
    conn: sqlite3.Connection, selected_days: set[str] | None
) -> int:
    where = ""
    params: tuple[Any, ...] = ()
    if selected_days:
        marks = ",".join("?" for _ in selected_days)
        where = f"WHERE sf.operating_date IN ({marks})"
        params = tuple(sorted(selected_days))

    rows = conn.execute(
        f"""
        SELECT
            sf.snapshot_id,
            sf.operating_date,
            sf.observed_at,
            ro.ride_id,
            COALESCE(r.name, 'Ride ' || ro.ride_id),
            r.category,
            COALESCE(r.indoor,0),
            COALESCE(r.water,0),
            COALESCE(r.family,0),
            COALESCE(r.thrill,0),
            COALESCE(r.weather_sensitive,0),
            sf.minute_of_day,
            sf.time_bucket,
            sf.weekday,
            sf.is_weekend,
            sf.temperature_c,
            sf.apparent_temperature_c,
            sf.precipitation_mm,
            sf.cloud_cover_percent,
            sf.wind_speed_kmh,
            sf.open_ride_count,
            sf.park_load_index,
            ro.status,
            ro.wait_minutes,
            COALESCE(ro.measurement_valid,0)
        FROM snapshot_features sf
        JOIN ride_observations ro ON ro.snapshot_id=sf.snapshot_id
        LEFT JOIN rides r ON r.ride_id=ro.ride_id
        {where}{" AND" if where else " WHERE"} ro.ride_id NOT IN ({','.join('?' for _ in EXCLUDED_RIDE_IDS)})
        """,
        params + tuple(sorted(EXCLUDED_RIDE_IDS)),
    ).fetchall()

    conn.executemany(
        """
        INSERT INTO ride_training_rows VALUES(
            ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )
        ON CONFLICT(snapshot_id,ride_id) DO UPDATE SET
            operating_date=excluded.operating_date,
            observed_at=excluded.observed_at,
            ride_name=excluded.ride_name,
            category=excluded.category,
            indoor=excluded.indoor,
            water=excluded.water,
            family=excluded.family,
            thrill=excluded.thrill,
            weather_sensitive=excluded.weather_sensitive,
            minute_of_day=excluded.minute_of_day,
            time_bucket=excluded.time_bucket,
            weekday=excluded.weekday,
            is_weekend=excluded.is_weekend,
            temperature_c=excluded.temperature_c,
            apparent_temperature_c=excluded.apparent_temperature_c,
            precipitation_mm=excluded.precipitation_mm,
            cloud_cover_percent=excluded.cloud_cover_percent,
            wind_speed_kmh=excluded.wind_speed_kmh,
            open_ride_count=excluded.open_ride_count,
            park_load_index=excluded.park_load_index,
            status=excluded.status,
            wait_minutes=excluded.wait_minutes,
            measurement_valid=excluded.measurement_valid
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def aggregate_daily(conn: sqlite3.Connection, selected_days: set[str] | None) -> None:
    days = (
        sorted(selected_days)
        if selected_days
        else [
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT operating_date FROM snapshot_features ORDER BY operating_date"
            )
        ]
    )
    now = datetime.now(TZ).isoformat()

    for day in days:
        rows = conn.execute(
            """
            SELECT observed_at, weekday, is_weekend, open_ride_count,
                   park_avg_wait, park_median_wait, park_p90_wait,
                   temperature_c, precipitation_mm, cloud_cover_percent,
                   wind_speed_kmh, park_load_index
            FROM snapshot_features
            WHERE operating_date=?
            ORDER BY observed_at
            """,
            (day,),
        ).fetchall()
        if not rows:
            continue

        def values(index: int) -> list[float]:
            return [float(row[index]) for row in rows if row[index] is not None]

        open_counts = [int(row[3]) for row in rows]
        avg_waits = values(4)
        median_waits = values(5)
        p90_waits = values(6)
        temps = values(7)
        precipitation = values(8)
        clouds = values(9)
        winds = values(10)
        load_indexes = values(11)

        peak_row = max(
            (row for row in rows if row[4] is not None),
            key=lambda row: float(row[4]),
            default=None,
        )

        conn.execute(
            """
            INSERT INTO engineered_daily_features VALUES(
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )
            ON CONFLICT(operating_date) DO UPDATE SET
                weekday=excluded.weekday,
                is_weekend=excluded.is_weekend,
                snapshot_count=excluded.snapshot_count,
                first_snapshot_at=excluded.first_snapshot_at,
                last_snapshot_at=excluded.last_snapshot_at,
                avg_open_rides=excluded.avg_open_rides,
                min_open_rides=excluded.min_open_rides,
                max_open_rides=excluded.max_open_rides,
                park_avg_wait=excluded.park_avg_wait,
                park_median_wait=excluded.park_median_wait,
                park_p90_wait=excluded.park_p90_wait,
                peak_wait=excluded.peak_wait,
                peak_wait_at=excluded.peak_wait_at,
                avg_temperature_c=excluded.avg_temperature_c,
                min_temperature_c=excluded.min_temperature_c,
                max_temperature_c=excluded.max_temperature_c,
                precipitation_total_mm=excluded.precipitation_total_mm,
                avg_cloud_cover_percent=excluded.avg_cloud_cover_percent,
                avg_wind_speed_kmh=excluded.avg_wind_speed_kmh,
                avg_load_index=excluded.avg_load_index,
                created_at=excluded.created_at
            """,
            (
                day,
                int(rows[0][1]),
                int(rows[0][2]),
                len(rows),
                rows[0][0],
                rows[-1][0],
                statistics.fmean(open_counts) if open_counts else None,
                min(open_counts) if open_counts else None,
                max(open_counts) if open_counts else None,
                statistics.fmean(avg_waits) if avg_waits else None,
                statistics.fmean(median_waits) if median_waits else None,
                statistics.fmean(p90_waits) if p90_waits else None,
                float(peak_row[4]) if peak_row else None,
                str(peak_row[0]) if peak_row else None,
                statistics.fmean(temps) if temps else None,
                min(temps) if temps else None,
                max(temps) if temps else None,
                sum(precipitation) if precipitation else None,
                statistics.fmean(clouds) if clouds else None,
                statistics.fmean(winds) if winds else None,
                statistics.fmean(load_indexes) if load_indexes else None,
                now,
            ),
        )
    conn.commit()


def readiness(conn: sqlite3.Connection) -> dict[str, Any]:
    distinct_days = int(
        conn.execute(
            "SELECT COUNT(DISTINCT operating_date) FROM ride_training_rows"
        ).fetchone()[0]
    )
    total_rows = int(conn.execute("SELECT COUNT(*) FROM ride_training_rows").fetchone()[0])
    valid_rows = int(
        conn.execute(
            """
            SELECT COUNT(*) FROM ride_training_rows
            WHERE status='open' AND measurement_valid=1 AND wait_minutes IS NOT NULL
            """
        ).fetchone()[0]
    )
    rides_with_data = int(
        conn.execute(
            """
            SELECT COUNT(DISTINCT ride_id) FROM ride_training_rows
            WHERE status='open' AND measurement_valid=1 AND wait_minutes IS NOT NULL
            """
        ).fetchone()[0]
    )

    if distinct_days < MIN_DAYS_EXPERIMENTAL:
        status = "collecting"
        recommendation = (
            f"Noch keine Prognose bewerten. Mindestens {MIN_DAYS_EXPERIMENTAL} Tage "
            "für eine erste experimentelle Baseline sammeln."
        )
    elif distinct_days < MIN_DAYS_USABLE:
        status = "experimental"
        recommendation = (
            f"Baseline nur intern anzeigen. Für erste brauchbare Vergleiche mindestens "
            f"{MIN_DAYS_USABLE} Tage sammeln."
        )
    elif distinct_days < MIN_DAYS_RECOMMENDED:
        status = "usable_baseline"
        recommendation = (
            f"Median-Baseline nutzbar; ein echtes Modell erst ab ungefähr "
            f"{MIN_DAYS_RECOMMENDED} vollständigen Tagen trainieren."
        )
    else:
        status = "ready_for_model_v1"
        recommendation = (
            "Genügend Tage für zeitbasierte Validierung eines ersten Modells vorhanden."
        )

    result = {
        "distinct_days": distinct_days,
        "total_training_rows": total_rows,
        "valid_training_rows": valid_rows,
        "rides_with_valid_data": rides_with_data,
        "status": status,
        "recommendation": recommendation,
        "thresholds": {
            "experimental_days": MIN_DAYS_EXPERIMENTAL,
            "usable_baseline_days": MIN_DAYS_USABLE,
            "recommended_model_days": MIN_DAYS_RECOMMENDED,
        },
    }
    checked_at = datetime.now(TZ).isoformat()
    conn.execute(
        """
        INSERT INTO model_readiness VALUES(?,?,?,?,?,?,?,?)
        """,
        (
            checked_at,
            distinct_days,
            total_rows,
            valid_rows,
            rides_with_data,
            status,
            recommendation,
            json.dumps(result, ensure_ascii=False),
        ),
    )
    conn.commit()
    return result


def build_baseline_predictions(
    conn: sqlite3.Connection, target_date: str
) -> list[dict[str, Any]]:
    target = date.fromisoformat(target_date)
    target_weekday = target.weekday()
    target_weekend = int(target_weekday >= 5)
    created_at = datetime.now(TZ).isoformat()

    rides = conn.execute(
        """
        SELECT DISTINCT ride_id, ride_name
        FROM ride_training_rows
        WHERE status='open' AND measurement_valid=1 AND wait_minutes IS NOT NULL
        ORDER BY ride_name
        """
    ).fetchall()

    predictions: list[dict[str, Any]] = []
    conn.execute("DELETE FROM baseline_predictions WHERE target_date=?", (target_date,))

    for ride_id, ride_name in rides:
        for minute in range(570, 1110, TIME_BUCKET_MINUTES):  # 09:30 bis 18:00
            # Stufe 1: gleicher Wochentag und Zeitfenster.
            samples = conn.execute(
                """
                SELECT operating_date, wait_minutes
                FROM ride_training_rows
                WHERE ride_id=?
                  AND time_bucket=?
                  AND weekday=?
                  AND status='open'
                  AND measurement_valid=1
                  AND wait_minutes IS NOT NULL
                  AND operating_date<?
                """,
                (ride_id, minute, target_weekday, target_date),
            ).fetchall()
            method = "same_weekday_time_bucket"

            # Stufe 2: Wochenende/Werktag und Zeitfenster.
            if len({row[0] for row in samples}) < 2:
                samples = conn.execute(
                    """
                    SELECT operating_date, wait_minutes
                    FROM ride_training_rows
                    WHERE ride_id=?
                      AND time_bucket=?
                      AND is_weekend=?
                      AND status='open'
                      AND measurement_valid=1
                      AND wait_minutes IS NOT NULL
                      AND operating_date<?
                    """,
                    (ride_id, minute, target_weekend, target_date),
                ).fetchall()
                method = "day_type_time_bucket"

            # Stufe 3: beliebiger Tag, gleiches Zeitfenster.
            if len({row[0] for row in samples}) < 2:
                samples = conn.execute(
                    """
                    SELECT operating_date, wait_minutes
                    FROM ride_training_rows
                    WHERE ride_id=?
                      AND time_bucket=?
                      AND status='open'
                      AND measurement_valid=1
                      AND wait_minutes IS NOT NULL
                      AND operating_date<?
                    """,
                    (ride_id, minute, target_date),
                ).fetchall()
                method = "all_days_time_bucket"

            if not samples:
                continue

            waits = [int(row[1]) for row in samples]
            support_days = len({str(row[0]) for row in samples})
            predicted = float(statistics.median(waits))
            lower = float(percentile_nearest_rank(waits, 0.25) or predicted)
            upper = float(percentile_nearest_rank(waits, 0.75) or predicted)

            item = {
                "target_date": target_date,
                "ride_id": int(ride_id),
                "ride_name": str(ride_name),
                "minute_of_day": minute,
                "time": f"{minute // 60:02d}:{minute % 60:02d}",
                "predicted_wait_minutes": round(predicted, 1),
                "lower_minutes": round(lower, 1),
                "upper_minutes": round(upper, 1),
                "support_days": support_days,
                "support_samples": len(waits),
                "method": method,
            }
            predictions.append(item)
            conn.execute(
                """
                INSERT INTO baseline_predictions VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    target_date,
                    created_at,
                    int(ride_id),
                    str(ride_name),
                    minute,
                    predicted,
                    lower,
                    upper,
                    support_days,
                    len(waits),
                    method,
                ),
            )

    conn.commit()
    return predictions


def write_outputs(
    output_dir: Path,
    readiness_result: dict[str, Any],
    predictions: list[dict[str, Any]],
    target_date: str,
    conn: sqlite3.Connection,
) -> tuple[Path, Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    daily_rows = [
        dict(row)
        for row in conn.execute(
            "SELECT * FROM engineered_daily_features ORDER BY operating_date"
        )
    ]

    document = {
        "generated_at": datetime.now(TZ).isoformat(),
        "target_date": target_date,
        "readiness": readiness_result,
        "daily_features": daily_rows,
        "baseline_predictions": predictions,
    }

    json_path = output_dir / f"feature_report_{target_date}.json"
    csv_path = output_dir / f"baseline_predictions_{target_date}.csv"
    text_path = output_dir / f"feature_report_{target_date}.txt"

    json_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    fieldnames = [
        "target_date",
        "ride_id",
        "ride_name",
        "time",
        "minute_of_day",
        "predicted_wait_minutes",
        "lower_minutes",
        "upper_minutes",
        "support_days",
        "support_samples",
        "method",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(predictions)

    lines = [
        "MOVIE PARK – FEATURE ENGINEERING / BASELINE",
        "=" * 72,
        f"Erstellt: {document['generated_at']}",
        f"Prognose-Zieldatum: {target_date}",
        f"Historische Tage: {readiness_result['distinct_days']}",
        f"Trainingszeilen: {readiness_result['total_training_rows']}",
        f"Gültige Wartezeitzeilen: {readiness_result['valid_training_rows']}",
        f"Attraktionen mit Daten: {readiness_result['rides_with_valid_data']}",
        f"Status: {readiness_result['status']}",
        f"Empfehlung: {readiness_result['recommendation']}",
        "",
        "WICHTIG",
        "-" * 72,
        "Die Baseline ist kein trainiertes ML-Modell. Sie nutzt historische Mediane",
        "je Attraktion und 30-Minuten-Zeitfenster mit transparenten Fallbacks.",
        "Bei wenigen Tagen ist sie nur eine technische Funktionsprüfung.",
        "",
        f"Erzeugte Prognosepunkte: {len(predictions)}",
    ]

    if predictions:
        strongest = sorted(
            predictions,
            key=lambda item: (
                item["support_days"],
                item["support_samples"],
            ),
            reverse=True,
        )[:10]
        lines.extend(["", "BEISPIELE MIT HÖCHSTER DATENSTÜTZE", "-" * 72])
        for item in strongest:
            lines.append(
                f"{item['time']} {item['ride_name']}: "
                f"{item['predicted_wait_minutes']:.0f} min "
                f"({item['lower_minutes']:.0f}–{item['upper_minutes']:.0f}), "
                f"{item['support_days']} Tage/{item['support_samples']} Messungen"
            )

    text_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, csv_path, text_path


def send_ntfy(title: str, message: str) -> bool:
    if not NTFY_TOPIC:
        return False
    payload = json.dumps(
        {
            "topic": NTFY_TOPIC,
            "title": title,
            "message": message,
            "priority": 3,
            "tags": ["bar_chart", "brain"],
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        NTFY_SERVER,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
        return True
    except Exception as exc:
        print(f"ntfy fehlgeschlagen: {exc}", file=sys.stderr)
        return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--target-date",
        help="Zieldatum der Baseline, Standard: morgen in Europe/Berlin",
    )
    parser.add_argument(
        "--day",
        action="append",
        dest="days",
        help="Nur diesen Quelltag aktualisieren; mehrfach verwendbar.",
    )
    parser.add_argument("--notify", action="store_true")
    parser.add_argument("--print", action="store_true", dest="print_report")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = args.database.resolve()
    if not db_path.is_file():
        raise FeatureError(f"Datenbank fehlt: {db_path}")

    target_date = args.target_date or (datetime.now(TZ).date() + timedelta(days=1)).isoformat()
    date.fromisoformat(target_date)
    selected_days = set(args.days) if args.days else None

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        init_schema(conn)
        source_days = list_source_days(conn)
        if not source_days:
            raise FeatureError("Die Datenbank enthält keine Snapshot-Tage.")

        features = build_snapshot_features(conn, selected_days)
        training_count = build_training_rows(conn, selected_days)
        aggregate_daily(conn, selected_days)
        readiness_result = readiness(conn)
        predictions = build_baseline_predictions(conn, target_date)
        paths = write_outputs(
            args.output_dir.resolve(),
            readiness_result,
            predictions,
            target_date,
            conn,
        )
    finally:
        conn.close()

    summary = (
        f"Feature Engineering abgeschlossen\n"
        f"Tage: {readiness_result['distinct_days']}\n"
        f"Gültige Trainingszeilen: {readiness_result['valid_training_rows']}\n"
        f"Status: {readiness_result['status']}\n"
        f"Baseline-Punkte für {target_date}: {len(predictions)}\n"
        f"{readiness_result['recommendation']}"
    )

    if args.notify:
        send_ntfy("Movie Park: Modell-Datenstatus", summary)

    if args.print_report:
        print(paths[2].read_text(encoding="utf-8"))
    else:
        print(summary)
        print(f"JSON: {paths[0]}")
        print(f"CSV: {paths[1]}")
        print(f"Text: {paths[2]}")
        print(f"Aktualisierte Snapshot-Features: {len(features)}")
        print(f"Aktualisierte Trainingszeilen: {training_count}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FeatureError, sqlite3.Error, OSError, ValueError) as exc:
        print(f"FEHLER: {exc}", file=sys.stderr)
        raise SystemExit(1)
