import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { ParamSlider } from "@/components/ParamSlider";
import { ViewerPlaceholder } from "@/components/ViewerPlaceholder";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ChevronRight, Wrench, Plus } from "lucide-react";

const partGroups = [
  { id: "splitter", name: "Front splitter", enabled: true, df: "+38 kgf", dr: "+4 kgf" },
  { id: "canards", name: "Canards", enabled: true, df: "+12 kgf", dr: "+2 kgf" },
  { id: "skirts", name: "Side skirts", enabled: false, df: "—", dr: "—" },
  { id: "diffuser", name: "Rear diffuser", enabled: true, df: "+46 kgf", dr: "+1 kgf" },
  { id: "wing", name: "Rear wing", enabled: true, df: "+148 kgf", dr: "+18 kgf" },
];

const Parts = () => {
  const [chord, setChord] = useState(280);
  const [aoa, setAoa] = useState(8);
  const [endplate, setEndplate] = useState(120);
  const [splitter, setSplitter] = useState(60);
  const [diffAngle, setDiffAngle] = useState(11);

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="Step 2 of 5"
          title="Aero Parts"
          description="Configure parts with parametric controls. Predicted deltas use surrogate model — confirm with full CFD run."
          actions={
            <>
              <Button variant="outline" size="sm" className="border-border bg-surface-1">
                <Plus className="mr-2 h-3.5 w-3.5" /> Add custom part
              </Button>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground shadow-glow">
                Save & continue
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-12">
          {/* Parts list */}
          <div className="lg:col-span-3 glass rounded-lg p-3">
            <div className="px-2 py-2 text-mono text-[10px] uppercase tracking-widest text-primary/80">
              Parts library
            </div>
            <div className="space-y-1">
              {partGroups.map((p, i) => (
                <button
                  key={p.id}
                  className={`group flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors ${i === 4 ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-surface-2"}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Switch checked={p.enabled} className="data-[state=checked]:bg-primary" />
                    <div className="min-w-0">
                      <div className="text-sm truncate">{p.name}</div>
                      <div className="text-mono text-[10px] text-muted-foreground">DF {p.df} · DR {p.dr}</div>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
            <div className="mt-2 border-t border-border pt-3 px-2 text-mono text-[10px] text-muted-foreground">
              4 of 5 enabled · package ⌀ +244 kgf DF
            </div>
          </div>

          {/* Editor */}
          <div className="lg:col-span-6 space-y-4">
            <ViewerPlaceholder variant="geometry" badge="REAR WING · GT-style" />

            <div className="glass rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold">Rear wing — parameters</h3>
                </div>
                <Tabs defaultValue="profile">
                  <TabsList className="bg-surface-2 border border-border h-8">
                    <TabsTrigger value="profile" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Profile</TabsTrigger>
                    <TabsTrigger value="mount" className="text-xs">Mount</TabsTrigger>
                    <TabsTrigger value="endplate" className="text-xs">Endplate</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <ParamSlider label="Chord length" value={chord} onChange={setChord} min={180} max={380} unit=" mm" hint="GT3 ref 320" />
                <ParamSlider label="Angle of attack" value={aoa} onChange={setAoa} min={0} max={18} unit="°" hint="stall ~14°" />
                <ParamSlider label="Endplate height" value={endplate} onChange={setEndplate} min={60} max={180} unit=" mm" />
                <ParamSlider label="Mount height (deck)" value={120} min={50} max={250} unit=" mm" />
                <ParamSlider label="Span" value={1480} min={1200} max={1600} unit=" mm" />
                <ParamSlider label="Gurney flap" value={12} min={0} max={30} unit=" mm" />
              </div>

              <div className="mt-5 rounded-md border border-border bg-surface-1 p-3 text-mono text-[11px]">
                <div className="text-muted-foreground mb-1.5 uppercase text-[10px] tracking-widest">Surrogate prediction</div>
                <div className="grid grid-cols-3 gap-3 tabular-nums">
                  <div><span className="text-muted-foreground">ΔDF </span><span className="text-success">+148 kgf</span></div>
                  <div><span className="text-muted-foreground">ΔDR </span><span className="text-warning">+18 kgf</span></div>
                  <div><span className="text-muted-foreground">L/D </span><span className="text-foreground">8.2</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Inspector */}
          <div className="lg:col-span-3 space-y-4">
            <div className="glass rounded-lg p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Package summary</div>
              <div className="mt-4 space-y-3">
                {[
                  { l: "Total downforce", v: "+244", u: "kgf", c: "text-primary" },
                  { l: "Total drag", v: "+25", u: "kgf", c: "text-warning" },
                  { l: "Front share", v: "42.6", u: "%", c: "text-foreground" },
                  { l: "Est. mass added", v: "11.4", u: "kg", c: "text-foreground" },
                ].map((r) => (
                  <div key={r.l}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{r.l}</span>
                      <span className={`text-mono text-sm tabular-nums ${r.c}`}>{r.v}<span className="text-muted-foreground text-[10px] ml-1">{r.u}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass rounded-lg p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Compatibility</div>
              <ul className="mt-3 space-y-2 text-xs">
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">Splitter ↔ Diffuser</span>
                  <span className="text-success text-mono text-[11px]">OK</span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">Wing ↔ Roof flow</span>
                  <span className="text-warning text-mono text-[11px]">CHECK</span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">Canards ↔ Bumper</span>
                  <span className="text-success text-mono text-[11px]">OK</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Parts;
