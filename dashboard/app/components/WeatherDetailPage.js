"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppUpdateWatcher from "./AppUpdateWatcher";
import { localeCode } from "../lib/locale";
import MoreMenu from "./MoreMenu";
import { AppHeader, AppNav } from "./AppChrome";
import movieParkLogo from "../assets/movie-park-logo.png";

function WeatherMark({ code, size = 28 }) {
  const rain = code >= 51 && code <= 99;
  const snow = code >= 71 && code <= 86;
  const cloudy = code === 3 || code === 45 || code === 48;
  if (rain || snow) return <svg className="weather-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><path d="M8 20.5a5.5 5.5 0 0 1 1.3-10.8A8 8 0 0 1 24.6 12a4.3 4.3 0 0 1-.6 8.5H8Z" fill="none" stroke="currentColor" strokeWidth="1.8"/>{snow ? <path d="M11 25h.01M16 25h.01M21 25h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/> : <path d="m11 24-1 3m7-3-1 3m7-3-1 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>}</svg>;
  if (cloudy) return <svg className="weather-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><path d="M7 22a6 6 0 0 1 1.5-11.8A8.5 8.5 0 0 1 25 13a4.5 4.5 0 0 1-1 9H7Z" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
  return <svg className="weather-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16 3v4m0 18v4M3 16h4m18 0h4M7 7l3 3m12 12 3 3m0-18-3 3M10 22l-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(localeCode(), { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(timestamp));
}

function formatDate(date) {
  return new Intl.DateTimeFormat(localeCode(), { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Berlin" }).format(new Date(`${date}T12:00:00+02:00`));
}

function navIcon(type) {
  if (type === "home") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3v-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (type === "shows") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM8 3v3m8-3v3M8 18v3m8-3v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (type === "map") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 18V9l3-3 3 4 3-6 3 5v9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

function FullDayChart({ hours }) {
  const visible = hours.filter((_, index) => index >= 6 && index <= 22);
  const values = visible.map((hour) => hour.temperature);
  if (!values.length) return null;
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const range = Math.max(1, max - min);
  const points = visible.map((hour, index) => ({
    x: 24 + index * (652 / Math.max(1, visible.length - 1)),
    y: 132 - ((hour.temperature - min) / range) * 90,
    hour,
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const area = `${line} L${points.at(-1).x},150 L${points[0].x},150 Z`;
  return <div className="day-chart-wrap"><svg className="day-chart" viewBox="0 0 700 175" role="img" aria-label="Temperaturverlauf des gesamten Tages">
    <defs><linearGradient id="day-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d7a58" stopOpacity=".26"/><stop offset="1" stopColor="#0d7a58" stopOpacity="0"/></linearGradient></defs>
    <path className="day-chart-area" d={area}/><path className="day-chart-line" d={line}/>
    {points.map((point, index) => index % 2 === 0 ? <g key={point.hour.time}><circle cx={point.x} cy={point.y} r="3.5"/><text x={point.x} y={point.y - 10} textAnchor="middle">{Math.round(point.hour.temperature)}°</text><text className="day-chart-time" x={point.x} y="169" textAnchor="middle">{formatTime(point.hour.time)}</text></g> : null)}
  </svg></div>;
}

function AccuracyMetric({ value, suffix, label, inverse = false }) {
  const available = Number.isFinite(value);
  const good = available && (inverse ? value <= 2 : value >= 80);
  return <div className={`accuracy-metric${good ? " is-good" : ""}`}><span>{label}</span><strong>{available ? `${value.toFixed(inverse ? 1 : 0)}${suffix}` : "—"}</strong></div>;
}

function accuracyVerdict(summary) {
  if (!summary?.matchedHours) return { tone: "neutral", title: "Noch keine Bewertung möglich", text: "Für einen fairen Vergleich fehlen noch aufgezeichnete Parkstunden mit Vorhersage und späterem Messwert." };
  const temperature = summary.temperatureMae;
  const rain = summary.rainAccuracy;
  if (temperature <= 1.5 && rain >= 80) return { tone: "good", title: "Die Prognosen waren sehr zuverlässig", text: "Temperatur und Regen wurden in den aufgezeichneten Parkstunden meist treffend vorhergesagt." };
  if (temperature <= 2.5 && rain >= 65) return { tone: "fair", title: "Die Prognosen waren überwiegend passend", text: "Für die Tagesplanung sind die Werte hilfreich, kurzfristige Änderungen bleiben aber möglich." };
  return { tone: "mixed", title: "Die Prognosen lagen zuletzt häufiger daneben", text: "Nutze für deinen Parktag am besten zusätzlich die aktuellen Live-Werte." };
}

function dayAccuracyLabel(day) {
  if (day.temperatureMae <= 1.5 && day.rainAccuracy >= 80) return "Sehr genau";
  if (day.temperatureMae <= 2.5 && day.rainAccuracy >= 65) return "Überwiegend passend";
  return "Durchwachsen";
}

export default function WeatherDetailPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/weather/detail", { cache: "no-store" });
        if (!response.ok) throw new Error("Detail weather failed");
        if (active) { setData(await response.json()); setError(false); }
      } catch { if (active) setError(true); }
    };
    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const nowHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" }).formatToParts(new Date()).find((part) => part.type === "hour")?.value ?? 0);
  const current = data?.current;

  return <div className="weather-detail-app">
    <AppUpdateWatcher />
    <AppHeader backHref="/" title="Wetter" />

    <main className="weather-detail-main">
      <section className="weather-detail-hero">
        <div><p className="eyebrow">Wetter & Prognose</p><h1>Der ganze Parktag.<br/>Stunde für Stunde.</h1><p>Live-Prognose für Movie Park Germany und ein ehrlicher Vergleich mit den bereits aufgezeichneten Wetterdaten.</p></div>
        <div className="detail-current"><span><WeatherMark code={current?.weatherCode} size={34}/></span><strong>{current ? `${Math.round(current.temperature)}°` : "—"}</strong><small>{current?.condition ?? "Wird geladen"} · Live</small></div>
      </section>

      {error && !data ? <div className="detail-error">Die ausführlichen Wetterdaten sind gerade nicht erreichbar.</div> : !data ? <div className="detail-loading">Wetterverlauf wird geladen …</div> : <>
        <section className="detail-section full-day-section">
          <div className="detail-section-head"><div><p className="eyebrow">Heute · {formatDate(data.today.date)}</p><h2>Ganztägige Prognose</h2></div><span className="source-chip">Open-Meteo</span></div>
          <div className="day-summary-grid">
            <div><small>Tiefstwert</small><strong>{Math.round(data.today.minimumTemperature)}°</strong></div><div><small>Höchstwert</small><strong>{Math.round(data.today.maximumTemperature)}°</strong></div><div><small>Max. Regenrisiko</small><strong>{Math.round(data.today.maximumRainProbability)}%</strong></div><div><small>Sonnenuntergang</small><strong>{formatTime(data.today.sunset)}</strong></div>
          </div>
          <FullDayChart hours={data.today.hourly}/>
          <div className="full-hour-strip">
            {data.today.hourly.map((hour) => <article className={Number(hour.time.slice(11,13)) === nowHour ? "is-current" : ""} key={hour.time}><time>{formatTime(hour.time)}</time><span><WeatherMark code={hour.weatherCode}/></span><strong>{Math.round(hour.temperature)}°</strong><small>Regen {Math.round(hour.precipitationProbability)}%</small><small>Wind {Math.round(hour.windSpeed)} km/h</small></article>)}
          </div>
        </section>

        <section className="detail-section tomorrow-section">
          <div className="detail-section-head"><div><p className="eyebrow">Morgen · {formatDate(data.tomorrow.date)}</p><h2>Der nächste Parktag</h2><p>Die wichtigsten Aussichten für morgen, kompakt für deine Planung.</p></div><span className="source-chip">Open-Meteo</span></div>
          <div className="tomorrow-overview">
            <div className="tomorrow-condition"><span><WeatherMark code={data.tomorrow.hourly[12]?.weatherCode ?? data.tomorrow.hourly[0]?.weatherCode} size={38}/></span><div><small>Voraussichtlich</small><strong>{data.tomorrow.hourly[12]?.condition ?? data.tomorrow.hourly[0]?.condition ?? "—"}</strong></div></div>
            <div><small>Temperatur</small><strong>{Math.round(data.tomorrow.minimumTemperature)}° <span>bis</span> {Math.round(data.tomorrow.maximumTemperature)}°</strong></div>
            <div><small>Max. Regenrisiko</small><strong>{Math.round(data.tomorrow.maximumRainProbability)}%</strong></div>
            <div><small>Sonnenuntergang</small><strong>{formatTime(data.tomorrow.sunset)}</strong></div>
          </div>
          <div className="tomorrow-hour-strip">
            {data.tomorrow.hourly.filter((hour) => { const value = Number(hour.time.slice(11,13)); return value >= 9 && value <= 19; }).map((hour) => <article key={hour.time}><time>{formatTime(hour.time)}</time><WeatherMark code={hour.weatherCode}/><strong>{Math.round(hour.temperature)}°</strong><small>{Math.round(hour.precipitationProbability)}% Regen</small></article>)}
          </div>
        </section>

        <section className="detail-section accuracy-section accuracy-simple">
          <div className="detail-section-head"><div><p className="eyebrow">Vorhersage im Rückblick</p><h2>Wie gut passte die Wettervorhersage?</h2><p>Früher gespeicherte Open-Meteo-Vorhersagen werden mit den später für dieselben Parkstunden abgerufenen Wetterwerten verglichen.</p></div><span className="early-data-chip">Mehr Stunden verbessern den Vergleich</span></div>
          {(() => { const verdict = accuracyVerdict(data.accuracySummary); return <div className={`accuracy-verdict is-${verdict.tone}`}><span aria-hidden="true">{verdict.tone === "good" ? "✓" : verdict.tone === "fair" ? "~" : "i"}</span><div><strong>{verdict.title}</strong><p>{verdict.text}</p></div></div>; })()}
          <div className="accuracy-overview accuracy-overview-simple">
            <div><small>Temperatur im Schnitt</small><strong>± {data.accuracySummary.temperatureMae?.toFixed(1) ?? "—"}°</strong><p>Kleiner ist besser</p></div>
            <div><small>Regen richtig erkannt</small><strong>{data.accuracySummary.rainAccuracy?.toFixed(0) ?? "—"}%</strong><p>Höher ist besser</p></div>
            <div><small>Datengrundlage</small><strong>{data.accuracySummary.matchedHours}</strong><p>Stunden aus {data.accuracySummary.days} Tagen</p></div>
          </div>
          <div className="accuracy-simple-list">
            <div className="accuracy-simple-head"><strong>Letzte aufgezeichnete Tage</strong><small>Vorhersage ↔ Messung</small></div>
            {data.history.length ? data.history.map((day) => <article key={day.date}>
              <div><strong>{formatDate(day.date)}</strong><small>{day.matchedHours} verglichene Stunden</small></div>
              <span className="accuracy-day-rating">{dayAccuracyLabel(day)}</span>
              <dl><div><dt>Temperatur</dt><dd>± {day.temperatureMae?.toFixed(1) ?? "—"}°</dd></div><div><dt>Regen</dt><dd>{day.rainAccuracy?.toFixed(0) ?? "—"}% richtig</dd></div><div><dt>Wetterlage</dt><dd>{day.conditionAccuracy?.toFixed(0) ?? "—"}% richtig</dd></div></dl>
            </article>) : <p className="no-history">Noch nicht genug vergleichbare Tage vorhanden.</p>}
          </div>
          <p className="accuracy-note">Die Bewertung ist ein transparenter Zwischenstand. Mit jedem aufgezeichneten Parktag wird sie aussagekräftiger.</p>
        </section>

        <footer className="weather-data-footer">Datenquelle: <a href={data.source.url} target="_blank" rel="noopener noreferrer">Open-Meteo ↗</a> · {data.source.location} ({data.source.latitude}° N, {data.source.longitude}° E) · Historische Vergleiche aus dem lokalen Movie-Park-Datenspeicher</footer>
      </>}
    </main>

    <AppNav active="more" />
  </div>;
}
