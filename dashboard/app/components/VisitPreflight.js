"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { storedFavoriteIds } from "../lib/pushPreferences";

const CHECKIN_KEY="moviepark-check-in";
const activeCheckIn=()=>{try{const value=JSON.parse(localStorage.getItem(CHECKIN_KEY));return Boolean(value?.until&&new Date(value.until)>new Date())}catch{return false}};

export default function VisitPreflight(){
  const[server,setServer]=useState(null),[expanded,setExpanded]=useState(false),[client,setClient]=useState({secure:false,gps:"unknown",push:"unknown",pwa:false,checkIn:false,favorites:0});
  const load=useCallback(async()=>{try{const response=await fetch("/api/preflight",{cache:"no-store"});setServer(await response.json())}catch{setServer({serverReady:false})}
    let gps="unavailable";if(window.isSecureContext&&navigator.geolocation){try{gps=(await navigator.permissions?.query({name:"geolocation"}))?.state||"available"}catch{gps="available"}}
    setClient({secure:window.isSecureContext,gps,push:"Notification" in window?Notification.permission:"unavailable",pwa:window.matchMedia("(display-mode: standalone)").matches||Boolean(navigator.standalone),checkIn:activeCheckIn(),favorites:storedFavoriteIds().length});
  },[]);
  useEffect(()=>{load();const sync=()=>load();window.addEventListener("moviepark:checkin",sync);window.addEventListener("focus",sync);return()=>{window.removeEventListener("moviepark:checkin",sync);window.removeEventListener("focus",sync)}},[load]);
  const checks=useMemo(()=>[
    {label:"Live-Daten",ok:Boolean(server?.snapshot?.freshEnough),detail:server?.snapshot?server.snapshot.collectionExpected?(server.snapshot.ageMinutes<=0?"gerade aktualisiert":`vor ${server.snapshot.ageMinutes} Min.`):"Collector pausiert planmäßig außerhalb der Öffnung":"nicht erreichbar"},
    {label:"Prognosen",ok:Boolean(server?.forecast),detail:server?.forecast?`${server.forecast.quality?.trainingDays||0} Vergleichstage · ${server.forecast.modelVersion}`:"nicht verfügbar"},
    {label:"Sichere Verbindung",ok:client.secure,detail:client.secure?"HTTPS aktiv":"HTTPS erforderlich"},
    {label:"Standort",ok:["granted","prompt","available"].includes(client.gps),detail:client.gps==="granted"?"freigegeben":client.gps==="denied"?"in Einstellungen blockiert":"wird im Park angefragt"},
    {label:"Benachrichtigungen",ok:client.push==="granted",optional:true,detail:client.push==="granted"?"aktiv":client.push==="denied"?"blockiert":"noch nicht aktiviert"},
    {label:"Favoriten",ok:client.favorites>0,optional:true,detail:client.favorites?`${client.favorites} ausgewählt`:"noch keine ausgewählt"},
  ],[server,client]);
  const blockers=checks.filter(item=>!item.ok&&!item.optional),ready=Boolean(server?.serverReady)&&blockers.length===0;
  return <section className={`visit-preflight ${ready?"is-ready":"is-action"}`} aria-label="Besuchsbereitschaft">
    <button type="button" className="visit-preflight-summary" onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}><span className="visit-preflight-mark">{ready?"✓":"!"}</span><span><small>Parktag-Check</small><strong>{ready?"Bereit für deinen Parktag":`${blockers.length||1} Punkt${blockers.length===1?"":"e"} prüfen`}</strong><em>{server?.calendar?.isOpen?`${String(Math.floor(server.calendar.opensMinute/60)).padStart(2,"0")}:${String(server.calendar.opensMinute%60).padStart(2,"0")}–${String(Math.floor(server.calendar.closesMinute/60)).padStart(2,"0")}:${String(server.calendar.closesMinute%60).padStart(2,"0")} Uhr${server.calendar.eventName?` · ${server.calendar.eventName}`:""}`:"Live-Daten, Standort und Planung auf einen Blick"}</em></span><b>{expanded?"−":"+"}</b></button>
    {expanded?<div className="visit-preflight-details">{checks.map(item=><article className={item.ok?"is-ok":item.optional?"is-optional":"is-missing"} key={item.label}><i>{item.ok?"✓":item.optional?"○":"!"}</i><span><strong>{item.label}</strong><small>{item.detail}</small></span></article>)}<div className="visit-preflight-actions"><button type="button" onClick={load}>Erneut prüfen</button>{!client.checkIn?<span>Check-in ist erst während der Parköffnung möglich.</span>:<Link href="/park-day">Parktag öffnen →</Link>}</div></div>:null}
  </section>;
}
