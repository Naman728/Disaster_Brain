"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TriagePayload } from "@/components/TriageCard";

export type TriageInputSource = "voice" | "photo" | "manual";

export type TriageData = {
  readonly id: string;
  readonly source: TriageInputSource;
  readonly symptomsRaw?: string;
  readonly photoDataUrl?: string;
  readonly submittedAt: string;
  readonly triage: TriagePayload;
};

export type AddPatientInput = {
  triage: TriagePayload;
  source: TriageInputSource;
  symptomsRaw?: string;
  photoDataUrl?: string;
};

export type PatientContextType = {
  patients: TriageData[];
  addPatient: (input: AddPatientInput) => void;
  removePatient: (id: string) => void;
  clearAll: () => void;
  getPatientById: (id: string) => TriageData | undefined;
  getCriticalPatients: () => TriageData[];
  getNextApiPatientNumber: () => number;
};

const PatientContext = createContext<PatientContextType | undefined>(undefined);

function parsePIndex(id: string | undefined): number | null {
  if (typeof id !== "string") return null;
  const m = /^P-(\d+)$/i.exec(id.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function formatPatientQueueId(n: number): string {
  return `P-${String(Math.max(1, Math.floor(n))).padStart(3, "0")}`;
}

function maxAssignedPatientIndex(patients: TriageData[]): number {
  let max = 0;
  for (const p of patients) {
    for (const raw of [p.id, p.triage.patientId] as const) {
      const idx = parsePIndex(raw);
      if (idx !== null) max = Math.max(max, idx);
    }
  }
  return max;
}

function numericIdOfPatient(p: TriageData): number | null {
  return parsePIndex(p.id) ?? parsePIndex(p.triage.patientId);
}

/** True if another row already uses this P-number (or same id string). */
function isPatientIdTaken(patients: TriageData[], candidateRaw: string): boolean {
  const trimmed = candidateRaw.trim();
  const num = parsePIndex(trimmed);
  if (num === null) {
    return patients.some(
      (p) => p.id === trimmed || p.triage.patientId === trimmed,
    );
  }
  return patients.some((p) => {
    const n = numericIdOfPatient(p);
    return n === num;
  });
}

function resolvePatientEntry(
  prev: TriageData[],
  input: AddPatientInput,
): TriageData {
  const incomingTriage: TriagePayload = { ...input.triage };
  const existingPid = incomingTriage.patientId;
  const hasValidPid =
    typeof existingPid === "string" && /^P-\d+$/i.test(existingPid.trim());
  const trimmedPid = hasValidPid ? existingPid.trim() : "";

  if (hasValidPid && !isPatientIdTaken(prev, trimmedPid)) {
    const id = trimmedPid;
    return {
      id,
      source: input.source,
      symptomsRaw: input.symptomsRaw,
      photoDataUrl: input.photoDataUrl,
      submittedAt: new Date().toISOString(),
      triage: incomingTriage,
    };
  }

  const resolvedId = formatPatientQueueId(maxAssignedPatientIndex(prev) + 1);
  return {
    id: resolvedId,
    source: input.source,
    symptomsRaw: input.symptomsRaw,
    photoDataUrl: input.photoDataUrl,
    submittedAt: new Date().toISOString(),
    triage: {
      ...incomingTriage,
      patientId: resolvedId,
    },
  };
}

export function PatientProvider({ children }: { children: ReactNode }) {
  const [patients, setPatients] = useState<TriageData[]>([]);

  const addPatient = useCallback((input: AddPatientInput) => {
    setPatients((prev) => [...prev, resolvePatientEntry(prev, input)]);
  }, []);

  const removePatient = useCallback((id: string) => {
    setPatients((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setPatients([]);
  }, []);

  const getPatientById = useCallback(
    (id: string) => patients.find((p) => p.id === id),
    [patients],
  );

  const getCriticalPatients = useCallback(
    () => patients.filter((p) => p.triage.startTag === "IMMEDIATE"),
    [patients],
  );

  const getNextApiPatientNumber = useCallback(
    () => maxAssignedPatientIndex(patients) + 1,
    [patients],
  );

  const value = useMemo<PatientContextType>(
    () => ({
      patients,
      addPatient,
      removePatient,
      clearAll,
      getPatientById,
      getCriticalPatients,
      getNextApiPatientNumber,
    }),
    [
      patients,
      addPatient,
      removePatient,
      clearAll,
      getPatientById,
      getCriticalPatients,
      getNextApiPatientNumber,
    ],
  );

  return (
    <PatientContext.Provider value={value}>{children}</PatientContext.Provider>
  );
}

export function usePatients(): PatientContextType {
  const ctx = useContext(PatientContext);
  if (ctx === undefined) {
    throw new Error("usePatients must be used inside PatientProvider");
  }
  return ctx;
}
