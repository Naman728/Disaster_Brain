export type TriagePayload = {
  patientId?: string;
  timestamp?: string;
  protocol?: string;
  scenarioType?: string;
  startTag?: string;
  priorityLevel?: number;
  priorityLabel?: string;
  chiefComplaint?: string;
  vitalSigns?: {
    consciousness?: string;
    breathing?: string;
    circulation?: string;
  };
  visibleInjuries?: unknown;
  suspectedInjuries?: unknown;
  combatSpecific?: Record<string, unknown>;
  immediateActions?: unknown;
  tcccActions?: Record<string, unknown>;
  doNotDo?: unknown;
  transportPriority?: string;
  evacuationPriority?: string;
  confidenceNote?: string;
};

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-gray-800/80 py-2 last:border-0 sm:grid-cols-[minmax(0,0.35fr)_minmax(0,1fr)]">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="text-sm text-gray-200">{value || "—"}</div>
    </div>
  );
}

function formatCombatFlags(cs: Record<string, unknown> | undefined): string {
  if (!cs || typeof cs !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(cs)) {
    if (typeof v === "boolean") parts.push(`${k}: ${v ? "yes" : "no"}`);
    else if (v != null && String(v).trim()) parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(" · ");
}

function formatTccc(t: Record<string, unknown> | undefined): string {
  if (!t || typeof t !== "object") return "";
  return Object.entries(t)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
}

export default function TriageCard({ data }: { data: TriagePayload }) {
  const vs = data.vitalSigns ?? {};
  const visible = asStringList(data.visibleInjuries);
  const injuries = asStringList(data.suspectedInjuries);
  const actions = asStringList(data.immediateActions);
  const notDo = asStringList(data.doNotDo);
  const transport =
    data.transportPriority?.trim() ||
    data.evacuationPriority?.trim() ||
    "";

  return (
    <div className="border border-gray-800 bg-gray-900/70 shadow-[inset_4px_0_0_0_rgba(220,38,38,0.85)]">
      <div className="border-b border-gray-800 bg-gray-950/80 px-4 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-gray-500">
          Triage record
        </span>
      </div>
      <div className="px-4 py-3">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <span className="text-lg font-bold tracking-wide text-amber-400/90">
            {data.startTag ?? "—"}
          </span>
          <span className="text-xs text-gray-400">
            Level {data.priorityLevel ?? "—"} · {data.priorityLabel ?? "—"}
          </span>
        </div>

        <Row label="Patient" value={data.patientId ?? ""} />
        <Row label="Time (server)" value={data.timestamp ?? ""} />
        {data.protocol ? (
          <Row label="Protocol" value={data.protocol} />
        ) : null}
        {data.scenarioType ? (
          <Row label="Scenario" value={data.scenarioType} />
        ) : null}
        <Row label="Chief complaint" value={data.chiefComplaint ?? ""} />
        <Row label="Evacuation / transport" value={transport} />
        {data.confidenceNote ? (
          <Row label="Confidence" value={data.confidenceNote} />
        ) : null}

        <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-red-400/80">
          Vital signs
        </div>
        <Row label="Consciousness" value={vs.consciousness ?? ""} />
        <Row label="Breathing" value={vs.breathing ?? ""} />
        <Row label="Circulation" value={vs.circulation ?? ""} />

        {visible.length > 0 ? (
          <>
            <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">
              Visible injuries
            </div>
            <ul className="list-inside list-disc space-y-1 py-2 text-sm text-gray-300">
              {visible.map((item, i) => (
                <li key={`v-${i}`}>{item}</li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">
          Suspected injuries
        </div>
        <ul className="list-inside list-disc space-y-1 py-2 text-sm text-gray-300">
          {(injuries.length ? injuries : ["—"]).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>

        {data.combatSpecific && Object.keys(data.combatSpecific).length > 0 ? (
          <>
            <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Combat indicators
            </div>
            <p className="py-1 text-xs whitespace-pre-wrap text-gray-400">
              {formatCombatFlags(data.combatSpecific) || "—"}
            </p>
          </>
        ) : null}

        {data.tcccActions && Object.keys(data.tcccActions).length > 0 ? (
          <>
            <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-500/80">
              TCCC (MARCH)
            </div>
            <pre className="max-h-40 overflow-auto rounded border border-gray-800/80 bg-gray-950/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-gray-300">
              {formatTccc(data.tcccActions) || "—"}
            </pre>
          </>
        ) : null}

        <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-500/80">
          Immediate actions
        </div>
        <ol className="list-inside list-decimal space-y-1 py-2 text-sm text-gray-300">
          {(actions.length ? actions : ["—"]).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>

        <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-rose-400/80">
          Do not
        </div>
        <ul className="list-inside list-disc space-y-1 py-2 text-sm text-gray-400">
          {(notDo.length ? notDo : ["—"]).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
