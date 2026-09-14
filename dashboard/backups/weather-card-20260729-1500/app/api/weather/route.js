import { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATABASE_PATH = "/opt/moviepark/app/data/moviepark.sqlite";
const PARK_TIME_ZONE = "Europe/Berlin";
const PARK_LATITUDE = 51.6207;
const PARK_LONGITUDE = 6.972;

const CONDITIONS = {
  0: "Klar",
  1: "Überwiegend klar",
  2: "Teilweise bewölkt",
  3: "Bedeckt",
  45: "Nebel",
  48: "Raureifnebel",
  51: "Leichter Nieselregen",
  53: "Nieselregen",
  55: "Starker Nieselregen",
  56: "Gefrierender Nieselregen",
  57: "Starker gefrierender Nieselregen",
  61: "Leichter Regen",
  63: "Regen",
  65: "Starker Regen",
  66: "Gefrierender Regen",
  67: "Starker gefrierender Regen",
  71: "Leichter Schneefall",
  73: "Schneefall",
  75: "Starker Schneefall",
  77: "Schneegriesel",
  80: "Leichte Regenschauer",
  81: "Regenschauer",
  82: "Starke Regenschauer",
  85: "Leichte Schneeschauer",
  86: "Starke Schneeschauer",
  95: "Gewitter",
  96: "Gewitter mit Hagel",
  99: "Starkes Gewitter mit Hagel",
};

function conditionFor(code, fallback) {
  return CONDITIONS[code] ?? fallback ?? "Unbekannt";
}

function normalize(row, timestamp, source) {
  if (!row) return null;
  return {
    timestamp,
    temperature: row.temperature_c,
    apparentTemperature: row.apparent_temperature_c,
    humidity: row.humidity_percent ?? null,
    precipitationProbability: row.precipitation_probability ?? null,
    precipitation: row.precipitation_mm ?? 0,
    weatherCode: row.weather_code,
    condition: conditionFor(row.weather_code, row.condition),
    cloudCover: row.cloud_cover_percent,
    windSpeed: row.wind_speed_kmh,
    source,
  };
}

function readDatabaseWeather(now) {
  const database = new DatabaseSync(DATABASE_PATH, { readOnly: true });
  try {
    const currentRow = database.prepare(`
      SELECT * FROM weather_observations
      ORDER BY unixepoch(snapshot_id) DESC
      LIMIT 1
    `).get();

    const historyTarget = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const historyRow = database.prepare(`
      SELECT * FROM weather_observations
      ORDER BY ABS(unixepoch(snapshot_id) - unixepoch(?)) ASC
      LIMIT 1
    `).get(historyTarget);

    const futureLimit = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
    const forecastRows = database.prepare(`
      SELECT wf.*
      FROM weather_forecasts wf
      INNER JOIN (
        SELECT forecast_for, MAX(snapshot_id) AS latest_snapshot
        FROM weather_forecasts
        WHERE unixepoch(forecast_for) > unixepoch(?)
          AND unixepoch(forecast_for) <= unixepoch(?)
        GROUP BY forecast_for
      ) newest
        ON newest.forecast_for = wf.forecast_for
       AND newest.latest_snapshot = wf.snapshot_id
      ORDER BY unixepoch(wf.forecast_for) ASC
      LIMIT 4
    `).all(now.toISOString(), futureLimit);

    const parkRow = database.prepare(`
      SELECT
        s.observed_at,
        SUM(CASE WHEN ro.status = 'open' THEN 1 ELSE 0 END) AS open_ride_count,
        SUM(CASE WHEN ro.status = 'closed' THEN 1 ELSE 0 END) AS closed_ride_count
      FROM snapshots s
      LEFT JOIN ride_observations ro ON ro.snapshot_id = s.snapshot_id
      WHERE s.snapshot_id = (
        SELECT snapshot_id FROM snapshots
        ORDER BY unixepoch(observed_at) DESC LIMIT 1
      )
      GROUP BY s.snapshot_id, s.observed_at
    `).get();

    return {
      current: normalize(currentRow, currentRow?.snapshot_id, "database"),
      history: normalize(historyRow, historyRow?.snapshot_id, "database"),
      forecast: forecastRows.map((row) =>
        normalize(row, row.forecast_for, "database"),
      ),
      parkRow,
    };
  } finally {
    database.close();
  }
}

async function fetchForecastFallback() {
  const query = new URLSearchParams({
    latitude: String(PARK_LATITUDE),
    longitude: String(PARK_LONGITUDE),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
    ].join(","),
    timezone: PARK_TIME_ZONE,
    forecast_days: "2",
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`);

  const payload = await response.json();
  return payload.hourly.time.map((timestamp, index) => ({
    timestamp,
    temperature: payload.hourly.temperature_2m[index],
    apparentTemperature: payload.hourly.apparent_temperature[index],
    humidity: null,
    precipitationProbability: payload.hourly.precipitation_probability[index],
    precipitation: payload.hourly.precipitation[index],
    weatherCode: payload.hourly.weather_code[index],
    condition: conditionFor(payload.hourly.weather_code[index]),
    cloudCover: payload.hourly.cloud_cover[index],
    windSpeed: payload.hourly.wind_speed_10m[index],
    source: "live-forecast",
  }));
}

function nextFourHours(items, now) {
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);
  const targets = Array.from({ length: 4 }, (_, index) =>
    currentHour.getTime() + (index + 1) * 60 * 60 * 1000,
  );

  return targets.map((target) => {
    const closest = items.reduce((best, item) => {
      const distance = Math.abs(new Date(item.timestamp).getTime() - target);
      return !best || distance < best.distance ? { item, distance } : best;
    }, null);
    return closest?.distance <= 31 * 60 * 1000 ? closest.item : null;
  });
}

function resolveParkStatus(row, now) {
  const openingHour = 10;
  const assumedClosingHour = 18;
  const parkHourParts = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: PARK_TIME_ZONE,
  }).formatToParts(now);
  const parkHour = Number(parkHourParts.find((part) => part.type === "hour")?.value ?? 0);
  const observedAt = row?.observed_at ?? null;
  const ageMinutes = observedAt
    ? Math.max(0, Math.round((now.getTime() - new Date(observedAt).getTime()) / 60000))
    : null;
  const fresh = ageMinutes !== null && ageMinutes <= 20;

  if (!fresh) {
    if (parkHour < openingHour) {
      return { state: "closed", label: "Park geschlossen", detail: "Öffnet um 10 Uhr", observedAt, openingHour, assumedClosingHour };
    }
    if (parkHour >= assumedClosingHour) {
      return { state: "closed", label: "Park geschlossen", detail: "Öffnet wieder um 10 Uhr", observedAt, openingHour, assumedClosingHour };
    }
    return { state: "unknown", label: "Parkstatus unbekannt", label: "Parkstatus unbekannt", detail: "Live-Status wird aktualisiert", observedAt, openingHour, assumedClosingHour };
  }
  if (Number(row.open_ride_count) >= 3) {
    return { state: "open", label: "Park geöffnet", detail: String(row.open_ride_count) + " Attraktionen geöffnet", observedAt, openingHour, assumedClosingHour };
  }
  return {
    state: "closed",
    label: "Park geschlossen",
    detail: parkHour < openingHour ? "Öffnet um 10 Uhr" : "Aktuell geschlossen",
    observedAt,
    openingHour,
    assumedClosingHour,
  };
}

export async function GET() {
  try {
    const now = new Date();
    const databaseWeather = readDatabaseWeather(now);
    let forecast = nextFourHours(databaseWeather.forecast, now);
    let forecastSource = "database";

    if (forecast.some((item) => item === null)) {
      try {
        const fallback = await fetchForecastFallback();
        forecast = nextFourHours(fallback, now);
        forecastSource = "live-forecast";
      } catch {
        forecastSource = "unavailable";
      }
    }

    return Response.json(
      {
        location: "Movie Park Germany",
        timeZone: PARK_TIME_ZONE,
        generatedAt: now.toISOString(),
        current: databaseWeather.current,
        history: databaseWeather.history,
        park: resolveParkStatus(databaseWeather.parkRow, now),
        forecast,
        forecastSource,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return Response.json(
      { error: "Wetterdaten sind gerade nicht verfügbar.", detail: error.message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
