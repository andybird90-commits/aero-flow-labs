import { Link } from "react-router-dom";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ParamSlider } from "@/components/ParamSlider";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { Legend } from "@/components/Legend";
import {
  ChevronRight, ArrowRight, ChevronLeft, Plus, Save, Copy, RotateCcw,
  Wind, Gauge, Layers, Maximize2, Eye, EyeOff, Grid3x3, Move3d, Settings2,
  Wrench, Sparkles, ChevronDown, TrendingUp, TrendingDown, Minus, Info,
  Lock, Pin, GitCompareArrows, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────── */
/*  Aero categories & parts                                            */
/* ─────────────────────────────────────────────────────────────────── */
type PartId =
  | "splitter" | "canards" | "skirts" | "wing" | "ducktail"
  | "diffuser" | "underbody" | "ride";

type Tag = { label: string; tone: "df" | "drag" | "front" | "rear" | "stab" | "neutral" };

const TAG_STYLES: Record<Tag["tone"], string> = {
  df:      "border-primary/30 bg-primary/10 text-primary",
  drag:    "border-warning/30 bg-warning/10 text-warning",
  front:   "border-success/30 bg-success/10 text-success",
  rear:    "border-success/30 bg-success/10 text-success",
  stab:    "border-primary/30 bg-primary/10 text-primary-glow",
  neutral: "border-border bg-surface-2 text-muted-foreground",
};

interface PartDef {
  id: PartId;
  name: string;
  group: "Front" | "Sides" | "Rear" | "Underbody" | "Stance";
  enabled: boolean;
  df: number;   // kgf @ 200 km/h
  dr: number;   // kgf
  tags: Tag[];
  status?: "ok" | "tuned" | "stalled";
}

const initialParts: PartDef[] = [
  { id: "splitter", name: "Front splitter", group: "Front",     enabled: true,  df: 38,  dr: 4,
    tags: [{ label: "front load ↑", tone: "front" }, { label: "drag ↑", tone: "drag" }] },
  { id: "canards",  name: "Canards",        group: "Front",     enabled: true,  df: 12,  dr: 2,
    tags: [{ label: "front bias ↑", tone: "front" }] },
  { id: "skirts",   name: "Side skirts",    group: "Sides",     enabled: false, df: 0,   dr: 0,
    tags: [{ label: "underbody seal", tone: "neutral" }] },
  { id: "wing",     name: "Rear wing",      group: "Rear",      enabled: true,  df: 148, dr: 18, status: "tuned",
    tags: [{ label: "rear load ↑", tone: "rear" }, { label: "drag ↑↑", tone: "drag" }, { label: "stability ↑", tone: "stab" }] },
  { id: "ducktail", name: "Ducktail",       group: "Rear",      enabled: false, df: 0,   dr: 0,
    tags: [{ label: "rear load ↑", tone: "rear" }] },
  { id: "diffuser", name: "Rear diffuser",  group: "Underbody", enabled: true,  df: 46,  dr: 1,
    tags: [{ label: "rear load ↑", tone: "rear" }, { label: "DF/DR ↑", tone: "df" }] },
  { id: "underbody",name: "Underbody aids", group: "Underbody", enabled: true,  df: 22,  dr: -1,
    tags: [{ label: "drag ↓", tone: "df" }, { label: "balance ↑", tone: "stab" }] },
  { id: "ride",     name: "Ride height & rake", group: "Stance", enabled: true, df: 18, dr: 0,
    tags: [{ label: "rake +0.3°", tone: "stab" }] },
];

const groupOrder: PartDef["group"][] = ["Front", "Sides", "Rear", "Underbody", "Stance"];

/* ─────────────────────────────────────────────────────────────────── */
/*  Presets                                                            */
/* ─────────────────────────────────────────────────────────────────── */
const presets = [
  { id: "road",    name: "Fast Road",            sub: "Comfort · low drag",   icon: Wind,
    df: 95,  dr: 8,  bias: 38, accent: "from-primary/20 to-transparent" },
  { id: "track",   name: "Track Day",            sub: "Balanced grip",        icon: Gauge,
    df: 244, dr: 25, bias: 43, accent: "from-primary/30 to-transparent" },
  { id: "topspd",  name: "High-speed Stability", sub: "Low Cd · trim",        icon: TrendingUp,
    df: 118, dr: 11, bias: 41, accent: "from-warning/20 to-transparent" },
  { id: "rear",    name: "Max Rear Grip",        sub: "Aggressive wing",      icon: ArrowUpRight,
    df: 318, dr: 38, bias: 36, accent: "from-success/20 to-transparent" },
] as const;

/* ─────────────────────────────────────────────────────────────────── */
/*  Parameter schema per part                                          */
/* ─────────────────────────────────────────────────────────────────── */
type ParamKey =
  | "chord" | "aoa" | "endplate" | "mount" | "span" | "gurney" | "elements"
  | "splDepth" | "splProtrusion" | "splWidth"
  | "canWidth" | "canAngle" | "canHeight"
  | "skDepth" | "skLength" | "skSeal"
  | "diffAngle" | "diffLength" | "diffStrakes"
  | "ubCoverage" | "ubNACA"
  | "rideF" | "rideR" | "rake"
  | "duckHeight" | "duckAngle";

type ParamDef = { key: ParamKey; label: string; min: number; max: number; default: number; unit: string; hint?: string };

const partParams: Record<PartId, { tabs: { id: string; label: string; params: ParamDef[] }[] }> = {
  wing: {
    tabs: [
      { id: "profile", label: "Profile", params: [
        { key: "chord",    label: "Chord length",      min: 180, max: 380, default: 280, unit: "mm", hint: "GT3 ref 320" },
        { key: "aoa",      label: "Angle of attack",   min: 0,   max: 18,  default: 8,   unit: "°",  hint: "stall ~14°" },
        { key: "elements", label: "Number of elements",min: 1,   max: 3,   default: 2,   unit: "" },
        { key: "gurney",   label: "Gurney flap height",min: 0,   max: 30,  default: 12,  unit: "mm" },
      ]},
      { id: "mount", label: "Mount", params: [
        { key: "mount",    label: "Mount height (deck)", min: 50,  max: 250, default: 120, unit: "mm" },
        { key: "span",     label: "Span",                min: 1200,max: 1600,default: 1480,unit: "mm" },
      ]},
      { id: "endplate", label: "Endplate", params: [
        { key: "endplate", label: "Endplate height",   min: 60,  max: 180, default: 120, unit: "mm" },
      ]},
    ],
  },
  splitter: {
    tabs: [
      { id: "geom", label: "Geometry", params: [
        { key: "splProtrusion", label: "Protrusion",  min: 20, max: 120, default: 60, unit: "mm", hint: "regs ≤ 100" },
        { key: "splDepth",      label: "Depth (under)", min: 30, max: 220, default: 110, unit: "mm" },
        { key: "splWidth",      label: "Width",       min: 1400, max: 1900, default: 1740, unit: "mm" },
      ]},
    ],
  },
  canards: {
    tabs: [
      { id: "geom", label: "Geometry", params: [
        { key: "canWidth",  label: "Element width",  min: 80, max: 260, default: 180, unit: "mm" },
        { key: "canAngle",  label: "Incidence",      min: 0,  max: 22,  default: 12,  unit: "°", hint: "stall ~18°" },
        { key: "canHeight", label: "Height on bumper", min: 200, max: 600, default: 380, unit: "mm" },
        { key: "elements",  label: "Pairs",          min: 1,  max: 3,   default: 1,   unit: "" },
      ]},
    ],
  },
  skirts: {
    tabs: [
      { id: "geom", label: "Geometry", params: [
        { key: "skDepth",  label: "Skirt depth",     min: 20,  max: 140, default: 70,  unit: "mm" },
        { key: "skLength", label: "Length coverage", min: 60,  max: 100, default: 90,  unit: "%" },
        { key: "skSeal",   label: "Floor seal gap",  min: 0,   max: 40,  default: 8,   unit: "mm" },
      ]},
    ],
  },
  diffuser: {
    tabs: [
      { id: "geom", label: "Geometry", params: [
        { key: "diffAngle",   label: "Diffuser angle", min: 4,   max: 18,  default: 11,  unit: "°", hint: "stall ~15°" },
        { key: "diffLength",  label: "Length",        min: 400, max: 1100,default: 780, unit: "mm" },
        { key: "diffStrakes", label: "Strakes",       min: 0,   max: 6,   default: 4,   unit: "" },
      ]},
    ],
  },
  underbody: {
    tabs: [
      { id: "geom", label: "Geometry", params: [
        { key: "ubCoverage", label: "Floor coverage", min: 40,  max: 100, default: 85,  unit: "%" },
        { key: "ubNACA",     label: "NACA ducts",     min: 0,   max: 4,   default: 2,   unit: "" },
      ]},
    ],
  },
  ride: {
    tabs: [
      { id: "stance", label: "Stance", params: [
        { key: "rideF", label: "Ride height · front", min: 40, max: 140, default: 78, unit: "mm" },
        { key: "rideR", label: "Ride height · rear",  min: 40, max: 140, default: 82, unit: "mm" },
        { key: "rake",  label: "Rake angle",          min: -10, max: 30, default: 8,  unit: "·0.1°", hint: "0.8°" },
      ]},
    ],
  },
  ducktail: {
    tabs: [
      { id: "geom", label: "Geometry", params: [
        { key: "duckHeight", label: "Lip height",  min: 10, max: 80, default: 38, unit: "mm" },
        { key: "duckAngle",  label: "Trailing angle", min: 0,  max: 24, default: 12, unit: "°" },
      ]},
    ],
  },
};

const PART_ICONS: Record<PartId, typeof Wind> = {
  splitter: Layers, canards: ChevronRight, skirts: Minus, wing: Wind,
  ducktail: ArrowUpRight, diffuser: Layers, underbody: Grid3x3, ride: Move3d,
};

/* ─────────────────────────────────────────────────────────────────── */
/*  Tag pill                                                           */
/* ─────────────────────────────────────────────────────────────────── */
function TagPill({ tag }: { tag: Tag }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-mono text-[9px] uppercase tracking-widest",
      TAG_STYLES[tag.tone],
    )}>
      {tag.label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Aero viewer                                                        */
/* ─────────────────────────────────────────────────────────────────── */
function AeroViewer({ activePart, parts }: { activePart: PartId; parts: PartDef[] }) {
  const [mode, setMode] = useState<"shaded" | "parts" | "streamlines">("parts");
  const [showLabels, setShowLabels] = useState(true);

  const isOn = (id: PartId) => parts.find(p => p.id === id)?.enabled;

  const partLabels: { id: PartId; x: number; y: number; lx: number; ly: number }[] = [
    { id: "canards",  x: 220, y: 290, lx: 130, ly: 240 },
    { id: "splitter", x: 200, y: 358, lx: 100, ly: 410 },
    { id: "skirts",   x: 470, y: 360, lx: 460, ly: 420 },
    { id: "wing",     x: 815, y: 240, lx: 880, ly: 200 },
    { id: "ducktail", x: 770, y: 268, lx: 855, ly: 260 },
    { id: "diffuser", x: 820, y: 360, lx: 890, ly: 410 },
    { id: "underbody",x: 500, y: 376, lx: 500, ly: 432 },
  ];

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-0 shadow-elevated">
      {/* Toolbar */}
      <div className="relative z-10 flex items-center justify-between border-b border-border bg-surface-0/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
            {[
              { id: "shaded",       label: "Shaded" },
              { id: "parts",        label: "Parts" },
              { id: "streamlines",  label: "Preview Δ" },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id as typeof mode)}
                className={cn(
                  "rounded px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors",
                  mode === m.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="hidden md:inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
            {["XY", "XZ", "YZ", "ISO"].map((p, i) => (
              <button key={p} className={cn(
                "rounded px-2 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors",
                i === 3 ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}>{p}</button>
            ))}
          </div>
          <StatusChip tone="warning" size="sm">Surrogate preview</StatusChip>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setShowLabels(v => !v)}>
            {showLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Grid3x3 className="h-3.5 w-3.5" />
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
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_55%,hsl(188_95%_55%/0.10),transparent_70%)]" />

        <svg viewBox="0 0 1000 520" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="bodyGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"   stopColor="hsl(188 95% 55%)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="hsl(220 70% 25%)" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="streamGrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%"   stopColor="hsl(188 95% 55%)" stopOpacity="0" />
              <stop offset="40%"  stopColor="hsl(188 95% 55%)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="hsl(38 95% 58%)"  stopOpacity="0.15" />
            </linearGradient>
          </defs>

          {/* ground */}
          <line x1="60" y1="380" x2="940" y2="380" stroke="hsl(188 95% 55%)" strokeWidth="0.6" strokeDasharray="3 4" opacity="0.4" />

          {/* body */}
          <g>
            <path d="M180,360 L240,320 L380,290 L560,280 L700,300 L800,325 L880,360 L180,360 Z"
              fill="url(#bodyGrad)" stroke="hsl(188 95% 55%)" strokeWidth="1.2" />
            <path d="M380,290 L500,262 L620,268 L700,290 Z"
              fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.85" />
          </g>

          {/* streamlines (Preview Δ mode) */}
          {mode === "streamlines" && (
            <g opacity="0.85">
              {Array.from({ length: 14 }).map((_, i) => {
                const y = 200 + i * 14;
                const lift = isOn("wing") ? -8 : 0;
                const splitterPush = isOn("splitter") ? -6 : 0;
                return (
                  <path key={i}
                    d={`M40,${y} Q260,${y + splitterPush} 500,${y + splitterPush - 2} T940,${y + lift}`}
                    stroke="url(#streamGrad)" strokeWidth="0.9" fill="none" />
                );
              })}
              {/* wake */}
              {isOn("wing") && (
                <g opacity="0.6">
                  {[0,1,2,3].map(i => (
                    <path key={i} d={`M820,${230 + i*8} q40,${10 + i*4} 80,${i*6}`}
                      stroke="hsl(38 95% 58%)" strokeWidth="0.6" fill="none" strokeDasharray="2 3" />
                  ))}
                </g>
              )}
            </g>
          )}

          {/* Splitter */}
          {isOn("splitter") && (
            <g>
              <path d="M150,366 L250,366 L260,372 L150,372 Z"
                fill={activePart === "splitter" ? "hsl(188 95% 55% / 0.35)" : "hsl(188 95% 55% / 0.18)"}
                stroke="hsl(188 95% 55%)" strokeWidth={activePart === "splitter" ? 1.4 : 0.8} />
            </g>
          )}

          {/* Canards */}
          {isOn("canards") && (
            <g>
              <path d="M210,288 L240,282 L248,290 L218,294 Z"
                fill={activePart === "canards" ? "hsl(188 95% 55% / 0.45)" : "hsl(188 95% 55% / 0.22)"}
                stroke="hsl(188 95% 55%)" strokeWidth={activePart === "canards" ? 1.4 : 0.8} />
            </g>
          )}

          {/* Side skirts */}
          {isOn("skirts") && (
            <path d="M310,358 L660,358 L660,366 L310,366 Z"
              fill={activePart === "skirts" ? "hsl(188 95% 55% / 0.30)" : "hsl(188 95% 55% / 0.14)"}
              stroke="hsl(188 95% 55%)" strokeWidth={activePart === "skirts" ? 1.4 : 0.6} />
          )}

          {/* Underbody */}
          {isOn("underbody") && (
            <path d="M260,370 L780,370 L780,378 L260,378 Z"
              fill={activePart === "underbody" ? "hsl(188 95% 55% / 0.20)" : "hsl(188 95% 55% / 0.08)"}
              stroke="hsl(188 95% 55%)" strokeWidth="0.5" strokeDasharray="3 3" />
          )}

          {/* Diffuser */}
          {isOn("diffuser") && (
            <g>
              <path d="M780,370 L860,348 L860,378 L780,378 Z"
                fill={activePart === "diffuser" ? "hsl(188 95% 55% / 0.40)" : "hsl(188 95% 55% / 0.20)"}
                stroke="hsl(188 95% 55%)" strokeWidth={activePart === "diffuser" ? 1.4 : 0.8} />
              {[0,1,2,3].map(i => (
                <line key={i} x1={790 + i*18} y1="378" x2={794 + i*18} y2="354"
                  stroke="hsl(188 95% 55%)" strokeWidth="0.4" opacity="0.7" />
              ))}
            </g>
          )}

          {/* Ducktail */}
          {isOn("ducktail") && (
            <path d="M740,278 L820,272 L820,282 L740,288 Z"
              fill={activePart === "ducktail" ? "hsl(188 95% 55% / 0.40)" : "hsl(188 95% 55% / 0.18)"}
              stroke="hsl(188 95% 55%)" strokeWidth={activePart === "ducktail" ? 1.4 : 0.8} />
          )}

          {/* Rear wing */}
          {isOn("wing") && (
            <g>
              {/* uprights */}
              <path d="M790,310 L795,250 L800,250 L795,310 Z" fill="hsl(188 95% 55% / 0.35)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />
              <path d="M840,310 L845,250 L850,250 L845,310 Z" fill="hsl(188 95% 55% / 0.35)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />
              {/* main plane */}
              <path d="M740,250 L900,238 L900,252 L740,266 Z"
                fill={activePart === "wing" ? "hsl(188 95% 55% / 0.55)" : "hsl(188 95% 55% / 0.35)"}
                stroke="hsl(188 95% 55%)" strokeWidth={activePart === "wing" ? 1.6 : 1} />
              {/* gurney */}
              <path d="M898,238 L902,234 L902,238 Z" fill="hsl(38 95% 58%)" />
              {/* endplates */}
              <path d="M736,236 L744,236 L744,272 L736,272 Z" fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
              <path d="M896,236 L904,236 L904,260 L896,260 Z" fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
            </g>
          )}

          {/* wheels */}
          <g>
            <circle cx="290" cy="365" r="32" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
            <circle cx="290" cy="365" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
            <circle cx="780" cy="365" r="32" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
            <circle cx="780" cy="365" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
          </g>

          {/* Part callouts */}
          {showLabels && partLabels.filter(l => isOn(l.id)).map((l) => {
            const part = parts.find(p => p.id === l.id)!;
            const isActive = activePart === l.id;
            return (
              <g key={l.id} opacity={isActive ? 1 : 0.7}>
                <line x1={l.x} y1={l.y} x2={l.lx} y2={l.ly}
                  stroke={isActive ? "hsl(38 95% 58%)" : "hsl(188 95% 55%)"} strokeWidth="0.6" />
                <circle cx={l.x} cy={l.y} r="2.5" fill={isActive ? "hsl(38 95% 58%)" : "hsl(188 95% 55%)"} />
                <g transform={`translate(${l.lx - 50}, ${l.ly - 8})`}>
                  <rect width="100" height="16" rx="3"
                    fill="hsl(220 26% 6% / 0.9)" stroke={isActive ? "hsl(38 95% 58%)" : "hsl(188 95% 55%)"} strokeWidth="0.5" />
                  <text x="6" y="11" fill="hsl(0 0% 95%)" style={{ font: "9px 'JetBrains Mono', monospace" }}>
                    {part.name.toUpperCase()}
                  </text>
                  <text x="94" y="11" textAnchor="end" fill="hsl(188 95% 55%)" style={{ font: "9px 'JetBrains Mono', monospace" }}>
                    +{part.df}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* HUD top-right */}
        <div className="absolute top-3 right-3 flex items-center gap-3 rounded-md border border-border bg-surface-1/80 px-3 py-1.5 backdrop-blur text-mono text-[10px]">
          <div><span className="text-muted-foreground">U∞ </span><span className="text-foreground">200 km/h</span></div>
          <div><span className="text-muted-foreground">α </span><span className="text-foreground">0°</span></div>
          <div><span className="text-muted-foreground">ρ </span><span className="text-foreground">1.225</span></div>
        </div>

        {/* Bottom-left axes */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 text-mono text-[10px]">
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-destructive" />
            <span className="text-foreground">X</span><span className="text-muted-foreground">forward</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-success" />
            <span className="text-foreground">Y</span><span className="text-muted-foreground">left</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" />
            <span className="text-foreground">Z</span><span className="text-muted-foreground">up</span>
          </div>
        </div>

        <div className="absolute bottom-3 right-3 text-mono text-[10px] text-muted-foreground/70">
          drag · orbit  /  shift+drag · pan  /  scroll · zoom
        </div>
      </div>

      {/* Legend strip */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <Legend
          items={[
            { label: "Active part",   color: "text-warning", shape: "square" },
            { label: "Enabled",       color: "text-primary", shape: "square" },
            { label: "Approximation", color: "text-muted-foreground", shape: "line" },
          ]}
        />
        <div className="text-mono text-[10px] text-muted-foreground">
          Surrogate model · CFD confirmation pending
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Left rail — categories                                             */
/* ─────────────────────────────────────────────────────────────────── */
function CategoryRail({
  parts, activeId, onSelect, onToggle,
}: {
  parts: PartDef[]; activeId: PartId;
  onSelect: (id: PartId) => void;
  onToggle: (id: PartId) => void;
}) {
  const enabledCount = parts.filter(p => p.enabled).length;

  return (
    <div className="glass rounded-xl flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Aero parts</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground -mr-1">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {groupOrder.map((group) => {
          const items = parts.filter(p => p.group === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <div className="px-2 py-1 text-mono text-[9px] uppercase tracking-widest text-muted-foreground/70">
                {group}
              </div>
              <div className="space-y-1">
                {items.map((p) => {
                  const Icon = PART_ICONS[p.id];
                  const isActive = p.id === activeId;
                  return (
                    <div
                      key={p.id}
                      onClick={() => onSelect(p.id)}
                      className={cn(
                        "group cursor-pointer rounded-md border px-2.5 py-2 transition-all",
                        isActive
                          ? "border-primary/40 bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
                          : "border-transparent hover:border-border hover:bg-surface-2/60",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <Switch
                          checked={p.enabled}
                          onCheckedChange={(e) => { onToggle(p.id); }}
                          onClick={(e) => e.stopPropagation()}
                          className="data-[state=checked]:bg-primary scale-75 -ml-1"
                        />
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                        <div className="min-w-0 flex-1">
                          <div className={cn("text-sm truncate", !p.enabled && "text-muted-foreground")}>
                            {p.name}
                          </div>
                          <div className="text-mono text-[10px] text-muted-foreground tabular-nums">
                            {p.enabled ? <>DF +{p.df} · DR +{p.dr}</> : <>off</>}
                          </div>
                        </div>
                        {p.status === "tuned" && (
                          <Pin className="h-3 w-3 text-primary-glow shrink-0" />
                        )}
                      </div>
                      {isActive && p.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {p.tags.slice(0, 2).map((t) => <TagPill key={t.label} tag={t} />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border px-4 py-2.5 text-mono text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{enabledCount} of {parts.length} enabled</span>
        <span className="text-primary">⌀ +{parts.filter(p => p.enabled).reduce((s, p) => s + p.df, 0)} kgf DF</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Right rail — component editor                                      */
/* ─────────────────────────────────────────────────────────────────── */
function ComponentEditor({
  part, values, onChange,
}: {
  part: PartDef;
  values: Record<string, number>;
  onChange: (key: string, v: number) => void;
}) {
  const schema = partParams[part.id];
  const [tab, setTab] = useState(schema.tabs[0].id);
  const activeTab = schema.tabs.find(t => t.id === tab) ?? schema.tabs[0];
  const Icon = PART_ICONS[part.id];

  return (
    <div className="glass rounded-xl flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-semibold truncate">{part.name}</h3>
                {part.status === "tuned" && (
                  <span className="text-mono text-[9px] uppercase tracking-widest text-primary-glow">tuned</span>
                )}
              </div>
              <div className="text-mono text-[10px] text-muted-foreground">{part.group} · GT-style profile</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Lock className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {part.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {part.tags.map(t => <TagPill key={t.label} tag={t} />)}
          </div>
        )}

        {/* Tabs */}
        {schema.tabs.length > 1 && (
          <div className="mt-3 inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-1 p-0.5">
            {schema.tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors",
                  tab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Params */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {activeTab.params.map((p) => (
          <ParamSlider
            key={p.key}
            label={p.label}
            value={values[p.key] ?? p.default}
            min={p.min}
            max={p.max}
            unit={p.unit ? ` ${p.unit}` : ""}
            hint={p.hint}
            onChange={(v) => onChange(p.key, v)}
          />
        ))}
      </div>

      {/* Per-part surrogate prediction */}
      <div className="border-t border-border bg-surface-1/40 p-4">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Surrogate prediction · this part
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: "ΔDF",   v: `+${part.df}`, u: "kgf", c: "text-success" },
            { l: "ΔDrag", v: `+${part.dr}`, u: "kgf", c: "text-warning" },
            { l: "L/D",   v: part.dr > 0 ? (part.df / part.dr).toFixed(1) : "∞", u: "", c: "text-foreground" },
          ].map((r) => (
            <div key={r.l} className="rounded-md border border-border bg-surface-1 p-2">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{r.l}</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className={cn("text-mono text-base font-semibold tabular-nums", r.c)}>{r.v}</span>
                {r.u && <span className="text-mono text-[10px] text-muted-foreground">{r.u}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Preset rail                                                        */
/* ─────────────────────────────────────────────────────────────────── */
function PresetRail({ active, onPick }: { active: string; onPick: (id: string) => void }) {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Preset packages</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          1-click baseline
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
        {presets.map((p) => {
          const Icon = p.icon;
          const isActive = p.id === active;
          return (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              className={cn(
                "group relative overflow-hidden rounded-lg border p-3 text-left transition-all",
                isActive
                  ? "border-primary/40 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]"
                  : "border-border bg-surface-1 hover:border-primary/30",
              )}
            >
              <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60 pointer-events-none", p.accent)} />
              <div className="relative flex items-center gap-2">
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md border",
                  isActive ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface-2 text-muted-foreground group-hover:text-primary",
                )}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-mono text-[10px] text-muted-foreground truncate">{p.sub}</div>
                </div>
              </div>
              <div className="relative mt-3 grid grid-cols-3 gap-1.5 text-mono text-[10px] tabular-nums">
                <div><span className="text-muted-foreground">DF </span><span className="text-success">+{p.df}</span></div>
                <div><span className="text-muted-foreground">DR </span><span className="text-warning">+{p.dr}</span></div>
                <div><span className="text-muted-foreground">F% </span><span className="text-foreground">{p.bias}</span></div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Variant summary strip (bottom)                                     */
/* ─────────────────────────────────────────────────────────────────── */
function VariantStrip({ parts, variantName, setVariantName }: {
  parts: PartDef[]; variantName: string; setVariantName: (s: string) => void;
}) {
  const enabled = parts.filter(p => p.enabled);
  const totalDF = enabled.reduce((s, p) => s + p.df, 0);
  const totalDR = enabled.reduce((s, p) => s + p.dr, 0);
  const ld = totalDR > 0 ? (totalDF / totalDR).toFixed(2) : "∞";
  const frontDF = enabled.filter(p => p.group === "Front").reduce((s, p) => s + p.df, 0)
                + enabled.filter(p => p.id === "underbody").reduce((s, p) => s + p.df * 0.4, 0);
  const frontShare = totalDF > 0 ? ((frontDF / totalDF) * 100).toFixed(1) : "0.0";

  const stats = [
    { l: "Total downforce", v: `+${totalDF}`, u: "kgf", c: "text-primary",     d: "+18.4%" },
    { l: "Total drag",      v: `+${totalDR}`, u: "kgf", c: "text-warning",     d: "+4.1%"  },
    { l: "L/D ratio",       v: ld,            u: "",    c: "text-foreground",  d: "+0.31"  },
    { l: "Front share",     v: frontShare,    u: "%",   c: "text-foreground",  d: "target 42" },
    { l: "Mass added",      v: "11.4",        u: "kg",  c: "text-foreground",  d: "" },
    { l: "Cost est.",       v: "$ 4.2k",      u: "",    c: "text-foreground",  d: "" },
  ];

  return (
    <div className="sticky bottom-0 z-30 border-t border-border bg-surface-0/85 backdrop-blur-xl">
      <div className="px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          {/* Variant name input */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
              <Wrench className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Variant · draft
              </div>
              <input
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                className="bg-transparent text-sm font-medium tracking-tight outline-none focus:ring-0 border-b border-transparent focus:border-primary/50 transition-colors w-full max-w-[260px]"
              />
            </div>
          </div>

          <div className="hidden lg:block h-9 w-px bg-border" />

          {/* Stats */}
          <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2">
            {stats.map((s) => (
              <div key={s.l} className="leading-tight">
                <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</div>
                <div className="flex items-baseline gap-1">
                  <span className={cn("text-mono text-base font-semibold tabular-nums", s.c)}>{s.v}</span>
                  {s.u && <span className="text-mono text-[10px] text-muted-foreground">{s.u}</span>}
                  {s.d && <span className="text-mono text-[10px] text-muted-foreground/70 ml-1">{s.d}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="glass" size="sm">
              <GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare
            </Button>
            <Button variant="glass" size="sm">
              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
            </Button>
            <Button variant="glass" size="sm">
              <Save className="mr-2 h-3.5 w-3.5" /> Save variant
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/simulation">
                Continue to Simulation
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Compatibility panel (small, under preset)                          */
/* ─────────────────────────────────────────────────────────────────── */
function CompatibilityPanel() {
  const items = [
    { l: "Splitter ↔ Diffuser", s: "ok",   note: "Pressure-coupled · balanced" },
    { l: "Wing ↔ Roof flow",    s: "warn", note: "Wing in roof wake at α > 4°" },
    { l: "Canards ↔ Bumper",    s: "ok",   note: "Clearance 18 mm" },
    { l: "Diffuser ↔ Skirts",   s: "ok",   note: "Floor sealed" },
  ];
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Compatibility</h3>
        </div>
        <StatusChip tone="warning" size="sm" dot={false}>1 check</StatusChip>
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((it) => (
          <li key={it.l} className="px-4 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{it.l}</span>
              <span className={cn(
                "text-mono text-[10px] uppercase tracking-widest",
                it.s === "ok" ? "text-success" : "text-warning",
              )}>{it.s}</span>
            </div>
            <div className="text-mono text-[10px] text-muted-foreground mt-0.5">{it.note}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Parts = () => {
  const [parts, setParts] = useState<PartDef[]>(initialParts);
  const [activeId, setActiveId] = useState<PartId>("wing");
  const [preset, setPreset] = useState<string>("track");
  const [variantName, setVariantName] = useState<string>("Optimized Package v3 — draft");
  const [values, setValues] = useState<Record<string, number>>({});

  const activePart = parts.find(p => p.id === activeId)!;

  const toggle = (id: PartId) =>
    setParts((prev) => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));

  const setValue = (key: string, v: number) =>
    setValues((prev) => ({ ...prev, [key]: v }));

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
            <span className="text-foreground">Aero parts</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip tone="warning" size="sm">Surrogate preview</StatusChip>
            <ConfidenceBadge level="medium" compact />
            <div className="h-5 w-px bg-border mx-1" />
            <Button variant="glass" size="sm" asChild>
              <Link to="/geometry"><ChevronLeft className="mr-2 h-3.5 w-3.5" /> Geometry</Link>
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/simulation">Continue to Simulation <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 pb-2">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
              Step 02 · Parametric configuration
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Aero Parts</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Build your aero package from validated parametric components. Predicted deltas use the surrogate model —
              confirm with a full CFD run before committing the variant.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-1/60 px-3 py-2">
            <div className="leading-tight">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Reference</div>
              <div className="text-mono text-[11px] text-foreground">U∞ 200 km/h · ρ 1.225</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="leading-tight">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Last sync</div>
              <div className="text-mono text-[11px] text-foreground">just now</div>
            </div>
          </div>
        </div>

        {/* Presets */}
        <PresetRail active={preset} onPick={setPreset} />

        {/* Main 3-column workspace */}
        <div className="mt-4 grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-3 min-h-[680px]">
            <CategoryRail
              parts={parts}
              activeId={activeId}
              onSelect={setActiveId}
              onToggle={toggle}
            />
          </div>

          <div className="xl:col-span-6 space-y-4">
            <AeroViewer activePart={activeId} parts={parts} />
            <CompatibilityPanel />
          </div>

          <div className="xl:col-span-3 min-h-[680px]">
            <ComponentEditor
              part={activePart}
              values={values}
              onChange={setValue}
            />
          </div>
        </div>
      </div>

      {/* Sticky variant strip */}
      <VariantStrip parts={parts} variantName={variantName} setVariantName={setVariantName} />
    </AppLayout>
  );
};

export default Parts;
