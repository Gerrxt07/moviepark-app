# Movie Park Germany
# Park-Prognosen-System von Gerrxt

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import signal
import shutil
import sqlite3
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Literal
from zoneinfo import ZoneInfo

import aiohttp


# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

PARK_ID = 310
URL = f"https://queue-times.com/parks/{PARK_ID}/queue_times.json"

LOCAL_TIMEZONE = ZoneInfo("Europe/Berlin")

# Queue-Times aktualisiert die Daten typischerweise ungefähr alle fünf Minuten.
INTERVAL_SECONDS = 5 * 60

# Ein einzelner Attraktionsdatensatz gilt bis zu diesem Alter als aktuell.
MAX_RIDE_DATA_AGE_SECONDS = 15 * 60

# Mindestens dieser Anteil der Attraktionen mit Zeitstempel muss aktuell sein,
# damit der gesamte Payload als ausreichend frisch eingestuft wird.
MIN_FRESH_RIDE_RATIO = 0.75

# Plausibilitätsgrenze. Höhere Werte werden gespeichert, aber als ungültig markiert.
MAX_REASONABLE_WAIT_TIME_MINUTES = 240

# Mindestanzahl geöffneter Attraktionen, um den Park heuristisch als geöffnet
# einzustufen.
MIN_OPEN_RIDES_FOR_OPEN_STATE = 3

# Sicherheitsfenster, falls für den Tag noch kein offizieller Kalendereintrag
# vorliegt. Normalerweise wird park_calendar mit je 30 Minuten Vor-/Nachlauf genutzt.
COLLECTION_START = datetime_time(hour=9, minute=30)
COLLECTION_END = datetime_time(hour=18, minute=30)
COLLECTION_PADDING_MINUTES = 30

DATA_DIR = Path("data")
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
STATE_DIR = DATA_DIR / "state"
LAST_SEMANTIC_HASH_FILE = STATE_DIR / "last_semantic_hash.txt"
LAST_SUCCESS_FILE = STATE_DIR / "last_success.json"
NOTIFICATION_STATE_FILE = STATE_DIR / "notification_state.json"
DATABASE_FILE = DATA_DIR / "moviepark.sqlite"
ANALYZER_SCRIPT = Path(__file__).with_name("analyze_day.py")
FEATURE_SCRIPT = Path(__file__).with_name("build_features.py")
MODEL_SCRIPT = Path(__file__).with_name("model_trainer.py")
MODEL_DIR = DATA_DIR / "models"
RIDES_FILE = Path(__file__).with_name("rides.json")

# ntfy-Konfiguration. Der Topic kann sicherer über die systemd-Umgebungsvariable
# NTFY_TOPIC gesetzt werden; ohne Variable wird der getestete Topic verwendet.
NTFY_SERVER = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.getenv(
    "NTFY_TOPIC",
    "gerrxt-moviepark-app-channel",
).strip()
NTFY_ENABLED = bool(NTFY_TOPIC)

# Erst nach dieser Zahl vollständig fehlgeschlagener Collector-Durchläufe wird
# alarmiert. Ein Durchlauf enthält bereits alle HTTP-Retries.
NOTIFY_AFTER_CONSECUTIVE_FAILURES = 1

# Wiederholte identische Warnungen werden höchstens in diesem Abstand gesendet.
NOTIFICATION_REPEAT_SECONDS = 60 * 60

# Zusätzliche Warnschwelle für sehr alte Queue-Times-Daten.
STALE_DATA_ALERT_SECONDS = 20 * 60

# Wetter am Movie Park Germany (Warner-Allee, Bottrop-Kirchhellen/Feldhausen).
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_LATITUDE = 51.6207
WEATHER_LONGITUDE = 6.9720
WEATHER_LOCATION_NAME = "Movie Park Germany / Feldhausen"
WEATHER_FORECAST_END_HOUR = 19
WEATHER_TIMEOUT = aiohttp.ClientTimeout(total=12, connect=5, sock_read=8)

# Wartungswarnungen.
MIN_EXPECTED_RIDE_COUNT = 25
NO_SEMANTIC_CHANGE_ALERT_SECONDS = 2 * 60 * 60
DISK_WARNING_PERCENT = 85.0
DISK_CRITICAL_PERCENT = 95.0

# IDs von Attraktionen, die nur aus den verarbeiteten Daten entfernt werden.
# Die Rohdaten enthalten weiterhin alle Attraktionen.
EXCLUDED_RIDE_IDS = {
    11003,
    15278,
    13964,
    10986,
    11010,  # TMNT: License to Drive – retired; raw source data is preserved
}

RIDE_NAME_OVERRIDES = {
    10984: "Star Trek: Operation Enterprise",
}

TIMEOUT = aiohttp.ClientTimeout(
    total=15,
    connect=5,
    sock_connect=5,
    sock_read=10,
)

HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Gerrxt-Movie-Park-Monitor/3.0",
}

RETRY_DELAYS_SECONDS = (2, 5, 15)

ParkState = Literal[
    "pre_opening",
    "open",
    "closing",
    "closed",
    "unknown",
]

RideStatus = Literal[
    "open",
    "closed",
    "unknown",
    "invalid",
]


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Eigene Fehler und Datenklassen
# ---------------------------------------------------------------------------


class InvalidPayloadError(ValueError):
    """Wird ausgelöst, wenn die API-Antwort strukturell unbrauchbar ist."""



@dataclass(slots=True, frozen=True)
class FetchResult:
    payload: dict[str, Any]
    status_code: int
    duration_ms: int
    fetched_at_utc: datetime



@dataclass(slots=True, frozen=True)
class SourceTimestampStats:
    newest_update_utc: datetime | None
    oldest_update_utc: datetime | None
    median_update_utc: datetime | None
    newest_age_seconds: int | None
    oldest_age_seconds: int | None
    median_age_seconds: int | None
    timestamped_ride_count: int
    fresh_ride_count: int
    stale_ride_count: int
    missing_timestamp_count: int
    invalid_timestamp_count: int
    fresh_ride_ratio: float | None
    payload_fresh: bool


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


class Scheduler:
    def __init__(self) -> None:
        self._stop_event = asyncio.Event()

    @property
    def is_stopped(self) -> bool:
        return self._stop_event.is_set()

    def stop(self) -> None:
        self._stop_event.set()

    async def wait(self) -> None:
        await self._stop_event.wait()

    async def wait_or_timeout(self, timeout: float) -> bool:
        try:
            await asyncio.wait_for(self.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False


# ---------------------------------------------------------------------------
# Zeitfunktionen
# ---------------------------------------------------------------------------


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_local_time(timestamp: datetime) -> datetime:
    return timestamp.astimezone(LOCAL_TIMEZONE)


@dataclass(slots=True, frozen=True)
class CollectionWindow:
    start: datetime_time
    end: datetime_time
    is_open: bool
    source: str
    event_name: str | None = None


def minute_to_time(minute: int) -> datetime_time:
    normalized = minute % (24 * 60)
    return datetime_time(hour=normalized // 60, minute=normalized % 60)


def collection_window_for(timestamp_utc: datetime) -> CollectionWindow:
    """Liest das tagesaktuelle Sammelfenster aus dem offiziellen Parkkalender."""
    operating_date = to_local_time(timestamp_utc).date().isoformat()
    try:
        database_uri = f"file:{DATABASE_FILE.resolve()}?mode=ro"
        with sqlite3.connect(database_uri, uri=True, timeout=5) as connection:
            row = connection.execute(
                """SELECT is_open, opens_minute, closes_minute, event_name
                   FROM park_calendar WHERE operating_date=?""",
                (operating_date,),
            ).fetchone()
    except sqlite3.Error as exc:
        logger.warning("Parkkalender nicht lesbar; Sicherheitsfenster wird genutzt: %s", exc)
        row = None

    if row and not bool(row[0]):
        return CollectionWindow(COLLECTION_START, COLLECTION_END, False, "park_calendar", row[3])
    if row and row[1] is not None and row[2] is not None:
        start = minute_to_time(int(row[1]) - COLLECTION_PADDING_MINUTES)
        end = minute_to_time(int(row[2]) + COLLECTION_PADDING_MINUTES)
        return CollectionWindow(start, end, True, "park_calendar", row[3])
    return CollectionWindow(COLLECTION_START, COLLECTION_END, True, "fallback")


def is_time_in_window(local_time: datetime_time, start: datetime_time, end: datetime_time) -> bool:
    if start <= end:
        return start <= local_time < end
    return local_time >= start or local_time < end


def is_collection_window(timestamp_utc: datetime) -> bool:
    """Prüft das dynamische, tagesaktuelle Sammelfenster in lokaler Parkzeit."""
    window = collection_window_for(timestamp_utc)
    if not window.is_open:
        return False
    local_time = to_local_time(timestamp_utc).time().replace(tzinfo=None)
    return is_time_in_window(local_time, window.start, window.end)


def seconds_until_next_interval(now_monotonic: float, next_run: float) -> float:
    return max(0.0, next_run - now_monotonic)


# ---------------------------------------------------------------------------
# ntfy-Benachrichtigungen und persistenter Alarmzustand
# ---------------------------------------------------------------------------


def default_notification_state() -> dict[str, Any]:
    return {
        "api_failure_active": False,
        "consecutive_failures": 0,
        "first_failure_at_utc": None,
        "last_failure_notification_at_utc": None,
        "stale_data_active": False,
        "last_stale_notification_at_utc": None,
        "operating_date": None,
        "day_started": False,
        "day_finished": False,
        "raw_snapshot_count": 0,
        "processed_change_count": 0,
        "failure_count": 0,
        "error_count": 0,
        "ride_count": 0,
        "first_success_at_local": None,
        "last_success_at_local": None,
        "weather_failure_active": False,
        "last_weather_failure_notification_at_utc": None,
        "low_ride_count_active": False,
        "last_semantic_change_at_local": None,
        "no_change_alert_active": False,
        "disk_warning_active": False,
        "daily_analysis_done": False,
        "daily_analysis_error": None,
        "post_close_features_done": False,
        "post_close_model_done": False,
        "post_close_pipeline_error": None,
    }


def load_notification_state() -> dict[str, Any]:
    state = default_notification_state()

    try:
        loaded = json.loads(
            NOTIFICATION_STATE_FILE.read_text(encoding="utf-8")
        )
    except FileNotFoundError:
        return state
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning(
            "Benachrichtigungszustand konnte nicht gelesen werden: %s",
            exc,
        )
        return state

    if isinstance(loaded, dict):
        for key in state:
            if key in loaded:
                state[key] = loaded[key]

    return state


def save_notification_state(state: dict[str, Any]) -> None:
    write_json_atomic(NOTIFICATION_STATE_FILE, state)


def parse_optional_iso_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def notification_repeat_due(
    previous_value: Any,
    now_utc: datetime,
) -> bool:
    previous = parse_optional_iso_timestamp(previous_value)
    if previous is None:
        return True

    return (
        now_utc - previous
    ).total_seconds() >= NOTIFICATION_REPEAT_SECONDS


async def send_ntfy(
    session: aiohttp.ClientSession,
    title: str,
    message: str,
    *,
    priority: int = 3,
    tags: tuple[str, ...] = (),
) -> bool:
    """Sendet eine ntfy-Nachricht, ohne den Collector bei Fehlern zu stoppen."""
    if not NTFY_ENABLED:
        logger.debug("ntfy ist deaktiviert, da kein Topic konfiguriert ist.")
        return False

    payload: dict[str, Any] = {
        "topic": NTFY_TOPIC,
        "title": title,
        "message": message,
        "priority": priority,
    }

    if tags:
        payload["tags"] = list(tags)

    try:
        async with session.post(
            NTFY_SERVER,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as response:
            response.raise_for_status()
            await response.read()

        logger.info("ntfy-Benachrichtigung gesendet: %s", title)
        return True

    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.error(
            "ntfy-Benachrichtigung konnte nicht gesendet werden: %s",
            exc,
        )
        return False


async def register_collector_failure(
    session: aiohttp.ClientSession,
    error_message: str,
) -> None:
    now_utc = utc_now()
    state = load_notification_state()

    consecutive_failures = int(state.get("consecutive_failures") or 0) + 1
    state["consecutive_failures"] = consecutive_failures
    state["failure_count"] = int(state.get("failure_count") or 0) + 1
    state["error_count"] = int(state.get("error_count") or 0) + 1

    if not state.get("first_failure_at_utc"):
        state["first_failure_at_utc"] = now_utc.isoformat()

    should_notify = (
        consecutive_failures >= NOTIFY_AFTER_CONSECUTIVE_FAILURES
        and (
            not bool(state.get("api_failure_active"))
            or notification_repeat_due(
                state.get("last_failure_notification_at_utc"),
                now_utc,
            )
        )
    )

    if should_notify:
        sent = await send_ntfy(
            session,
            "Movie Park Collector: Fehler",
            (
                "Der Queue-Times-Abruf ist vollständig fehlgeschlagen.\n"
                f"Fehlgeschlagene Durchläufe in Folge: {consecutive_failures}\n"
                f"Fehler: {error_message}"
            ),
            priority=5,
            tags=("rotating_light", "warning"),
        )
        if sent:
            state["api_failure_active"] = True
            state["last_failure_notification_at_utc"] = now_utc.isoformat()

    save_notification_state(state)


async def register_collector_success(
    session: aiohttp.ClientSession,
) -> None:
    now_utc = utc_now()
    state = load_notification_state()
    failure_was_active = bool(state.get("api_failure_active"))
    previous_failure_count = int(state.get("consecutive_failures") or 0)
    first_failure = parse_optional_iso_timestamp(
        state.get("first_failure_at_utc")
    )

    if failure_was_active:
        if first_failure is not None:
            outage_minutes = max(
                1,
                round((now_utc - first_failure).total_seconds() / 60),
            )
            duration_text = f"Ungefähre Ausfalldauer: {outage_minutes} Minuten."
        else:
            duration_text = "Die ungefähre Ausfalldauer ist unbekannt."

        await send_ntfy(
            session,
            "Movie Park Collector: wieder online",
            (
                "Der Queue-Times-Abruf funktioniert wieder.\n"
                f"Vorherige Fehlversuche: {previous_failure_count}\n"
                f"{duration_text}"
            ),
            priority=4,
            tags=("white_check_mark",),
        )

    state["api_failure_active"] = False
    state["consecutive_failures"] = 0
    state["first_failure_at_utc"] = None
    state["last_failure_notification_at_utc"] = None
    save_notification_state(state)


async def update_stale_data_alert(
    session: aiohttp.ClientSession,
    timestamp_stats: SourceTimestampStats,
) -> None:
    now_utc = utc_now()
    state = load_notification_state()
    newest_age = timestamp_stats.newest_age_seconds
    data_is_stale = (
        newest_age is None
        or newest_age > STALE_DATA_ALERT_SECONDS
        or not timestamp_stats.payload_fresh
    )

    if data_is_stale:
        should_notify = (
            not bool(state.get("stale_data_active"))
            or notification_repeat_due(
                state.get("last_stale_notification_at_utc"),
                now_utc,
            )
        )

        if should_notify:
            if newest_age is None:
                age_text = "Kein gültiger Aktualisierungszeitpunkt vorhanden."
            else:
                age_text = (
                    "Neuester Attraktions-Zeitstempel ist ungefähr "
                    f"{round(newest_age / 60)} Minuten alt."
                )

            sent = await send_ntfy(
                session,
                "Movie Park Collector: veraltete Daten",
                (
                    "Die API ist erreichbar, liefert aber nicht ausreichend "
                    "aktuelle Attraktionsdaten.\n"
                    f"{age_text}\n"
                    f"Fresh-Ratio: {timestamp_stats.fresh_ride_ratio}"
                ),
                priority=4,
                tags=("warning", "hourglass"),
            )
            if sent:
                state["stale_data_active"] = True
                state["last_stale_notification_at_utc"] = now_utc.isoformat()

    elif bool(state.get("stale_data_active")):
        await send_ntfy(
            session,
            "Movie Park Collector: Daten wieder aktuell",
            (
                "Die Queue-Times-Daten sind wieder ausreichend aktuell.\n"
                f"Fresh-Ratio: {timestamp_stats.fresh_ride_ratio}"
            ),
            priority=3,
            tags=("white_check_mark",),
        )
        state["stale_data_active"] = False
        state["last_stale_notification_at_utc"] = None

    save_notification_state(state)


def reset_daily_notification_state(state: dict[str, Any], operating_date: str) -> None:
    state["operating_date"] = operating_date
    state["day_started"] = False
    state["day_finished"] = False
    state["raw_snapshot_count"] = 0
    state["processed_change_count"] = 0
    state["failure_count"] = 0
    state["error_count"] = 0
    state["ride_count"] = 0
    state["first_success_at_local"] = None
    state["last_success_at_local"] = None
    state["last_semantic_change_at_local"] = None
    state["no_change_alert_active"] = False
    state["daily_analysis_done"] = False
    state["daily_analysis_error"] = None
    state["post_close_features_done"] = False
    state["post_close_model_done"] = False
    state["post_close_pipeline_error"] = None


def is_after_collection_window(timestamp_utc: datetime) -> bool:
    window = collection_window_for(timestamp_utc)
    if not window.is_open:
        return True
    local_time = to_local_time(timestamp_utc).time().replace(tzinfo=None)
    if window.start <= window.end:
        return local_time >= window.end
    return window.end <= local_time < window.start


def expected_daily_snapshot_count(timestamp_utc: datetime | None = None) -> int:
    """Berechnet die planmäßige Zahl der Abrufe innerhalb des Sammelfensters."""
    window = collection_window_for(timestamp_utc or utc_now())
    if not window.is_open:
        return 0
    start_seconds = (
        window.start.hour * 3600
        + window.start.minute * 60
        + window.start.second
    )
    end_seconds = (
        window.end.hour * 3600
        + window.end.minute * 60
        + window.end.second
    )

    window_seconds = end_seconds - start_seconds
    if window_seconds <= 0:
        window_seconds += 24 * 3600

    return max(1, window_seconds // INTERVAL_SECONDS)


async def maybe_send_day_end_notification(
    session: aiohttp.ClientSession,
    now_utc: datetime,
) -> None:
    """Startet nach Sammelende genau einmal die externe Tagesanalyse.

    Die Analyse liest Raw-Snapshots, aktualisiert SQLite und sendet die kombinierte
    Tages-/Qualitätsmeldung selbst. Bei einem Fehler sendet der Collector einen
    klaren Fallback-Alarm, bleibt aber aktiv.
    """
    state = load_notification_state()
    operating_date = state.get("operating_date")
    if not operating_date or not state.get("day_started") or state.get("daily_analysis_done"):
        return

    local_date = to_local_time(now_utc).date().isoformat()
    date_changed = operating_date != local_date
    if not date_changed and not is_after_collection_window(now_utc):
        return

    if not ANALYZER_SCRIPT.is_file():
        message = f"Analyse-Skript fehlt: {ANALYZER_SCRIPT}"
        logger.error(message)
        await send_ntfy(
            session,
            "Movie Park: Tagesanalyse fehlgeschlagen",
            message,
            priority=5,
            tags=("warning", "bar_chart"),
        )
        state["daily_analysis_error"] = message
        state["day_finished"] = True
        save_notification_state(state)
        return

    command = [
        sys.executable,
        str(ANALYZER_SCRIPT),
        "--data-dir", str(DATA_DIR.resolve()),
        "--rides", str(RIDES_FILE.resolve()),
        "--database", str(DATABASE_FILE.resolve()),
        "--notify",
        str(operating_date),
    ]
    logger.info("Tagesanalyse wird gestartet: %s", " ".join(command))
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            command,
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
            cwd=str(Path(__file__).resolve().parent),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        completed = None
        error_text = str(exc)
    else:
        error_text = (completed.stderr or completed.stdout or "").strip()[-1500:]

    if completed is not None and completed.returncode == 0:
        logger.info("Tagesanalyse erfolgreich: %s", (completed.stdout or "").strip())
        state["daily_analysis_done"] = True
        state["daily_analysis_error"] = None
        state["day_finished"] = True
    else:
        message = (
            f"Analyse für {operating_date} konnte nicht abgeschlossen werden.\n"
            f"Fehler: {error_text or 'unbekannt'}"
        )
        logger.error(message)
        await send_ntfy(
            session,
            "Movie Park: Tagesanalyse fehlgeschlagen",
            message,
            priority=5,
            tags=("warning", "bar_chart"),
        )
        state["daily_analysis_error"] = error_text or "unbekannt"
        state["day_finished"] = True
    save_notification_state(state)


async def maybe_run_post_close_model_pipeline(
    session: aiohttp.ClientSession,
    now_utc: datetime,
) -> None:
    """Baut Features und Challenger erst nach dem echten Tagesabschluss."""
    state = load_notification_state()
    operating_date = state.get("operating_date")
    if not operating_date or not state.get("daily_analysis_done") or state.get("post_close_model_done"):
        return
    local_date = to_local_time(now_utc).date().isoformat()
    if operating_date == local_date and not is_after_collection_window(now_utc):
        return

    target_date = (datetime.strptime(str(operating_date), "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
    app_dir = str(Path(__file__).resolve().parent)

    async def execute(label: str, command: list[str], timeout: int) -> subprocess.CompletedProcess[str] | None:
        logger.info("Post-Close %s wird gestartet: %s", label, " ".join(command))
        try:
            return await asyncio.to_thread(
                subprocess.run, command, capture_output=True, text=True,
                timeout=timeout, check=False, cwd=app_dir,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            state["post_close_pipeline_error"] = f"{label}: {exc}"
            save_notification_state(state)
            logger.exception("Post-Close %s fehlgeschlagen", label)
            return None

    if not state.get("post_close_features_done"):
        feature_command = [
            sys.executable, str(FEATURE_SCRIPT),
            "--database", str(DATABASE_FILE.resolve()),
            "--output-dir", str((DATA_DIR / "features").resolve()),
            "--target-date", target_date,
            "--day", str(operating_date),
        ]
        completed = await execute("Feature-Build", feature_command, 420)
        if completed is None or completed.returncode != 0:
            error = ((completed.stderr or completed.stdout) if completed else state.get("post_close_pipeline_error")) or "unbekannt"
            state["post_close_pipeline_error"] = f"Feature-Build: {str(error).strip()[-1200:]}"
            save_notification_state(state)
            await send_ntfy(session, "Movie Park: Post-Close-Pipeline fehlgeschlagen", state["post_close_pipeline_error"], priority=5, tags=("warning", "bar_chart"))
            return
        state["post_close_features_done"] = True
        state["post_close_pipeline_error"] = None
        save_notification_state(state)
        logger.info("Post-Close Feature-Build erfolgreich: %s", (completed.stdout or "").strip())

    model_command = [
        sys.executable, str(MODEL_SCRIPT),
        "--database", str(DATABASE_FILE.resolve()),
        "--models", str(MODEL_DIR.resolve()),
    ]
    completed = await execute("Modelltraining", model_command, 1200)
    if completed is None or completed.returncode != 0:
        error = ((completed.stderr or completed.stdout) if completed else state.get("post_close_pipeline_error")) or "unbekannt"
        state["post_close_pipeline_error"] = f"Modelltraining: {str(error).strip()[-1200:]}"
        save_notification_state(state)
        await send_ntfy(session, "Movie Park: Post-Close-Pipeline fehlgeschlagen", state["post_close_pipeline_error"], priority=5, tags=("warning", "bar_chart"))
        return

    state["post_close_model_done"] = True
    state["post_close_pipeline_error"] = None
    save_notification_state(state)
    output = (completed.stdout or "").strip()
    try:
        result = json.loads(output.splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        result = {}
    await send_ntfy(
        session,
        "Movie Park: Tagesdaten und Modell aktualisiert",
        (
            f"Parktag: {operating_date}\n"
            f"Ausgeführt nach dem dynamischen Parkschluss: {to_local_time(now_utc).strftime('%H:%M')} Uhr\n"
            f"Trainingsstand: {result.get('trainingDays', '?')} vollständige Tage\n"
            f"Modellstatus: {result.get('status', 'aktualisiert')}\n"
            f"Produktiv: {'ja' if result.get('status') == 'champion' else 'nein – aktive Baseline bleibt bestehen'}"
        ),
        priority=3,
        tags=("bar_chart", "white_check_mark"),
    )
    logger.info("Post-Close Modelltraining erfolgreich: %s", output)


async def register_daily_success(
    session: aiohttp.ClientSession,
    fetch_result: FetchResult,
    timestamp_stats: SourceTimestampStats,
    observations: list[dict[str, Any]],
    semantic_hash_changed: bool,
) -> None:
    local_timestamp = to_local_time(fetch_result.fetched_at_utc)
    operating_date = local_timestamp.date().isoformat()
    state = load_notification_state()

    if state.get("operating_date") != operating_date:
        reset_daily_notification_state(state, operating_date)

    state["raw_snapshot_count"] = int(state.get("raw_snapshot_count") or 0) + 1
    if semantic_hash_changed:
        state["processed_change_count"] = int(state.get("processed_change_count") or 0) + 1
    state["ride_count"] = len(observations)
    state["last_success_at_local"] = local_timestamp.isoformat()
    if not state.get("first_success_at_local"):
        state["first_success_at_local"] = local_timestamp.isoformat()

    if not state.get("day_started"):
        sent = await send_ntfy(
            session,
            "Movie Park: Datenerfassung gestartet",
            (
                f"Datum: {operating_date}\n"
                f"Uhrzeit: {local_timestamp.strftime('%H:%M')} Uhr\n"
                f"Erkannte Attraktionen: {len(observations)}\n"
                f"API aktuell: {'ja' if timestamp_stats.payload_fresh else 'nein'}\n"
                "Erster Datensatz wurde gespeichert."
            ),
            priority=3,
            tags=("roller_coaster", "white_check_mark"),
        )
        if sent:
            state["day_started"] = True

    save_notification_state(state)




def weather_code_text(code: Any) -> str:
    labels = {
        0: "klar", 1: "überwiegend klar", 2: "teilweise bewölkt", 3: "bedeckt",
        45: "Nebel", 48: "Reifnebel", 51: "leichter Nieselregen",
        53: "Nieselregen", 55: "starker Nieselregen", 56: "gefrierender Nieselregen",
        57: "starker gefrierender Nieselregen", 61: "leichter Regen",
        63: "Regen", 65: "starker Regen", 66: "gefrierender Regen",
        67: "starker gefrierender Regen", 71: "leichter Schneefall",
        73: "Schneefall", 75: "starker Schneefall", 77: "Schneegriesel",
        80: "leichte Regenschauer", 81: "Regenschauer", 82: "starke Regenschauer",
        85: "leichte Schneeschauer", 86: "starke Schneeschauer",
        95: "Gewitter", 96: "Gewitter mit Hagel", 99: "starkes Gewitter mit Hagel",
    }
    try:
        return labels.get(int(code), f"Wettercode {code}")
    except (TypeError, ValueError):
        return "unbekannt"


def _number(value: Any, digits: int = 1) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(float(value), digits)


async def fetch_weather(session: aiohttp.ClientSession, now_utc: datetime) -> dict[str, Any]:
    params = {
        "latitude": WEATHER_LATITUDE,
        "longitude": WEATHER_LONGITUDE,
        "timezone": "Europe/Berlin",
        "forecast_days": 1,
        "current": (
            "temperature_2m,apparent_temperature,relative_humidity_2m,"
            "precipitation,rain,showers,weather_code,cloud_cover,"
            "wind_speed_10m,wind_gusts_10m"
        ),
        "hourly": (
            "temperature_2m,apparent_temperature,precipitation_probability,"
            "precipitation,rain,showers,weather_code,cloud_cover,"
            "wind_speed_10m,wind_gusts_10m"
        ),
    }
    started = time.perf_counter()
    async with session.get(WEATHER_URL, params=params, timeout=WEATHER_TIMEOUT) as response:
        response.raise_for_status()
        payload = await response.json(content_type=None)
    if not isinstance(payload, dict) or not isinstance(payload.get("current"), dict):
        raise InvalidPayloadError("Wetter-API enthält keine gültigen aktuellen Werte.")

    current = payload["current"]
    hourly = payload.get("hourly") if isinstance(payload.get("hourly"), dict) else {}
    times = hourly.get("time") if isinstance(hourly.get("time"), list) else []
    local_now = to_local_time(now_utc)
    forecast: list[dict[str, Any]] = []
    fields = (
        "temperature_2m", "apparent_temperature", "precipitation_probability",
        "precipitation", "rain", "showers", "weather_code", "cloud_cover",
        "wind_speed_10m", "wind_gusts_10m",
    )
    for index, value in enumerate(times):
        try:
            stamp = datetime.fromisoformat(str(value)).replace(tzinfo=LOCAL_TIMEZONE)
        except ValueError:
            continue
        if stamp < local_now.replace(minute=0, second=0, microsecond=0):
            continue
        if stamp.date() != local_now.date() or stamp.hour > WEATHER_FORECAST_END_HOUR:
            continue
        item: dict[str, Any] = {"time_local": stamp.isoformat()}
        for field in fields:
            values = hourly.get(field)
            item[field] = values[index] if isinstance(values, list) and index < len(values) else None
        item["condition"] = weather_code_text(item.get("weather_code"))
        forecast.append(item)

    return {
        "provider": "open-meteo",
        "location": WEATHER_LOCATION_NAME,
        "latitude": payload.get("latitude", WEATHER_LATITUDE),
        "longitude": payload.get("longitude", WEATHER_LONGITUDE),
        "fetched_at_utc": utc_now().isoformat(),
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "current": {
            "time_local": current.get("time"),
            "temperature_c": _number(current.get("temperature_2m")),
            "apparent_temperature_c": _number(current.get("apparent_temperature")),
            "relative_humidity_percent": _number(current.get("relative_humidity_2m"), 0),
            "precipitation_mm": _number(current.get("precipitation"), 2),
            "rain_mm": _number(current.get("rain"), 2),
            "showers_mm": _number(current.get("showers"), 2),
            "weather_code": current.get("weather_code"),
            "condition": weather_code_text(current.get("weather_code")),
            "cloud_cover_percent": _number(current.get("cloud_cover"), 0),
            "wind_speed_kmh": _number(current.get("wind_speed_10m")),
            "wind_gusts_kmh": _number(current.get("wind_gusts_10m")),
        },
        "remaining_day_hourly": forecast,
    }


def format_weather_log(weather: dict[str, Any]) -> str:
    current = weather.get("current", {})
    forecast = weather.get("remaining_day_hourly", [])
    forecast_parts = []
    for item in forecast:
        time_value = str(item.get("time_local", ""))[11:16]
        forecast_parts.append(
            f"{time_value} {item.get('temperature_2m', '?')}°C/"
            f"{item.get('condition', '?')}, Regen {item.get('precipitation_probability', '?')}%"
        )
    return (
        f"Wetter {current.get('temperature_c', '?')}°C, gefühlt "
        f"{current.get('apparent_temperature_c', '?')}°C, {current.get('condition', '?')}, "
        f"Niederschlag {current.get('precipitation_mm', '?')} mm, "
        f"Wind {current.get('wind_speed_kmh', '?')} km/h | Resttag: "
        + "; ".join(forecast_parts)
    )


async def update_weather_alert(session: aiohttp.ClientSession, error: Exception | None) -> None:
    state = load_notification_state()
    if error is not None:
        if not state.get("weather_failure_active") or notification_repeat_due(
            state.get("last_weather_failure_notification_at_utc"), utc_now()
        ):
            sent = await send_ntfy(
                session,
                "Movie Park Collector: Wetterdaten fehlen",
                f"Queue-Times werden weiter gespeichert, aber der Wetterabruf ist fehlgeschlagen.\nFehler: {error}",
                priority=4,
                tags=("partly_sunny", "warning"),
            )
            if sent:
                state["last_weather_failure_notification_at_utc"] = utc_now().isoformat()
        state["weather_failure_active"] = True
    elif state.get("weather_failure_active"):
        await send_ntfy(
            session,
            "Movie Park Collector: Wetterdaten wieder verfügbar",
            "Der Wetterabruf für Feldhausen/Kirchhellen funktioniert wieder.",
            priority=3,
            tags=("partly_sunny", "white_check_mark"),
        )
        state["weather_failure_active"] = False
        state["last_weather_failure_notification_at_utc"] = None
    save_notification_state(state)


async def update_maintenance_alerts(
    session: aiohttp.ClientSession,
    observations: list[dict[str, Any]],
    semantic_hash_changed: bool,
    park_state: ParkState,
    now_local: datetime,
) -> None:
    state = load_notification_state()
    ride_count = len(observations)
    if ride_count < MIN_EXPECTED_RIDE_COUNT and not state.get("low_ride_count_active"):
        if await send_ntfy(
            session,
            "Movie Park Collector: unvollständige Attraktionsliste",
            f"Es wurden nur {ride_count} Attraktionen erkannt. Warnschwelle: {MIN_EXPECTED_RIDE_COUNT}.",
            priority=4,
            tags=("warning", "roller_coaster"),
        ):
            state["low_ride_count_active"] = True
    elif ride_count >= MIN_EXPECTED_RIDE_COUNT and state.get("low_ride_count_active"):
        await send_ntfy(
            session,
            "Movie Park Collector: Attraktionsliste wieder vollständig",
            f"Aktuell werden wieder {ride_count} Attraktionen erkannt.",
            priority=3,
            tags=("white_check_mark", "roller_coaster"),
        )
        state["low_ride_count_active"] = False

    if semantic_hash_changed:
        state["last_semantic_change_at_local"] = now_local.isoformat()
        state["no_change_alert_active"] = False
    elif park_state in {"open", "closing"}:
        last_change = parse_optional_iso_timestamp(state.get("last_semantic_change_at_local"))
        if last_change is not None:
            age = (utc_now() - last_change).total_seconds()
            if age >= NO_SEMANTIC_CHANGE_ALERT_SECONDS and not state.get("no_change_alert_active"):
                if await send_ntfy(
                    session,
                    "Movie Park Collector: Daten möglicherweise eingefroren",
                    f"Seit ungefähr {round(age / 60)} Minuten wurde keine Status- oder Wartezeitänderung erkannt, obwohl der Park als {park_state} gilt.",
                    priority=4,
                    tags=("hourglass", "warning"),
                ):
                    state["no_change_alert_active"] = True
    save_notification_state(state)


def disk_status() -> tuple[float, float]:
    usage = shutil.disk_usage(DATA_DIR.resolve())
    used_percent = (usage.used / usage.total) * 100 if usage.total else 0.0
    free_gb = usage.free / (1024 ** 3)
    return round(used_percent, 1), round(free_gb, 1)


async def update_disk_alert(session: aiohttp.ClientSession) -> None:
    state = load_notification_state()
    used_percent, free_gb = disk_status()
    warning = used_percent >= DISK_WARNING_PERCENT
    if warning and not state.get("disk_warning_active"):
        priority = 5 if used_percent >= DISK_CRITICAL_PERCENT else 4
        if await send_ntfy(
            session,
            "Movie Park Server: Speicherplatzwarnung",
            f"Datenträger belegt: {used_percent:.1f} %\nFreier Speicher: {free_gb:.1f} GB",
            priority=priority,
            tags=("floppy_disk", "warning"),
        ):
            state["disk_warning_active"] = True
    elif not warning and state.get("disk_warning_active"):
        await send_ntfy(
            session,
            "Movie Park Server: Speicherplatz wieder ausreichend",
            f"Datenträger belegt: {used_percent:.1f} %\nFreier Speicher: {free_gb:.1f} GB",
            priority=3,
            tags=("floppy_disk", "white_check_mark"),
        )
        state["disk_warning_active"] = False
    save_notification_state(state)

# ---------------------------------------------------------------------------
# API-Struktur und Validierung
# ---------------------------------------------------------------------------


def validate_payload(payload: Any) -> dict[str, Any]:
    """Prüft die grundlegende Queue-Times-Struktur."""
    if not isinstance(payload, dict):
        raise InvalidPayloadError("Die API-Antwort ist kein JSON-Objekt.")

    rides = payload.get("rides", [])
    lands = payload.get("lands", [])

    if rides is not None and not isinstance(rides, list):
        raise InvalidPayloadError("Das Feld 'rides' ist keine Liste.")

    if lands is not None and not isinstance(lands, list):
        raise InvalidPayloadError("Das Feld 'lands' ist keine Liste.")

    for index, ride in enumerate(rides or []):
        if not isinstance(ride, dict):
            raise InvalidPayloadError(f"rides[{index}] ist kein Objekt.")

    for land_index, land in enumerate(lands or []):
        if not isinstance(land, dict):
            raise InvalidPayloadError(f"lands[{land_index}] ist kein Objekt.")

        land_rides = land.get("rides", [])
        if land_rides is not None and not isinstance(land_rides, list):
            raise InvalidPayloadError(
                f"lands[{land_index}].rides ist keine Liste."
            )

        for ride_index, ride in enumerate(land_rides or []):
            if not isinstance(ride, dict):
                raise InvalidPayloadError(
                    f"lands[{land_index}].rides[{ride_index}] ist kein Objekt."
                )

    if not get_all_rides(payload):
        logger.warning("Die API-Antwort enthält keine Attraktionen.")

    return payload


def get_all_rides(payload: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    direct_rides = payload.get("rides", [])
    if isinstance(direct_rides, list):
        result.extend(ride for ride in direct_rides if isinstance(ride, dict))

    lands = payload.get("lands", [])
    if isinstance(lands, list):
        for land in lands:
            if not isinstance(land, dict):
                continue

            land_rides = land.get("rides", [])
            if isinstance(land_rides, list):
                result.extend(
                    ride for ride in land_rides if isinstance(ride, dict)
                )

    return result


def parse_api_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def calculate_age_seconds(
    source_timestamp: datetime | None,
    fetched_at_utc: datetime,
) -> int | None:
    if source_timestamp is None:
        return None

    return max(0, int((fetched_at_utc - source_timestamp).total_seconds()))


def collect_source_timestamp_stats(
    payload: dict[str, Any],
    fetched_at_utc: datetime,
) -> SourceTimestampStats:
    timestamps: list[datetime] = []
    missing_count = 0
    invalid_count = 0

    for ride in get_all_rides(payload):
        value = ride.get("last_updated")

        if not isinstance(value, str) or not value.strip():
            missing_count += 1
            continue

        try:
            timestamps.append(parse_api_timestamp(value))
        except ValueError:
            invalid_count += 1
            logger.warning(
                "Ungültiger last_updated-Wert bei Attraktion %r: %r",
                ride.get("id"),
                value,
            )

    if not timestamps:
        return SourceTimestampStats(
            newest_update_utc=None,
            oldest_update_utc=None,
            median_update_utc=None,
            newest_age_seconds=None,
            oldest_age_seconds=None,
            median_age_seconds=None,
            timestamped_ride_count=0,
            fresh_ride_count=0,
            stale_ride_count=0,
            missing_timestamp_count=missing_count,
            invalid_timestamp_count=invalid_count,
            fresh_ride_ratio=None,
            payload_fresh=False,
        )

    ordered = sorted(timestamps)
    newest = ordered[-1]
    oldest = ordered[0]
    median_epoch = median(item.timestamp() for item in ordered)
    median_timestamp = datetime.fromtimestamp(median_epoch, tz=timezone.utc)

    ages = [calculate_age_seconds(item, fetched_at_utc) or 0 for item in ordered]
    fresh_count = sum(age <= MAX_RIDE_DATA_AGE_SECONDS for age in ages)
    stale_count = len(ages) - fresh_count
    fresh_ratio = fresh_count / len(ages)

    newest_age = calculate_age_seconds(newest, fetched_at_utc)
    oldest_age = calculate_age_seconds(oldest, fetched_at_utc)
    median_age = calculate_age_seconds(median_timestamp, fetched_at_utc)

    payload_fresh = (
        newest_age is not None
        and newest_age <= MAX_RIDE_DATA_AGE_SECONDS
        and fresh_ratio >= MIN_FRESH_RIDE_RATIO
    )

    return SourceTimestampStats(
        newest_update_utc=newest,
        oldest_update_utc=oldest,
        median_update_utc=median_timestamp,
        newest_age_seconds=newest_age,
        oldest_age_seconds=oldest_age,
        median_age_seconds=median_age,
        timestamped_ride_count=len(ordered),
        fresh_ride_count=fresh_count,
        stale_ride_count=stale_count,
        missing_timestamp_count=missing_count,
        invalid_timestamp_count=invalid_count,
        fresh_ride_ratio=round(fresh_ratio, 4),
        payload_fresh=payload_fresh,
    )


# ---------------------------------------------------------------------------
# Normalisierung und fachliche Validierung
# ---------------------------------------------------------------------------


def normalize_ride_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = unicodedata.normalize("NFKC", value)
    normalized = "".join(
        char for char in normalized if unicodedata.category(char) != "Cf"
    )
    normalized = " ".join(normalized.split()).strip()

    return normalized or None


def parse_ride_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def parse_wait_time(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def classify_ride_status(
    is_open: Any,
    wait_time: int | None,
) -> RideStatus:
    if not isinstance(is_open, bool):
        return "unknown"

    if is_open is False:
        return "closed"

    if wait_time is None or wait_time < 0:
        return "invalid"

    return "open"


def normalize_ride_observation(
    ride: dict[str, Any],
    fetched_at_utc: datetime,
    seen_ids: set[int],
) -> dict[str, Any]:
    ride_id = parse_ride_id(ride.get("id"))
    source_name = ride.get("name") if isinstance(ride.get("name"), str) else None
    display_name = normalize_ride_name(source_name)
    display_name = RIDE_NAME_OVERRIDES.get(ride_id, display_name)
    is_open = ride.get("is_open")
    source_wait_time = parse_wait_time(ride.get("wait_time"))

    validation_errors: list[str] = []

    if ride_id is None:
        validation_errors.append("missing_or_invalid_ride_id")
    elif ride_id in seen_ids:
        validation_errors.append("duplicate_ride_id")
    else:
        seen_ids.add(ride_id)

    if display_name is None:
        validation_errors.append("missing_or_invalid_name")

    if not isinstance(is_open, bool):
        validation_errors.append("missing_or_invalid_is_open")

    if source_wait_time is None:
        validation_errors.append("missing_or_invalid_wait_time")
    elif source_wait_time < 0:
        validation_errors.append("negative_wait_time")
    elif source_wait_time > MAX_REASONABLE_WAIT_TIME_MINUTES:
        validation_errors.append("wait_time_out_of_range")

    source_updated_at_utc: datetime | None = None
    timestamp_status = "missing"
    timestamp_value = ride.get("last_updated")

    if isinstance(timestamp_value, str) and timestamp_value.strip():
        try:
            source_updated_at_utc = parse_api_timestamp(timestamp_value)
            timestamp_status = "valid"
        except ValueError:
            timestamp_status = "invalid"
            validation_errors.append("invalid_last_updated")

    source_age_seconds = calculate_age_seconds(
        source_updated_at_utc,
        fetched_at_utc,
    )

    source_fresh = (
        source_age_seconds is not None
        and source_age_seconds <= MAX_RIDE_DATA_AGE_SECONDS
    )

    status = classify_ride_status(is_open, source_wait_time)

    # Eine geschlossene Attraktion hat keine Wartezeitmessung. Der von der API
    # gelieferte Nullwert bleibt separat unter source_wait_time_minutes erhalten.
    wait_time_minutes: int | None = None
    if (
        status == "open"
        and source_wait_time is not None
        and 0 <= source_wait_time <= MAX_REASONABLE_WAIT_TIME_MINUTES
    ):
        wait_time_minutes = source_wait_time

    measurement_valid = (
        status == "open"
        and wait_time_minutes is not None
        and source_fresh
        and not validation_errors
    )

    fetched_at_local = to_local_time(fetched_at_utc)

    return {
        "ride_id": ride_id,
        "source_name": source_name,
        "display_name": display_name,
        "status": status,
        "is_open": is_open if isinstance(is_open, bool) else None,
        "source_wait_time_minutes": source_wait_time,
        "wait_time_minutes": wait_time_minutes,
        "measurement_valid": measurement_valid,
        "source_updated_at_utc": (
            source_updated_at_utc.isoformat()
            if source_updated_at_utc is not None
            else None
        ),
        "source_age_seconds": source_age_seconds,
        "source_fresh": source_fresh,
        "timestamp_status": timestamp_status,
        "observed_at_utc": fetched_at_utc.isoformat(),
        "observed_at_local": fetched_at_local.isoformat(),
        "validation_errors": validation_errors,
    }


def normalize_observations(
    payload: dict[str, Any],
    fetched_at_utc: datetime,
) -> list[dict[str, Any]]:
    seen_ids: set[int] = set()
    observations: list[dict[str, Any]] = []

    for ride in get_all_rides(payload):
        ride_id = parse_ride_id(ride.get("id"))
        if ride_id in EXCLUDED_RIDE_IDS:
            continue

        observations.append(
            normalize_ride_observation(
                ride=ride,
                fetched_at_utc=fetched_at_utc,
                seen_ids=seen_ids,
            )
        )

    observations.sort(
        key=lambda item: (
            item["ride_id"] is None,
            item["ride_id"] if item["ride_id"] is not None else 0,
        )
    )

    return observations


# ---------------------------------------------------------------------------
# Parkzustand und Analysemerkmale
# ---------------------------------------------------------------------------


def determine_park_state(
    observations: list[dict[str, Any]],
) -> ParkState:
    """Leitet den Parkzustand ausschließlich aus den API-Beobachtungen ab."""
    open_count = sum(item["status"] == "open" for item in observations)
    fresh_count = sum(item.get("source_fresh") is True for item in observations)
    known_count = sum(
        item["status"] in {"open", "closed"} for item in observations
    )

    if open_count >= MIN_OPEN_RIDES_FOR_OPEN_STATE:
        return "open"

    # Einzelne offene Attraktionen können während Hoch-/Runterfahren oder bei
    # unvollständigen API-Daten auftreten. Diese Lage bleibt bewusst unbekannt.
    if open_count > 0:
        return "unknown"

    # Nur dann geschlossen annehmen, wenn ausreichend viele aktuelle und
    # eindeutig klassifizierbare Attraktionen vorliegen.
    if observations and known_count >= MIN_OPEN_RIDES_FOR_OPEN_STATE and fresh_count >= MIN_OPEN_RIDES_FOR_OPEN_STATE:
        return "closed"

    return "unknown"


def build_session_features(
    fetched_at_utc: datetime,
) -> dict[str, Any]:
    local_timestamp = to_local_time(fetched_at_utc)
    operating_date = local_timestamp.date().isoformat()

    return {
        "operating_date": operating_date,
        "session_id": f"movie-park-{PARK_ID}_{operating_date}",
        "weekday": local_timestamp.weekday(),
        "local_date": operating_date,
        "local_time": local_timestamp.time().isoformat(),
        "minutes_since_midnight": (
            local_timestamp.hour * 60 + local_timestamp.minute
        ),
    }


def build_observation_summary(
    observations: list[dict[str, Any]],
) -> dict[str, Any]:
    total = len(observations)
    open_count = sum(item["status"] == "open" for item in observations)
    closed_count = sum(item["status"] == "closed" for item in observations)
    unknown_count = sum(item["status"] == "unknown" for item in observations)
    invalid_count = sum(item["status"] == "invalid" for item in observations)
    valid_measurement_count = sum(item["measurement_valid"] for item in observations)
    fresh_count = sum(item["source_fresh"] for item in observations)

    valid_wait_times = [
        item["wait_time_minutes"]
        for item in observations
        if item["measurement_valid"] and item["wait_time_minutes"] is not None
    ]

    return {
        "ride_count": total,
        "open_ride_count": open_count,
        "closed_ride_count": closed_count,
        "unknown_ride_count": unknown_count,
        "invalid_ride_count": invalid_count,
        "valid_measurement_count": valid_measurement_count,
        "fresh_ride_count": fresh_count,
        "open_ride_ratio": round(open_count / total, 4) if total else None,
        "valid_measurement_ratio": (
            round(valid_measurement_count / total, 4) if total else None
        ),
        "mean_wait_time_minutes": (
            round(sum(valid_wait_times) / len(valid_wait_times), 2)
            if valid_wait_times
            else None
        ),
        "median_wait_time_minutes": (
            median(valid_wait_times) if valid_wait_times else None
        ),
        "maximum_wait_time_minutes": (
            max(valid_wait_times) if valid_wait_times else None
        ),
    }


# ---------------------------------------------------------------------------
# Hashing und Status
# ---------------------------------------------------------------------------


def calculate_payload_hash(payload: dict[str, Any]) -> str:
    canonical_json = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def calculate_semantic_hash(
    observations: list[dict[str, Any]],
    park_state: ParkState,
) -> str:
    semantic_state = {
        "park_state": park_state,
        "rides": [
            {
                "ride_id": item["ride_id"],
                "status": item["status"],
                "is_open": item["is_open"],
                "source_wait_time_minutes": item["source_wait_time_minutes"],
            }
            for item in observations
        ],
    }

    canonical_json = json.dumps(
        semantic_state,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def read_last_semantic_hash() -> str | None:
    try:
        value = LAST_SEMANTIC_HASH_FILE.read_text(encoding="utf-8").strip()
        return value or None
    except FileNotFoundError:
        return None
    except OSError as exc:
        logger.warning("Letzter semantischer Hash konnte nicht gelesen werden: %s", exc)
        return None


def save_last_semantic_hash(value: str) -> None:
    write_text_atomic(LAST_SEMANTIC_HASH_FILE, value + "\n")


# ---------------------------------------------------------------------------
# Dateiverarbeitung
# ---------------------------------------------------------------------------


def ensure_directories() -> None:
    for directory in (
        RAW_DATA_DIR,
        PROCESSED_DATA_DIR,
        STATE_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)


def write_text_atomic(file_path: Path, content: str) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = file_path.with_name(file_path.name + ".tmp")
    temporary_path.write_text(content, encoding="utf-8")
    temporary_path.replace(file_path)


def write_json_atomic(file_path: Path, data: dict[str, Any]) -> None:
    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    write_text_atomic(file_path, serialized + "\n")


def create_timestamp_filename(prefix: str, timestamp_utc: datetime) -> str:
    timestamp_string = timestamp_utc.strftime("%Y%m%dT%H%M%S.%fZ")
    return f"{prefix}_{timestamp_string}.json"


def get_date_folder(base_directory: Path, timestamp_utc: datetime) -> Path:
    local_date_string = to_local_time(timestamp_utc).strftime("%Y-%m-%d")
    return base_directory / local_date_string


def build_raw_record(
    fetch_result: FetchResult,
    payload_hash: str,
    timestamp_stats: SourceTimestampStats,
    weather: dict[str, Any] | None,
    observations: list[dict[str, Any]],
) -> dict[str, Any]:
    fetched_at_local = to_local_time(fetch_result.fetched_at_utc)

    return {
        "schema_version": 2,
        "collector": {
            "name": "Gerrxt Movie Park Monitor",
            "version": "3.0",
        },
        "source": {
            "name": "queue-times",
            "park_id": PARK_ID,
            "url": URL,
        },
        "request": {
            "http_status": fetch_result.status_code,
            "duration_ms": fetch_result.duration_ms,
            "fetched_at_utc": fetch_result.fetched_at_utc.isoformat(),
            "fetched_at_local": fetched_at_local.isoformat(),
        },
        "data_quality": {
            "source_payload_hash": payload_hash,
            "newest_source_update_utc": (
                timestamp_stats.newest_update_utc.isoformat()
                if timestamp_stats.newest_update_utc
                else None
            ),
            "oldest_source_update_utc": (
                timestamp_stats.oldest_update_utc.isoformat()
                if timestamp_stats.oldest_update_utc
                else None
            ),
            "median_source_update_utc": (
                timestamp_stats.median_update_utc.isoformat()
                if timestamp_stats.median_update_utc
                else None
            ),
            "newest_source_age_seconds": timestamp_stats.newest_age_seconds,
            "oldest_source_age_seconds": timestamp_stats.oldest_age_seconds,
            "median_source_age_seconds": timestamp_stats.median_age_seconds,
            "timestamped_ride_count": timestamp_stats.timestamped_ride_count,
            "fresh_ride_count": timestamp_stats.fresh_ride_count,
            "stale_ride_count": timestamp_stats.stale_ride_count,
            "missing_timestamp_count": timestamp_stats.missing_timestamp_count,
            "invalid_timestamp_count": timestamp_stats.invalid_timestamp_count,
            "fresh_ride_ratio": timestamp_stats.fresh_ride_ratio,
            "payload_fresh": timestamp_stats.payload_fresh,
            "maximum_ride_age_seconds": MAX_RIDE_DATA_AGE_SECONDS,
            "minimum_fresh_ride_ratio": MIN_FRESH_RIDE_RATIO,
        },
        "weather": weather,
        "observations": observations,
        "payload": fetch_result.payload,
    }


def build_processed_record(
    fetch_result: FetchResult,
    observations: list[dict[str, Any]],
    payload_hash: str,
    semantic_hash: str,
    timestamp_stats: SourceTimestampStats,
    park_state: ParkState,
    weather: dict[str, Any] | None,
) -> dict[str, Any]:
    session_features = build_session_features(
        fetch_result.fetched_at_utc,
    )
    summary = build_observation_summary(observations)

    observation_valid = (
        timestamp_stats.payload_fresh
        and park_state in {"open", "closing"}
        and summary["valid_measurement_count"] > 0
    )

    return {
        "schema_version": 2,
        "collector": {
            "name": "Gerrxt Movie Park Monitor",
            "version": "3.0",
        },
        "source": {
            "name": "queue-times",
            "park_id": PARK_ID,
            "url": URL,
        },
        "request": {
            "http_status": fetch_result.status_code,
            "duration_ms": fetch_result.duration_ms,
            "fetched_at_utc": fetch_result.fetched_at_utc.isoformat(),
            "fetched_at_local": to_local_time(fetch_result.fetched_at_utc).isoformat(),
        },
        "processing": {
            "excluded_ride_ids": sorted(EXCLUDED_RIDE_IDS),
            "source_payload_hash": payload_hash,
            "semantic_state_hash": semantic_hash,
            "closed_wait_times_normalized_to_null": True,
            "maximum_reasonable_wait_time_minutes": (
                MAX_REASONABLE_WAIT_TIME_MINUTES
            ),
        },
        "data_quality": {
            "source_fresh": timestamp_stats.payload_fresh,
            "observation_valid": observation_valid,
            "park_state": park_state,
            "fresh_ride_ratio": timestamp_stats.fresh_ride_ratio,
            "timestamped_ride_count": timestamp_stats.timestamped_ride_count,
            "fresh_ride_count": timestamp_stats.fresh_ride_count,
            "stale_ride_count": timestamp_stats.stale_ride_count,
            "missing_timestamp_count": timestamp_stats.missing_timestamp_count,
            "invalid_timestamp_count": timestamp_stats.invalid_timestamp_count,
        },
        "session": session_features,
        "weather": weather,
        "summary": summary,
        "observations": observations,
    }


def save_record(
    base_directory: Path,
    prefix: str,
    record: dict[str, Any],
    timestamp_utc: datetime,
) -> Path:
    folder = get_date_folder(base_directory, timestamp_utc)
    file_path = folder / create_timestamp_filename(prefix, timestamp_utc)
    write_json_atomic(file_path, record)
    return file_path


def save_last_success(
    raw_record: dict[str, Any],
    raw_file_path: Path,
    processed_file_path: Path | None,
    semantic_hash_changed: bool,
) -> None:
    status_record = {
        "schema_version": 2,
        "last_successful_request": raw_record["request"],
        "data_quality": raw_record["data_quality"],
        "raw_file": str(raw_file_path),
        "processed_file": (
            str(processed_file_path) if processed_file_path is not None else None
        ),
        "semantic_hash_changed": semantic_hash_changed,
    }
    write_json_atomic(LAST_SUCCESS_FILE, status_record)


# ---------------------------------------------------------------------------
# HTTP-Abruf
# ---------------------------------------------------------------------------


async def wait_before_retry(
    scheduler: Scheduler,
    delay_seconds: int,
) -> None:
    stopped = await scheduler.wait_or_timeout(delay_seconds)
    if stopped:
        raise asyncio.CancelledError(
            "Collector wurde während eines Retries beendet."
        )


async def fetch_queue_times(
    session: aiohttp.ClientSession,
    scheduler: Scheduler,
) -> FetchResult:
    attempts = len(RETRY_DELAYS_SECONDS) + 1
    last_error: Exception | None = None

    for attempt_number in range(1, attempts + 1):
        if scheduler.is_stopped:
            raise asyncio.CancelledError("Collector wurde beendet.")

        started_at = time.perf_counter()

        try:
            async with session.get(URL) as response:
                response.raise_for_status()

                try:
                    payload = await response.json(content_type=None)
                except (
                    json.JSONDecodeError,
                    aiohttp.ContentTypeError,
                ) as exc:
                    raise InvalidPayloadError(
                        "Die API-Antwort enthält kein gültiges JSON."
                    ) from exc

                validated_payload = validate_payload(payload)
                fetched_at_utc = utc_now()
                duration_ms = round(
                    (time.perf_counter() - started_at) * 1000
                )

                return FetchResult(
                    payload=validated_payload,
                    status_code=response.status,
                    duration_ms=duration_ms,
                    fetched_at_utc=fetched_at_utc,
                )

        except asyncio.CancelledError:
            raise
        except (
            aiohttp.ClientError,
            asyncio.TimeoutError,
            InvalidPayloadError,
        ) as exc:
            last_error = exc

            if attempt_number >= attempts:
                break

            retry_delay = RETRY_DELAYS_SECONDS[attempt_number - 1]
            logger.warning(
                "Abrufversuch %d/%d fehlgeschlagen: %s. Neuer Versuch in %d Sekunden.",
                attempt_number,
                attempts,
                exc,
                retry_delay,
            )
            await wait_before_retry(scheduler, retry_delay)

    raise RuntimeError(
        f"Alle {attempts} API-Abrufversuche sind fehlgeschlagen."
    ) from last_error


# ---------------------------------------------------------------------------
# Einzelner Collector-Durchlauf
# ---------------------------------------------------------------------------


async def run_once(
    session: aiohttp.ClientSession,
    scheduler: Scheduler,
) -> None:
    current_time_utc = utc_now()
    current_time_local = to_local_time(current_time_utc)
    collection_window = collection_window_for(current_time_utc)

    if not is_collection_window(current_time_utc):
        await maybe_send_day_end_notification(session, current_time_utc)
        await maybe_run_post_close_model_pipeline(session, current_time_utc)
        logger.info(
            "Außerhalb des dynamischen Sammelfensters %s–%s Uhr (%s%s). "
            "Lokale Zeit: %s. Abruf wird übersprungen.",
            collection_window.start.strftime("%H:%M"),
            collection_window.end.strftime("%H:%M"),
            collection_window.source,
            f", {collection_window.event_name}" if collection_window.event_name else "",
            current_time_local.strftime("%H:%M:%S"),
        )
        return

    try:
        fetch_result = await fetch_queue_times(session, scheduler)

        weather: dict[str, Any] | None = None
        weather_error: Exception | None = None
        try:
            weather = await fetch_weather(session, fetch_result.fetched_at_utc)
            logger.info(format_weather_log(weather))
        except (aiohttp.ClientError, asyncio.TimeoutError, InvalidPayloadError, ValueError) as exc:
            weather_error = exc
            logger.warning("Wetterabruf fehlgeschlagen; Queue-Times werden weiter verarbeitet: %s", exc)
        await update_weather_alert(session, weather_error)

        payload_hash = calculate_payload_hash(fetch_result.payload)
        timestamp_stats = collect_source_timestamp_stats(
            fetch_result.payload,
            fetch_result.fetched_at_utc,
        )

        await register_collector_success(session)
        await update_stale_data_alert(session, timestamp_stats)

        observations = normalize_observations(
            fetch_result.payload,
            fetch_result.fetched_at_utc,
        )
        raw_record = build_raw_record(
            fetch_result=fetch_result,
            payload_hash=payload_hash,
            timestamp_stats=timestamp_stats,
            weather=weather,
            observations=observations,
        )

        raw_file_path = save_record(
            RAW_DATA_DIR,
            "queue-times-raw",
            raw_record,
            fetch_result.fetched_at_utc,
        )

        try:
            await asyncio.to_thread(
                insert_database_snapshot,
                fetch_result,
                raw_file_path,
                timestamp_stats,
                observations,
                weather,
            )
        except (OSError, sqlite3.Error) as exc:
            logger.exception(
                "SQLite-Schreibfehler; Raw-Snapshot bleibt erhalten: %s",
                exc,
            )
        park_state = determine_park_state(observations)
        semantic_hash = calculate_semantic_hash(observations, park_state)
        previous_semantic_hash = read_last_semantic_hash()
        semantic_hash_changed = semantic_hash != previous_semantic_hash

        processed_file_path: Path | None = None

        if semantic_hash_changed:
            processed_record = build_processed_record(
                fetch_result=fetch_result,
                observations=observations,
                payload_hash=payload_hash,
                semantic_hash=semantic_hash,
                timestamp_stats=timestamp_stats,
                park_state=park_state,
                weather=weather,
            )

            processed_file_path = save_record(
                PROCESSED_DATA_DIR,
                "queue-times-processed",
                processed_record,
                fetch_result.fetched_at_utc,
            )
            save_last_semantic_hash(semantic_hash)

            logger.info(
                "Semantische Änderung erkannt. Verarbeitete Daten gespeichert: %s",
                processed_file_path,
            )
        else:
            logger.info(
                "Keine fachliche Änderung bei Status oder Wartezeiten. "
                "Nur Rohdaten wurden gespeichert."
            )

        save_last_success(
            raw_record=raw_record,
            raw_file_path=raw_file_path,
            processed_file_path=processed_file_path,
            semantic_hash_changed=semantic_hash_changed,
        )

        await register_daily_success(
            session=session,
            fetch_result=fetch_result,
            timestamp_stats=timestamp_stats,
            observations=observations,
            semantic_hash_changed=semantic_hash_changed,
        )
        await update_maintenance_alerts(
            session, observations, semantic_hash_changed, park_state,
            to_local_time(fetch_result.fetched_at_utc),
        )
        await update_disk_alert(session)

        logger.info(
            "Rohdaten gespeichert: %s | Parkzustand: %s | Fresh-Ratio: %s",
            raw_file_path,
            park_state,
            timestamp_stats.fresh_ride_ratio,
        )

    except asyncio.CancelledError:
        logger.info("Aktueller Abruf wurde wegen des Stop-Signals beendet.")
        raise
    except aiohttp.ClientResponseError as exc:
        message = f"HTTP-Fehler {exc.status}: {exc.message}"
        logger.error(message)
        await register_collector_failure(session, message)
    except asyncio.TimeoutError:
        message = "Zeitüberschreitung beim Abruf der API."
        logger.error(message)
        await register_collector_failure(session, message)
    except InvalidPayloadError as exc:
        message = f"Ungültige API-Antwort: {exc}"
        logger.error(message)
        await register_collector_failure(session, message)
    except OSError as exc:
        message = f"Fehler beim Speichern der Daten: {exc}"
        logger.exception(message)
        await register_collector_failure(session, message)
    except Exception as exc:
        message = f"Unerwarteter Fehler beim Collector-Durchlauf: {exc}"
        logger.exception(message)
        await register_collector_failure(session, message)


# ---------------------------------------------------------------------------
# Signalbehandlung
# ---------------------------------------------------------------------------


def install_signal_handlers(scheduler: Scheduler) -> None:
    loop = asyncio.get_running_loop()

    def handle_signal(received_signal: int) -> None:
        try:
            signal_name = signal.Signals(received_signal).name
        except ValueError:
            signal_name = str(received_signal)

        logger.info("Signal %s empfangen. Collector wird beendet.", signal_name)
        scheduler.stop()

    for current_signal in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(
                current_signal,
                handle_signal,
                current_signal,
            )
        except (NotImplementedError, RuntimeError, ValueError):
            try:
                signal.signal(
                    current_signal,
                    lambda sig, frame: handle_signal(sig),
                )
            except ValueError:
                logger.warning(
                    "Signal %s konnte nicht registriert werden.",
                    current_signal,
                )


# ---------------------------------------------------------------------------
# Hauptprogramm
# ---------------------------------------------------------------------------


async def main() -> None:
    ensure_directories()
    initialize_database()
    if not NOTIFICATION_STATE_FILE.exists():
        save_notification_state(default_notification_state())

    scheduler = Scheduler()
    install_signal_handlers(scheduler)

    connector = aiohttp.TCPConnector(
        limit=5,
        ttl_dns_cache=300,
    )

    async with aiohttp.ClientSession(
        timeout=TIMEOUT,
        headers=HEADERS,
        connector=connector,
    ) as session:
        loop = asyncio.get_running_loop()
        next_run = loop.time()
        startup_window = collection_window_for(utc_now())

        logger.info(
            "Movie-Park-Collector 3.0 gestartet. Intervall: %d Sekunden. "
            "Dynamisches Sammelfenster: %s–%s Uhr (%s%s).",
            INTERVAL_SECONDS,
            startup_window.start.strftime("%H:%M"),
            startup_window.end.strftime("%H:%M"),
            startup_window.source,
            f", {startup_window.event_name}" if startup_window.event_name else "",
        )

        used_percent, free_gb = disk_status()
        last_success = load_notification_state().get("last_success_at_local") or "noch keiner"
        await send_ntfy(
            session,
            "Movie Park Collector 3.0 gestartet",
            (
                "Systemcheck erfolgreich.\n"
                f"Intervall: {INTERVAL_SECONDS // 60} Minuten\n"
                "Dynamisches Sammelfenster: "
                f"{startup_window.start.strftime('%H:%M')}–"
                f"{startup_window.end.strftime('%H:%M')} Uhr "
                f"({startup_window.source})\n"
                f"Wetter: Open-Meteo für Feldhausen/Kirchhellen\n"
                f"Speicher: {used_percent:.1f} % belegt, {free_gb:.1f} GB frei\n"
                f"Letzter Datenerfolg: {last_success}"
            ),
            priority=3,
            tags=("white_check_mark", "computer"),
        )

        while not scheduler.is_stopped:
            await run_once(session, scheduler)

            next_run += INTERVAL_SECONDS
            sleep_duration = seconds_until_next_interval(loop.time(), next_run)

            if sleep_duration == 0:
                next_run = loop.time()

            if await scheduler.wait_or_timeout(sleep_duration):
                break

    logger.info("Movie-Park-Collector wurde ordnungsgemäß beendet.")


# ---------------------------------------------------------------------------
# SQLite – transaktionale Arbeitsdatenbank
# ---------------------------------------------------------------------------

def initialize_database() -> None:
    DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_FILE, timeout=300) as connection:
        connection.execute("PRAGMA busy_timeout=300000")
        connection.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS snapshots(
            snapshot_id TEXT PRIMARY KEY,
            observed_at TEXT NOT NULL,
            operating_date TEXT NOT NULL,
            raw_path TEXT,
            http_status INTEGER,
            duration_ms INTEGER,
            payload_fresh INTEGER,
            ride_count INTEGER,
            collector_version TEXT
        );
        CREATE TABLE IF NOT EXISTS rides(
            ride_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT,
            indoor INTEGER,
            water INTEGER,
            family INTEGER,
            thrill INTEGER,
            weather_sensitive INTEGER
        );
        CREATE TABLE IF NOT EXISTS ride_observations(
            snapshot_id TEXT NOT NULL,
            ride_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            wait_minutes INTEGER,
            measurement_valid INTEGER,
            source_fresh INTEGER,
            PRIMARY KEY(snapshot_id, ride_id),
            FOREIGN KEY(snapshot_id) REFERENCES snapshots(snapshot_id)
        );
        CREATE TABLE IF NOT EXISTS weather_observations(
            snapshot_id TEXT PRIMARY KEY,
            temperature_c REAL,
            apparent_temperature_c REAL,
            humidity_percent REAL,
            precipitation_mm REAL,
            rain_mm REAL,
            showers_mm REAL,
            weather_code INTEGER,
            condition TEXT,
            cloud_cover_percent REAL,
            wind_speed_kmh REAL,
            wind_gusts_kmh REAL,
            FOREIGN KEY(snapshot_id) REFERENCES snapshots(snapshot_id)
        );
        """)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(rides)")}
        for column, sql_type in (
            ("category", "TEXT"),
            ("indoor", "INTEGER"),
            ("water", "INTEGER"),
            ("family", "INTEGER"),
            ("thrill", "INTEGER"),
            ("weather_sensitive", "INTEGER"),
        ):
            if column not in columns:
                connection.execute(f"ALTER TABLE rides ADD COLUMN {column} {sql_type}")
        connection.commit()


def insert_database_snapshot(
    fetch_result: FetchResult,
    raw_file_path: Path,
    timestamp_stats: SourceTimestampStats,
    observations: list[dict[str, Any]],
    weather: dict[str, Any] | None,
) -> None:
    """Schreibt einen vollständigen Abruf atomar in SQLite.

    Ein Datenbankfehler wird vom Aufrufer nur protokolliert; die Raw-Datei bleibt
    stets die maßgebliche, unveränderte Quelle.
    """
    snapshot_id = fetch_result.fetched_at_utc.isoformat()
    local_timestamp = to_local_time(fetch_result.fetched_at_utc)
    with sqlite3.connect(DATABASE_FILE, timeout=300) as connection:
        connection.execute("PRAGMA busy_timeout=300000")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute(
            """INSERT OR REPLACE INTO snapshots
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                snapshot_id,
                local_timestamp.isoformat(),
                local_timestamp.date().isoformat(),
                str(raw_file_path),
                fetch_result.status_code,
                fetch_result.duration_ms,
                int(timestamp_stats.payload_fresh),
                len(observations),
                "3.0",
            ),
        )
        for observation in observations:
            ride_id = observation.get("ride_id")
            if not isinstance(ride_id, int):
                continue
            name = observation.get("display_name") or observation.get("source_name") or str(ride_id)
            connection.execute(
                "INSERT OR IGNORE INTO rides(ride_id, name) VALUES (?, ?)",
                (ride_id, str(name)),
            )
            source_fresh = observation.get("source_fresh")
            connection.execute(
                """INSERT OR REPLACE INTO ride_observations
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    snapshot_id,
                    ride_id,
                    str(observation.get("status") or "unknown"),
                    observation.get("wait_time_minutes"),
                    int(observation.get("measurement_valid") is True),
                    None if source_fresh is None else int(bool(source_fresh)),
                ),
            )
        if isinstance(weather, dict):
            current = weather.get("current") if isinstance(weather.get("current"), dict) else {}
            connection.execute(
                """INSERT OR REPLACE INTO weather_observations
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    snapshot_id,
                    current.get("temperature_c"),
                    current.get("apparent_temperature_c"),
                    current.get("relative_humidity_percent"),
                    current.get("precipitation_mm"),
                    current.get("rain_mm"),
                    current.get("showers_mm"),
                    current.get("weather_code"),
                    current.get("condition"),
                    current.get("cloud_cover_percent"),
                    current.get("wind_speed_kmh"),
                    current.get("wind_gusts_kmh"),
                ),
            )
        connection.commit()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Programm durch Tastatureingabe beendet.")
    except Exception as exc:
        logger.exception("Kritischer Programmfehler: %s", exc)
        sys.exit(1)
