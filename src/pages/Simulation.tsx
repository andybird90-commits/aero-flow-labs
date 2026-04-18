import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { ParamSlider } from "@/components/ParamSlider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlayCircle, Server, Clock, CheckCircle2 } from "lucide-react";

const Simulation = () => {
  const [speed, setSpeed] = useState(180);
  const [yaw, setYaw] = useState(0);
  const [ride, setRide] = useState(115);
  const [running, setRunning] = useState(false);

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="Step 3 of 5"
          title="Simulation Setup"
          description="Define operating point and solver fidelity. Each variant runs as an independent CFD job on the cluster."
          actions={
            <>
              <Button variant="outline" size="sm" className="border-border bg-surface-1">Save preset</Button>
              <Button
                size="sm"
                onClick={() => setRunning(true)}
                className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90"
              >
                <PlayCircle className="mr-2 h-3.5 w-3.5" /> Queue run
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {/* Operating point */}
          <div className="glass rounded-lg p-5 lg:col-span-2 space-y-6">
            <div>
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Operating point</div>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <ParamSlider label="Freestream velocity" value={speed} onChange={setSpeed} min={60} max={300} unit=" km/h" hint="straight" />
                <ParamSlider label="Yaw angle" value={yaw} onChange={setYaw} min={-10} max={10} step={0.5} unit="°" hint="crosswind" />
                <ParamSlider label="Front ride height" value={ride} onChange={setRide} min={60} max={160} unit=" mm" />
                <ParamSlider label="Rear ride height" value={118} min={60} max={160} unit=" mm" />
                <ParamSlider label="Air density ρ" value={1225} min={1100} max={1300} step={5} unit=" g/m³" hint="ISA" />
                <ParamSlider label="Roll angle" value={0} min={-3} max={3} step={0.1} unit="°" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Solver fidelity</div>
                <Tabs defaultValue="balanced">
                  <TabsList className="bg-surface-2 border border-border h-8">
                    <TabsTrigger value="quick" className="text-xs">Quick</TabsTrigger>
                    <TabsTrigger value="balanced" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Balanced</TabsTrigger>
                    <TabsTrigger value="hifi" className="text-xs">High-fidelity</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {[
                  { l: "Turbulence model", v: "k-ω SST" },
                  { l: "Mesh refinement", v: "Adaptive · L3" },
                  { l: "Iterations", v: "2,400 max" },
                  { l: "Wheels", v: "Rotating" },
                  { l: "Ground", v: "Moving" },
                  { l: "Cooling", v: "Porous Darcy" },
                ].map((r) => (
                  <div key={r.l} className="rounded-md border border-border bg-surface-1 px-3 py-2.5">
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{r.l}</div>
                    <div className="text-sm">{r.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80 mb-3">Variants in queue</div>
              <div className="space-y-2">
                {[
                  { name: "Variant B · Track pack", state: "queued", eta: "~38 min" },
                  { name: "Variant A · Street pack", state: "queued", eta: "~36 min" },
                  { name: "Baseline", state: "done", eta: "complete" },
                ].map((v) => (
                  <div key={v.name} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {v.state === "done" ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm">{v.name}</span>
                    </div>
                    <span className="text-mono text-[11px] text-muted-foreground">{v.eta}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right — cluster / preflight */}
          <div className="space-y-4">
            <div className="glass rounded-lg p-5">
              <div className="flex items-center gap-2 text-mono text-[10px] uppercase tracking-widest text-primary/80">
                <Server className="h-3.5 w-3.5" /> Cluster status
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { l: "Available nodes", v: "12 / 14" },
                  { l: "Avg queue wait", v: "2m 14s" },
                  { l: "Your quota", v: "381 / 600 min" },
                  { l: "Estimated cost", v: "12 credits" },
                ].map((r) => (
                  <div key={r.l} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{r.l}</span>
                    <span className="text-mono text-sm">{r.v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 h-1.5 w-full rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-gradient-primary" style={{ width: "63%" }} />
              </div>
              <div className="mt-1 flex justify-between text-mono text-[10px] text-muted-foreground">
                <span>quota</span>
                <span>63%</span>
              </div>
            </div>

            <div className="glass rounded-lg p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Preflight checks</div>
              <ul className="mt-3 space-y-2 text-xs">
                {[
                  { l: "Geometry valid", ok: true },
                  { l: "Mesh validated", ok: true },
                  { l: "Parts collision-free", ok: true },
                  { l: "Operating point in range", ok: true },
                  { l: "No solver warnings", ok: false },
                ].map((c) => (
                  <li key={c.l} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{c.l}</span>
                    <span className={`text-mono text-[11px] ${c.ok ? "text-success" : "text-warning"}`}>
                      {c.ok ? "PASS" : "REVIEW"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {running && (
              <div className="glass rounded-lg p-5 ring-1 ring-primary/30">
                <div className="text-mono text-[10px] uppercase tracking-widest text-primary mb-2">Run #2185 queued</div>
                <p className="text-xs text-muted-foreground">
                  Variant B will start in ~2m. You'll be notified when results are ready.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Simulation;
