import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Hexagon, ArrowRight, Upload, FileText, Sparkles, Wrench, Sliders, FileDown,
  Check, Box,
} from "lucide-react";

function Nav() {
  return (
    <header className="relative z-30 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
          <Hexagon className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">BodyKit Studio</div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            AI body kit & aero design
          </div>
        </div>
      </div>
      <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
        <a href="#workflow" className="hover:text-foreground transition-colors">Workflow</a>
        <a href="#parts" className="hover:text-foreground transition-colors">Parts</a>
        <a href="#export" className="hover:text-foreground transition-colors">Export</a>
      </nav>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild><Link to="/auth">Sign in</Link></Button>
        <Button variant="hero" size="sm" asChild>
          <Link to="/projects">Open Studio <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div className="absolute inset-0 bg-[radial-gradient(80%_50%_at_50%_-10%,hsl(188_95%_55%/0.12),transparent_60%)] pointer-events-none" />
      <div className="relative mx-auto max-w-7xl px-6 pt-12 pb-20">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8 items-center">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1/60 px-3 py-1 text-mono text-[11px] uppercase tracking-widest text-muted-foreground backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              AI body kit & aero design studio
            </div>

            <h1 className="mt-6 text-5xl md:text-6xl font-semibold leading-[1.04] tracking-tight">
              Style your car with AI.{" "}
              <span className="text-primary glow-text">Export real parts.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
              Upload your car model. Describe the look you want.
              Generate styling concepts, refine the fitted body kit and
              export print-ready STL files for fabrication.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="hero" size="lg" asChild>
                <Link to="/projects">Start a project <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button variant="glass" size="lg" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4 text-mono text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-primary" />
                STL & OBJ export
              </span>
              <span className="hidden sm:inline text-muted-foreground/40">·</span>
              <span>Free to start · no card required</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-[420px] overflow-hidden rounded-xl border border-border bg-surface-0 shadow-elevated">
              <div className="absolute inset-0 grid-bg opacity-50" />
              <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,hsl(188_95%_55%/0.18),transparent_70%)]" />
              <div className="relative h-full grid place-items-center">
                <div className="text-center">
                  <Hexagon className="mx-auto h-20 w-20 text-primary/40" />
                  <div className="mt-4 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Premium 3D viewer
                  </div>
                  <div className="mt-1 text-sm text-foreground">Studio render · live preview</div>
                </div>
              </div>
              <div className="absolute inset-x-4 bottom-4 grid grid-cols-3 gap-3">
                {[
                  { l: "MODELS",   v: "STL/OBJ" },
                  { l: "CONCEPTS", v: "AI gen" },
                  { l: "OUTPUT",   v: "STL kit" },
                ].map((s) => (
                  <div key={s.l} className="glass-strong rounded-md px-3 py-2.5">
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</div>
                    <div className="mt-0.5 text-mono text-sm font-semibold text-primary">{s.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: Upload,    title: "Upload",   body: "Drop your STL or OBJ car model. Orient it once." },
  { icon: FileText,  title: "Brief",    body: "Describe the look — style tags, build type, hard constraints." },
  { icon: Sparkles,  title: "Concepts", body: "AI generates styling concepts based on your car and brief." },
  { icon: Wrench,    title: "Parts",    body: "Approve a concept. AI suggests fitted body kit parameters." },
  { icon: Sliders,   title: "Refine",   body: "Tune width, depth, angle, flare, height — live preview." },
  { icon: FileDown,  title: "Export",   body: "Download STL files per part or as a full fabrication kit." },
];

function Workflow() {
  return (
    <section id="workflow" className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">How it works</div>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight">From upload to fabrication in six steps.</h2>
          <p className="mt-3 text-muted-foreground">
            Premium automotive design tooling for custom car builders, aero designers and fabrication-led enthusiasts.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="bg-card p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-1 text-primary">
                  <s.icon className="h-4 w-4" />
                </div>
                <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Step {i + 1}
                </div>
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const PARTS = [
  "Front splitter", "Lip extension", "Side skirts", "Canards",
  "Rear diffuser", "Ducktail", "Rear wing", "Wide arches",
];

function Parts() {
  return (
    <section id="parts" className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid gap-12 lg:grid-cols-12 items-center">
          <div className="lg:col-span-5">
            <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Body kit parts</div>
            <h2 className="mt-2 text-4xl font-semibold tracking-tight">A real, exportable kit — not just renders.</h2>
            <p className="mt-3 text-muted-foreground">
              Generated parts conform to your uploaded car's bounding box and snap to natural anchor points.
              Tune them with sliders, then export real STL geometry for 3D printing or fabrication.
            </p>
          </div>
          <div className="lg:col-span-7">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PARTS.map((p) => (
                <div key={p} className="glass rounded-md px-3 py-3 flex items-center gap-2">
                  <Box className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section id="export" className="border-t border-border">
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="text-4xl font-semibold tracking-tight">Build your kit.</h2>
        <p className="mt-3 text-muted-foreground">
          Start a project — it takes a minute. STL export is included.
        </p>
        <div className="mt-8">
          <Button variant="hero" size="lg" asChild>
            <Link to="/projects">Open BodyKit Studio <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-8 flex items-center justify-between text-mono text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <Hexagon className="h-3.5 w-3.5 text-primary" />
          <span>BodyKit Studio</span>
        </div>
        <div>© {new Date().getFullYear()} BodyKit Studio</div>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <Workflow />
      <Parts />
      <CTA />
      <Footer />
    </div>
  );
}
