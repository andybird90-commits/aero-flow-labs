import { useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";

const labels: Record<string, string[]> = {
  "/projects": ["Projects"],
  "/upload": ["Studio", "Upload Model"],
  "/brief": ["Studio", "Design Brief"],
  "/concepts": ["Studio", "Concepts"],
  "/parts": ["Studio", "Fitted Parts"],
  "/refine": ["Studio", "Refine"],
  "/exports": ["Studio", "Exports"],
  "/settings": ["Settings"],
  "/": ["Welcome"],
};

export function Topbar() {
  const { pathname } = useLocation();
  const crumbs = labels[pathname] ?? ["BodyKit Studio"];

  return (
    <div className="flex w-full items-center gap-4">
      <nav className="flex items-center gap-2 text-sm">
        <span className="text-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          BodyKit Studio
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
