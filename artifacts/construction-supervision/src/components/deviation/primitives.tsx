import type { ReactNode } from "react";

export function Kind({ kind }: { kind: "fact" | "estimate" | "derived" }) {
  const map = {
    fact: { t: "مسجّل", c: "border-emerald-700/40 text-emerald-800 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300" },
    derived: { t: "محسوب", c: "border-sky-700/40 text-sky-800 bg-sky-50 dark:bg-sky-950 dark:text-sky-300" },
    estimate: { t: "تقدير", c: "border-amber-700/40 text-amber-800 bg-amber-50 dark:bg-amber-950 dark:text-amber-300" },
  }[kind];
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold leading-none ${map.c}`}>
      {map.t}
    </span>
  );
}

export function Section({ title, kicker, children, aside }: { title: string; kicker?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-4 py-3 md:px-5">
        <div>
          {kicker && <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">{kicker}</p>}
          <h2 className="text-base font-bold md:text-lg">{title}</h2>
        </div>
        {aside}
      </header>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

export function Metric({
  label, value, unit, kind, note, tone,
}: { label: string; value: string; unit?: string; kind: "fact" | "estimate" | "derived"; note?: ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-background p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Kind kind={kind} />
      </div>
      <div className={`text-2xl font-extrabold tabular-nums ${tone ?? ""}`} dir="ltr" style={{ textAlign: "right" }}>
        {value}
        {unit && value !== "—" && <span className="ms-1 text-sm font-semibold text-muted-foreground">{unit}</span>}
      </div>
      {note && <p className="text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  );
}
