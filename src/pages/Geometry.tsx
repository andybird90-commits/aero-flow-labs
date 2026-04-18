import { Link } from "react-router-dom";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { Legend } from "@/components/Legend";
import {
  Upload, RotateCcw, Maximize2, Layers, Ruler, ChevronRight, ArrowRight,
  CheckCircle2, AlertTriangle, XCircle, Wrench, RefreshCw, Box, Crosshair,
  Settings2, Eye, EyeOff, Grid3x3, Move3d, Disc, Car, ShieldCheck, Info,
  ChevronLeft,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────── */
/*  Mock geometry data                                                 */
/* ─────────────────────────────────────────────────────────────────── */
const meta = {
  source: "Validated baseline · ZN8_GR86_2023_v4",
  template: "Toyota GR86 (ZN8) · 2023",
  uploaded: false,
  hash: "sha256:9f12…a8b1",
  imported: "Apr 12 · 14:22",
};

const dimensions = [
  { k: "Wheelbase",       v: "2575", u: "mm", ref: "OEM 2575" },
  { k: "Track · front",   v: "1520", u: "mm", ref: "OEM 1520" },
  { k: "Track · rear",    v: "1550", u: "mm", ref: "OEM 1550" },
  { k: "Overall length",  v: "4265", u: "mm", ref: "OEM 4265" },
  { k: "Overall width",   v: "1775", u: "mm", ref: "OEM 1775" },
  { k: "Overall height",  v: "1310", u: "mm", ref: "OEM 1310" },
  { k: "Frontal area",    v: "1.98", u: "m²", ref: "calc" },
  { k: "Reference Cd",    v: "0.31", u: "",   ref: "ref" },
];

type CheckState = "ok" | "warn" | "fail" | "info";
const validation: { k: string; v: string; state: CheckState; note?: string }[] = [
  { k: "Scale validation",       v: "1.000 × · units mm",     state: "ok" },
  { k: "Watertight",              v: "Closed manifold",         state: "ok" },
  { k: "Surface intersections",  v: "0 detected",              state: "ok" },
  { k: "Self-intersections",     v: "0 detected",              state: "ok" },
  { k: "Triangle density",       v: "1.84M tri · adaptive",    state: "ok" },
  { k: "Underbody",               v: "Closed approximation",    state: "warn", note: "Smoothed underbody — diffuser tunnel detail simplified" },
  { k: "Cooling apertures",      v: "Modelled as porous",      state: "info" },
  { k: "Mirrors",                 v: "Included",                state: "ok" },
  { k: "Antenna / wipers",       v: "Excluded",                state: "info", note: "Negligible aero contribution at U∞ ≤ 220 km/h" },
  { k: "Symmetry",                v: "Half-body Y+ mirror",     state: "ok" },
];

const meshHealth = [
  { k: "Cell count",         v: "1.84M",       bar: 78, tone: "ok" as const },
  { k: "y+ avg / max",       v: "2.3 / 4.8",   bar: 90, tone: "ok" as const },
  { k: "Skewness · max",     v: "0.71",        bar: 65, tone: "warn" as const },
  { k: "Aspect ratio · max", v: "18.2",        bar: 82, tone: "ok" as const },
  { k: "Boundary layers",    v: "8",           bar: 70, tone: "ok" as const },
  { k: "Refinement zones",   v: "6",           bar: 60, tone: "ok" as const },
];

const wheels = [
  { k: "Wheel diameter",     v: "660",  u: "mm" },
  { k: "Tyre width",         v: "245",  u: "mm" },
  { k: "Rim diameter",       v: "18",   u: "in" },
  { k: "Rotation modelled",  v: "MRF · ω from U∞" },
  { k: "Ground motion",      v: "Translating wall" },
  { k: "Contact patch",      v: "Flat · 180 mm" },
];

const rideHeight = { front: 78, rear: 82, frontRef: 100, rearRef: 110 };

const surfaceWarnings: { sev: "warn" | "info"; title: string; body: string }[] = [
  { sev: "warn", title: "Underbody simplification",
    body: "Diffuser tunnel and floor channels are smoothed in baseline mesh. Comparative deltas remain valid; absolute Cl may be ±4%." },
  { sev: "info", title: "Cooling flow",
    body: "Front intake modelled as porous medium (resistance 1.2e6, inertial 0.12). Re-enable detailed radiator core for high-fidelity runs." },
  { sev: "info", title: "Lowered ride height",
    body: "Front ride height 22 mm below OEM. Splitter clearance verified at 38 mm — within solver wall-distance margin." },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Helpers                                                            */
/* ─────────────────────────────────────────────────────────────────── */
function CheckIcon({ state }: { state: CheckState }) {
  if (state === "ok")   return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (state === "warn") return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
  if (state === "fail") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Geometry viewer                                                    */
/* ─────────────────────────────────────────────────────────────────── */
type ViewMode = "shaded" | "wireframe" | "xray" | "underbody";

function GeometryViewer() {
  const [mode, setMode] = useState<ViewMode>("wireframe");
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  const modes: { id: ViewMode; label: string }[] = [
    { id: "shaded",    label: "Shaded" },
    { id: "wireframe", label: "Wireframe" },
    { id: "xray",      label: "X-ray" },
    { id: "underbody", label: "Underbody" },
  ];

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-0 shadow-elevated">
      {/* Toolbar */}
      <div className="relative z-10 flex items-center justify-between border-b border-border bg-surface-0/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors ${
                  mode === m.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="hidden md:inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
            {["XY", "XZ", "YZ", "ISO"].map((p, i) => (
              <button
                key={p}
                className={`rounded px-2 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors ${
                  i === 3 ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setShowLabels(v => !v)}>
            {showLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setShowGrid(v => !v)}>
            <Grid3x3 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Move3d className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative h-[520px]">
        {showGrid && <div className="absolute inset-0 grid-bg opacity-40" />}
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_55%,hsl(188_95%_55%/0.10),transparent_70%)]" />

        <svg viewBox="0 0 1000 520" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="gShade" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"   stopColor="hsl(188 95% 55%)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="hsl(220 70% 25%)" stopOpacity="0.05" />
            </linearGradient>
            <pattern id="gMesh" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
              <path d="M0,0 L14,0 M0,7 L14,7 M0,0 L0,14 M7,0 L7,14"
                stroke="hsl(188 95% 55%)" strokeWidth="0.4" opacity="0.5" />
            </pattern>
          </defs>

          {/* ground line */}
          <line x1="60" y1="380" x2="940" y2="380" stroke="hsl(188 95% 55%)" strokeWidth="0.6" strokeDasharray="3 4" opacity="0.4" />
          <text x="60" y="396" fill="hsl(215 14% 58%)" style={{ font: "10px 'JetBrains Mono', monospace" }}>z = 0 · ground plane</text>

          {/* Body */}
          <g transform="translate(0, 30)">
            <path d="M180,330 L240,290 L380,260 L560,250 L700,270 L800,295 L880,330 L180,330 Z"
              fill={mode === "shaded" ? "url(#gShade)" : mode === "xray" ? "hsl(188 95% 55% / 0.12)" : "hsl(220 24% 9%)"}
              stroke="hsl(188 95% 55%)" strokeWidth="1.2" />

            {mode === "wireframe" && (
              <>
                <path d="M180,330 L240,290 L380,260 L560,250 L700,270 L800,295 L880,330"
                  fill="url(#gMesh)" opacity="0.4" />
                {/* longitudinal lines */}
                {[260, 280, 300, 320].map((y, i) => (
                  <path key={i} d={`M${190 + i*4},${y} Q500,${y - 8} ${870 - i*4},${y - 5}`}
                    stroke="hsl(188 95% 55%)" strokeWidth="0.4" fill="none" opacity="0.45" />
                ))}
                {/* cross-sections */}
                {[260, 320, 380, 440, 500, 560, 620, 700, 780].map((x, i) => (
                  <path key={i} d={`M${x},330 L${x + 5},${280 + Math.abs(500 - x)/12}`}
                    stroke="hsl(188 95% 55%)" strokeWidth="0.4" fill="none" opacity="0.5" />
                ))}
              </>
            )}

            {mode === "underbody" && (
              <>
                <path d="M220,332 L860,332 L860,360 L220,360 Z"
                  fill="hsl(188 95% 55% / 0.18)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
                <text x="500" y="350" textAnchor="middle" fill="hsl(188 95% 55%)" style={{ font: "10px 'JetBrains Mono', monospace" }} opacity="0.9">
                  CLOSED UNDERBODY · simplified
                </text>
                {/* tunnel hint */}
                <path d="M620,360 L860,360 L860,372 L640,372 Z"
                  fill="none" stroke="hsl(38 95% 58%)" strokeWidth="0.6" strokeDasharray="3 3" />
                <text x="750" y="384" textAnchor="middle" fill="hsl(38 95% 58%)" style={{ font: "9px 'JetBrains Mono', monospace" }}>
                  diffuser tunnel · approximated
                </text>
              </>
            )}

            {/* Cabin */}
            <path d="M380,260 L500,232 L620,238 L700,260 Z"
              fill={mode === "xray" ? "hsl(188 95% 55% / 0.06)" : "hsl(220 24% 11%)"}
              stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.85" />

            {/* Mirrors */}
            <path d="M395,265 L405,260 L412,265 L405,270 Z" fill="hsl(188 95% 55%)" opacity="0.5" />
            <path d="M680,265 L688,260 L695,265 L688,270 Z" fill="hsl(188 95% 55%)" opacity="0.5" />

            {/* Wheels — wells */}
            <circle cx="290" cy="335" r="32" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.5" />
            <circle cx="290" cy="335" r="30" fill="hsl(220 26% 6%)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
            <circle cx="290" cy="335" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
            {[0,45,90,135].map(a => (
              <line key={a} x1={290 + 14*Math.cos(a*Math.PI/180)} y1={335 + 14*Math.sin(a*Math.PI/180)}
                x2={290 - 14*Math.cos(a*Math.PI/180)} y2={335 - 14*Math.sin(a*Math.PI/180)}
                stroke="hsl(188 95% 55%)" strokeWidth="0.4" opacity="0.5" />
            ))}
            <circle cx="780" cy="335" r="32" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.5" />
            <circle cx="780" cy="335" r="30" fill="hsl(220 26% 6%)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
            <circle cx="780" cy="335" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
            {[0,45,90,135].map(a => (
              <line key={a} x1={780 + 14*Math.cos(a*Math.PI/180)} y1={335 + 14*Math.sin(a*Math.PI/180)}
                x2={780 - 14*Math.cos(a*Math.PI/180)} y2={335 - 14*Math.sin(a*Math.PI/180)}
                stroke="hsl(188 95% 55%)" strokeWidth="0.4" opacity="0.5" />
            ))}
          </g>

          {/* Dimension lines */}
          {showLabels && (
            <g style={{ font: "10px 'JetBrains Mono', monospace" }}>
              {/* wheelbase */}
              <line x1="290" y1="430" x2="780" y2="430" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.7" />
              <line x1="290" y1="425" x2="290" y2="435" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.7" />
              <line x1="780" y1="425" x2="780" y2="435" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.7" />
              <text x="535" y="424" textAnchor="middle" fill="hsl(188 95% 55%)" opacity="0.9">2575 mm · wheelbase</text>

              {/* Overall length */}
              <line x1="180" y1="460" x2="880" y2="460" stroke="hsl(215 14% 58%)" strokeWidth="0.4" opacity="0.6" />
              <line x1="180" y1="455" x2="180" y2="465" stroke="hsl(215 14% 58%)" strokeWidth="0.4" opacity="0.6" />
              <line x1="880" y1="455" x2="880" y2="465" stroke="hsl(215 14% 58%)" strokeWidth="0.4" opacity="0.6" />
              <text x="530" y="454" textAnchor="middle" fill="hsl(215 14% 58%)">4265 mm · overall length</text>

              {/* Ride height callout */}
              <line x1="200" y1="358" x2="200" y2="380" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
              <line x1="195" y1="358" x2="205" y2="358" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
              <line x1="195" y1="380" x2="205" y2="380" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
              <text x="170" y="375" fill="hsl(38 95% 58%)">F 78</text>
              <line x1="860" y1="358" x2="860" y2="380" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
              <line x1="855" y1="358" x2="865" y2="358" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
              <line x1="855" y1="380" x2="865" y2="380" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
              <text x="868" y="375" fill="hsl(38 95% 58%)">R 82</text>

              {/* Track callout */}
              <text x="290" y="490" textAnchor="middle" fill="hsl(215 14% 58%)">⊢ track 1520 ⊣</text>
              <text x="780" y="490" textAnchor="middle" fill="hsl(215 14% 58%)">⊢ track 1550 ⊣</text>
            </g>
          )}
        </svg>

        {/* Top-left status overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <StatusChip tone="success" size="sm">Mesh ready</StatusChip>
          <StatusChip tone="warning" size="sm">2 warnings</StatusChip>
        </div>

        {/* Top-right scale + units */}
        <div className="absolute top-3 right-3 flex items-center gap-3 rounded-md border border-border bg-surface-1/80 px-3 py-1.5 backdrop-blur text-mono text-[10px]">
          <div><span className="text-muted-foreground">Scale </span><span className="text-foreground">1.000×</span></div>
          <div><span className="text-muted-foreground">Units </span><span className="text-foreground">mm</span></div>
          <div><span className="text-muted-foreground">Tri </span><span className="text-foreground">1.84M</span></div>
        </div>

        {/* Bottom-left axes */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 text-mono text-[10px]">
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-destructive" />
            <span className="text-foreground">X</span>
            <span className="text-muted-foreground">forward</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-success" />
            <span className="text-foreground">Y</span>
            <span className="text-muted-foreground">left</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" />
            <span className="text-foreground">Z</span>
            <span className="text-muted-foreground">up</span>
          </div>
        </div>

        <div className="absolute bottom-3 right-3 text-mono text-[10px] text-muted-foreground/70">
          drag · orbit  /  shift+drag · pan  /  scroll · zoom
        </div>
      </div>

      {/* Footer info row */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border border-t border-border">
        <div className="p-3 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-1 text-primary">
            <Box className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Source</div>
            <div className="text-mono text-[11px] truncate text-foreground">{meta.template}</div>
          </div>
        </div>
        <div className="p-3 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-1 text-primary">
            <Crosshair className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Origin</div>
            <div className="text-mono text-[11px] truncate text-foreground">Front-axle ground · centre</div>
          </div>
        </div>
        <div className="p-3 flex items-center justify-between gap-2.5">
          <Legend
            items={[
              { label: "Body",      color: "text-primary",     shape: "square" },
              { label: "Underbody", color: "text-primary-glow", shape: "square" },
              { label: "Approx.",   color: "text-warning",     shape: "line"   },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Validation panel                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function ValidationPanel() {
  const okCount = validation.filter(v => v.state === "ok").length;
  const warnCount = validation.filter(v => v.state === "warn").length;

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Geometry validation</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusChip tone="success" size="sm" dot={false}>{okCount} ok</StatusChip>
          <StatusChip tone="warning" size="sm" dot={false}>{warnCount} warn</StatusChip>
        </div>
      </div>

      <ul className="divide-y divide-border/60">
        {validation.map((v) => (
          <li key={v.k} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckIcon state={v.state} />
                <span className="text-sm text-foreground truncate">{v.k}</span>
              </div>
              <span className="text-mono text-[11px] text-muted-foreground tabular-nums truncate text-right">{v.v}</span>
            </div>
            {v.note && (
              <div className="mt-1 ml-6 text-mono text-[10px] text-muted-foreground/80 leading-relaxed">{v.note}</div>
            )}
          </li>
        ))}
      </ul>

      <div className="border-t border-border px-4 py-3 flex items-center justify-between">
        <ConfidenceBadge level="high" compact />
        <Button variant="glass" size="sm">
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Revalidate
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Mesh health card                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function MeshHealth() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Mesh health</h3>
        </div>
        <StatusChip tone="success" size="sm">Solver-ready</StatusChip>
      </div>
      <div className="p-4 space-y-3">
        {meshHealth.map((m) => (
          <div key={m.k}>
            <div className="flex items-center justify-between text-mono text-[11px]">
              <span className="text-muted-foreground">{m.k}</span>
              <span className={`tabular-nums ${m.tone === "warn" ? "text-warning" : "text-foreground"}`}>{m.v}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${m.tone === "warn" ? "bg-warning/70" : "bg-gradient-primary"}`}
                style={{ width: `${m.bar}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-2.5 text-mono text-[10px] text-muted-foreground">
        Quality scores normalised against ZN8 baseline · 0 (poor) → 100 (excellent)
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Vehicle dimensions                                                 */
/* ─────────────────────────────────────────────────────────────────── */
function VehicleDimensions() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Vehicle dimensions</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Auto-extracted</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-border/60">
        {dimensions.map((d) => (
          <div key={d.k} className="p-3">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{d.k}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-mono text-base font-semibold tabular-nums">{d.v}</span>
              {d.u && <span className="text-mono text-[10px] text-muted-foreground">{d.u}</span>}
            </div>
            <div className="text-mono text-[10px] text-muted-foreground/70 mt-0.5">vs {d.ref}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Orientation & scale controls                                       */
/* ─────────────────────────────────────────────────────────────────── */
function OrientationControls() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Move3d className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Orientation &amp; scale</h3>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground -mr-2">
          <RotateCcw className="mr-1.5 h-3 w-3" /> Reset
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: "Yaw",   v: "0.00°"  },
            { l: "Pitch", v: "+0.80°" },
            { l: "Roll",  v: "0.00°"  },
          ].map((a) => (
            <div key={a.l} className="rounded-md border border-border bg-surface-1 p-2">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{a.l}</div>
              <div className="text-mono text-sm tabular-nums mt-0.5">{a.v}</div>
            </div>
          ))}
        </div>

        {/* Ride height visual */}
        <div className="rounded-md border border-border bg-surface-1 p-3">
          <div className="flex items-center justify-between text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Ride height (mm)</span>
            <span className="text-warning">−22 / −28 vs OEM</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[
              { l: "Front", v: rideHeight.front, ref: rideHeight.frontRef },
              { l: "Rear",  v: rideHeight.rear,  ref: rideHeight.rearRef },
            ].map((r) => (
              <div key={r.l}>
                <div className="flex items-baseline justify-between">
                  <span className="text-mono text-[11px] text-muted-foreground">{r.l}</span>
                  <span className="text-mono text-base font-semibold tabular-nums text-foreground">{r.v}</span>
                </div>
                <div className="relative mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-gradient-primary" style={{ width: `${(r.v / 150) * 100}%` }} />
                  <div className="absolute top-0 bottom-0 w-px bg-warning" style={{ left: `${(r.ref / 150) * 100}%` }} />
                </div>
                <div className="mt-0.5 text-mono text-[9px] text-muted-foreground/70">OEM ref · {r.ref}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface-1 p-3 flex items-center justify-between">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Scale</div>
            <div className="text-mono text-sm tabular-nums mt-0.5">1.000 × · units mm</div>
          </div>
          <StatusChip tone="success" size="sm">Locked</StatusChip>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Underbody status                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function UnderbodyStatus() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Underbody</h3>
        </div>
        <StatusChip tone="warning" size="sm">Simplified</StatusChip>
      </div>
      <div className="p-4 space-y-2.5">
        {[
          { k: "Floor closure",      v: "Closed", ok: true  },
          { k: "Diffuser tunnel",    v: "Smoothed approximation", ok: false },
          { k: "Exhaust cutout",     v: "Filled", ok: true  },
          { k: "Rear crash bar",     v: "Modelled", ok: true  },
          { k: "Splitter clearance", v: "38 mm", ok: true  },
        ].map((r) => (
          <div key={r.k} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2">
            <div className="flex items-center gap-2">
              {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
              <span className="text-sm">{r.k}</span>
            </div>
            <span className="text-mono text-[11px] text-muted-foreground tabular-nums">{r.v}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-2.5 text-mono text-[10px] text-muted-foreground">
        Underbody simplification reduces absolute Cl confidence by ~4% · deltas remain valid
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Wheel modelling                                                    */
/* ─────────────────────────────────────────────────────────────────── */
function WheelModelling() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Disc className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Wheel modelling</h3>
        </div>
        <StatusChip tone="success" size="sm">Rotating</StatusChip>
      </div>
      <dl className="divide-y divide-border/60">
        {wheels.map((w) => (
          <div key={w.k} className="flex items-center justify-between px-4 py-2.5">
            <dt className="text-mono text-[11px] text-muted-foreground">{w.k}</dt>
            <dd className="text-mono text-[11px] text-foreground tabular-nums">
              {w.v}{w.u && <span className="text-muted-foreground ml-1">{w.u}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Surface warnings                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function SurfaceWarnings() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold tracking-tight">Surface quality &amp; notes</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{surfaceWarnings.length} items</span>
      </div>
      <div className="p-3 space-y-2">
        {surfaceWarnings.map((w) => (
          <div
            key={w.title}
            className={`rounded-md border p-3 ${
              w.sev === "warn"
                ? "border-warning/25 bg-warning/5"
                : "border-border bg-surface-1"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {w.sev === "warn"
                ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{w.title}</div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{w.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Geometry = () => {
  return (
    <AppLayout>
      {/* Sticky workspace header */}
      <div className="sticky top-14 z-20 border-b border-border bg-surface-0/80 backdrop-blur">
        <div className="px-6 py-3 flex flex-wrap items-center gap-3">
          <nav className="flex items-center gap-1.5 text-mono text-[11px] uppercase tracking-widest">
            <Link to="/garage" className="text-muted-foreground hover:text-foreground transition-colors">Garage</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <Link to="/build" className="text-muted-foreground hover:text-foreground transition-colors">GR86 Track Build</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-foreground">Geometry</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip tone="success" size="sm">Mesh ready</StatusChip>
            <ConfidenceBadge level="high" compact />
            <div className="h-5 w-px bg-border mx-1" />
            <Button variant="glass" size="sm">
              <Upload className="mr-2 h-3.5 w-3.5" /> Upload custom STL
            </Button>
            <Button variant="glass" size="sm">
              <Wrench className="mr-2 h-3.5 w-3.5" /> Repair geometry
            </Button>
            <Button variant="glass" size="sm">
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Revalidate
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/parts">Continue to Aero parts <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* Step header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
              Step 01 · Pre-simulation
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Geometry</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Validate the vehicle baseline mesh, ride height and reference dimensions before adding aero parts.
              Honest confidence depends on a clean, watertight surface.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-1/60 px-3 py-2">
            <div className="leading-tight">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Source</div>
              <div className="text-mono text-[11px] text-foreground">{meta.source}</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="leading-tight">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Imported</div>
              <div className="text-mono text-[11px] text-foreground">{meta.imported}</div>
            </div>
          </div>
        </div>

        {/* Main grid: viewer + validation rail */}
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8 space-y-4">
            <GeometryViewer />
            <div className="grid gap-4 lg:grid-cols-2">
              <VehicleDimensions />
              <OrientationControls />
            </div>
            <SurfaceWarnings />
          </div>

          <aside className="xl:col-span-4 space-y-4">
            <ValidationPanel />
            <MeshHealth />
            <UnderbodyStatus />
            <WheelModelling />
          </aside>
        </div>

        {/* Bottom action bar */}
        <div className="mt-6 glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
              <ShieldCheck className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-medium">Geometry validated · ready for aero parts</div>
              <div className="text-mono text-[11px] text-muted-foreground">
                10 of 10 checks passed · 2 warnings logged · confidence HIGH
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="glass" size="sm" asChild>
              <Link to="/build"><ChevronLeft className="mr-2 h-3.5 w-3.5" /> Back to overview</Link>
            </Button>
            <Button variant="glass" size="sm">
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset orientation
            </Button>
            <Button variant="glass" size="sm">
              <Wrench className="mr-2 h-3.5 w-3.5" /> Repair geometry
            </Button>
            <Button variant="glass" size="sm">
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Revalidate
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/parts">
                Continue to Aero parts
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Geometry;
