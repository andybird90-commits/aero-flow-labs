import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Filter, ArrowRight, Wind, Lock } from "lucide-react";
import { StatCard } from "@/components/StatCard";

const cars = [
  { id: "civic-fk8", make: "Honda", model: "Civic Type R", year: "2020 · FK8", supported: true, runs: 14, lastRun: "2h ago", power: "320 hp", weight: "1410 kg" },
  { id: "gt86", make: "Toyota", model: "GR86", year: "2023 · ZN8", supported: true, runs: 6, lastRun: "yesterday", power: "232 hp", weight: "1275 kg" },
  { id: "m2", make: "BMW", model: "M2 Competition", year: "2019 · F87", supported: true, runs: 9, lastRun: "3d ago", power: "405 hp", weight: "1550 kg" },
  { id: "cayman", make: "Porsche", model: "718 Cayman GT4", year: "2022 · 982", supported: true, runs: 3, lastRun: "1w ago", power: "414 hp", weight: "1420 kg" },
  { id: "supra", make: "Toyota", model: "GR Supra", year: "2024 · A90", supported: true, runs: 2, lastRun: "2w ago", power: "382 hp", weight: "1542 kg" },
  { id: "evo", make: "Mitsubishi", model: "Lancer Evo X", year: "2015 · CZ4A", supported: false, runs: 0, lastRun: "—", power: "291 hp", weight: "1545 kg" },
];

const Garage = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="Workspace"
          title="Garage"
          description="Select a vehicle to enter its build workspace. Each car has its own validated baseline geometry and reference dataset."
          actions={
            <>
              <Button variant="outline" size="sm" className="border-border bg-surface-1">
                <Filter className="mr-2 h-3.5 w-3.5" /> Filter
              </Button>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90">
                <Plus className="mr-2 h-3.5 w-3.5" /> Request a car
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="VEHICLES" value="6" hint="5 supported" />
          <StatCard label="ACTIVE BUILDS" value="3" delta={{ value: "+1", direction: "up" }} hint="this week" />
          <StatCard label="TOTAL RUNS" value="34" delta={{ value: "+8", direction: "up" }} hint="last 30 days" accent />
          <StatCard label="SOLVER MIN" value="218.4" unit="min" hint="quota: 600 min" />
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cars.map((c) => (
            <div key={c.id} className="glass group relative overflow-hidden rounded-xl p-5 transition-all hover:border-primary/40 hover:shadow-glow">
              <div className="absolute inset-x-0 top-0 h-px stat-line opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="flex items-start justify-between">
                <div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{c.make}</div>
                  <div className="mt-1 text-lg font-semibold tracking-tight">{c.model}</div>
                  <div className="text-mono text-[11px] text-muted-foreground">{c.year}</div>
                </div>
                {c.supported ? (
                  <span className="text-mono text-[10px] uppercase tracking-widest rounded border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                    Supported
                  </span>
                ) : (
                  <span className="text-mono text-[10px] uppercase tracking-widest rounded border border-border bg-surface-2 px-2 py-0.5 text-muted-foreground inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Soon
                  </span>
                )}
              </div>

              {/* Car silhouette */}
              <div className="relative mt-4 h-32 overflow-hidden rounded-lg border border-border bg-surface-0">
                <div className="absolute inset-0 grid-bg-fine opacity-40" />
                <svg viewBox="0 0 400 140" className="absolute inset-0 h-full w-full">
                  <path d="M50,100 L90,75 L160,65 L240,60 L300,68 L340,80 L360,100 L50,100 Z"
                    fill="hsl(188 95% 55% / 0.1)" stroke={c.supported ? "hsl(188 95% 55%)" : "hsl(215 14% 40%)"} strokeWidth="1" />
                  <circle cx="110" cy="103" r="11" fill="hsl(220 26% 8%)" stroke={c.supported ? "hsl(188 95% 55%)" : "hsl(215 14% 40%)"} strokeWidth="0.7" />
                  <circle cx="290" cy="103" r="11" fill="hsl(220 26% 8%)" stroke={c.supported ? "hsl(188 95% 55%)" : "hsl(215 14% 40%)"} strokeWidth="0.7" />
                </svg>
                {c.supported && (
                  <div className="absolute bottom-2 right-2 text-mono text-[10px] text-muted-foreground">CD 0.34 · CL −0.08</div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-mono text-[11px]">
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest">Runs</div>
                  <div className="text-foreground">{c.runs}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest">Power</div>
                  <div className="text-foreground">{c.power}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-widest">Mass</div>
                  <div className="text-foreground">{c.weight}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-mono text-[11px] text-muted-foreground">Last run · {c.lastRun}</span>
                <Button asChild size="sm" disabled={!c.supported} className="bg-gradient-primary text-primary-foreground hover:opacity-90 disabled:opacity-30">
                  <Link to="/build">Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                </Button>
              </div>
            </div>
          ))}

          {/* Empty add card */}
          <div className="group flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1/40 p-5 text-center transition-colors hover:border-primary/40">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2">
              <Wind className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div className="mt-3 text-sm font-medium">Don't see your car?</div>
            <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
              Submit a request and we'll prioritise scanning baseline geometry.
            </p>
            <Button variant="outline" size="sm" className="mt-4 border-border bg-surface-1">
              Request vehicle
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Garage;
