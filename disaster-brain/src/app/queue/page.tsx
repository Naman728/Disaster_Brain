"use client";

import Link from "next/link";
import { useMemo } from "react";
import TriageCard from "@/components/TriageCard";
import { usePatients, type TriageData } from "@/context/PatientContext";

export const PRIORITY_ORDER = {
  IMMEDIATE: 1,
  DELAYED: 2,
  MINOR: 3,
  EXPECTANT: 4,
} as const;

export type StartTagKey = keyof typeof PRIORITY_ORDER;

function isStartTagKey(tag: string): tag is StartTagKey {
  return Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, tag);
}

/** Lower number = higher acuity (treated first). Unknown → 5. */
function getPriorityRank(startTag: string | undefined): number {
  if (!startTag) return 5;
  const normalized = startTag.trim().toUpperCase();
  if (isStartTagKey(normalized)) {
    return PRIORITY_ORDER[normalized];
  }
  return 5;
}

function getPatientId(p: TriageData): string {
  const pid = p.triage.patientId;
  if (typeof pid === "string" && pid.trim()) return pid.trim();
  return p.id;
}

type CategoryCounts = Record<StartTagKey, number> & { UNKNOWN: number };

function countByCategory(patients: TriageData[]): CategoryCounts {
  const counts: CategoryCounts = {
    IMMEDIATE: 0,
    DELAYED: 0,
    MINOR: 0,
    EXPECTANT: 0,
    UNKNOWN: 0,
  };
  for (const p of patients) {
    const raw = (p.triage.startTag ?? "").trim().toUpperCase();
    if (isStartTagKey(raw)) counts[raw] += 1;
    else counts.UNKNOWN += 1;
  }
  return counts;
}

export default function QueuePage() {
  const { patients, removePatient, clearAll } = usePatients();

  const sortedPatients = useMemo(() => {
    return [...patients].sort((a, b) => {
      const ra = getPriorityRank(a.triage.startTag);
      const rb = getPriorityRank(b.triage.startTag);
      if (ra !== rb) return ra - rb;
      return a.submittedAt.localeCompare(b.submittedAt);
    });
  }, [patients]);

  const categoryCounts = useMemo(() => countByCategory(patients), [patients]);

  const total = patients.length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <header className="sticky top-0 z-20 border-b border-red-900/30 bg-gray-950/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-red-400/90">
              Command center
            </div>
            <h1 className="text-lg font-bold tracking-wide text-gray-100 sm:text-xl">
              Emergency patient queue
            </h1>
          </div>
          <nav className="flex items-center gap-4 text-xs font-semibold uppercase tracking-wider">
            <Link
              href="/"
              className="rounded border border-gray-600 px-4 py-2 text-gray-300 transition hover:border-amber-600/60 hover:text-amber-100"
            >
              ← Triage console
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <section
          className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
          aria-label="Queue statistics"
        >
          <StatTile label="Total" value={total} accent="border-gray-600" />
          <StatTile
            label="Immediate"
            value={categoryCounts.IMMEDIATE}
            accent="border-red-600 bg-red-950/40 text-red-100"
          />
          <StatTile
            label="Delayed"
            value={categoryCounts.DELAYED}
            accent="border-amber-700 bg-amber-950/30 text-amber-100"
          />
          <StatTile
            label="Minor"
            value={categoryCounts.MINOR}
            accent="border-emerald-700 bg-emerald-950/30 text-emerald-100"
          />
          <StatTile
            label="Expectant"
            value={categoryCounts.EXPECTANT}
            accent="border-gray-500 bg-gray-900/80 text-gray-300"
          />
          <StatTile
            label="Unclassified"
            value={categoryCounts.UNKNOWN}
            accent="border-rose-900/50 bg-rose-950/20 text-rose-200"
          />
        </section>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Sorted by START severity (immediate first). Same queue as voice /
            photo / manual triage.
          </p>
          <button
            type="button"
            disabled={total === 0}
            onClick={clearAll}
            className="text-[10px] font-bold uppercase tracking-wider text-rose-400/90 underline decoration-rose-900 hover:text-rose-300 disabled:opacity-30"
          >
            Clear board
          </button>
        </div>

        {total === 0 ? (
          <div className="rounded border border-dashed border-gray-700 bg-gray-900/40 px-8 py-16 text-center">
            <p className="mb-2 text-sm font-semibold text-gray-300">
              No patients on the board
            </p>
            <p className="mb-8 text-xs text-gray-500">
              Run triage from the console — entries appear here instantly in
              priority order.
            </p>
            <Link
              href="/"
              className="inline-block rounded border border-amber-600/50 bg-amber-950/40 px-6 py-3 text-xs font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-900/50"
            >
              Open triage console
            </Link>
          </div>
        ) : (
          <ul className="space-y-8 font-mono">
            {sortedPatients.map((patient) => {
              const patientId = getPatientId(patient);
              const photoUrl = patient.photoDataUrl;
              const tag = (patient.triage.startTag ?? "—").toString();
              const rank = getPriorityRank(patient.triage.startTag);

              return (
                <li key={patientId}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-2 text-[10px] uppercase tracking-wider text-gray-500">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-gray-300">{patientId}</span>
                      <span className="rounded border border-gray-700 px-2 py-0.5 text-gray-400">
                        P{rank === 5 ? "?" : rank}
                      </span>
                      <span>{tag}</span>
                      <span className="text-gray-600">· {patient.source}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removePatient(patient.id)}
                      className="text-rose-400/90 underline decoration-rose-900 hover:text-rose-300"
                    >
                      Remove from board
                    </button>
                  </div>
                  {photoUrl ? (
                    <div className="mb-4 overflow-hidden rounded border border-gray-800 bg-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrl}
                        alt={`Field photo for ${patientId}`}
                        className="max-h-48 w-full object-cover object-center"
                      />
                    </div>
                  ) : null}
                  <TriageCard data={patient.triage} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div
      className={`rounded border px-3 py-3 text-center ${accent}`}
      role="status"
    >
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
