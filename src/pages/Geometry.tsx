import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { ViewerPlaceholder } from "@/components/ViewerPlaceholder";
import { Button } from "@/components/ui/button";
import { Upload, RotateCcw, Maximize2, Layers, Ruler } from "lucide-react";

const Geometry = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="Step 1 of 5"
          title="Geometry"
          description="Validate the vehicle baseline mesh, ride height and reference dimensions before adding parts."
          actions={
            <>
              <Button variant="outline" size="sm" className="border-border bg-surface-1">
                <Upload className="mr-2 h-3.5 w-3.5" /> Upload custom STL
              </Button>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground shadow-glow">
                Continue to parts
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <div className="lg:col-span-3 space-y-4">
            <ViewerPlaceholder
              variant="geometry"
              badge="MESH READY"
              overlay={
                <div className="absolute top-3 right-32 flex gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7 border-border bg-surface-1/80 backdrop-blur"><RotateCcw className="h-3.5 w-3.5" /></Button>
                  <Button variant="outline" size="icon" className="h-7 w-7 border-border bg-surface-1/80 backdrop-blur"><Maximize2 className="h-3.5 w-3.5" /></Button>
                </div>
              }
            />

            <div className="grid gap-4 md:grid-cols-3">
              {[
                { label: "Wheelbase", v: "2700", u: "mm" },
                { label: "Track (front)", v: "1585", u: "mm" },
                { label: "Frontal area", v: "2.18", u: "m²" },
                { label: "Ride height (F)", v: "115", u: "mm" },
                { label: "Ride height (R)", v: "118", u: "mm" },
                { label: "Reference Cd", v: "0.34", u: "" },
              ].map((s) => (
                <div key={s.label} className="glass rounded-lg p-4">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tabular-nums">{s.v}</span>
                    {s.u && <span className="text-mono text-xs text-muted-foreground">{s.u}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar — mesh */}
          <div className="space-y-4">
            <div className="glass rounded-lg p-5">
              <div className="flex items-center gap-2 text-mono text-[10px] uppercase tracking-widest text-primary/80">
                <Layers className="h-3.5 w-3.5" /> Mesh quality
              </div>
              <div className="mt-3 space-y-3 text-xs">
                {[
                  { l: "Cell count", v: "1.84M" },
                  { l: "Y+ avg", v: "32" },
                  { l: "Skewness max", v: "0.71" },
                  { l: "Boundary layers", v: "8" },
                  { l: "Refinement zones", v: "6" },
                ].map((r) => (
                  <div key={r.l} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{r.l}</span>
                    <span className="text-mono">{r.v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-mono text-[11px] text-success">
                ✓ Mesh validated for solver
              </div>
            </div>

            <div className="glass rounded-lg p-5">
              <div className="flex items-center gap-2 text-mono text-[10px] uppercase tracking-widest text-primary/80">
                <Ruler className="h-3.5 w-3.5" /> Reference frame
              </div>
              <div className="mt-3 space-y-2 text-xs">
                {["Origin: contact patch · centre", "X: forward", "Y: left", "Z: up"].map((r) => (
                  <div key={r} className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-1 w-1 rounded-full bg-primary" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface-1 p-4 text-xs">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Assumptions</div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>• Closed underbody approximation</li>
                <li>• Wheels rotating, ground moving</li>
                <li>• Cooling flow modelled as porous</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Geometry;
