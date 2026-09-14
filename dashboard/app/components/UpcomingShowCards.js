"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { parkMinutes, SHOW_PROGRAMME, timeMinutes } from "../data/showProgramme";

function upcomingShows(now) {
  const currentMinutes = parkMinutes(new Date(now));
  return SHOW_PROGRAMME.flatMap((show) => show.times.map((time) => ({
    ...show,
    time,
    startsAtMinute: timeMinutes(time),
  }))).map((show) => {
    const minutesUntil = show.startsAtMinute - currentMinutes;
    const minutesRemaining = show.startsAtMinute + show.duration - currentMinutes;
    return { ...show, minutesUntil, minutesRemaining, ongoing: minutesUntil <= 0 && minutesRemaining > 0 };
  }).filter((show) => show.ongoing || (show.minutesUntil > 0 && show.minutesUntil <= 45))
    .sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || a.startsAtMinute - b.startsAtMinute);
}

export default function UpcomingShowCards() {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 15_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pageshow", update);
    };
  }, []);

  const upcoming = useMemo(() => now ? upcomingShows(now) : [], [now]);

  if (!upcoming.length) return null;
  return <section className="show-alerts" aria-labelledby="show-alert-title">
    <div className="show-alerts-head">
      <div><p className="eyebrow">Aktuell & gleich im Park</p><h2 id="show-alert-title">Dein Showprogramm</h2></div>
      <Link href="/shows">Alle Zeiten <span aria-hidden="true">→</span></Link>
    </div>
    <div className="show-alert-grid">
      {upcoming.map((show) => <Link className={`show-alert-card is-${show.tone}${show.ongoing ? " is-ongoing" : ""}`} href={`/shows#${show.id}`} key={`${show.id}-${show.time}`}>
        <span className="show-alert-countdown">{show.ongoing ? <><b>Live</b><small>noch<br />{show.minutesRemaining} Min.</small></> : <><b>{show.minutesUntil}</b> Min.</>}</span>
        <div><small>{show.ongoing ? "Läuft jetzt" : show.type} · {show.location}</small><strong>{show.title}</strong><p>{show.ongoing ? `Läuft seit ${show.time} Uhr und endet voraussichtlich in ${show.minutesRemaining} Minuten.` : `Beginnt um ${show.time} Uhr. Plane jetzt deinen Weg dorthin.`}</p></div>
        <span className="show-alert-arrow" aria-hidden="true">→</span>
      </Link>)}
    </div>
  </section>;
}
