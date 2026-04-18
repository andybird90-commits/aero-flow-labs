import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { ViewerPlaceholder } from "@/components/ViewerPlaceholder";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRight } from "lucide-react";

const variants = [
  { name: "Baseline", label: "OEM trim", color: "muted", df: 240, dr: 108, ld: 2.22, bal: 44.4 },
  { name: "Variant A", label: "Street pack", color: "primary", df: 268, dr: 109, ld: 2.46, bal: 43.1 },
  { name: "Variant B", label: "Track pack", color: "primary", df: 284, dr: 112, ld: 2.54, bal: 42.6 },
];

const metrics = [
  { l: "Downforce", k: "df", u: "kgf" },
  { l: "Drag", k: "dr", u: "kgf" },
  { l: "L/D", k: "ld", u: "" },
  { l: "Aero balance F", k: "bal", u: "%" },
] as const;

const Compare = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-[1500px] px-6 py-8">
        <PageHeader
          eyebrow="Step 5 of 5"
          title="Compare variants"
          description="Side-by-side comparison of selected variants. Deltas are computed against the leftmost column."
          actions={
            <>
              <Button variant="outline" size="sm" className="border-border bg-surface-1">
                <Plus className="mr-2 h-3.5 w-3.5" /> Add variant
              </Button>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground shadow-glow">
                Promote Variant B <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {variants.map((v, i) => (
            <div
              key={v.name}
              className={`glass rounded-lg p-5 ${i === 2 ? "ring-1 ring-primary/40" : ""}`}
            >
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{v.label}</div>
                  <div className="mt-1 text-lg font-semibold">{v.name}</div>
                </div>
                {i === 2 && (
                  <span className="text-mono text-[10px] uppercase tracking-widest rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                    Selected
                  </span>
                )}
              </div>
              <div className="mt-4">
                <ViewerPlaceholder variant="pressure" className="min-h-[220px]" />
              </div>

              <div className="mt-4 space-y-3">
                {metrics.map((m) => {
                  const value = (v as any)[m.k] as number;
                  const base = (variants[0] as any)[m.k] as number;
                  const delta = value - base;
                  const pct = ((delta / base) * 100).toFixed(1);
                  return (
                    <div key={m.k} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-b-0">
                      <span className="text-xs text-muted-foreground">{m.l}</span>
                      <div className="text-right">
                        <div className="text-mono text-base tabular-nums">{value}{m.u && <span className="text-[10px] text-muted-foreground ml-1">{m.u}</span>}</div>
                        {i > 0 && (
                          <div className={`text-mono text-[10px] ${delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {delta > 0 ? "+" : ""}{delta.toFixed(1)} ({pct}%)
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Delta matrix */}
        <div className="glass mt-6 rounded-lg p-5 overflow-x-auto">
          <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80 mb-4">Per-component delta matrix</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="text-left font-normal pb-3 pr-4">Component</th>
                <th className="text-right font-normal pb-3 px-4">Baseline</th>
                <th className="text-right font-normal pb-3 px-4">Variant A</th>
                <th className="text-right font-normal pb-3 px-4">Variant B</th>
                <th className="text-right font-normal pb-3 pl-4">Δ best</th>
              </tr>
            </thead>
            <tbody className="text-mono tabular-nums">
              {[
                { c: "Front splitter DF", a: 0, b: 32, x: 38 },
                { c: "Canards DF", a: 0, b: 8, x: 12 },
                { c: "Diffuser DF", a: 18, b: 38, x: 46 },
                { c: "Rear wing DF", a: 60, b: 120, x: 148 },
                { c: "Total drag", a: 108, b: 109, x: 112 },
              ].map((r) => (
                <tr key={r.c} className="border-t border-border/50">
                  <td className="py-3 pr-4 text-foreground/90">{r.c}</td>
                  <td className="text-right py-3 px-4 text-muted-foreground">{r.a}</td>
                  <td className="text-right py-3 px-4">{r.b}</td>
                  <td className="text-right py-3 px-4 text-primary">{r.x}</td>
                  <td className="text-right py-3 pl-4 text-success">+{r.x - r.a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
};

export default Compare;
