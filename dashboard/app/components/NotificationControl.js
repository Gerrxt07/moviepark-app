"use client";

import { useEffect, useState } from "react";
import { favoritePushPreferences, syncPushPreferences } from "../lib/pushPreferences";

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10a6 6 0 0 1 12 0v4l2 3H4l2-3v-4Zm4 10h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function applicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function NotificationControl() {
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checkedIn, setCheckedIn] = useState(false);

  useEffect(() => {
    let active = true;
    const inspect = async () => {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
      if (isIOS && !isStandalone) {
        if (active) setStatus("ios-install-required");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setStatus("unsupported");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (active) setStatus(subscription ? "enabled" : Notification.permission === "denied" ? "blocked" : "disabled");
        if (subscription) {
          let until=null;try{until=JSON.parse(localStorage.getItem("moviepark-check-in"))?.until??null}catch{}
          syncPushPreferences(until).catch(()=>{});
        }
      } catch {
        if (active) setStatus("unsupported");
      }
    };
    const inspectCheckIn = () => {
      try {
        const value = JSON.parse(localStorage.getItem("moviepark-check-in"));
        setCheckedIn(Boolean(value?.until && new Date(value.until).getTime() > Date.now()));
      } catch { setCheckedIn(false); }
    };
    inspect();
    inspectCheckIn();
    window.addEventListener("moviepark:checkin", inspectCheckIn);
    return () => {
      active = false;
      window.removeEventListener("moviepark:checkin", inspectCheckIn);
    };
  }, []);

  const enable = async () => {
    setBusy(true); setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "disabled");
        setMessage("Benachrichtigungen wurden nicht erlaubt.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const keyResponse = await fetch("/api/push", { cache: "no-store" });
      if (!keyResponse.ok) throw new Error();
      const { publicKey } = await keyResponse.json();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
      }
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          checkedInUntil: (() => {
            try { return JSON.parse(localStorage.getItem("moviepark-check-in"))?.until ?? null; } catch { return null; }
          })(),
          preferences: favoritePushPreferences(),
        }),
      });
      if (!response.ok) throw new Error();
      setStatus("enabled");
      setMessage(checkedIn ? "Aktiviert. Eine Bestätigung wurde gesendet." : "Aktiviert. Hinweise starten mit deinem nächsten Check-in.");
    } catch {
      setMessage("Aktivierung nicht möglich. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
        await subscription.unsubscribe();
      }
      setStatus("disabled");
      setMessage("Benachrichtigungen sind deaktiviert.");
    } catch {
      setMessage("Deaktivierung nicht möglich. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  };

  const labels = {
    loading: ["Benachrichtigungen", "Status wird geprüft …"],
    enabled: ["Benachrichtigungen aktiv", checkedIn ? "Park-Hinweise sind für heute freigeschaltet" : "Hinweise starten nach deinem Park-Check-in"],
    disabled: ["Benachrichtigungen aktivieren", "Direkte Hinweise auf diesem Gerät erlauben"],
    blocked: ["Benachrichtigungen blockiert", "Bitte in den Geräteeinstellungen erlauben"],
    "ios-install-required": ["Zum Home-Bildschirm hinzufügen", "iPhone-Mitteilungen funktionieren nur in der installierten Web-App"],
    unsupported: ["Nicht verfügbar", "Dieser Browser unterstützt keine Push-Mitteilungen"],
  };
  const [title, description] = labels[status];

  return <div className={`notification-control is-${status}`}>
    <button type="button" disabled={busy || status === "loading" || status === "blocked" || status === "unsupported" || status === "ios-install-required"} onClick={status === "enabled" ? disable : enable}>
      <span className="more-menu-icon"><BellIcon /></span>
      <span><strong>{busy ? "Bitte warten …" : title}</strong><small>{description}</small></span>
      <b aria-hidden="true">{status === "enabled" ? "✓" : status === "disabled" ? "→" : "·"}</b>
    </button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
