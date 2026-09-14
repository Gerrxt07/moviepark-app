import { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATABASE_PATH = "/opt/moviepark/app/data/moviepark.sqlite";
const TIME_ZONE = "Europe/Berlin";
const LATITUDE = 51.6207;
const LONGITUDE = 6.972;

const CONDITIONS = {
  0: "Klar", 1: "Überwiegend klar", 2: "Teilweise bewölkt", 3: "Bedeckt",
  45: "Nebel", 48: "Raureifnebel", 51: "Leichter Nieselregen", 53: "Nieselregen",
  55: "Starker Nieselregen", 61: "Leichter Regen", 63: "Regen", 65: "Starker Regen",
  71: "Leichter Schneefall", 73: "Schneefall", 75: "Starker Schneefall",
  80: "Leichte Regenschauer", 81: "Regenschauer", 82: "Starke Regenschauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Starkes Gewitter mit Hagel",
};

function conditionGroup(code) {
  if (code == null) return "unknown";
  if (code <= 1) return "clear";
  if (code <= 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "thunder";
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) return "snow";
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) return "rain";
  return "other";
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function percentage(values) {
  const valid = values.filter((value) => typeof value === "boolean");
  return valid.length ? valid.filter(Boolean).length / valid.length * 100 : null;
}

function localDate(timestamp) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(timestamp));
}

function buildAccuracyHistory() {
  const database = new DatabaseSync(DATABASE_PATH, { readOnly: true });
  try {
    const observations = database.prepare(`
      SELECT snapshot_id AS observed_at, temperature_c, apparent_temperature_c,
             precipitation_mm, weather_code, condition, cloud_cover_percent, wind_speed_kmh
      FROM weather_observations
      ORDER BY unixepoch(snapshot_id) ASC
    `).all();
    const forecasts = database.prepare(`
      SELECT snapshot_id, forecast_for, temperature_c, apparent_temperature_c,
             precipitation_probability, precipitation_mm, weather_code, condition,
             cloud_cover_percent, wind_speed_kmh
      FROM weather_forecasts
      ORDER BY unixepoch(snapshot_id) ASC, unixepoch(forecast_for) ASC
    `).all();

    const observationsByDay = new Map();
    for (const observation of observations) {
      const day = localDate(observation.observed_at);
      if (!observationsByDay.has(day)) observationsByDay.set(day, []);
      observationsByDay.get(day).push({ ...observation, epoch: new Date(observation.observed_at).getTime() });
    }

    const firstForecastByTarget = new Map();
    for (const forecast of forecasts) {
      const targetEpoch = new Date(forecast.forecast_for).getTime();
      const targetHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).formatToParts(new Date(targetEpoch)).find((part) => part.type === "hour")?.value);
      if (targetHour < 10 || targetHour > 18) continue;
      const key = forecast.forecast_for;
      if (!firstForecastByTarget.has(key)) firstForecastByTarget.set(key, { ...forecast, targetEpoch });
    }

    const matchesByDay = new Map();
    for (const forecast of firstForecastByTarget.values()) {
      const day = localDate(forecast.forecast_for);
      const dayObservations = observationsByDay.get(day) ?? [];
      let closest = null;
      for (const observation of dayObservations) {
        const distance = Math.abs(observation.epoch - forecast.targetEpoch);
        if (!closest || distance < closest.distance) closest = { observation, distance };
      }
      if (!closest || closest.distance > 20 * 60 * 1000) continue;
      const actual = closest.observation;
      const forecastRain = Number(forecast.precipitation_probability ?? 0) >= 30 || Number(forecast.precipitation_mm ?? 0) >= 0.1;
      const actualRain = Number(actual.precipitation_mm ?? 0) >= 0.1;
      const match = {
        forecastFor: forecast.forecast_for,
        forecastTemperature: forecast.temperature_c,
        actualTemperature: actual.temperature_c,
        temperatureError: Math.abs(Number(forecast.temperature_c) - Number(actual.temperature_c)),
        forecastRain,
        actualRain,
        rainCorrect: forecastRain === actualRain,
        forecastCondition: CONDITIONS[forecast.weather_code] ?? forecast.condition,
        actualCondition: CONDITIONS[actual.weather_code] ?? actual.condition,
        conditionCorrect: conditionGroup(forecast.weather_code) === conditionGroup(actual.weather_code),
      };
      if (!matchesByDay.has(day)) matchesByDay.set(day, []);
      matchesByDay.get(day).push(match);
    }

    return [...matchesByDay.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 7).map(([date, matches]) => ({
      date,
      matchedHours: matches.length,
      temperatureMae: average(matches.map((match) => match.temperatureError)),
      rainAccuracy: percentage(matches.map((match) => match.rainCorrect)),
      conditionAccuracy: percentage(matches.map((match) => match.conditionCorrect)),
      forecastAverage: average(matches.map((match) => Number(match.forecastTemperature))),
      actualAverage: average(matches.map((match) => Number(match.actualTemperature))),
      matches,
    }));
  } finally {
    database.close();
  }
}

async function fetchFullDayForecast() {
  const query = new URLSearchParams({
    latitude: String(LATITUDE), longitude: String(LONGITUDE), timezone: TIME_ZONE,
    hourly: ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "weather_code", "cloud_cover", "wind_speed_10m"].join(","),
    daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "sunrise", "sunset"].join(","),
    current: ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation", "weather_code", "cloud_cover", "wind_speed_10m"].join(","),
    forecast_days: "2",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Open-Meteo request failed: ${response.status}`);
  const payload = await response.json();
  const allHours = payload.hourly.time.map((time, index) => ({
    time,
    temperature: payload.hourly.temperature_2m[index],
    apparentTemperature: payload.hourly.apparent_temperature[index],
    precipitationProbability: payload.hourly.precipitation_probability[index],
    precipitation: payload.hourly.precipitation[index],
    weatherCode: payload.hourly.weather_code[index],
    condition: CONDITIONS[payload.hourly.weather_code[index]] ?? "Unbekannt",
    cloudCover: payload.hourly.cloud_cover[index],
    windSpeed: payload.hourly.wind_speed_10m[index],
  }));
  const buildDay = (index) => {
    const date = payload.daily.time[index];
    return {
      date,
      minimumTemperature: payload.daily.temperature_2m_min[index],
      maximumTemperature: payload.daily.temperature_2m_max[index],
      maximumRainProbability: payload.daily.precipitation_probability_max[index],
      sunrise: payload.daily.sunrise[index],
      sunset: payload.daily.sunset[index],
      hourly: allHours.filter((hour) => hour.time.startsWith(date)),
    };
  };
  return {
    current: {
      timestamp: payload.current.time,
      temperature: payload.current.temperature_2m,
      apparentTemperature: payload.current.apparent_temperature,
      humidity: payload.current.relative_humidity_2m,
      precipitation: payload.current.precipitation ?? 0,
      weatherCode: payload.current.weather_code,
      condition: CONDITIONS[payload.current.weather_code] ?? "Unbekannt",
      cloudCover: payload.current.cloud_cover,
      windSpeed: payload.current.wind_speed_10m,
    },
    today: buildDay(0),
    tomorrow: buildDay(1),
  };
}

export async function GET() {
  try {
    const [forecast, history] = await Promise.all([fetchFullDayForecast(), Promise.resolve(buildAccuracyHistory())]);
    const allMatches = history.flatMap((day) => day.matches);
    return Response.json({
      generatedAt: new Date().toISOString(),
      timeZone: TIME_ZONE,
      source: { name: "Open-Meteo", url: "https://open-meteo.com/", location: "Movie Park Germany / Feldhausen", latitude: LATITUDE, longitude: LONGITUDE },
      current: forecast.current,
      today: forecast.today,
      tomorrow: forecast.tomorrow,
      history,
      accuracySummary: {
        days: history.length,
        matchedHours: allMatches.length,
        temperatureMae: average(allMatches.map((match) => match.temperatureError)),
        rainAccuracy: percentage(allMatches.map((match) => match.rainCorrect)),
        conditionAccuracy: percentage(allMatches.map((match) => match.conditionCorrect)),
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return Response.json({ error: "Detailwetter ist gerade nicht verfügbar.", detail: error.message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
