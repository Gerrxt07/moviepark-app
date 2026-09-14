"use client";

import { useEffect, useState } from "react";

function localDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

export default function ParkClosedNotice() {
  const [park, setPark] = useState(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      try {
        const response = await fetch("/api/weather", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        setPark(payload.park);
        const dismissed = window.localStorage.getItem("moviepark-closed-notice-dismissed") === localDateKey();
        if (payload.park?.state === "closed" && !dismissed) window.setTimeout(() => active && setVisible(true), 550);
      } catch {
        // No notice is shown when the live park status cannot be confirmed.
      }
    };
    loadStatus();
    window.addEventListener("moviepark:refresh", loadStatus);
    return () => { active = false; window.removeEventListener("moviepark:refresh", loadStatus); };
  }, []);

  const dismiss = () => {
    setClosing(true);
    try { window.localStorage.setItem("moviepark-closed-notice-dismissed", localDateKey()); } catch {}
    window.setTimeout(() => setVisible(false), 260);
  };

  if (!visible || park?.state !== "closed") return null;
  return <aside className={`park-closed-notice${closing ? " is-closing" : ""}`} role="status" aria-live="polite">
    <span className="closed-notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8v5m0 3h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7"/></svg></span>
    <div><strong>Der Park ist gerade geschlossen</strong><p>{park.detail === "Öffnet um 10 Uhr" ? "Die Studiotore öffnen heute um 10 Uhr." : "Die Studiotore öffnen wieder um 10 Uhr."}</p></div>
    <button type="button" onClick={dismiss} aria-label="Hinweis schließen">×</button>
  </aside>;
}
