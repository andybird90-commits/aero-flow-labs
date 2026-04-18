import { ReactNode } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { JobProgress } from "@/components/JobProgress";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState, Skeleton } from "@/components/LoadingState";
import { Legend, ColorRamp } from "@/components/Legend";
import { ParamSlider } from "@/components/ParamSlider";
import { ViewerPlaceholder } from "@/components/ViewerPlaceholder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wind, Inbox, PlayCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Section primitive ─────────────────────────────── */
function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 border-b border-border py-10 first:pt-6", className)}>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">
            {id.replace("ds-", "").toUpperCase()}
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("glass rounded-lg p-5", className)}>{children}</div>;
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-1 p-4">
      <div className="mb-3 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ── Color tokens ──────────────────────────────────── */
const surfaces = [
  { name: "background", token: "--background", className: "bg-background" },
  { name: "surface 1",  token: "--surface-1",  className: "bg-surface-1" },
  { name: "surface 2",  token: "--surface-2",  className: "bg-surface-2" },
  { name: "surface 3",  token: "--surface-3",  className: "bg-surface-3" },
  { name: "card",       token: "--card",       className: "bg-card" },
  { name: "popover",    token: "--popover",    className: "bg-popover" },
];

const brand = [
  { name: "primary",     className: "bg-primary text-primary-foreground" },
  { name: "primary glow",className: "bg-primary-glow text-primary-foreground" },
  { name: "primary dim", className: "bg-primary-dim text-foreground" },
  { name: "accent",      className: "bg-accent text-accent-foreground" },
];

const semantic = [
  { name: "success",     className: "bg-success text-success-foreground" },
  { name: "warning",     className: "bg-warning text-warning-foreground" },
  { name: "destructive", className: "bg-destructive text-destructive-foreground" },
  { name: "muted",       className: "bg-muted text-muted-foreground" },
];

function Swatch({ name, token, className }: { name: string; token?: string; className: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-1 overflow-hidden">
      <div className={cn("h-16 w-full", className)} />
      <div className="px-3 py-2">
        <div className="text-xs font-medium">{name}</div>
        {token && <div className="text-mono text-[10px] text-muted-foreground">{token}</div>}
      </div>
    </div>
  );
}

const DesignSystem = () => {
  const sections = [
    ["ds-foundations", "Foundations"],
    ["ds-color", "Color"],
    ["ds-type", "Typography"],
    ["ds-elevation", "Elevation & Surfaces"],
    ["ds-buttons", "Buttons"],
    ["ds-forms", "Form controls"],
    ["ds-tabs", "Tabs"],
    ["ds-toggles", "Toggles & Switches"],
    ["ds-sliders", "Sliders"],
    ["ds-tables", "Tables"],
    ["ds-status", "Status chips"],
    ["ds-confidence", "Confidence levels"],
    ["ds-jobs", "Job progress states"],
    ["ds-tooltips", "Tooltips"],
    ["ds-modals", "Modals"],
    ["ds-empty", "Empty states"],
    ["ds-loading", "Loading states"],
    ["ds-charts", "Chart styles"],
    ["ds-legends", "Legends & color ramps"],
    ["ds-viewer", "3D viewer panel"],
  ];

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <PageHeader
          eyebrow="System"
          title="AeroLab Design System"
          description="Tokens, components and patterns that power the AeroLab interface. Premium, technical, motorsport-engineering influenced — never gimmicky."
          actions={
            <>
              <StatusChip tone="solver">v0.4 · build 218</StatusChip>
              <Button variant="hero" size="sm"><PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Open in app</Button>
            </>
          }
        />

        <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
          {/* Side TOC */}
          <aside className="hidden lg:block">
            <div className="glass sticky top-20 rounded-lg p-3">
              <div className="px-2 py-1 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Contents
              </div>
              <nav className="mt-1 flex flex-col">
                {sections.map(([id, label]) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <div>
            {/* Foundations */}
            <Section id="ds-foundations" title="Design principles" description="The product feels like serious engineering software: dense, precise, atmospheric. Cyan signals signal — never decoration.">
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  { t: "Honest", d: "Show assumptions and confidence. Outputs are comparative, never OEM-grade." },
                  { t: "Dense, not crowded", d: "Tight spacing, monospaced data, generous breathing room around hero figures." },
                  { t: "Atmospheric", d: "Subtle grids, gradient halos and scanline accents — restraint over decoration." },
                ].map((p) => (
                  <Card key={p.t}>
                    <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Principle</div>
                    <h3 className="mt-2 text-base font-semibold">{p.t}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{p.d}</p>
                  </Card>
                ))}
              </div>
            </Section>

            {/* Color */}
            <Section id="ds-color" title="Color palette" description="HSL tokens defined in index.css. Components use semantic names — never raw hex.">
              <div className="space-y-5">
                <div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Surfaces</div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{surfaces.map((s) => <Swatch key={s.name} {...s} />)}</div>
                </div>
                <div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Brand</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{brand.map((s) => <Swatch key={s.name} {...s} />)}</div>
                </div>
                <div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Semantic</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{semantic.map((s) => <Swatch key={s.name} {...s} />)}</div>
                </div>
              </div>
            </Section>

            {/* Typography */}
            <Section id="ds-type" title="Typography" description="Inter for UI and prose. JetBrains Mono for data, IDs and engineering values — tabular numerics on by default.">
              <Card>
                <div className="space-y-5">
                  <div>
                    <div className="text-5xl font-semibold tracking-tight">Aerodynamic balance.</div>
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">Display · Inter 600 · 48 / 1.05</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tracking-tight">Variant B · Track Pack</div>
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">H1 · Inter 600 · 24 / 1.2</div>
                  </div>
                  <div>
                    <div className="text-base font-medium">Baseline mesh validated</div>
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">H3 · Inter 500 · 16 / 1.4</div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground max-w-2xl">
                      Body copy uses Inter at 14px on a 1.55 line height. Reserve it for descriptive text — operating values always render in JetBrains Mono.
                    </p>
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">Body · Inter 400 · 14 / 1.55</div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border">
                    {[
                      { l: "DOWNFORCE", v: "284 kgf" },
                      { l: "DRAG",      v: "112 kgf" },
                      { l: "L/D",       v: "2.54" },
                      { l: "BALANCE",   v: "42.6%" },
                    ].map((s) => (
                      <div key={s.l} className="rounded border border-border bg-surface-1 p-3">
                        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</div>
                        <div className="text-mono mt-1 text-lg tabular-nums">{s.v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Mono · JetBrains Mono · tabular-nums</div>
                </div>
              </Card>
            </Section>

            {/* Elevation */}
            <Section id="ds-elevation" title="Elevation & Surfaces" description="Three card treatments cover 95% of layouts. Use sparingly — most data sits flat on background.">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-surface-1 p-5">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">surface-1</div>
                  <div className="mt-2 text-sm">Inline panels, list rows. No shadow.</div>
                </div>
                <div className="glass rounded-lg p-5">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">.glass</div>
                  <div className="mt-2 text-sm">Default card. Subtle inner highlight + 8px shadow.</div>
                </div>
                <div className="glass-strong rounded-lg p-5">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">.glass-strong</div>
                  <div className="mt-2 text-sm">Hero / dialog containers. Heavier blur and shadow.</div>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <StatCard label="DOWNFORCE" value="284" unit="kgf" delta={{ value: "+18.4%", direction: "up" }} accent />
                <StatCard label="DRAG" value="112" unit="kgf" delta={{ value: "+4.1%", direction: "up", good: "down" }} hint="vs baseline" />
              </div>
            </Section>

            {/* Buttons */}
            <Section id="ds-buttons" title="Buttons" description="Three intent levels: hero (primary CTA, glow), default/glass (secondary), ghost (tertiary).">
              <div className="grid gap-4 md:grid-cols-2">
                <Specimen label="Variants">
                  <Button variant="hero">Run simulation</Button>
                  <Button variant="default">Default</Button>
                  <Button variant="glass">Glass</Button>
                  <Button variant="accent">Accent</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="link">Link</Button>
                </Specimen>
                <Specimen label="Sizes & states">
                  <Button variant="hero" size="lg">Large</Button>
                  <Button variant="hero">Default</Button>
                  <Button variant="hero" size="sm">Small</Button>
                  <Button variant="hero" size="xs">XS</Button>
                  <Button variant="hero" disabled>Disabled</Button>
                  <Button variant="hero"><ArrowRight /> With icon</Button>
                </Specimen>
              </div>
            </Section>

            {/* Forms */}
            <Section id="ds-forms" title="Form controls" description="High-contrast inputs on surface-1, with mono labels for engineering parameters.">
              <Card>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ds-name" className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Variant name</Label>
                    <Input id="ds-name" defaultValue="Track Pack v2" className="bg-surface-1 border-border" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Solver fidelity</Label>
                    <Select defaultValue="balanced">
                      <SelectTrigger className="bg-surface-1 border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quick">Quick · 12 min</SelectItem>
                        <SelectItem value="balanced">Balanced · 38 min</SelectItem>
                        <SelectItem value="hifi">High-fidelity · 2h 10m</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>
            </Section>

            {/* Tabs */}
            <Section id="ds-tabs" title="Tabs" description="Used for switching views inside a panel. Active tab carries the brand cyan; never use as primary navigation.">
              <Card>
                <Tabs defaultValue="pressure">
                  <TabsList className="bg-surface-2 border border-border h-9">
                    <TabsTrigger value="pressure" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Pressure</TabsTrigger>
                    <TabsTrigger value="velocity" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Velocity</TabsTrigger>
                    <TabsTrigger value="wake" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Wake</TabsTrigger>
                  </TabsList>
                  <TabsContent value="pressure" className="mt-4 text-sm text-muted-foreground">Pressure field tab content.</TabsContent>
                  <TabsContent value="velocity" className="mt-4 text-sm text-muted-foreground">Velocity field tab content.</TabsContent>
                  <TabsContent value="wake" className="mt-4 text-sm text-muted-foreground">Wake structure tab content.</TabsContent>
                </Tabs>
              </Card>
            </Section>

            {/* Toggles */}
            <Section id="ds-toggles" title="Toggles & Switches" description="Use a Switch when toggling an on/off state for a part or assumption. Cyan track when on.">
              <Card>
                <div className="space-y-3">
                  {["Front splitter", "Canards", "Side skirts", "Rear diffuser", "Rear wing"].map((p, i) => (
                    <div key={p} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2.5">
                      <span className="text-sm">{p}</span>
                      <Switch defaultChecked={i !== 2} className="data-[state=checked]:bg-primary" />
                    </div>
                  ))}
                </div>
              </Card>
            </Section>

            {/* Sliders */}
            <Section id="ds-sliders" title="Sliders" description="Parametric ParamSlider — mono value, dual hint markers, brand-glow knob.">
              <Card>
                <div className="grid gap-5 md:grid-cols-2">
                  <ParamSlider label="Wing angle of attack" value={8} min={0} max={18} unit="°" hint="stall ~14°" />
                  <ParamSlider label="Front ride height" value={115} min={60} max={160} unit=" mm" />
                  <ParamSlider label="Freestream velocity" value={180} min={60} max={300} unit=" km/h" hint="straight" />
                  <ParamSlider label="Yaw angle" value={2} min={-10} max={10} step={0.5} unit="°" />
                </div>
              </Card>
            </Section>

            {/* Tables */}
            <Section id="ds-tables" title="Tables" description="Quiet borders, mono numerics, last column right-aligned. No striping — restraint reads as engineering.">
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      <th className="text-left font-normal pb-3 pr-4">Run</th>
                      <th className="text-left font-normal pb-3 px-4">Variant</th>
                      <th className="text-left font-normal pb-3 px-4">State</th>
                      <th className="text-right font-normal pb-3 px-4">DF</th>
                      <th className="text-right font-normal pb-3 px-4">DR</th>
                      <th className="text-right font-normal pb-3 pl-4">L/D</th>
                    </tr>
                  </thead>
                  <tbody className="text-mono tabular-nums">
                    {[
                      { id: "#2185", v: "Variant B", s: "simulating", df: "—",   dr: "—",   ld: "—",    tone: "simulating" as const },
                      { id: "#2184", v: "Variant B", s: "converged",  df: "284", dr: "112", ld: "2.54", tone: "success" as const },
                      { id: "#2183", v: "Variant A", s: "converged",  df: "268", dr: "109", ld: "2.46", tone: "success" as const },
                      { id: "#2179", v: "Baseline",  s: "converged",  df: "240", dr: "108", ld: "2.22", tone: "success" as const },
                      { id: "#2174", v: "Variant B", s: "failed",     df: "—",   dr: "—",   ld: "—",    tone: "failed" as const },
                    ].map((r) => (
                      <tr key={r.id} className="border-t border-border/50">
                        <td className="py-3 pr-4">{r.id}</td>
                        <td className="py-3 px-4 font-sans">{r.v}</td>
                        <td className="py-3 px-4 font-sans"><StatusChip tone={r.tone}>{r.s}</StatusChip></td>
                        <td className="text-right py-3 px-4">{r.df}</td>
                        <td className="text-right py-3 px-4">{r.dr}</td>
                        <td className="text-right py-3 pl-4 text-primary">{r.ld}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </Section>

            {/* Status chips */}
            <Section id="ds-status" title="Status chips" description="One chip per lifecycle state. Always include the dot — colour alone is not accessible.">
              <Card>
                <div className="flex flex-wrap gap-3">
                  <StatusChip tone="preview">Preview</StatusChip>
                  <StatusChip tone="simulating">Simulating</StatusChip>
                  <StatusChip tone="solver">Solver-backed</StatusChip>
                  <StatusChip tone="warning">Warning</StatusChip>
                  <StatusChip tone="failed">Failed</StatusChip>
                  <StatusChip tone="success">Converged</StatusChip>
                  <StatusChip tone="optimized">Optimized</StatusChip>
                  <StatusChip tone="neutral">Neutral</StatusChip>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <StatusChip tone="simulating" size="sm">SM</StatusChip>
                  <StatusChip tone="simulating" size="md">MD</StatusChip>
                  <StatusChip tone="simulating" size="lg">LG</StatusChip>
                </div>
              </Card>
            </Section>

            {/* Confidence */}
            <Section id="ds-confidence" title="Confidence levels" description="Apply to any aero figure. Make the user aware of model fidelity at a glance.">
              <Card>
                <div className="grid gap-4 md:grid-cols-3">
                  <ConfidenceBadge level="low"    detail="Surrogate model · ±15%" />
                  <ConfidenceBadge level="medium" detail="Coarse CFD · ±6%" />
                  <ConfidenceBadge level="high"   detail="Full CFD · validated" />
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <ConfidenceBadge level="low"    compact />
                  <ConfidenceBadge level="medium" compact />
                  <ConfidenceBadge level="high"   compact />
                </div>
              </Card>
            </Section>

            {/* Job progress */}
            <Section id="ds-jobs" title="Job progress states" description="The four states a CFD run can be in. Use JobProgress to keep them consistent across the app.">
              <div className="grid gap-4 md:grid-cols-2">
                <JobProgress state="queued"    label="Run #2186 · Variant C" iteration={0}    eta="2m 14s" residual="awaiting node" />
                <JobProgress state="running"   label="Run #2185 · Variant B" iteration={1820} eta="6m 02s" residual="Cd 1.2e-04 · Cl 8.7e-05" />
                <JobProgress state="converged" label="Run #2184 · Variant B" iteration={2400} residual="converged @ 1820 it · 38m 12s" />
                <JobProgress state="failed"    label="Run #2174 · Variant B" iteration={420}  residual="diverged · momentum residual" />
              </div>
            </Section>

            {/* Tooltips */}
            <Section id="ds-tooltips" title="Tooltips" description="For terse hints on dense data. Keep under one line.">
              <Card>
                <TooltipProvider>
                  <div className="flex flex-wrap items-center gap-4">
                    <Tooltip>
                      <TooltipTrigger asChild><Button variant="glass" size="sm">Hover me</Button></TooltipTrigger>
                      <TooltipContent>Lift coefficient at the front axle</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-mono text-sm tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 cursor-help">
                          Cp = −2.14
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="text-mono">Suction peak on wing upper surface</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </Card>
            </Section>

            {/* Modals */}
            <Section id="ds-modals" title="Modals" description="Use the glass-strong dialog for run config, exports and confirmations. Avoid for simple confirmations — prefer inline.">
              <Card>
                <Dialog>
                  <DialogTrigger asChild><Button variant="hero">Open dialog</Button></DialogTrigger>
                  <DialogContent className="border-border bg-surface-1">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Wind className="h-4 w-4 text-primary" /> Queue simulation run
                      </DialogTitle>
                      <DialogDescription>
                        Variant B will be added to the cluster queue. Estimated wait: <span className="text-mono text-foreground">2m 14s</span>.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 py-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Solver</span><span className="text-mono">k-ω SST · Balanced</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Operating</span><span className="text-mono">180 km/h · 0° yaw</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Cost</span><span className="text-mono">12 credits</span></div>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost">Cancel</Button>
                      <Button variant="hero"><PlayCircle /> Queue run</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </Card>
            </Section>

            {/* Empty */}
            <Section id="ds-empty" title="Empty states" description="Acknowledge the gap, then offer the next step.">
              <div className="grid gap-4 md:grid-cols-2">
                <EmptyState
                  icon={<Inbox className="h-5 w-5" />}
                  title="No runs yet"
                  description="Configure a variant and queue your first simulation to see results here."
                  action={<Button variant="hero" size="sm"><PlayCircle /> Queue first run</Button>}
                />
                <EmptyState
                  icon={<Wind className="h-5 w-5" />}
                  title="No vehicles in garage"
                  description="Pick a supported chassis to spin up a build workspace."
                  action={<Button variant="glass" size="sm">Browse vehicles</Button>}
                />
              </div>
            </Section>

            {/* Loading */}
            <Section id="ds-loading" title="Loading states" description="Three flavours: inline status, panel skeleton, full viewer spinner.">
              <div className="grid gap-4 md:grid-cols-3">
                <Card><LoadingState variant="inline" label="Streaming residuals" /></Card>
                <LoadingState variant="panel" label="Loading run" />
                <Card>
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton variant="block" />
                    <Skeleton className="w-2/3" />
                    <Skeleton className="w-1/2" />
                  </div>
                </Card>
              </div>
              <div className="mt-4">
                <LoadingState variant="viewer" label="Solving · iter 1820 / 2400" sublabel="k-ω SST · 12 nodes engaged" />
              </div>
            </Section>

            {/* Charts */}
            <Section id="ds-charts" title="Chart styles" description="Lines on dark grids, 1.5px stroke, mono axis labels. Brand cyan for primary series, semantic colors for residuals.">
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Convergence — residuals (log)</div>
                  <Legend
                    items={[
                      { label: "Cd",       color: "text-primary" },
                      { label: "Cl",       color: "text-destructive" },
                      { label: "momentum", color: "text-warning" },
                    ]}
                  />
                </div>
                <div className="relative h-64 rounded-md border border-border bg-surface-0 grid-bg-fine">
                  <svg viewBox="0 0 600 220" className="absolute inset-0 h-full w-full">
                    <defs>
                      <linearGradient id="cdfill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {/* axis ticks */}
                    {[0,1,2,3,4].map((i) => (
                      <line key={i} x1="0" x2="600" y1={i*55} y2={i*55} stroke="hsl(220 18% 16% / 0.6)" strokeWidth="1" />
                    ))}
                    {/* area + lines */}
                    <path d="M0,40 C100,80 220,120 320,150 S500,190 600,200 L600,220 L0,220 Z" fill="url(#cdfill)" />
                    <path d="M0,40 C100,80 220,120 320,150 S500,190 600,200" stroke="hsl(188 95% 55%)" strokeWidth="1.5" fill="none" />
                    <path d="M0,20 C100,60 220,90 320,130 S500,170 600,185" stroke="hsl(0 75% 58%)" strokeWidth="1.5" fill="none" />
                    <path d="M0,60 C100,100 220,140 320,160 S500,195 600,205" stroke="hsl(38 95% 58%)" strokeWidth="1.5" fill="none" />
                  </svg>
                  <div className="absolute bottom-1 left-2 text-mono text-[10px] text-muted-foreground">iter</div>
                  <div className="absolute top-1 left-2 text-mono text-[10px] text-muted-foreground">res</div>
                </div>
              </Card>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Card>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80 mb-3">Bar — force breakdown</div>
                  <div className="space-y-2.5 text-xs">
                    {[
                      { l: "Wing",        v: 148, w: 55 },
                      { l: "Diffuser",    v: 46,  w: 20 },
                      { l: "Splitter",    v: 38,  w: 15 },
                      { l: "Canards",     v: 12,  w: 6 },
                      { l: "Body resid.", v: 40,  w: 4 },
                    ].map((r) => (
                      <div key={r.l}>
                        <div className="flex justify-between"><span className="text-muted-foreground">{r.l}</span><span className="text-mono">{r.v} kgf</span></div>
                        <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-gradient-primary" style={{ width: `${r.w}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80 mb-3">Sparkline — DF over runs</div>
                  <div className="flex items-end gap-1 h-24">
                    {[40,55,52,68,72,70,84,88,92,95,98,100].map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-primary/50 to-primary" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-mono text-[10px] text-muted-foreground tabular-nums"><span>240</span><span>284 kgf</span></div>
                </Card>
              </div>
            </Section>

            {/* Legends */}
            <Section id="ds-legends" title="Legends & color ramps" description="Pair every series chart with a legend. Use a color ramp for any continuous field (Cp, U, ω).">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80 mb-3">Series legend</div>
                  <Legend
                    orientation="vertical"
                    items={[
                      { label: "Variant B", color: "text-primary",     value: "284 kgf" },
                      { label: "Variant A", color: "text-primary-glow",value: "268 kgf", shape: "line" },
                      { label: "Baseline",  color: "text-muted-foreground", value: "240 kgf", shape: "line" },
                    ]}
                  />
                </Card>
                <Card className="space-y-3">
                  <ColorRamp label="Cp"      min="−2.1" max="+1.0" ticks={["−2","−1","0","+1"]} />
                  <ColorRamp label="U / U∞"  min="0" max="1.4" gradient="from-surface-2 via-primary/60 to-primary" ticks={["0","0.5","1.0","1.4"]} />
                  <ColorRamp label="Vorticity ω̄" min="0" max="1500" gradient="from-surface-2 via-warning to-destructive" />
                </Card>
              </div>
            </Section>

            {/* Viewer */}
            <Section id="ds-viewer" title="3D viewer panel" description="The signature surface. Always pair the viewport with corner metadata, axis triad and operating point.">
              <ViewerPlaceholder variant="velocity" badge="DESIGN SYSTEM SAMPLE" />
              <div className="mt-3 grid gap-3 md:grid-cols-3 text-mono text-[11px]">
                {[
                  { l: "Top-left",     v: "Field name + sub-label" },
                  { l: "Top-right",    v: "Status chip (LIVE / READY)" },
                  { l: "Bottom-left",  v: "Axis triad + frame counter" },
                  { l: "Bottom-right", v: "Operating point (U∞, ρ)" },
                  { l: "Backdrop",     v: "32px grid + radial halo" },
                  { l: "Strokes",      v: "1px cyan, opacity ramp 0.7→0.05" },
                ].map((s) => (
                  <div key={s.l} className="rounded border border-border bg-surface-1 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</div>
                    <div className="mt-1 text-foreground/90">{s.v}</div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default DesignSystem;
