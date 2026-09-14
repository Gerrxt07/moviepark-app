"use client";

import { useCallback, useEffect, useState } from "react";

function WeatherIcon({ code, size = 32 }) {
  const isThunder = code >= 95;
  const isSnow = code >= 71 && code <= 86;
  const isRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  const isFog = code === 45 || code === 48;
  const isCloudy = code === 2 || code === 3;
  const isPartlyCloudy = code === 1 || code === 2;

  if (isThunder) {
    return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M13 31a9 9 0 0 1 1.5-17.9A13 13 0 0 1 39 19a6 6 0 0 1-1 12H13Z" fill="#dce6ee"/><path d="m25 27-6 11h6l-2 8 9-13h-6l3-6Z" fill="#ffb703"/></svg>;
  }
  if (isSnow) {
    return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M12 27a8 8 0 0 1 2-15.7A12 12 0 0 1 37 17a5 5 0 0 1 0 10H12Z" fill="#dce6ee"/><g stroke="#66b9df" strokeWidth="2.5" strokeLinecap="round"><path d="M16 33v8M12.5 35l7 4M19.5 35l-7 4M32 33v8M28.5 35l7 4M35.5 35l-7 4"/></g></svg>;
  }
  if (isRain) {
    return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M11 27a8 8 0 0 1 2-15.7A12 12 0 0 1 37 17a5 5 0 0 1 0 10H11Z" fill="#dce6ee"/><g stroke="#2386b8" strokeWidth="3" strokeLinecap="round"><path d="m16 32-2 5M25 32l-2 5M34 32l-2 5"/></g></svg>;
  }
  if (isFog) {
    return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M10 19h28M7 26h34M12 33h24" stroke="#93a5af" strokeWidth="3.5" strokeLinecap="round"/></svg>;
  }
  if (isCloudy) {
    return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M11 34a9 9 0 0 1 2-17.7A13 13 0 0 1 38 22a6 6 0 0 1-1 12H11Z" fill="#c9d7df"/></svg>;
  }
  if (isPartlyCloudy) {
    return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><circle cx="17" cy="16" r="9" fill="#ffca3a"/><path d="M12 35a8 8 0 0 1 2-15.7A12 12 0 0 1 37 25a5 5 0 0 1 0 10H12Z" fill="#dce6ee"/></svg>;
  }
  return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="11" fill="#ffca3a"/><g stroke="#ffca3a" strokeWidth="3" strokeLinecap="round"><path d="M24 4v5M24 39v5M4 24h5M39 24h5M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4"/></g></svg>;
}

function DropletIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3S6 10 6 15a6 6 0 0 0 12 0c0-5-6-12-6-12Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M9 16a3 3 0 0 0 3 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

function WindIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h10a3 3 0 1 0-3-3M4 12h15a3 3 0 1 1-3 3M4 16h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

function formatHour(timestamp, timeZone) {
  if (!timestamp) return "–";
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(timestamp));
}

function ageLabel(timestamp) {
  if (!timestamp) return "Keine Live-Daten";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000));
  return minutes < 1 ? "Gerade aktualisiert" : `Vor ${minutes} Min. aktualisiert`;
}

function HourTile({ item, label, timeZone, current = false }) {
  return <article className={`hour-tile${current ? " is-current" : ""}`}>
    <span className="hour-label">{label ?? formatHour(item?.timestamp, timeZone)}</span>
    {item ? <>
      <WeatherIcon code={item.weatherCode} size={current ? 38 : 30} />
      <strong>{Math.round(item.temperature)}°</strong>
      <span className="rain-chance"><DropletIcon /> {Math.round(item.precipitationProbability ?? (item.precipitation > 0 ? 100 : 0))}%</span>
    </> : <><span className="weather-placeholder">—</span><strong>—°</strong><span className="rain-chance">Keine Daten</span></>}
  </article>;
}

export default function WeatherDashboard() {
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadWeather = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch("/api/weather", { cache: "no-store" });
      if (!response.ok) throw new Error("Weather request failed");
      setWeather(await response.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadWeather();
    const timer = window.setInterval(() => loadWeather(true), 60_000);
    return () => window.clearInterval(timer);
  }, [loadWeather]);

  useEffect(() => {
    const staleAfterMs = 60 * 60 * 1000;
    const storageKey = "moviepark-backgrounded-at";

    const markBackgrounded = () => {
      try { window.localStorage.setItem(storageKey, String(Date.now())); } catch {}
    };

    const refreshAfterReturn = () => {
      if (document.visibilityState === "hidden") {
        markBackgrounded();
        return;
      }

      let backgroundedAt = 0;
      try { backgroundedAt = Number(window.localStorage.getItem(storageKey) ?? 0); } catch {}
      if (backgroundedAt > 0 && Date.now() - backgroundedAt >= staleAfterMs) {
        try { window.localStorage.setItem(storageKey, String(Date.now())); } catch {}
        window.location.reload();
        return;
      }

      loadWeather(true);
      window.dispatchEvent(new Event("moviepark:refresh"));
    };

    const restoreFromCache = (event) => {
      if (event.persisted) refreshAfterReturn();
    };

    document.addEventListener("visibilitychange", refreshAfterReturn);
    window.addEventListener("pagehide", markBackgrounded);
    window.addEventListener("pageshow", restoreFromCache);
    return () => {
      document.removeEventListener("visibilitychange", refreshAfterReturn);
      window.removeEventListener("pagehide", markBackgrounded);
      window.removeEventListener("pageshow", restoreFromCache);
    };
  }, [loadWeather]);

  const current = weather?.current;
  const timeline = [weather?.history, current, ...(weather?.forecast ?? [])];

  return <section className="weather-card" aria-labelledby="weather-title">
    <div className="weather-card-head">
      <div>
        <p className="eyebrow">Wetter im Park</p>
        <h2 id="weather-title">Dein Tag auf einen Blick</h2>
      </div>
      <button className={`refresh-button${refreshing ? " is-loading" : ""}`} onClick={() => loadWeather()} disabled={refreshing} aria-label="Wetter aktualisieren">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M18.2 9A7 7 0 0 0 6.3 6.3L4 9m2 6a7 7 0 0 0 11.7 2.7L20 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
    </div>

    {error && !weather ? <div className="weather-error">Wetterdaten sind gerade nicht erreichbar. Wir versuchen es automatisch erneut.</div> : <>
      <div className="weather-now">
        <div className="current-condition">
          <div className="current-icon"><WeatherIcon code={current?.weatherCode ?? 3} size={64} /></div>
          <div>
            <div className="current-temp">{current ? Math.round(current.temperature) : "—"}<sup>°C</sup></div>
            <p>{current?.condition ?? "Wetter wird geladen …"}</p>
          </div>
        </div>
        <div className="weather-facts">
          <div><span>Gefühlt</span><strong>{current ? `${Math.round(current.apparentTemperature)}°` : "—"}</strong></div>
          <div><span><DropletIcon /> Regen</span><strong>{current ? `${current.precipitation.toFixed(1)} mm` : "—"}</strong></div>
          <div><span><WindIcon /> Wind</span><strong>{current ? `${Math.round(current.windSpeed)} km/h` : "—"}</strong></div>
        </div>
      </div>

      <div className="timeline-head">
        <span>{ageLabel(current?.timestamp)}</span>
        <span>4-Stunden-Ausblick</span>
      </div>
      <div className="hourly-strip">
        {timeline.map((item, index) => <HourTile key={item?.timestamp ?? index} item={item} label={index === 0 ? "Vor 1 Std." : index === 1 ? "Jetzt" : null} timeZone={weather?.timeZone ?? "Europe/Berlin"} current={index === 1} />)}
      </div>
      <p className="weather-source">Live-Messung aus den Parkdaten · Prognose {weather?.forecastSource === "database" ? "aus dem Datenspeicher" : "live aktualisiert"}</p>
    </>}
  </section>;
}
