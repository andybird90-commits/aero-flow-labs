import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";

const nodes = [...Array(14)].map((_, i) => ({
  id: `cfd-${(i + 1).toString().padStart(2, "0")}`,
  load: Math.round(20 + Math.random() * 75),
  state: i === 3 || i === 9 ? "idle" : i === 11 ? "warning" : "active",
}));

const SystemStatus = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="Operations"
          title="System Status"
          description="Real-time view of solver cluster, queue depth and platform services."
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="CLUSTER UPTIME" value="99.94" unit="%" hint="last 30 days" accent />
          <StatCard label="JOBS / 24H" value="218" delta={{ value: "+12%", direction: "up" }} />
          <StatCard label="AVG WAIT" value="2:14" unit="min" hint="queue" />
          <StatCard label="ERROR RATE" value="0.4" unit="%" delta={{ value: "−0.2 pt", direction: "down", good: "down" }} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 glass rounded-lg p-5">
            <div className="flex items-center justify-between">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Solver nodes</div>
              <span className="text-mono text-[11px] text-muted-foreground">14 nodes · GPU A100 ×4 each</span>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {nodes.map((n) => (
                <div key={n.id} className="rounded-md border border-border bg-surface-1 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-mono text-[10px] text-muted-foreground">{n.id}</span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        n.state === "active" ? "bg-success animate-pulse-soft" :
                        n.state === "idle" ? "bg-muted-foreground/40" :
                        "bg-warning"
                      }`}
                    />
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${n.state === "warning" ? "bg-warning" : "bg-gradient-primary"}`}
                      style={{ width: `${n.load}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-mono text-[10px] text-muted-foreground">{n.load}%</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="glass rounded-lg p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Services</div>
              <div className="mt-3 space-y-2 text-xs">
                {[
                  { l: "Solver gateway", s: "ok" },
                  { l: "Mesh service", s: "ok" },
                  { l: "Storage (S3)", s: "ok" },
                  { l: "Auth", s: "ok" },
                  { l: "Report renderer", s: "warn" },
                ].map((r) => (
                  <div key={r.l} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{r.l}</span>
                    <span className={`text-mono text-[11px] ${r.s === "ok" ? "text-success" : "text-warning"}`}>
                      {r.s === "ok" ? "OPERATIONAL" : "DEGRADED"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass rounded-lg p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Recent events</div>
              <ul className="mt-3 space-y-2 text-xs">
                {[
                  { t: "14:18", m: "Run #2185 queued", c: "muted" },
                  { t: "14:08", m: "Run #2184 converged", c: "success" },
                  { t: "13:42", m: "cfd-12 high temp warning", c: "warning" },
                  { t: "13:01", m: "Render service slow", c: "warning" },
                ].map((e, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="text-mono text-[10px] text-muted-foreground w-9 shrink-0">{e.t}</span>
                    <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${e.c === "success" ? "bg-success" : e.c === "warning" ? "bg-warning" : "bg-muted-foreground/50"}`} />
                    <span className="text-foreground/90">{e.m}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SystemStatus;
