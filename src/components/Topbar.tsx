import { useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";

const labels: Record<string, string[]> = {
  "/dashboard":         ["Dashboard"],
  "/concept-studio":    ["Studio", "Concept"],
  "/build-studio":      ["Studio", "3D Build"],
  "/part-library":      ["Library", "Parts"],
  "/body-skin-library": ["Library", "Body Skins"],
  "/car-library":       ["Library", "Cars"],
  "/projects":          ["Projects"],
  "/meshy-admin":       ["Admin", "Meshy"],
  "/blender-jobs":      ["Admin", "Blender Jobs"],
  "/settings":          ["Settings"],
  "/settings/car-stls": ["Settings", "Car STLs"],
  // Legacy crumbs (still reachable via URL)
  "/brief":             ["Studio", "Brief (legacy)"],
  "/concepts":          ["Studio", "Concepts"],
  "/parts":             ["Studio", "Parts (legacy)"],
  "/refine":            ["Studio", "Refine (legacy)"],
  "/exports":           ["Studio", "Exports (legacy)"],
  "/styles":            ["Library", "Styles"],
  "/garage":            ["Library", "Garage"],
  "/library":           ["Library"],
  "/marketplace":       ["Marketplace"],
  "/prototyper":        ["Prototyper (legacy)"],
  "/":                  ["Welcome"],
};

export function Topbar() {
  const { pathname } = useLocation();
  const crumbs = labels[pathname] ?? ["APEX NEXT"];

  return (
    <div className="flex w-full items-center gap-4">
      <nav className="flex items-center gap-2 text-sm">
        <span className="text-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          APEX NEXT
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
        <UserMenu />
      </div>
    </div>
  );
}
