"use client";

import Image from "next/image";
import attractionImage from "../assets/9ced106408715e7c89b42b82377dd9ff.jpg";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { localeCode } from "../lib/locale";

function WeatherIcon({ code, size = 32 }) {
  const thunder = code >= 95;
  const snow = code >= 71 && code <= 77 || code >= 85 && code <= 86;
  const rain = code >= 51 && code <= 67 || code >= 80 && code <= 82;
  const fog = code === 45 || code === 48;
  const cloudy = code === 3;
  const partlyCloudy = code === 1 || code === 2;

  if (thunder) return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M13 31a9 9 0 0 1 1.5-17.9A13 13 0 0 1 39 19a6 6 0 0 1-1 12H13Z" fill="#e8eef2"/><path d="m25 27-6 11h6l-2 8 9-13h-6l3-6Z" fill="#ffd166"/></svg>;
  if (snow) return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M12 27a8 8 0 0 1 2-15.7A12 12 0 0 1 37 17a5 5 0 0 1 0 10H12Z" fill="#e8eef2"/><g stroke="#8bd7f2" strokeWidth="2.5" strokeLinecap="round"><path d="M16 33v8M12.5 35l7 4M19.5 35l-7 4M32 33v8M28.5 35l7 4M35.5 35l-7 4"/></g></svg>;
  if (rain) return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M11 27a8 8 0 0 1 2-15.7A12 12 0 0 1 37 17a5 5 0 0 1 0 10H11Z" fill="#e8eef2"/><g stroke="#6bc5ee" strokeWidth="3" strokeLinecap="round"><path d="m16 32-2 5M25 32l-2 5M34 32l-2 5"/></g></svg>;
  if (fog) return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><g stroke="#d9e4e8" strokeWidth="3.5" strokeLinecap="round"><path d="M10 19h28M7 26h34M12 33h24"/></g></svg>;
  if (cloudy) return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M11 34a9 9 0 0 1 2-17.7A13 13 0 0 1 38 22a6 6 0 0 1-1 12H11Z" fill="#d9e4e8"/></svg>;
  if (partlyCloudy) return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><circle cx="17" cy="16" r="9" fill="#ffd166"/><path d="M12 35a8 8 0 0 1 2-15.7A12 12 0 0 1 37 25a5 5 0 0 1 0 10H12Z" fill="#e8eef2"/></svg>;
  return <svg className="weather-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="11" fill="#ffd166"/><g stroke="#ffd166" strokeWidth="3" strokeLinecap="round"><path d="M24 4v5M24 39v5M4 24h5M39 24h5M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4"/></g></svg>;
}

function MetricIcon({ type }) {
  if (type === "humidity") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3S6 10 6 15a6 6 0 0 0 12 0c0-5-6-12-6-12Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M9 16a3 3 0 0 0 3 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  if (type === "wind") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h10a3 3 0 1 0-3-3M4 12h15a3 3 0 1 1-3 3M4 16h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  if (type === "cloud") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18a4 4 0 0 1 .8-7.9A6 6 0 0 1 18.3 12 3 3 0 0 1 18 18H6Z" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
  if (type === "rain") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14a4 4 0 0 1 .8-7.9A6 6 0 0 1 18.3 8 3 3 0 0 1 18 14H6Z" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="m8 17-1 3m6-3-1 3m6-3-1 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

function formatHour(timestamp, timeZone) {
  if (!timestamp) return "–";
  return new Intl.DateTimeFormat(localeCode(), { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(timestamp));
}

function ageLabel(timestamp) {
  if (!timestamp) return "Keine Live-Daten";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000));
  return minutes < 1 ? "Gerade aktualisiert" : `Vor ${minutes} Min. aktualisiert`;
}

function collectorAgeLabel(timestamp, now = Date.now()) {
  if (!timestamp) return "Datenstand unbekannt";
  const seconds = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000));
  if (seconds < 10) return "gerade eben";
  if (seconds < 60) return `vor ${seconds} Sekunden`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  const days = Math.floor(hours / 24);
  return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}

function collectorDateLabel(timestamp, timeZone) {
  if (!timestamp) return "Kein Zeitstempel verfügbar";
  return new Intl.DateTimeFormat(localeCode(), { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(timestamp)) + (localeCode() === "en-GB" ? "" : " Uhr");
}

function weatherAdvice(current) {
  if (!current) return { title: "Parkwetter wird geladen", text: "Die aktuellen Bedingungen erscheinen gleich.", tone: "calm" };
  const rainy = current.precipitation > 0 || current.weatherCode >= 51 && current.weatherCode <= 99;
  if (rainy) return { title: "Regen clever nutzen", text: "Shows und Indoor-Attraktionen sind jetzt eine gute Wahl.", tone: "rain" };
  if (current.temperature >= 30) return { title: "Heute wird es heiß", text: "Regelmäßig trinken, Schatten nutzen und Pausen einplanen.", tone: "heat" };
  if (current.windSpeed >= 30) return { title: "Windiger Parktag", text: "Behalte kurzfristige Hinweise bei Outdoor-Attraktionen im Blick.", tone: "wind" };
  return { title: "Gute Bedingungen für den Park", text: "Perfektes Wetter für deine nächste Runde.", tone: "good" };
}

function TrendChart({ items }) {
  const values = items.map((item) => item?.temperature).filter(Number.isFinite);
  if (values.length < 2) return <div className="trend-empty">Trend wird geladen …</div>;
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const range = Math.max(1, max - min);
  const points = items.map((item, index) => {
    if (!item || !Number.isFinite(item.temperature)) return null;
    return {
      x: 26 + index * (448 / Math.max(1, items.length - 1)),
      y: 92 - ((item.temperature - min) / range) * 62,
      temperature: Math.round(item.temperature),
    };
  }).filter(Boolean);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const area = `${path} L${points.at(-1).x},108 L${points[0].x},108 Z`;

  return <svg className="temperature-trend" viewBox="0 0 500 120" role="img" aria-label="Temperaturverlauf für die nächsten Stunden">
    <defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a9a70" stopOpacity=".22"/><stop offset="1" stopColor="#1a9a70" stopOpacity="0"/></linearGradient></defs>
    <path className="trend-area" d={area} />
    <path className="trend-line" d={path} />
    {points.map((point, index) => <g key={`${point.x}-${index}`}><circle className="trend-dot" cx={point.x} cy={point.y} r="4"/><text x={point.x} y={point.y - 10} textAnchor="middle">{point.temperature}°</text></g>)}
  </svg>;
}

function ForecastItem({ item, label, timeZone, current }) {
  return <article className={`forecast-item${current ? " is-now" : ""}`}>
    <span className="forecast-time">{label ?? formatHour(item?.timestamp, timeZone)}</span>
    {item ? <>
      <WeatherIcon code={item.weatherCode} size={current ? 34 : 29} />
      <strong>{Math.round(item.temperature)}°</strong>
      <span className="forecast-rain"><MetricIcon type="humidity" />{Math.round(item.precipitationProbability ?? (item.precipitation > 0 ? 100 : 0))}%</span>
    </> : <><span className="forecast-missing">—</span><strong>—°</strong><span className="forecast-rain">Keine Daten</span></>}
  </article>;
}

export default function WeatherDashboard() {
  const cardRef = useRef(null);
  const modalPanelRef = useRef(null);
  const dragStartY = useRef(0);
  const dragDistance = useRef(0);
  const closeTimer = useRef(null);
  const closingRef = useRef(false);
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsClosing, setDetailsClosing] = useState(false);
  const [ageNow, setAgeNow] = useState(() => Date.now());

  const loadWeather = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch("/api/weather", { cache: "no-store" });
      if (!response.ok) throw new Error("Weather request failed");
      const payload=await response.json();
      setWeather(payload);
      try{localStorage.setItem("moviepark-weather-cache-v1",JSON.stringify(payload));}catch{}
      setError(false);
    } catch {
      setError(true);
      try{const cached=JSON.parse(localStorage.getItem("moviepark-weather-cache-v1"));if(cached)setWeather({...cached,offline:true});}catch{}
    } finally {
      setRefreshing(false);
    }
  }, []);

  const openDetails = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closingRef.current = false;
    setDetailsClosing(false);
    setDetailsOpen(true);
  }, []);

  const closeDetails = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const panel = modalPanelRef.current;
    if (panel) { panel.style.transition = ""; panel.style.transform = ""; }
    setDetailsClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setDetailsOpen(false);
      setDetailsClosing(false);
      closingRef.current = false;
    }, 300);
  }, []);

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  useEffect(() => {
    loadWeather();
    const timer = window.setInterval(() => loadWeather(true), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [loadWeather]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => card.classList.toggle("is-visible", entry.isIntersecting), { threshold: 0.15 });
    observer.observe(card);
    let ticking = false;
    const updateParallax = () => {
      const rect = card.getBoundingClientRect();
      const offset = Math.max(-12, Math.min(12, (window.innerHeight / 2 - (rect.top + rect.height / 2)) * 0.035));
      card.style.setProperty("--weather-scroll", `${offset}px`);
      ticking = false;
    };
    const onScroll = () => { if (!ticking) { ticking = true; window.requestAnimationFrame(updateParallax); } };
    updateParallax();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, []);

  useEffect(() => {
    const staleAfterMs = 60 * 60 * 1000;
    const storageKey = "moviepark-backgrounded-at";
    const markBackgrounded = () => { try { window.localStorage.setItem(storageKey, String(Date.now())); } catch {} };
    const refreshAfterReturn = () => {
      if (document.visibilityState === "hidden") { markBackgrounded(); return; }
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
    const restoreFromCache = (event) => { if (event.persisted) refreshAfterReturn(); };
    document.addEventListener("visibilitychange", refreshAfterReturn);
    window.addEventListener("pagehide", markBackgrounded);
    window.addEventListener("pageshow", restoreFromCache);
    return () => {
      document.removeEventListener("visibilitychange", refreshAfterReturn);
      window.removeEventListener("pagehide", markBackgrounded);
      window.removeEventListener("pageshow", restoreFromCache);
    };
  }, [loadWeather]);

  useEffect(() => {
    if (!detailsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => { if (event.key === "Escape") closeDetails(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [detailsOpen, closeDetails]);

  const handleSheetTouchStart = (event) => {
    const panel = modalPanelRef.current;
    if (!panel || panel.scrollTop > 0) return;
    dragStartY.current = event.touches[0].clientY;
    dragDistance.current = 0;
    panel.style.transition = "none";
  };
  const handleSheetTouchMove = (event) => {
    const panel = modalPanelRef.current;
    if (!panel || !dragStartY.current || panel.scrollTop > 0) return;
    const distance = Math.max(0, event.touches[0].clientY - dragStartY.current);
    dragDistance.current = distance;
    if (distance > 0) event.preventDefault(); panel.style.transform = "translateY(" + distance + "px)";
  };
  const handleSheetTouchEnd = () => {
    const panel = modalPanelRef.current;
    dragStartY.current = 0;
    if (!panel) return;
    if (dragDistance.current >= 90) {
      dragDistance.current = 0;
      closeDetails();
      return;
    }
    dragDistance.current = 0;
    panel.style.transition = "transform .28s cubic-bezier(.22,1,.36,1)";
    panel.style.transform = "translateY(0)";
    window.setTimeout(() => { if (panel) { panel.style.transition = ""; panel.style.transform = ""; } }, 300);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setAgeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const current = weather?.current;
  const timeline = [weather?.history, current, ...(weather?.forecast ?? [])];
  const advice = useMemo(() => weatherAdvice(current), [current]);
  const timeZone = weather?.timeZone ?? "Europe/Berlin";

  return <><section ref={cardRef} className="weather-card weather-card-v2" aria-labelledby="weather-title">
    {weather?.offline?<p className="offline-banner">Offline · Wetterdaten sind nicht live.</p>:null}
    {error && !weather ? <div className="weather-error">Wetterdaten sind gerade nicht erreichbar. Wir versuchen es automatisch erneut.</div> : <>
      <div className="weather-stage" role="button" tabIndex={0} aria-label="Ausführliche Wetterdetails öffnen" onClick={openDetails} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetails(); } }}>
        <div className="weather-stage-top">
          <div><p className="weather-overline">Live Parkwetter</p><h2 id="weather-title">Movie Park Germany</h2></div>
          <button className={`refresh-button weather-refresh${refreshing ? " is-loading" : ""}`} onClick={(event) => { event.stopPropagation(); loadWeather(); }} disabled={refreshing} aria-label="Wetter aktualisieren">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M18.2 9A7 7 0 0 0 6.3 6.3L4 9m2 6a7 7 0 0 0 11.7 2.7L20 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="weather-primary">
          <div className="weather-primary-icon"><WeatherIcon code={current?.weatherCode ?? 3} size={76} /></div>
          <div><div className="weather-primary-temp">{current ? Math.round(current.temperature) : "—"}<sup>°C</sup></div><p>{current?.condition ?? "Wetter wird geladen …"}</p></div>
        </div>

        <div className="weather-glass-metrics">
          <div><span>Gefühlt</span><strong>{current ? `${Math.round(current.apparentTemperature)}°` : "—"}</strong></div>
          <div><span>Wind</span><strong>{current ? `${Math.round(current.windSpeed)} km/h` : "—"}</strong></div>
          <div><span>Luftfeuchte</span><strong>{current?.humidity != null ? `${Math.round(current.humidity)}%` : "—"}</strong></div>
        </div>
      </div>

      <button className="weather-open-details" type="button" onClick={openDetails}><span><strong>{current?.condition ?? "Wetterdetails"}</strong><small>{ageLabel(weather?.generatedAt)}</small></span><span>Details &amp; 4-Stunden-Trend <b aria-hidden="true">→</b></span></button>

      {detailsOpen && createPortal(<div className={"weather-modal-backdrop" + (detailsClosing ? " is-closing" : "")} onMouseDown={closeDetails}><section ref={modalPanelRef} className={"weather-modal-panel" + (detailsClosing ? " is-closing" : "")} role="dialog" aria-modal="true" aria-labelledby="weather-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="weather-modal-head" onTouchStart={handleSheetTouchStart} onTouchMove={handleSheetTouchMove} onTouchEnd={handleSheetTouchEnd}><div><p className="weather-overline">Live Parkwetter</p><h2 id="weather-modal-title">Wetterdetails</h2></div><button type="button" onClick={closeDetails} aria-label="Wetterdetails schließen">×</button></header>

      <div className={`weather-advice is-${advice.tone}`}><span className="advice-symbol"><WeatherIcon code={current?.weatherCode ?? 1} size={28} /></span><div><strong>{advice.title}</strong><p>{advice.text}</p></div><span className="weather-freshness">{ageLabel(current?.timestamp)}</span></div>

      <div className="weather-details-grid">
        <div><span className="metric-symbol"><MetricIcon type="humidity" /></span><span><small>Luftfeuchte</small><strong>{current?.humidity != null ? `${Math.round(current.humidity)}%` : "—"}</strong></span></div>
        <div><span className="metric-symbol"><MetricIcon type="cloud" /></span><span><small>Bewölkung</small><strong>{current?.cloudCover != null ? `${Math.round(current.cloudCover)}%` : "—"}</strong></span></div>
        <div><span className="metric-symbol"><MetricIcon type="rain" /></span><span><small>Niederschlag</small><strong>{current ? `${current.precipitation.toFixed(1)} mm` : "—"}</strong></span></div>
        <div><span className="metric-symbol"><MetricIcon type="wind" /></span><span><small>Wind</small><strong>{current ? `${Math.round(current.windSpeed)} km/h` : "—"}</strong></span></div>
      </div>

      <div className="weather-trend-section">
        <div className="weather-section-title"><div><p className="weather-overline">Temperaturverlauf</p><h3>Letzte Stunde und nächste vier Stunden</h3></div><span>{weather?.forecastSource === "database" ? "Open-Meteo · lokal gespeichert" : "Open-Meteo · aktuell abgerufen"}</span></div>
        <TrendChart items={timeline} />
        <div className="forecast-strip">
          {timeline.map((item, index) => <ForecastItem key={item?.timestamp ?? index} item={item} label={index === 0 ? "–1 Std." : index === 1 ? "Jetzt" : null} timeZone={timeZone} current={index === 1} />)}
        </div>
      </div>

      <p className="weather-source weather-source-v2">Quelle: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo ↗</a> · feste Parkposition Movie Park Germany/Feldhausen (51.6207° N, 6.9720° E) · aktuelle Werte und Vorhersagen können lokal zwischengespeichert werden · <a href="/data-info#quellen">Datenweg erklärt</a></p>
      </section></div>, document.body)}
    </>}
  </section>

  {weather?.park?.state === "closed" ? <section id="attractions" className="attractions-card attractions-card-unavailable" aria-label="Attraktionen bei geschlossenem Park nicht verfügbar">
    <Image className="attractions-card-image" src={attractionImage} alt="" fill sizes="(max-width: 760px) calc(100vw - 30px), 1120px" quality={78} />
    <div className="attractions-card-shade" />
    <div className="attractions-card-copy"><p className="closed-card-kicker">Park geschlossen</p><h2>Attraktionsstatus pausiert</h2><p>Live-Status und Wartezeiten sind wieder verfügbar, sobald der Park öffnet.</p></div>
    <span className="attractions-closed-badge"><i /> Derzeit nicht verfügbar</span>
  </section> : <a id="attractions" className="attractions-card" href="/attractions" aria-label="Attraktionsübersicht öffnen">
      <Image className="attractions-card-image" src={attractionImage} alt="" fill sizes="(max-width: 760px) calc(100vw - 30px), 1120px" quality={78} />
      <div className="attractions-card-shade" />
      <div className="attractions-card-copy"><h2>Was fährt gerade?</h2><p>Live-Status und Wartezeiten auf einen Blick.</p></div>
      <div className="attractions-stats">
        <div><small>Aktuell geöffnet</small><strong>{weather?.attractions ? weather.attractions.openCount : "—"}<span> Attraktionen</span></strong></div>
        <div><small>Ø Wartezeit</small><strong>{weather?.attractions?.averageWaitMinutes ?? "—"}<span> Min.</span></strong></div>
      </div>
      <div className="collector-status"><span><i />Collector · Datenstand</span><strong>{collectorDateLabel(weather?.attractions?.observedAt, timeZone)}</strong><small>{collectorAgeLabel(weather?.attractions?.observedAt, ageNow)}</small></div>
      <span className="attractions-card-action">Attraktionen ansehen <b aria-hidden="true">→</b></span>
    </a>}</>;
}
