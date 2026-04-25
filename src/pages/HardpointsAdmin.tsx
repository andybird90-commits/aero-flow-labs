import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Crosshair, Plus, Trash2, ShieldAlert, MousePointerClick } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin, useCarTemplates, useCarStlForTemplate, useSignedCarStlUrl } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import {
  useCarHardpoints, useAddCarHardpoint, useUpdateCarHardpoint, useDeleteCarHardpoint,
  HARDPOINT_TYPES, HARDPOINT_LABELS,
  type CarHardpoint, type CarHardpointType,
} from "@/lib/build-studio/hardpoints";
import type { Vec3 } from "@/lib/build-studio/placed-parts";
import { HardpointsAdminViewport } from "@/components/build-studio/HardpointsAdminViewport";

/**
 * Hardpoints admin — define anatomical reference points on each car_template.
 *
 * Used by Shell Fit Mode: a user pairs N skin landmarks with these hardpoints
 * and we solve for the rigid+scale transform that aligns the body skin to
 * the donor car. 3+ pairs → full alignment (rotation + translation + uniform
 * scale). 1–2 pairs → translation-only.
 */
export default function HardpointsAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);
  const { data: templates = [] } = useCarTemplates();
  const [templateId, setTemplateId] = useState<string>("");

  const activeTemplateId = templateId || templates[0]?.id || "";
  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === activeTemplateId) ?? null,
    [templates, activeTemplateId],
  );
  const { data: hardpoints = [], isLoading } = useCarHardpoints(activeTemplateId);
  const { data: heroStl } = useCarStlForTemplate(activeTemplateId);
  const { data: heroStlUrl } = useSignedCarStlUrl(heroStl);

  const add = useAddCarHardpoint();
  const update = useUpdateCarHardpoint();
  const del = useDeleteCarHardpoint();

  const [newType, setNewType] = useState<CarHardpointType>("front_wheel_centre");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<CarHardpointType, CarHardpoint[]>();
    for (const h of hardpoints) {
      const arr = m.get(h.point_type) ?? [];
      arr.push(h);
      m.set(h.point_type, arr);
    }
    return m;
  }, [hardpoints]);

  if (roleLoading) {
    return (
      <AppLayout>
        <div className="container mx-auto p-8 text-sm text-muted-foreground">Checking access…</div>
      </AppLayout>
    );
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const handleCarClick = async (pos: Vec3) => {
    if (!activeTemplateId) return;
    if (selectedId) {
      const h = hardpoints.find((x) => x.id === selectedId);
      if (!h) return;
      update.mutate({
        id: h.id,
        car_template_id: h.car_template_id,
        patch: { position: pos },
      });
      return;
    }
    try {
      const created = await add.mutateAsync({
        car_template_id: activeTemplateId,
        point_type: newType,
        label: HARDPOINT_LABELS[newType],
        position: pos,
      });
      setSelectedId(created.id);
      toast({ title: `Placed ${HARDPOINT_LABELS[newType]}` });
    } catch (e: any) {
      toast({ title: "Couldn't place hardpoint", description: e.message, variant: "destructive" });
    }
  };

  const handleAddAtOrigin = async () => {
    if (!activeTemplateId) {
      toast({ title: "Pick a car template first", variant: "destructive" });
      return;
    }
    try {
      const created = await add.mutateAsync({
        car_template_id: activeTemplateId,
        point_type: newType,
        label: HARDPOINT_LABELS[newType],
      });
      setSelectedId(created.id);
      toast({ title: "Hardpoint added" });
    } catch (e: any) {
      toast({ title: "Couldn't add hardpoint", description: e.message, variant: "destructive" });
    }
  };

  const handlePosChange = (h: CarHardpoint, axis: keyof Vec3, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    update.mutate({
      id: h.id,
      car_template_id: h.car_template_id,
      patch: { position: { ...h.position, [axis]: n } },
    });
  };

  const selected = hardpoints.find((h) => h.id === selectedId) ?? null;

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-6xl space-y-6">
        <PageHeader
          eyebrow="Admin"
          title="Hardpoints"
          description="Define anatomical reference points on each car template (wheel centres, sill line, windscreen base, …). Shell Fit uses these to auto-align body skins to the donor car."
        />

        <div className="glass rounded-xl p-4 flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px] space-y-1.5">
            <Label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Car template</Label>
            <Select value={activeTemplateId} onValueChange={(v) => { setTemplateId(v); setSelectedId(null); }}>
              <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.make} {t.model}{t.trim ? ` ${t.trim}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[220px] space-y-1.5">
            <Label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">New hardpoint type</Label>
            <Select value={newType} onValueChange={(v) => setNewType(v as CarHardpointType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HARDPOINT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{HARDPOINT_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAddAtOrigin} disabled={add.isPending || !activeTemplateId} variant="outline">
            <Plus className="h-4 w-4 mr-1.5" /> Add at origin
          </Button>
        </div>

        {activeTemplateId && (
          <div className="glass rounded-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MousePointerClick className="h-3.5 w-3.5" />
                {selected ? (
                  <>Click the car to <span className="text-primary font-medium">move</span> {selected.label || HARDPOINT_LABELS[selected.point_type]}</>
                ) : (
                  <>Click the car to <span className="text-primary font-medium">place a new {HARDPOINT_LABELS[newType]}</span></>
                )}
              </div>
              {selected && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedId(null)}>
                  Deselect
                </Button>
              )}
            </div>
            <div className="h-[420px] w-full">
              <HardpointsAdminViewport
                template={activeTemplate}
                heroStlUrl={heroStlUrl}
                hardpoints={hardpoints}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onClickCar={handleCarClick}
              />
            </div>
          </div>
        )}

        {!activeTemplateId ? (
          <div className="glass rounded-xl p-10 text-center text-sm text-muted-foreground">
            Select a car template above to view its hardpoints.
          </div>
        ) : isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="glass h-16 rounded-xl animate-pulse" />)}</div>
        ) : hardpoints.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
              <Crosshair className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">No hardpoints yet</h2>
            <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
              Pick a hardpoint type above, then click the car to drop it there. You'll want at least 6–8 well-spread points for accurate Shell Fit alignment (e.g. all 4 wheel centres + windscreen base + windscreen top).
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([type, list]) => (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold tracking-tight">{HARDPOINT_LABELS[type]}</h3>
                  <Badge variant="outline" className="text-[10px]">{list.length}</Badge>
                </div>
                <div className="space-y-2">
                  {list.map((h) => (
                    <div
                      key={h.id}
                      className={`glass rounded-lg p-3 flex items-center gap-3 flex-wrap cursor-pointer ${
                        selectedId === h.id ? "ring-1 ring-primary" : ""
                      }`}
                      onClick={() => setSelectedId(h.id)}
                    >
                      <Crosshair className={`h-4 w-4 shrink-0 ${selectedId === h.id ? "text-primary" : "text-muted-foreground"}`} />
                      <Input
                        className="h-8 w-[200px] text-xs"
                        value={h.label ?? ""}
                        placeholder="Label (e.g. Wheel hub FL)"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => update.mutate({
                          id: h.id, car_template_id: h.car_template_id,
                          patch: { label: e.target.value },
                        })}
                      />
                      <div className="flex items-center gap-1.5 ml-auto" onClick={(e) => e.stopPropagation()}>
                        {(["x", "y", "z"] as const).map((axis) => (
                          <div key={axis} className="flex items-center gap-1">
                            <span className="text-mono text-[10px] uppercase text-muted-foreground">{axis}</span>
                            <Input
                              type="number"
                              step="0.05"
                              className="h-8 w-[72px] text-xs text-mono"
                              value={Number(h.position[axis] ?? 0).toFixed(2)}
                              onChange={(e) => handlePosChange(h, axis, e.target.value)}
                            />
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive h-8 w-8 p-0"
                          onClick={() => {
                            if (selectedId === h.id) setSelectedId(null);
                            del.mutate({ id: h.id, car_template_id: h.car_template_id });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-md bg-muted/30">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Coordinates are in metres. Origin is the ground centre under the car. +X is forward, +Y is up, +Z is the driver-side lateral. Use the same convention when pairing with shell landmarks.
              </span>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
