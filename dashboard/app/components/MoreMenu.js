"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NotificationControl from "./NotificationControl";
import { readLocale, writeLocale } from "../lib/locale";

function MoreIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>;
}

function WeatherMenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M7 19a4 4 0 0 1 .8-7.9A6 6 0 0 1 19.3 13 3 3 0 0 1 19 19H7Z" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
}

function ReservationIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function ShowsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM8 3v3m8-3v3M8 18v3m8-3v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}

export default function MoreMenu({ active = false }) {
  const [open, setOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [closing, setClosing] = useState(false);
  const [locale, setLocale] = useState("de");
  const dragStart = useRef({ y: 0, time: 0 });

  const closeMenu = () => {
    if (closing) return;
    setClosing(true);
    setDragOffset(0);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, 220);
  };

  const handleTouchStart = (event) => {
    dragStart.current = { y: event.touches[0].clientY, time: Date.now() };
  };

  const handleTouchMove = (event) => {
    const distance = Math.max(0, event.touches[0].clientY - dragStart.current.y);
    if (distance > 0) {
      event.preventDefault();
      setDragOffset(Math.min(distance, 260));
    }
  };

  const handleTouchEnd = () => {
    const elapsed = Math.max(1, Date.now() - dragStart.current.time);
    const fastSwipe = dragOffset > 35 && dragOffset / elapsed > 0.45;
    if (dragOffset >= 80 || fastSwipe) closeMenu();
    else setDragOffset(0);
    dragStart.current = { y: 0, time: 0 };
  };

  useEffect(() => {
    setLocale(readLocale());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const close = (event) => { if (event.key === "Escape") closeMenu(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return <>
    <button className={active ? "active" : ""} type="button" onClick={() => setOpen(true)} aria-label="Mehr öffnen"><MoreIcon /><span>Mehr</span></button>
    {open && createPortal(<div className={`more-menu-backdrop${closing ? " is-closing" : ""}`} onMouseDown={closeMenu}>
      <section className={`more-menu-sheet${dragOffset > 0 ? " is-dragging" : ""}`} style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)`, opacity: Math.max(.72, 1 - dragOffset / 500) } : undefined} role="dialog" aria-modal="true" aria-labelledby="more-menu-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="more-menu-drag-zone" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
          <div className="more-menu-handle" />
          <header><div><p className="eyebrow">Park Guide</p><h2 id="more-menu-title">Mehr entdecken</h2></div><button type="button" onClick={closeMenu} aria-label="Menü schließen">×</button></header>
        </div>
        <nav aria-label="Weitere Bereiche">
          <section className="more-menu-group language-group" aria-labelledby="language-title"><h3 id="language-title">Sprache</h3>
            <div className="language-control">
              <div><strong>App-Sprache auswählen</strong><small>Alle Seiten, Hinweise und dynamischen Statusmeldungen verwenden dieselbe Sprache.</small></div>
              <div className="language-options" role="group" aria-label="App-Sprache auswählen">
                <button type="button" className={locale === "de" ? "is-selected" : ""} aria-pressed={locale === "de"} onClick={() => { if (locale === "de") return; writeLocale("de"); window.location.reload(); }}><span><b>Deutsch</b><small>German</small></span><i>{locale === "de" ? "✓" : ""}</i></button>
                <button type="button" className={locale === "en" ? "is-selected" : ""} aria-pressed={locale === "en"} onClick={() => { if (locale === "en") return; writeLocale("en"); window.location.reload(); }}><span><b>English</b><small>Englisch</small></span><i>{locale === "en" ? "✓" : ""}</i></button>
              </div>
              <p>Die App lädt nach einem Sprachwechsel einmal neu.</p>
            </div>
          </section>
          <section className="more-menu-group" aria-labelledby="more-app-links"><h3 id="more-app-links">Im Park Guide</h3>
            <NotificationControl />
            <Link className="more-menu-item" href="/park-day" onClick={() => setOpen(false)}><span className="more-menu-icon">◎</span><span><strong>Was jetzt?</strong><small>Dein persönlicher Live-Parktag</small></span><b aria-hidden="true">→</b></Link>
            <Link className="more-menu-item" href="/map" onClick={() => setOpen(false)}><span className="more-menu-icon">⌖</span><span><strong>Parkplan</strong><small>Bereiche, Favoriten und Live-Wartezeiten</small></span><b aria-hidden="true">→</b></Link>
            <Link className="more-menu-item" href="/forecast" onClick={() => setOpen(false)}><span className="more-menu-icon">▥</span><span><strong>7-Tage-Prognose</strong><small>Finde den besten Tag für deinen Besuch</small></span><b aria-hidden="true">→</b></Link>
            <Link className="more-menu-item" href="/data-info" onClick={() => setOpen(false)}><span className="more-menu-icon">?</span><span><strong>Daten & Prognosen verstehen</strong><small>Alle Begriffe und Hinweise an einem Ort</small></span><b aria-hidden="true">→</b></Link>
            <Link className="more-menu-item" href="/shows" onClick={() => setOpen(false)}><span className="more-menu-icon"><ShowsIcon /></span><span><strong>Shows & Parade</strong><small>Showzeiten und nächste Vorstellungen</small></span><b aria-hidden="true">→</b></Link>
            <Link className="more-menu-item" href="/weather" onClick={() => setOpen(false)}><span className="more-menu-icon"><WeatherMenuIcon /></span><span><strong>Wetter</strong><small>Parkwetter und Tagesverlauf</small></span><b aria-hidden="true">→</b></Link>
            <Link className="more-menu-item" href="/services" onClick={() => setOpen(false)}><span className="more-menu-icon">i</span><span><strong>Park-Services</strong><small>Hilfe und wichtige Anlaufstellen</small></span><b aria-hidden="true">→</b></Link>
            <Link className="more-menu-item" href="/legal" onClick={() => setOpen(false)}><span className="more-menu-icon">§</span><span><strong>Impressum & Datenschutz</strong><small>Betreiber, Datenverarbeitung und deine Rechte</small></span><b aria-hidden="true">→</b></Link>
          </section>
          <section className="more-menu-group is-external" aria-labelledby="more-web-links"><h3 id="more-web-links">Offizielle Movie Park Links</h3>
            <a className="more-menu-item ticket-menu-item" href="https://www.movieparkgermany.de/oeffnungszeiten-und-preise/preise" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}><span className="more-menu-icon">🎟</span><span><strong>Tickets kaufen</strong><small>Öffnet die offizielle Website</small></span><b aria-hidden="true">↗</b></a>
            <a className="more-menu-item reservation-menu-item" href="https://www.movieparkgermany.de/tickets-kaufen/ich-habe-bereits-ein-ticket" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}><span className="more-menu-icon"><ReservationIcon /></span><span><strong>Besuchstag reservieren</strong><small>Öffnet die offizielle Website</small></span><b aria-hidden="true">↗</b></a>
          </section>
          <div className="more-menu-coming"><span>Weitere Park-Funktionen</span><small>Folgen mit den nächsten Datenbereichen</small></div>
        </nav>
      </section>
    </div>, document.body)}
  </>;
}
