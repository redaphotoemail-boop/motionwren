"use client";

/* Template audits — admin only. A template audit renders the template on
   test inputs and checks the result visually: frozen segments, motion
   smoothness, whip blur, no whoosh sound, story order, coherence with the
   recipe, and cuts on the beat. A template that still fails does not ship.
   The reports below are the latest audit runs, committed with the repo
   (composer/audits/<template-id>/audit-report.json). Re-run one with:
     node composer/audit-template.mjs --recipe composer/templates/<id>.json \
       --film <rendered film> --verifier-report <verification-report.json> \
       --inputs <test inputs dir> --out composer/audits/<id>
   The film itself is not committed (video is too large for the repo); the
   report records the film's duration and the inputs it was rendered from. */

import { useState } from "react";
import { TEMPLATE_RECIPES } from "../../template-recipes";
import houseCallingAudit from "../../../composer/audits/house-calling-v1/audit-report.json";
import tourFlowAudit from "../../../composer/audits/tour-flow-v1/audit-report.json";

type AuditCheck = {
  id: string;
  pass: boolean | null;
  status: "pass" | "fail" | "skip";
  detail: string;
  fix: string | null;
};

type AuditReport = {
  template: string;
  rounds: number;
  filmDuration_s?: number;
  inputs?: string | null;
  auditedAt?: string;
  note?: string;
  checks: AuditCheck[];
  frozen?: { start_s: number; end_s: number; length_s: number }[];
};

const AUDITS: Record<string, AuditReport> = {
  "house-calling-v1": houseCallingAudit as AuditReport,
  "tour-flow-v1": tourFlowAudit as AuditReport,
};

const CHECK_LABELS: Record<string, string> = {
  freeze: "Frozen segments",
  smoothness: "Motion smoothness",
  "whip-blur": "Whip blur",
  "no-whoosh": "No whoosh sound",
  story: "Story order",
  coherence: "Coherence with the recipe",
  beat: "Cuts on the beat",
};

function statusChip(status: AuditCheck["status"]) {
  const style: Record<string, React.CSSProperties> = {
    pass: { background: "var(--ok-soft)", color: "#1F6B43" },
    fail: { background: "var(--bad-soft)", color: "var(--bad)" },
    skip: { background: "var(--surface-2, #f0ede8)", color: "var(--muted)" },
  };
  const label = status === "pass" ? "Pass" : status === "fail" ? "Fail" : "Skipped";
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, ...style[status] }}>
      {label}
    </span>
  );
}

function TemplateAuditCard({ id, name, seconds, photos }: { id: string; name: string; seconds: number; photos: number }) {
  const [open, setOpen] = useState(false);
  const report = AUDITS[id];
  if (!report) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>{name}</h2><span className="muted small">Audit</span></div>
        <p className="muted">No audit run recorded yet for this template.</p>
      </section>
    );
  }
  const passed = report.checks.filter((c) => c.status === "pass").length;
  const failed = report.checks.filter((c) => c.status === "fail").length;
  const skipped = report.checks.filter((c) => c.status === "skip").length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{name}</h2>
        <span className="muted small">Audit{report.auditedAt ? ` · ${report.auditedAt}` : ""}</span>
      </div>
      <p className="muted">
        {seconds} s · {photos} input slots · test film {report.filmDuration_s != null ? `${report.filmDuration_s}s` : "—"}
        {report.rounds ? ` · ${report.rounds} auto-fix round${report.rounds === 1 ? "" : "s"}` : ""}
      </p>
      <p className="muted small">
        {passed} passed · {failed} failed · {skipped} skipped
        {failed > 0 ? " — this template does not ship until the failures are fixed and re-audited." : " — ready to ship."}
      </p>
      {report.note ? <p className="muted small">{report.note}</p> : null}
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide audit checks" : "Audit this template — see the checks"}
      </button>
      {open ? (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {report.checks.map((c) => (
            <div key={c.id} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {statusChip(c.status)}
                <strong>{CHECK_LABELS[c.id] ?? c.id}</strong>
              </div>
              <p className="muted small" style={{ margin: 0 }}>{c.detail}</p>
              {c.status === "fail" && c.fix ? (
                <p className="muted small" style={{ margin: 0 }}>Auto-fix: {c.fix}</p>
              ) : null}
            </div>
          ))}
          <p className="muted small" style={{ margin: 0 }}>
            Re-run: <code>node composer/audit-template.mjs --recipe composer/templates/{id}.json --film &lt;rendered film&gt; --verifier-report &lt;verification-report.json&gt; --inputs &lt;test inputs&gt; --out composer/audits/{id}</code>
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function TemplateAudits() {
  return (
    <>
      <section className="panel">
        <div className="panel-head"><h2>Template audits</h2><span className="muted small">Recipe templates</span></div>
        <p className="muted">
          Each recipe template is rendered on test inputs and audited visually — frozen segments, motion smoothness,
          whip blur, whoosh sound, story order, coherence with the recipe, and cuts on the beat. A template that
          still fails does not ship. Open a template below to see its checks.
        </p>
      </section>
      {TEMPLATE_RECIPES.map((item) => (
        <TemplateAuditCard key={item.id} id={item.id} name={item.name} seconds={item.seconds} photos={item.photos} />
      ))}
    </>
  );
}
