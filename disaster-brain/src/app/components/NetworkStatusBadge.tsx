"use client";

import { useNavigatorOnLine } from "@/hooks/useNavigatorOnLine";

/**
 * Live network indicator for the header (demo: airplane mode → pill flips red while local AI stays available).
 */
export default function NetworkStatusBadge() {
  const isOnline = useNavigatorOnLine();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center rounded-full border px-2.5 py-1 sm:px-3"
      style={{
        gap: 8,
        transition: "all 0.4s ease",
        ...(isOnline
          ? {
              color: "#30d158",
              borderColor: "rgba(48,209,88,0.4)",
              backgroundColor: "rgba(48,209,88,0.08)",
            }
          : {
              color: "#ff3b30",
              borderColor: "rgba(255,59,48,0.4)",
              backgroundColor: "rgba(255,59,48,0.08)",
            }),
      }}
    >
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 7,
          height: 7,
          backgroundColor: isOnline ? "#30d158" : "#ff3b30",
          boxShadow: isOnline ? "0 0 8px #30d158" : "0 0 8px #ff3b30",
          transition: "all 0.4s ease",
        }}
        aria-hidden
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          transition: "all 0.4s ease",
        }}
      >
        {isOnline ? "ONLINE" : "OFFLINE — AI ACTIVE"}
      </span>
    </div>
  );
}
