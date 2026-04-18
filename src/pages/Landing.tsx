import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wind, ArrowRight, Activity, Layers, Gauge } from "lucide-react";

const Landing = () => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Backdrop */}
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,hsl(188_95%_55%/0.18),transparent_70%)]" />
      <div className="absolute inset-x-0 top-0 h-px stat-line" />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
            <Wind className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">AeroLab</div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Virtual Wind Tunnel
            </div>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#" className="hover:text-foreground">Platform</a>
          <a href="#" className="hover:text-foreground">Solver</a>
          <a href="#" className="hover:text-foreground">Garage</a>
          <a href="#" className="hover:text-foreground">Docs</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/garage">Sign in</Link>
          </Button>
          <Button size="sm" asChild className="bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow">
            <Link to="/garage">Open AeroLab <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-16 pb-12">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface-1/60 px-3 py-1 text-mono text-[11px] uppercase tracking-widest text-muted-foreground backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
          Solver cluster online · 14 nodes
        </div>
        <h1 className="max-w-4xl text-5xl md:text-6xl font-semibold leading-[1.05] tracking-tight">
          Virtual wind tunnel for{" "}
          <span className="text-primary glow-text">enthusiast and track cars.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Configure splitters, wings, diffusers and canards. Run comparative CFD jobs.
          Review drag, downforce, balance and pressure fields. Built for engineers and serious enthusiasts.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" asChild variant="hero">
            <Link to="/garage">Enter Garage <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button size="lg" variant="outline" className="border-border bg-surface-1/60 backdrop-blur">
            View sample run
          </Button>
          <span className="text-mono text-xs text-muted-foreground ml-2">
            Comparative aero · not OEM certification
          </span>
        </div>
      </section>

      {/* Hero panel */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20">
        <div className="glass-strong rounded-xl p-2 ring-1 ring-primary/10">
          <div className="rounded-lg border border-border bg-surface-0 p-6">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Run #2184</div>
                <div className="mt-1 text-sm font-medium">CIVIC_FK8 · Variant B · Track Pack</div>
              </div>
              <div className="hidden md:flex items-center gap-6 text-mono text-[11px]">
                <div><span className="text-muted-foreground">U∞ </span><span>180 km/h</span></div>
                <div><span className="text-muted-foreground">α </span><span>0.8°</span></div>
                <div><span className="text-muted-foreground">ρ </span><span>1.225</span></div>
                <div className="rounded border border-success/30 bg-success/10 px-2 py-0.5 text-success">CONVERGED</div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              {[
                { l: "DOWNFORCE", v: "284", u: "kgf", d: "+18.4%", icon: Gauge },
                { l: "DRAG", v: "112", u: "kgf", d: "+4.1%", icon: Activity },
                { l: "AERO BALANCE (F)", v: "42.6", u: "%", d: "−1.8 pt", icon: Layers },
              ].map((s) => (
                <div key={s.l} className="rounded-lg border border-border bg-surface-1 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</div>
                    <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-3xl font-semibold tabular-nums text-primary">{s.v}</span>
                    <span className="text-mono text-xs text-muted-foreground">{s.u}</span>
                  </div>
                  <div className="text-mono text-[11px] text-success">{s.d} vs baseline</div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-9 relative h-72 overflow-hidden rounded-lg border border-border bg-surface-0">
                <div className="absolute inset-0 grid-bg opacity-50" />
                <svg viewBox="0 0 800 280" className="absolute inset-0 h-full w-full">
                  <defs>
                    <linearGradient id="hflow" x1="0" x2="1">
                      <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
                      <stop offset="50%" stopColor="hsl(188 95% 55%)" stopOpacity="0.6" />
                      <stop offset="100%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[...Array(18)].map((_, i) => (
                    <path
                      key={i}
                      d={`M0,${30 + i * 14} C200,${20 + i * 13} 380,${110 + i * 9} 600,${80 + i * 11} S800,${100 + i * 10} 800,${100 + i * 10}`}
                      stroke="url(#hflow)" strokeWidth="1" fill="none" opacity={0.7 - i * 0.025}
                    />
                  ))}
                  <path d="M120,200 L180,160 L300,140 L420,130 L520,138 L600,160 L680,200 L120,200 Z"
                    fill="hsl(188 95% 55% / 0.15)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
                  <circle cx="220" cy="205" r="20" fill="hsl(220 26% 8%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
                  <circle cx="580" cy="205" r="20" fill="hsl(220 26% 8%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
                </svg>
                <div className="absolute top-3 left-3 text-mono text-[10px] tracking-widest text-primary/90">VELOCITY · MIDPLANE</div>
                <div className="absolute bottom-3 right-3 text-mono text-[10px] text-muted-foreground">FRAME 218 / 240</div>
              </div>
              <div className="col-span-12 lg:col-span-3 space-y-2">
                {[
                  { k: "Mesh", v: "1.84M cells" },
                  { k: "Solver", v: "RANS k-ω SST" },
                  { k: "Iterations", v: "2,400" },
                  { k: "Wall time", v: "00:38:12" },
                  { k: "Confidence", v: "Comparative · A" },
                ].map((r) => (
                  <div key={r.k} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2">
                    <span className="text-xs text-muted-foreground">{r.k}</span>
                    <span className="text-mono text-xs text-foreground">{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Landing;
