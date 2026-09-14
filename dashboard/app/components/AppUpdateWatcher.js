"use client";

import { useEffect, useRef } from "react";

export default function AppUpdateWatcher() {
  const currentVersion = useRef(null);
  const checking = useRef(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((registration) => registration.update()).catch(() => {});
    }
    let active = true;

    const checkVersion = async () => {
      if (!active || checking.current || document.visibilityState === "hidden") return;
      checking.current = true;
      try {
        const response = await fetch(`/api/version?time=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;
        const { version } = await response.json();
        if (!version) return;

        if (currentVersion.current === null) {
          currentVersion.current = version;
          return;
        }

        if (currentVersion.current !== version) {
          active = false;
          window.location.reload();
        }
      } catch {
        // A temporary network failure is retried by the next interval.
      } finally {
        checking.current = false;
      }
    };

    const handleActive = () => {
      if (document.visibilityState === "visible") checkVersion();
    };

    checkVersion();
    const timer = window.setInterval(checkVersion, 30_000);
    document.addEventListener("visibilitychange", handleActive);
    window.addEventListener("focus", checkVersion);
    window.addEventListener("pageshow", checkVersion);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleActive);
      window.removeEventListener("focus", checkVersion);
      window.removeEventListener("pageshow", checkVersion);
    };
  }, []);

  return null;
}
