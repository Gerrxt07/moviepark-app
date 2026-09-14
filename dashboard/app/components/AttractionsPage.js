"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import MoreMenu from "./MoreMenu";
import { AppHeader, AppNav } from "./AppChrome";
import { syncPushPreferences } from "../lib/pushPreferences";
import { localeCode } from "../lib/locale";
import movieParkLogo from "../assets/movie-park-logo.png";
import area51Image from "../assets/attraktionen/area51.jpeg";
import banditImage from "../assets/attraktionen/bandit.jpg";
import excaliburImage from "../assets/attraktionen/excalibur.jpg";
import ghostChasersImage from "../assets/attraktionen/ghostchaser.jpg";
import ironClawImage from "../assets/attraktionen/ironclaw.jpg";
import nycTransformerImage from "../assets/attraktionen/nyctransformer.jpg";
import starTrekImage from "../assets/attraktionen/startrek.jpg";
import vanHelsingImage from "../assets/attraktionen/vanhelsing.jpg";

import airGliderImage from "../assets/attraktionen/airglider.jpg";
import missionToMarsImage from "../assets/attraktionen/missiontomars.jpg";
import fairySpinImage from "../assets/attraktionen/fairyspin.jpg";
import atomicFlyerImage from "../assets/attraktionen/atomicflyer.jpg";
import splashBattleImage from "../assets/attraktionen/splashbattle.jpg";
import splatOSphereImage from "../assets/attraktionen/splatosphere.jpg";
import highFallImage from "../assets/attraktionen/highfall.jpg";
import doraImage from "../assets/attraktionen/dora.jpg";
import crazySurferImage from "../assets/attraktionen/crazysurfer.jpg";
import forbiddenChamberImage from "../assets/attraktionen/journytotheforbiddenchamber.jpg";
import studioTourImage from "../assets/attraktionen/studiotour.jpg";
import pawPatrolAdventureImage from "../assets/attraktionen/pawpatroladventure.jpg";
import pierSideCarouselImage from "../assets/attraktionen/piersidecarousel.jpg";
import rescue112Image from "../assets/attraktionen/rescue112.jpg";
import santaMonicaWheelImage from "../assets/attraktionen/santamonicawheel.jpg";
import seaSwingImage from "../assets/attraktionen/seaswing.jpg";
import sideKickImage from "../assets/attraktionen/sidekick.jpg";
import zumaZoomersImage from "../assets/attraktionen/zumazoomers.jpg";
import skyeHighFlyerImage from "../assets/attraktionen/skyhighflyer.jpg";
import stormyCruiseImage from "../assets/attraktionen/stormycruise.jpg";
import licenseToDriveImage from "../assets/attraktionen/licensetodrive.jpg";
import timeRidersImage from "../assets/attraktionen/timeriders.jpg";
const FAVORITES_KEY = "moviepark-attraction-favorites";
const SYNC_KEY = "moviepark-favorites-sync-token";
const ATTRACTIONS_CACHE_KEY = "moviepark-attractions-cache-v1";
const VIEW_STATE_KEY = "moviepark-attractions-view-v1";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
function syncTokenFromValue(value) {
  const input = String(value ?? "").trim();
  if (TOKEN_PATTERN.test(input)) return input;
  try {
    const url = new URL(input, window.location.origin);
    const token = new URLSearchParams(url.hash.slice(1)).get("sync") || url.searchParams.get("sync") || "";
    return TOKEN_PATTERN.test(token) ? token : "";
  } catch { return ""; }
}

function pairingCodeFromValue(value) {
  const input = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z2-9]{8}$/.test(input) ? input : "";
}

function decodeQrCanvas(sourceCanvas) {
  const cropRatios = [1, .85, .7, .55, .4, .28];
  for (const ratio of cropRatios) {
    const sourceWidth = Math.max(1, Math.round(sourceCanvas.width * ratio));
    const sourceHeight = Math.max(1, Math.round(sourceCanvas.height * ratio));
    const sourceX = Math.round((sourceCanvas.width - sourceWidth) / 2);
    const sourceY = Math.round((sourceCanvas.height - sourceHeight) / 2);
    const maximumSide = 1400;
    const scale = Math.min(1, maximumSide / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.drawImage(sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    if (result?.data) return result.data;
  }
  return "";
}

const ATTRACTION_IMAGES = {
  10981: area51Image,
  10983: splashBattleImage,
  10989: highFallImage,
  10992: fairySpinImage,
  10995: doraImage,
  10996: airGliderImage,
  11001: atomicFlyerImage,
  11002: missionToMarsImage,
  11005: splatOSphereImage,
  10982: ironClawImage,
  10984: starTrekImage,
  10985: excaliburImage,
  10987: banditImage,
  10997: ghostChasersImage,
  10999: nycTransformerImage,
  11000: vanHelsingImage,
  11007: crazySurferImage,
  16233: forbiddenChamberImage,
  10993: studioTourImage,
  10994: pawPatrolAdventureImage,
  10988: pierSideCarouselImage,
  11006: rescue112Image,
  10998: santaMonicaWheelImage,
  11008: seaSwingImage,
  11004: sideKickImage,
  10990: zumaZoomersImage,
  10991: skyeHighFlyerImage,
  11011: stormyCruiseImage,
  11010: licenseToDriveImage,
  11009: timeRidersImage,
};

function FavoriteIcon({ active }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>; }

function NavIcon({ type }) {
  if (type === "shows") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM8 3v3m8-3v3M8 18v3m8-3v3M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (type === "rides") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 18V9l3-3 3 4 3-6 3 5v9M8 14h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (type === "map") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3v-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}

function relativeAge(timestamp, now) {
  if (!timestamp) return "Datenstand unbekannt";
  const seconds = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return seconds < 10 ? "gerade eben" : `vor ${seconds} Sekunden`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
  const hours = Math.floor(minutes / 60);
  return `vor ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
}


function statusLabel(ride) {
  if (!ride.sourceFresh) return "Nicht aktuell";
  if (ride.status === "open") return "Geöffnet";
  if (ride.status === "closed") return "Geschlossen";
  return "Status unbekannt";
}

export default function AttractionsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState("recommended");
  const [typeFilter, setTypeFilter] = useState("all");
  const [favorites, setFavorites] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [syncToken, setSyncToken] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncCode, setSyncCode] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [qrImage, setQrImage] = useState("");
  const [qrScanning, setQrScanning] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = useState("");
  const qrFileRef = useRef(null);
  const favoritesListRef = useRef(null);
  const restoredViewRef = useRef(false);

  const saveViewState = useCallback(() => {
    try { sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ scrollY: window.scrollY, favoritesScrollLeft: favoritesListRef.current?.scrollLeft || 0, query, statusFilter, sortMode, typeFilter, savedAt: Date.now() })); } catch {}
  }, [query,statusFilter,sortMode,typeFilter]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/attractions", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setData(payload);
      try { localStorage.setItem(ATTRACTIONS_CACHE_KEY, JSON.stringify(payload)); } catch {}
      setError(false);
    } catch {
      setError(true);
      try { const cached = JSON.parse(localStorage.getItem(ATTRACTIONS_CACHE_KEY)); if (cached) setData({ ...cached, offline: true }); } catch {}
    }
  }, []);

  const connectToken = useCallback(async (token, localFavorites = []) => {
    if (!TOKEN_PATTERN.test(token)) throw new Error("Der Sync-Schlüssel ist ungültig.");
    const response = await fetch("/api/favorites-sync", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Sync konnte nicht geladen werden.");
    const merged = [...new Set([...payload.favorites, ...localFavorites])];
    if (merged.length !== payload.favorites.length) await fetch("/api/favorites-sync", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ favorites: merged }) });
    localStorage.setItem(SYNC_KEY, token);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(merged));
    setSyncToken(token); setFavorites(merged);
    return merged;
  }, []);

  const connectPairingCode = useCallback(async (code, localFavorites = []) => {
    const response = await fetch("/api/favorites-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: code }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Pairing-Code konnte nicht verbunden werden.");
    return connectToken(payload.token, localFavorites);
  }, [connectToken]);

  useEffect(() => {
    let localFavorites = [];
    try { localFavorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); setFavorites(localFavorites); } catch {}
    let token = "";
    try {
      const fragment = new URLSearchParams(location.hash.slice(1));
      const pair = fragment.get("pair") || "";
      token = fragment.get("sync") || localStorage.getItem(SYNC_KEY) || "";
      if (fragment.has("sync")) history.replaceState(null, "", location.pathname + location.search);
      if (pair) {
        history.replaceState(null, "", location.pathname + location.search);
        connectPairingCode(pair, localFavorites).then(() => setSyncMessage("Favoriten wurden verbunden.")).catch((err) => { setSyncMessage(err.message); setSyncOpen(true); });
      }
    } catch {}
    if (token) connectToken(token, localFavorites).then(() => setSyncMessage("Favoriten wurden verbunden.")).catch((err) => { setSyncMessage(err.message); setSyncOpen(true); });
    load();
    const refresh = window.setInterval(load, 60000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(refresh); window.clearInterval(clock); };
  }, [load, connectToken, connectPairingCode]);

  useEffect(() => {
    try {
      const saved=JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY)||"null");
      if(saved){setQuery(saved.query||"");setStatusFilter(saved.statusFilter||"all");setSortMode(saved.sortMode||"recommended");setTypeFilter(saved.typeFilter||"all");}
    } catch {}
  }, []);

  useEffect(() => {
    const persist=()=>saveViewState();
    window.addEventListener("pagehide",persist);
    return()=>{persist();window.removeEventListener("pagehide",persist);};
  },[saveViewState]);

  useEffect(() => {
    if (!syncToken) return;
    const refresh = async () => { try {
      const response = await fetch("/api/favorites-sync", { headers: { Authorization: `Bearer ${syncToken}` }, cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      setFavorites(payload.favorites); localStorage.setItem(FAVORITES_KEY, JSON.stringify(payload.favorites));
    } catch {} };
    const handleActive = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 2500);
    document.addEventListener("visibilitychange", handleActive);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", handleActive); window.removeEventListener("focus", refresh); };
  }, [syncToken]);

  useEffect(() => {
    if (!syncOpen || !pairingCode) { setQrImage(""); return; }
    const shareUrl = `${location.origin}/attractions#pair=${pairingCode}`;
    QRCode.toDataURL(shareUrl, { width: 260, margin: 4, errorCorrectionLevel: "M", color: { dark: "#123d30", light: "#ffffff" } }).then(setQrImage).catch(() => setQrImage(""));
  }, [syncOpen, pairingCode]);

  useEffect(() => {
    let until = null;
    try { until = JSON.parse(localStorage.getItem("moviepark-check-in"))?.until ?? null; } catch {}
    syncPushPreferences(until,favorites).catch(() => {});
  }, [favorites]);

  const requestPairingCode = async (token = syncToken) => {
    if (!token) return;
    const response = await fetch("/api/favorites-sync", { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Pairing-Code konnte nicht erstellt werden.");
    setPairingCode(payload.pairingCode);
    setPairingExpiresAt(payload.pairingExpiresAt);
  };

  useEffect(() => {
    if (!syncOpen || !syncToken || pairingCode) return;
    requestPairingCode(syncToken).catch((error) => setSyncMessage(error.message));
  }, [syncOpen, syncToken, pairingCode]);

  const saveRemote = (next) => {
    if (!syncToken) return;
    fetch("/api/favorites-sync", { method: "PUT", headers: { Authorization: `Bearer ${syncToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ favorites: next }) }).catch(() => {});
  };

  const toggleFavorite = (id) => {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch {}
      saveRemote(next);
      return next;
    });
  };

  const createBackup = async () => {
    setSyncing(true); setSyncMessage("");
    try {
      const response = await fetch("/api/favorites-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorites }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      localStorage.setItem(SYNC_KEY, payload.token); setSyncToken(payload.token); setPairingCode(payload.pairingCode || ""); setPairingExpiresAt(payload.pairingExpiresAt || ""); setSyncMessage("Backup erstellt. Verbinde dein anderes Gerät mit dem Pairing-Code.");
    } catch (error) { setSyncMessage(error.message || "Backup konnte nicht erstellt werden."); } finally { setSyncing(false); }
  };

  const importBackup = async () => {
    setSyncing(true); setSyncMessage("");
    try {
      const pair = pairingCodeFromValue(syncCode);
      if (pair) await connectPairingCode(pair, favorites);
      else {
        const token = syncTokenFromValue(syncCode);
        await connectToken(token, favorites);
      }
      setSyncCode(""); setSyncMessage("Verbunden. Deine Favoriten werden jetzt synchronisiert.");
    } catch (error) { setSyncMessage(error.message); } finally { setSyncing(false); }
  };

  const scanQrImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setQrScanning(true); setSyncMessage("");
    let objectUrl = "";
    try {
      let decodedValue = "";
      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          if (supported.includes("qr_code")) {
            const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
            try {
              const codes = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap);
              decodedValue = codes.find((code) => code.rawValue)?.rawValue || "";
            } finally {
              bitmap.close();
            }
          }
        } catch {
          // jsQR below supports browsers without a usable native detector.
        }
      }
      objectUrl = URL.createObjectURL(file);
      const image = await new Promise((resolve, reject) => {
        const element = new window.Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Das Foto konnte nicht gelesen werden."));
        element.src = objectUrl;
      });
      const maximumSide = 1800;
      const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Das Foto konnte nicht verarbeitet werden.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (!decodedValue) decodedValue = decodeQrCanvas(canvas);
      if (!decodedValue) throw new Error("Kein QR-Code erkannt. Halte die Kamera gerade und fülle das Bild möglichst mit dem Code.");
      const pair = (() => {
        try {
          const url = new URL(decodedValue, window.location.origin);
          return pairingCodeFromValue(new URLSearchParams(url.hash.slice(1)).get("pair"));
        } catch { return pairingCodeFromValue(decodedValue); }
      })();
      if (pair) await connectPairingCode(pair, favorites);
      else {
        const token = syncTokenFromValue(decodedValue);
        if (!token) throw new Error("Der QR-Code enthält keinen gültigen Favoriten-Sync.");
        await connectToken(token, favorites);
      }
      setSyncCode("");
      setSyncMessage("QR-Code erkannt. Favoriten sind jetzt verbunden.");
    } catch (error) {
      setSyncMessage(error.message || "QR-Code konnte nicht gelesen werden.");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setQrScanning(false);
    }
  };

  const rides = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(localeCode());
    const isOpen = (ride) => ride.status === "open" && Boolean(ride.sourceFresh);
    const filtered = (data?.attractions ?? []).filter((ride) => {
      if (needle && !ride.name.toLocaleLowerCase(localeCode()).includes(needle)) return false;
      if (statusFilter === "open" && !isOpen(ride)) return false;
      if (statusFilter === "closed" && isOpen(ride)) return false;
      if (typeFilter === "indoor" && !ride.indoor) return false;
      if (typeFilter === "family" && !ride.family) return false;
      if (typeFilter === "thrill" && !ride.thrill) return false;
      if (typeFilter === "water" && !ride.water) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      const favoriteDifference = Number(favorites.includes(b.id)) - Number(favorites.includes(a.id));
      if (favoriteDifference) return favoriteDifference;
      const aOpen = isOpen(a); const bOpen = isOpen(b);
      const openDifference = Number(bOpen) - Number(aOpen);
      const aWait = aOpen && a.measurementValid && a.waitMinutes != null ? Number(a.waitMinutes) : null;
      const bWait = bOpen && b.measurementValid && b.waitMinutes != null ? Number(b.waitMinutes) : null;
      if (sortMode === "wait-asc") {
        if (aWait == null || bWait == null) return aWait == null && bWait == null ? openDifference || a.name.localeCompare(b.name, "de-DE") : aWait == null ? 1 : -1;
        return aWait - bWait || a.name.localeCompare(b.name, "de-DE");
      }
      if (sortMode === "wait-desc") {
        if (aWait == null || bWait == null) return aWait == null && bWait == null ? openDifference || a.name.localeCompare(b.name, "de-DE") : aWait == null ? 1 : -1;
        return bWait - aWait || a.name.localeCompare(b.name, "de-DE");
      }
      if (sortMode === "name") return a.name.localeCompare(b.name, "de-DE");
      return openDifference || a.name.localeCompare(b.name, "de-DE");
    });
  }, [data, query, favorites, statusFilter, typeFilter, sortMode]);

  const openCount = data?.attractions.filter((ride) => ride.status === "open" && ride.sourceFresh).length ?? 0;
  const defaultView = !query.trim() && statusFilter === "all" && typeFilter === "all" && sortMode === "recommended";
  const favoriteRides = defaultView ? rides.filter((ride) => favorites.includes(ride.id)) : [];
  const remainingRides = defaultView ? rides.filter((ride) => !favorites.includes(ride.id)) : rides;
  useEffect(() => {
    if(!data||restoredViewRef.current)return;
    let saved=null;try{saved=JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY)||"null");}catch{}
    if(!saved)return;
    restoredViewRef.current=true;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{window.scrollTo({top:Number(saved.scrollY)||0,left:0,behavior:"auto"});if(favoritesListRef.current)favoritesListRef.current.scrollLeft=Number(saved.favoritesScrollLeft)||0;}));
  },[data,rides.length]);
  const renderRide = (ride, index, compact = false) => { const favorite = favorites.includes(ride.id); const open = ride.status === "open" && Boolean(ride.sourceFresh); const statusTone = !ride.sourceFresh ? "stale" : open ? "open" : "closed"; return <article id={`ride-${ride.id}`} className={`ride-card${favorite ? " is-favorite" : ""}${compact ? " is-quick" : ""}`} key={ride.id} style={{ "--ride-index": Math.min(index, 12) }}>
    <div className={`ride-image-placeholder${ATTRACTION_IMAGES[ride.id] ? " has-image" : ""}`} aria-hidden="true">{ATTRACTION_IMAGES[ride.id] ? <Image className="ride-card-image" src={ATTRACTION_IMAGES[ride.id]} alt="" fill sizes={compact ? "150px" : "(max-width: 760px) 92px, 112px"} quality={74} /> : <><NavIcon type="rides" /><span>Bild folgt</span></>}</div>
    <div className="ride-card-main"><div className="ride-card-title"><div><span className={`ride-status is-${statusTone}`}><i />{statusLabel(ride)}</span><h2><Link href={`/attractions/${ride.id}`} onClick={saveViewState}>{ride.name}</Link></h2></div><button className={favorite ? "is-active" : ""} type="button" onClick={() => toggleFavorite(ride.id)} aria-label={favorite ? `${ride.name} aus Favoriten entfernen` : `${ride.name} zu Favoriten hinzufügen`} aria-pressed={favorite}><FavoriteIcon active={favorite} /></button></div><div className="ride-card-bottom"><span><small>Wartezeit{compact ? "" : " · Trend der letzten 30 Minuten"}</small><span className="wait-display"><strong>{open && ride.measurementValid && ride.waitMinutes != null ? `${ride.waitMinutes} Min.` : "—"}</strong>{!compact && ride.delta30Minutes != null ? <em className={`wait-trend is-${ride.trend}`}>{ride.delta30Minutes > 0 ? "↑" : ride.delta30Minutes < 0 ? "↓" : "→"} {Math.abs(ride.delta30Minutes)} Min.</em> : null}</span></span><Link className="ride-detail-link" href={`/attractions/${ride.id}`} onClick={saveViewState}>Details →</Link></div></div>
  </article>; };

  return <div className="app-shell attractions-page-app">
    <AppHeader backHref="/" title="Attraktionen" />
    <main className="attractions-main">
      <header className="attractions-compact-head"><div><p className="eyebrow">Live-Übersicht · {relativeAge(data?.observedAt, now)}</p><h1>Attraktionen</h1><p>{openCount} von {data?.attractions.length ?? "—"} geöffnet · {favorites.length} {favorites.length === 1 ? "Favorit" : "Favoriten"}</p></div></header>
      <div className="inline-source-note"><span>LIVE</span><p><strong>Quelle: Queue-Times</strong><small>Der letzte gültige Messpunkt wird in der lokalen Datenbank zwischengespeichert.</small></p><Link href="/data-info#quellen">Datenweg →</Link></div>

      <label className="attractions-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Welche Attraktion suchst du?" aria-label="Attraktion suchen" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Suche löschen">×</button>}</label>
      {data?.offline ? <p className="offline-banner">Offline · letzter Datenstand {relativeAge(data.observedAt, now)}. Wartezeiten sind nicht live.</p> : null}
      {error && !data ? <div className="attractions-empty">Die Attraktionsdaten sind gerade nicht erreichbar. Wir versuchen es automatisch erneut.</div> : !data ? <div className="attractions-empty">Attraktionen werden geladen …</div> : <>
        {defaultView?<section className="favorites-first" aria-labelledby="favorites-title"><div className="section-title-row"><div><p className="eyebrow">Direkt erreichbar</p><h2 id="favorites-title">Deine Favoriten</h2></div><button className="favorites-manage" type="button" onClick={() => { setSyncMessage(""); setSyncOpen(true); }}>{syncToken ? "Sync aktiv" : "Sichern & teilen"} →</button></div>{favoriteRides.length?<div className="favorites-quick-list" ref={favoritesListRef} onScroll={saveViewState}>{favoriteRides.map((ride,index)=>renderRide(ride,index,true))}</div>:<div className="favorites-empty"><span>☆</span><div><strong>Noch keine Favoriten</strong><p>Tippe bei einer Attraktion auf den Stern. Deine wichtigsten Rides erscheinen dann sofort hier.</p></div></div>}</section>:null}
        <section className="all-rides-section" aria-labelledby="all-rides-title"><div className="section-title-row"><div><p className="eyebrow">Entdecken</p><h2 id="all-rides-title">{defaultView?"Alle anderen Attraktionen":"Suchergebnisse"}</h2></div><span>{remainingRides.length} Treffer</span></div>
          <section className="attraction-controls" aria-label="Attraktionen filtern und sortieren"><div className="status-filter" role="group" aria-label="Status filtern"><button type="button" className={statusFilter === "all" ? "is-active" : ""} onClick={() => setStatusFilter("all")}>Alle</button><button type="button" className={statusFilter === "open" ? "is-active" : ""} onClick={() => setStatusFilter("open")}>Geöffnet</button><button type="button" className={statusFilter === "closed" ? "is-active" : ""} onClick={() => setStatusFilter("closed")}>Zu</button></div><label className="sort-control"><span>Typ</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Alle</option><option value="indoor">Indoor</option><option value="family">Familie</option><option value="thrill">Thrill</option><option value="water">Wasser</option></select></label><label className="sort-control"><span>Sortieren</span><select value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="recommended">Empfohlen</option><option value="wait-asc">Kürzeste Wartezeit</option><option value="wait-desc">Längste Wartezeit</option><option value="name">Alphabetisch</option></select></label></section>
          <section className="attractions-list" aria-live="polite">{remainingRides.map((ride,index)=>renderRide(ride,index))}</section>
        </section>
        {!rides.length && <div className="attractions-empty">Keine Attraktion passt zu deiner aktuellen Suche oder Filterauswahl.</div>}
      </>}
    </main>
    {syncOpen && <div className="sync-modal-backdrop" onMouseDown={() => setSyncOpen(false)}><section className="sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="eyebrow">Anonym & geräteübergreifend</p><h2 id="sync-title">Favoriten sichern</h2></div><button type="button" onClick={() => setSyncOpen(false)} aria-label="Fenster schließen">×</button></header>
      {syncToken ? <div className="sync-connected">
        <div className="sync-success"><span>✓</span><div><strong>Backup ist aktiv</strong><small>Änderungen erscheinen innerhalb weniger Sekunden auf deinen verbundenen Geräten.</small></div></div>
        {pairingCode ? <div className="sync-pairing"><small>Temporärer Pairing-Code</small><strong>{pairingCode.slice(0, 4)} {pairingCode.slice(4)}</strong><span>Auf dem anderen Gerät eingeben · 15 Minuten gültig</span></div> : null}
        {qrImage && <div className="sync-qr"><img src={qrImage} alt="QR-Code zum Verbinden der Favoriten auf einem anderen Gerät"/><small>Mit dem anderen Gerät scannen</small></div>}
        <div className="sync-actions"><button type="button" onClick={() => requestPairingCode().then(() => setSyncMessage("Neuer Pairing-Code erstellt.")).catch((error) => setSyncMessage(error.message))}>Neuen Code erstellen</button><button type="button" disabled={!pairingCode} onClick={() => { const url = `${location.origin}/attractions#pair=${pairingCode}`; if (navigator.share) navigator.share({ title: "Movie Park Favoriten verbinden", text: `Pairing-Code: ${pairingCode}`, url }).catch(() => {}); else navigator.clipboard?.writeText(url).then(() => setSyncMessage("Pairing-Link kopiert.")); }}>Pairing teilen</button></div>
        <details className="sync-recovery"><summary>Wiederherstellungsschlüssel anzeigen</summary><label className="sync-code"><span>Dauerhafter privater Schlüssel</span><input readOnly value={syncToken}/></label></details>
        <p className="sync-warning">Der kurze Pairing-Code läuft nach 15 Minuten ab und kann nur einmal verwendet werden.</p>
        <button className="sync-disconnect" type="button" onClick={() => { localStorage.removeItem(SYNC_KEY); setSyncToken(""); setQrImage(""); setSyncMessage("Dieses Gerät wurde getrennt. Das Backup bleibt mit dem Schlüssel erhalten."); }}>Dieses Gerät trennen</button>
      </div> : <div className="sync-setup">
        <div className="sync-benefits"><span>Keine E-Mail</span><span>Kein Passwort</span><span>256-Bit-Schlüssel</span></div>
        <p>Erstelle ein anonymes Backup deiner aktuellen Favoriten. Danach kannst du einen QR-Code oder Schlüssel auf einem anderen Gerät verwenden.</p>
        <button className="sync-primary" type="button" disabled={syncing} onClick={createBackup}>{syncing ? "Wird erstellt …" : "Sicheres Backup erstellen"}</button>
        <div className="sync-divider"><span>oder vorhandenes Backup verbinden</span></div>
        <div className="sync-mobile-scanner"><input ref={qrFileRef} className="sync-qr-input" type="file" accept="image/*" capture="environment" onChange={scanQrImage}/><button type="button" disabled={qrScanning || syncing} onClick={() => qrFileRef.current?.click()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8v6H8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg><span><strong>{qrScanning ? "QR-Code wird gelesen …" : "QR-Code scannen"}</strong><small>Kamera öffnen und Sync direkt in dieser App übernehmen</small></span></button></div>
        <label className="sync-import"><span>8-stelliger Pairing-Code</span><input value={syncCode} onChange={(event) => setSyncCode(event.target.value.toUpperCase())} placeholder="ABCD 2345" autoCapitalize="characters" autoCorrect="off" spellCheck="false"/></label>
        <button className="sync-secondary" type="button" disabled={syncing || !syncCode.trim()} onClick={importBackup}>Favoriten verbinden</button>
      </div>}
      {syncMessage && <p className="sync-message" role="status">{syncMessage}</p>}
    </section></div>}

    <AppNav active="rides" />
  </div>;
}
