import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { ViewerPlaceholder } from "@/components/ViewerPlaceholder";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, GitCompareArrows, FileDown } from "lucide-react";
import { Link } from "react-router-dom";

const Results = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="Run #2184 · Variant B · Converged"
          title="Results"
          description="CIVIC_FK8 · Track Pack · 180 km/h · 0° yaw · 2,400 iterations · wall time 38m 12s"
          actions={
            <>
              <Button variant="outline" size="sm" className="border-border bg-surface-1" asChild>
                <Link to="/compare"><GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare</Link>
              </Button>
              <Button size="sm" variant="hero" asChild>
                <Link to="/exports"><FileDown className="mr-2 h-3.5 w-3.5" /> Export report</Link>
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="DOWNFORCE" value="284" unit="kgf" delta={{ value: "+18.4%", direction: "up" }} accent />
          <StatCard label="DRAG" value="112" unit="kgf" delta={{ value: "+4.1%", direction: "up", good: "down" }} />
          <StatCard label="L/D" value="2.54" delta={{ value: "+0.31", direction: "up" }} accent />
          <StatCard label="BALANCE F" value="42.6" unit="%" delta={{ value: "−1.8 pt", direction: "down" }} hint="target 44%" />
        </div>

        <Tabs defaultValue="pressure" className="mt-6">
          <TabsList className="bg-surface-1 border border-border h-9">
            <TabsTrigger value="pressure" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Pressure</TabsTrigger>
            <TabsTrigger value="velocity" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Velocity</TabsTrigger>
            <TabsTrigger value="wake" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Wake</TabsTrigger>
            <TabsTrigger value="convergence" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Convergence</TabsTrigger>
          </TabsList>

          <TabsContent value="pressure" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2"><ViewerPlaceholder variant="pressure" badge="Cp · MIDPLANE" /></div>
              <div className="space-y-4">
                <div className="glass rounded-lg p-5">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Pressure summary</div>
                  <div className="mt-3 space-y-2 text-xs">
                    {[
                      { l: "Cp min (suction)", v: "−2.14" },
                      { l: "Cp max (stagnation)", v: "+1.00" },
                      { l: "Stag. line on splitter", v: "−42 mm" },
                      { l: "Wing upper Cp peak", v: "−1.86" },
                      { l: "Diffuser pressure recovery", v: "0.62" },
                    ].map((r) => (
                      <div key={r.l} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{r.l}</span>
                        <span className="text-mono">{r.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="glass rounded-lg p-5">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Force breakdown</div>
                  <div className="mt-3 space-y-2.5 text-xs">
                    {[
                      { l: "Front splitter", df: 38, dr: 4, w: 14 },
                      { l: "Canards", df: 12, dr: 2, w: 5 },
                      { l: "Underbody / diffuser", df: 46, dr: 1, w: 17 },
                      { l: "Rear wing", df: 148, dr: 18, w: 55 },
                      { l: "Body residual", df: 40, dr: 87, w: 15 },
                    ].map((r) => (
                      <div key={r.l}>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{r.l}</span>
                          <span className="text-mono">{r.df} / {r.dr}</span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-gradient-primary" style={{ width: `${r.w}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-mono text-[10px] text-muted-foreground">DF / DR in kgf</div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="velocity" className="mt-4">
            <ViewerPlaceholder variant="velocity" badge="U · MIDPLANE" />
          </TabsContent>
          <TabsContent value="wake" className="mt-4">
            <ViewerPlaceholder variant="wake" badge="WAKE · 5m DOWNSTREAM" />
          </TabsContent>

          <TabsContent value="convergence" className="mt-4">
            <div className="glass rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Residuals</div>
                <span className="text-mono text-[11px] text-success">CONVERGED · 1820 / 2400 it</span>
              </div>
              <div className="mt-4 relative h-64 rounded-md border border-border bg-surface-0 grid-bg-fine">
                <svg viewBox="0 0 600 220" className="absolute inset-0 h-full w-full">
                  {[
                    { c: "hsl(188 95% 55%)", d: "M0,40 C100,80 220,120 320,150 S500,190 600,200" },
                    { c: "hsl(0 75% 58%)", d: "M0,20 C100,60 220,90 320,130 S500,170 600,185" },
                    { c: "hsl(38 95% 58%)", d: "M0,60 C100,100 220,140 320,160 S500,195 600,205" },
                  ].map((p, i) => (
                    <path key={i} d={p.d} stroke={p.c} strokeWidth="1.5" fill="none" />
                  ))}
                </svg>
                <div className="absolute top-2 left-3 flex gap-3 text-mono text-[10px]">
                  <span className="text-primary">● Cd</span>
                  <span className="text-destructive">● Cl</span>
                  <span className="text-warning">● momentum</span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Results;
