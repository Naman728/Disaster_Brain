"use client";

import { useEffect, useState } from "react";

/** Browser online/offline from `navigator` + `window` events (SSR-safe). */
export function useNavigatorOnLine(): boolean {
  const [online, setOnline] = useState(() =>
    typeof window !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    queueMicrotask(() => {
      setOnline(navigator.onLine);
    });
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
