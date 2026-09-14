"use client";

import { useCallback, useEffect, useState } from "react";
import { syncPushPreferences } from "../lib/pushPreferences";

const STORAGE_KEY = "moviepark-check-in";

function storedCheckIn() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (value?.until && new Date(value.until).getTime() > Date.now()) return value;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

async function syncPush(checkIn) {
  await syncPushPreferences(checkIn?.until ?? null);
}

export default function ParkCheckIn() {
  const [park, setPark] = useState(null);
  const [checkIn, setCheckIn] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");

  const checkout = useCallback(async () => {
    localStorage.removeItem(STORAGE_KEY);
    setCheckIn(null);
    window.dispatchEvent(new CustomEvent("moviepark:checkin", { detail: null }));
    await syncPush(null).catch(() => {});
  }, []);

  const loadPark = useCallback(async () => {
    try {
      const response = await fetch("/api/weather", { cache: "no-store" });
      if (!response.ok) return;
      const nextPark = (await response.json()).park;
      setPark(nextPark);
      if (nextPark?.state !== "open" && storedCheckIn()) await checkout();
    } catch {
      // Keep the last known state during brief connection interruptions.
    }
  }, [checkout]);

  useEffect(() => {
    const stored = storedCheckIn();
    setCheckIn(stored);
    if (stored) syncPush(stored).catch(() => {});
    loadPark();
    const timer = window.setInterval(() => {
      setCheckIn(storedCheckIn());
      loadPark();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadPark]);

  const finishCheckIn = async () => {
    setCheckingIn(true);
    setCheckInError("");
    try {
      const response = await fetch("/api/check-in", { method: "POST", cache: "no-store" });
      const value = await response.json();
      if (!response.ok || !value?.until) throw new Error(value?.error || "Check-in ist gerade nicht möglich.");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      if (localStorage.getItem(STORAGE_KEY) === null) throw new Error("Der Check-in konnte auf diesem Gerät nicht gespeichert werden.");
      setCheckIn(value);
      window.dispatchEvent(new CustomEvent("moviepark:checkin", { detail: value }));
      await syncPush(value).catch(() => {});
    } catch (error) {
      setCheckInError(error.message || "Check-in ist gerade nicht möglich.");
    } finally {
      setCheckingIn(false);
    }
  };

  if (park?.state !== "open") return null;

  if (checkIn) return <section className="park-checkin is-active" aria-label="Park Check-in">
    <span className="checkin-live-dot" aria-hidden="true" />
    <div><p className="eyebrow">Du bist im Park</p><h2>Eingecheckt</h2><small>Park-Hinweise sind für dieses Gerät freigeschaltet.</small></div>
    <button type="button" onClick={checkout}>Jetzt auschecken</button>
  </section>;

  return <section className="park-checkin" aria-label="Park Check-in">
    <div className="checkin-copy"><p className="eyebrow">Dein Parktag</p><h2>Bereit für Hollywood?</h2><small>Einchecken schaltet Park-Benachrichtigungen bis zum Parkschluss frei.</small></div>
    <button className="checkin-button" type="button" disabled={checkingIn} onClick={finishCheckIn}>
      <span aria-hidden="true">✓</span>
      <span><strong>{checkingIn ? "Check-in läuft …" : "Jetzt einchecken"}</strong><small>Für diesen Parktag aktivieren</small></span>
      <b aria-hidden="true">→</b>
    </button>
    {checkInError ? <p className="checkin-error" role="alert">{checkInError}</p> : null}
  </section>;
}
