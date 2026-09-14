"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import MoreMenu from "./MoreMenu";
import movieParkLogo from "../assets/movie-park-logo.png";

function Icon({ type }) {
  if (type === "rides") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18.5h18M5.5 18.5v-8l3.2-3.4 3.2 4.1 3.4-7 3.2 6.3v8M8 14.5h8"/><circle cx="8.5" cy="7.4" r="1.4"/><circle cx="15.4" cy="4.5" r="1.4"/></svg>;
  if (type === "shows") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16v12H4zM8 3.5v3m8-3v3M4 10.5h16"/><path d="m10 13 4 2.2-4 2.3z"/></svg>;
  if (type === "home") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 11.2 8.5-7 8.5 7v9H14v-5H10v5H3.5z"/></svg>;
  if (type === "map") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/></svg>;
  if (type === "parkday") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 14.2 9l5.8.5-4.4 3.8 1.4 5.7-5-3-5 3 1.4-5.7L4 9.5 9.8 9 12 3.5Z"/><circle cx="12" cy="12" r="2.2"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5l-7 7 7 7"/></svg>;
}

export function AppHeader({ backHref, title = "Park Guide", home = false }) {
  return <header className={`app-topbar${home ? " is-home" : ""}`}>
    <div className="app-topbar-inner">
      {backHref ? <Link className="app-back" href={backHref} aria-label="Zurück"><Icon type="back"/></Link> : <span className="app-topbar-side"/>}
      <Link className="app-wordmark" href="/" aria-label="Park Guide Startseite"><Image src={movieParkLogo} alt="Movie Park Germany" priority /></Link>
      <span className="app-page-title">{title}</span>
      <span className="app-topbar-side"/>
    </div>
  </header>;
}

export function AppNav({ active = "more" }) {
  const [checkedIn,setCheckedIn]=useState(false);
  useEffect(()=>{const sync=()=>{try{const value=JSON.parse(localStorage.getItem("moviepark-check-in"));setCheckedIn(Boolean(value?.until&&new Date(value.until).getTime()>Date.now()))}catch{setCheckedIn(false)}};sync();const timer=window.setInterval(sync,60000);window.addEventListener("moviepark:checkin",sync);window.addEventListener("focus",sync);return()=>{window.clearInterval(timer);window.removeEventListener("moviepark:checkin",sync);window.removeEventListener("focus",sync)}},[]);
  return <nav className="app-tabbar" aria-label="Hauptnavigation">
    <div className={`app-tabbar-inner${checkedIn?" has-parkday":""}`}>
      <Link className={active === "home" ? "is-active" : ""} href="/"><Icon type="home"/><span>Home</span></Link>
      <Link className={active === "rides" ? "is-active" : ""} href="/attractions"><Icon type="rides"/><span>Rides</span></Link>
      {checkedIn?<Link className={`app-parkday-tab${active==="today"?" is-active":""}`} href="/park-day" aria-label="Live-Parktag öffnen"><span className="app-parkday-live"/><Icon type="parkday"/><span>Parktag</span></Link>:null}
      <Link className={active === "map" ? "is-active" : ""} href="/map"><Icon type="map"/><span>Parkplan</span></Link>
      <MoreMenu active={active === "more"}/>
    </div>
  </nav>;
}
