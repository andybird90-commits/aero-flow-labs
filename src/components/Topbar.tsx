import { useLocation } from "react-router-dom";
import { Bell, Search, ChevronRight, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";

const labels: Record<string, string[]> = {
  "/garage": ["Garage"],
  "/build": ["Build", "Overview"],
  "/geometry": ["Build", "Geometry"],
  "/parts": ["Build", "Aero Parts"],
  "/simulation": ["Build", "Simulation Setup"],
  "/results": ["Build", "Results"],
  "/compare": ["Build", "Compare"],
  "/exports": ["Exports & Reports"],
  "/system": ["System Status"],
  "/design-system": ["Design System"],
  "/": ["Welcome"],
};

export function Topbar() {
  const { pathname } = useLocation();
  const crumbs = labels[pathname] ?? ["AeroLab"];

  return (
    <div className="flex w-full items-center gap-4">
      <nav className="flex items-center gap-2 text-sm">
        <span className="text-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          AeroLab
        </span>
        {crumbs.map((c, i) => (
          <span key={c} className="flex items-center gap-2">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className={i === crumbs.length - 1 ? "text-foreground" : "text-muted-foreground"}>
              {c}
            </span>
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs text-muted-foreground w-72">
          <Search className="h-3.5 w-3.5" />
          <input
            placeholder="Search builds, parts, runs…"
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="text-mono text-[10px] rounded border border-border bg-surface-2 px-1.5 py-0.5">
            ⌘K
          </kbd>
        </div>

        <div className="hidden lg:flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5">
          <Cpu className="h-3.5 w-3.5 text-primary" />
          <span className="text-mono text-[11px] text-muted-foreground">SOLVER</span>
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
          <span className="text-mono text-[11px] text-foreground">ONLINE</span>
        </div>

        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
        </Button>
      </div>
    </div>
  );
}
