"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MoreMenu from "./MoreMenu";
import { AppHeader, AppNav } from "./AppChrome";
import movieParkLogo from "../assets/movie-park-logo.png";
import stuntShowImage from "../assets/operationredcarpet.jpg";
import paradeImage from "../assets/Parade.jpg";
import { parkMinutes, SHOW_PROGRAMME, timeMinutes } from "../data/showProgramme";

const SHOW_IMAGES = {
  "operation-red-carpet": stuntShowImage,
  "parade-of-celebration": paradeImage,
};

function NavIcon({ type }) {
  if (type === "shows") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM8 3v3m8-3v3M8 18v3m8-3v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (type === "rides") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 18V9l3-3 3 4 3-6 3 5v9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3v-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}

export default function ShowsPage() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pageshow", update);
    };
  }, []);
  const currentMinutes = useMemo(() => now ? parkMinutes(new Date(now)) : null, [now]);
  const occurrences = useMemo(() => SHOW_PROGRAMME.flatMap((show) =>
    show.times.map((time) => ({ ...show, time, startsAtMinute: timeMinutes(time) })),
  ).sort((a, b) => a.startsAtMinute - b.startsAtMinute), []);
  const next = currentMinutes === null ? null : occurrences.find((item) => item.startsAtMinute > currentMinutes);
  const programmeDone = currentMinutes !== null && occurrences.length > 0
    && occurrences.every((item) => item.startsAtMinute + item.duration <= currentMinutes);

  return <div className="shows-app">
    <AppHeader backHref="/" title="Shows" />
    <main className="shows-main">
      <section className="shows-hero">
        <div><p className="eyebrow">Shows & Parade</p><h1>Heute auf dem Drehplan.</h1><p>Die aktuell hinterlegten regulären Programmpunkte kompakt an einem Ort.</p></div>
      </section>

      <section className="programme-update" aria-label="Hinweis zum Showprogramm"><strong>Programm aktualisiert</strong><p>„100 Years Houdini“ endete laut Movie Park am 30. August 2026 und wird nicht mehr als heutige Show angezeigt. Tageszeiten können sich ändern – verbindlich sind die Anzeigen im Park und die offizielle Movie-Park-App.</p></section>

      {programmeDone && <section className="shows-complete" aria-labelledby="shows-complete-title">
        <span className="shows-complete-mark" aria-hidden="true">✓</span>
        <div><p className="eyebrow">Das war’s für heute</p><h2 id="shows-complete-title">Der letzte Vorhang ist gefallen.</h2><p>Alle Shows und die Parade sind für heute beendet. Morgen wartet ein neuer Drehplan auf dich.</p></div>
        <Link href="/">Zurück zur Übersicht <span aria-hidden="true">→</span></Link>
      </section>}

      <div className={`programme-list${programmeDone ? " is-complete" : ""}`}>
        {SHOW_PROGRAMME.map((show, index) => <article id={show.id} className={`programme-card is-${show.tone}`} key={show.id}>
          <div className="programme-visual">
            <Image className="programme-image" src={SHOW_IMAGES[show.id]} alt="" fill sizes="(max-width: 760px) calc(100vw - 30px), 380px" quality={82} />
            <div className="programme-image-shade" />
            <b>0{index + 1}</b>
          </div>
          <div className="programme-content">
            <div className="programme-meta"><span>{show.type}</span><span>{show.duration} Min.</span></div>
            <h2>{show.title}</h2>
            <p>{show.description}</p>
            <div className="programme-location"><span aria-hidden="true">⌖</span><strong>{show.location}</strong></div>
            <div className="programme-times" aria-label={`Spielzeiten: ${show.times.join(", ")}`}>
              {show.times.map((time) => {
                const startsAtMinute = timeMinutes(time);
                const ongoing = currentMinutes !== null && currentMinutes >= startsAtMinute && currentMinutes < startsAtMinute + show.duration;
                const passed = currentMinutes !== null && currentMinutes >= startsAtMinute + show.duration;
                const stateClass = ongoing ? "is-ongoing" : passed ? "is-passed" : next?.id === show.id && next?.time === time ? "is-next" : "";
                return <span className={stateClass} key={time}><b>{time}</b><small>Uhr</small>{ongoing ? <em>● Läuft jetzt</em> : passed ? <em>✓ Vorbei</em> : null}</span>;
              })}
            </div>
          </div>
        </article>)}
      </div>
      <p className="programme-note">Stand: 31. August 2026. Quelle für Programmzeiträume: Movie Park Germany. Die hier hinterlegten Uhrzeiten sind eine Planungshilfe; Anzeigen im Park und die offizielle App haben Vorrang.</p>
    </main>
    <AppNav active="shows" />
  </div>;
}
