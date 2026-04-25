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
import { Magnet, Plus, Trash2, ShieldAlert, Link as LinkIcon, MousePointerClick } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin, useCarTemplates, useCarStlForTemplate, useSignedCarStlUrl } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import {
  useSnapZones, useAddSnapZone, useUpdateSnapZone, useDeleteSnapZone,
  SNAP_ZONE_TYPES, SNAP_ZONE_LABELS, MIRROR_TYPE,
  type SnapZone, type SnapZoneType,
} from "@/lib/build-studio/snap-zones";
import type { Vec3 } from "@/lib/build-studio/placed-parts";
import { SnapZonesAdminViewport } from "@/components/build-studio/SnapZonesAdminViewport";

/**
 * Snap Zones admin — define attachment slots for each car_template.
 *
 * Workflow:
 *  1. Pick a car template (loads its hero STL into the viewport).
 *  2. Pick a zone type, then click on the car to drop a zone there
 *     (or click "Add zone" to spawn at origin).
 *  3. Click an existing zone gizmo to select it; further clicks on the
 *     car move that zone. Use the row controls for fine numeric tuning.
 *  4. "Auto-pair L↔R" links matching left/right zones via mirror_zone_id
 *     so the user-side mirror button works without guessing.
 */
export default function SnapZonesAdmin() {
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
  const { data: zones = [], isLoading } = useSnapZones(activeTemplateId);
  const { data: heroStl } = useCarStlForTemplate(activeTemplateId);
  const { data: heroStlUrl } = useSignedCarStlUrl(heroStl);

  const add = useAddSnapZone();
  const update = useUpdateSnapZone();
  const del = useDeleteSnapZone();

  const [newType, setNewType] = useState<SnapZoneType>("front_splitter");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<SnapZoneType, SnapZone[]>();
    for (const z of zones) {
      const arr = m.get(z.zone_type) ?? [];
      arr.push(z);
      m.set(z.zone_type, arr);
    }
    return m;
  }, [zones]);

  if (roleLoading) {
    return (
      <AppLayout>
        <div className="container mx-auto p-8 text-sm text-muted-foreground">Checking access…</div>
      </AppLayout>
    );
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  /** Click on the 3D car: move selected zone, or spawn a new one. */
  const handleCarClick = async (pos: Vec3) => {
    if (!activeTemplateId) return;
    if (selectedZoneId) {
      const z = zones.find((x) => x.id === selectedZoneId);
      if (!z) return;
      update.mutate({
        id: z.id,
        car_template_id: z.car_template_id,
        patch: { position: pos },
      });
      return;
    }
    try {
      const created = await add.mutateAsync({
        car_template_id: activeTemplateId,
        zone_type: newType,
        label: SNAP_ZONE_LABELS[newType],
        position: pos,
      });
      setSelectedZoneId(created.id);
      toast({ title: `Placed ${SNAP_ZONE_LABELS[newType]}` });
    } catch (e: any) {
      toast({ title: "Couldn't place zone", description: e.message, variant: "destructive" });
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
        zone_type: newType,
        label: SNAP_ZONE_LABELS[newType],
      });
      setSelectedZoneId(created.id);
      toast({ title: "Snap zone added" });
    } catch (e: any) {
      toast({ title: "Couldn't add zone", description: e.message, variant: "destructive" });
    }
  };

  const handlePosChange = (zone: SnapZone, axis: keyof Vec3, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    update.mutate({
      id: zone.id,
      car_template_id: zone.car_template_id,
      patch: { position: { ...zone.position, [axis]: n } },
    });
  };

  /** Auto-pair zones whose types are L/R counterparts (front_left_arch ↔ front_right_arch, …). */
  const handleAutoPair = async () => {
    let paired = 0;
    for (const z of zones) {
      const partnerType = MIRROR_TYPE[z.zone_type];
      if (!partnerType) continue;
      const partner = zones.find((p) => p.zone_type === partnerType);
      if (!partner) continue;
      if (z.mirror_zone_id === partner.id) continue;
      await update.mutateAsync({
        id: z.id,
        car_template_id: z.car_template_id,
        patch: { mirror_zone_id: partner.id } as any,
      });
      paired++;
    }
    toast({ title: paired ? `Paired ${paired} zone${paired === 1 ? "" : "s"}` : "Nothing to pair" });
  };

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-6xl space-y-6">
        <PageHeader
          eyebrow="Admin"
          title="Snap Zones"
          description="Define part attachment slots on each car template. Click on the 3D car to place zones; users in the Build Studio will snap parts to them."
        />

        <div className="glass rounded-xl p-4 flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px] space-y-1.5">
            <Label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Car template</Label>
            <Select value={activeTemplateId} onValueChange={(v) => { setTemplateId(v); setSelectedZoneId(null); }}>
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
            <Label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">New zone type</Label>
            <Select value={newType} onValueChange={(v) => setNewType(v as SnapZoneType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SNAP_ZONE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{SNAP_ZONE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAddAtOrigin} disabled={add.isPending || !activeTemplateId} variant="outline">
            <Plus className="h-4 w-4 mr-1.5" /> Add at origin
          </Button>
          <Button onClick={handleAutoPair} disabled={zones.length < 2} variant="outline">
            <LinkIcon className="h-4 w-4 mr-1.5" /> Auto-pair L↔R
          </Button>
        </div>

        {/* 3D viewport */}
        {activeTemplateId && (
          <div className="glass rounded-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MousePointerClick className="h-3.5 w-3.5" />
                {selectedZone ? (
                  <>Click the car to <span className="text-primary font-medium">move</span> {selectedZone.label || SNAP_ZONE_LABELS[selectedZone.zone_type]}</>
                ) : (
                  <>Click the car to <span className="text-primary font-medium">place a new {SNAP_ZONE_LABELS[newType]}</span></>
                )}
              </div>
              {selectedZone && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedZoneId(null)}>
                  Deselect
                </Button>
              )}
            </div>
            <div className="h-[420px] w-full">
              <SnapZonesAdminViewport
                template={activeTemplate}
                heroStlUrl={heroStlUrl}
                zones={zones}
                selectedZoneId={selectedZoneId}
                onSelectZone={setSelectedZoneId}
                onClickCar={handleCarClick}
              />
            </div>
          </div>
        )}

        {!activeTemplateId ? (
          <div className="glass rounded-xl p-10 text-center text-sm text-muted-foreground">
            Select a car template above to view its snap zones.
          </div>
        ) : isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="glass h-16 rounded-xl animate-pulse" />)}</div>
        ) : zones.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
              <Magnet className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">No snap zones yet</h2>
            <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
              Pick a zone type above, then click the car to drop it there. Repeat for splitter, sills, wing, arches… then hit "Auto-pair L↔R".
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([type, list]) => (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold tracking-tight">{SNAP_ZONE_LABELS[type]}</h3>
                  <Badge variant="outline" className="text-[10px]">{list.length}</Badge>
                </div>
                <div className="space-y-2">
                  {list.map((z) => {
                    const partner = z.mirror_zone_id ? zones.find((x) => x.id === z.mirror_zone_id) : null;
                    return (
                      <div
                        key={z.id}
                        className={`glass rounded-lg p-3 flex items-center gap-3 flex-wrap cursor-pointer ${
                          selectedZoneId === z.id ? "ring-1 ring-primary" : ""
                        }`}
                        onClick={() => setSelectedZoneId(z.id)}
                      >
                        <Magnet className={`h-4 w-4 shrink-0 ${selectedZoneId === z.id ? "text-primary" : "text-muted-foreground"}`} />
                        <Input
                          className="h-8 w-[180px] text-xs"
                          value={z.label ?? ""}
                          placeholder="Label"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => update.mutate({
                            id: z.id, car_template_id: z.car_template_id,
                            patch: { label: e.target.value },
                          })}
                        />
                        {partner && (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <LinkIcon className="h-2.5 w-2.5" />
                            {partner.label || SNAP_ZONE_LABELS[partner.zone_type]}
                          </Badge>
                        )}
                        <div className="flex items-center gap-1.5 ml-auto" onClick={(e) => e.stopPropagation()}>
                          {(["x", "y", "z"] as const).map((axis) => (
                            <div key={axis} className="flex items-center gap-1">
                              <span className="text-mono text-[10px] uppercase text-muted-foreground">{axis}</span>
                              <Input
                                type="number"
                                step="0.05"
                                className="h-8 w-[72px] text-xs text-mono"
                                value={Number(z.position[axis] ?? 0).toFixed(2)}
                                onChange={(e) => handlePosChange(z, axis, e.target.value)}
                              />
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive h-8 w-8 p-0"
                            onClick={() => {
                              if (selectedZoneId === z.id) setSelectedZoneId(null);
                              del.mutate({ id: z.id, car_template_id: z.car_template_id });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-md bg-muted/30">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Coordinates are in metres. Origin is the ground centre under the car. +X is forward, +Y is up, +Z is the driver-side lateral.
              </span>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
