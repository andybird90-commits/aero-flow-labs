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
import { Magnet, Plus, Trash2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin, useCarTemplates } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import {
  useSnapZones, useAddSnapZone, useUpdateSnapZone, useDeleteSnapZone,
  SNAP_ZONE_TYPES, SNAP_ZONE_LABELS, type SnapZone, type SnapZoneType,
} from "@/lib/build-studio/snap-zones";
import type { Vec3 } from "@/lib/build-studio/placed-parts";

/**
 * Snap Zones admin — define attachment slots for each car_template.
 *
 * Snap zones live in the same normalized space as placed parts:
 *  origin = ground center, +X = forward, +Y = up, +Z = lateral.
 * In the Build Studio, parts within ~0.35m of a zone snap to it on release.
 */
export default function SnapZonesAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);
  const { data: templates = [] } = useCarTemplates();
  const [templateId, setTemplateId] = useState<string>("");

  // Default to first template once loaded.
  const activeTemplateId = templateId || templates[0]?.id || "";
  const { data: zones = [], isLoading } = useSnapZones(activeTemplateId);

  const add = useAddSnapZone();
  const update = useUpdateSnapZone();
  const del = useDeleteSnapZone();

  const [newType, setNewType] = useState<SnapZoneType>("front_splitter");

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

  const handleAdd = async () => {
    if (!activeTemplateId) {
      toast({ title: "Pick a car template first", variant: "destructive" });
      return;
    }
    try {
      await add.mutateAsync({
        car_template_id: activeTemplateId,
        zone_type: newType,
        label: SNAP_ZONE_LABELS[newType],
      });
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

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-6xl space-y-8">
        <PageHeader
          eyebrow="Admin"
          title="Snap Zones"
          description="Define part attachment slots on each car template. Used by the Build Studio for snap-to-zone placement."
        />

        <div className="glass rounded-xl p-4 flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px] space-y-1.5">
            <Label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Car template</Label>
            <Select value={activeTemplateId} onValueChange={setTemplateId}>
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
          <Button onClick={handleAdd} disabled={add.isPending || !activeTemplateId}>
            <Plus className="h-4 w-4 mr-1.5" /> Add zone
          </Button>
        </div>

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
              Add zones for the common attachment points (splitter, wing, sills…). Parts placed near them
              will snap automatically in the Build Studio.
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
                  {list.map((z) => (
                    <div key={z.id} className="glass rounded-lg p-3 flex items-center gap-3 flex-wrap">
                      <Magnet className="h-4 w-4 text-primary shrink-0" />
                      <Input
                        className="h-8 w-[200px] text-xs"
                        value={z.label ?? ""}
                        placeholder="Label"
                        onChange={(e) => update.mutate({
                          id: z.id, car_template_id: z.car_template_id,
                          patch: { label: e.target.value },
                        })}
                      />
                      <div className="flex items-center gap-1.5 ml-auto">
                        {(["x", "y", "z"] as const).map((axis) => (
                          <div key={axis} className="flex items-center gap-1">
                            <span className="text-mono text-[10px] uppercase text-muted-foreground">{axis}</span>
                            <Input
                              type="number"
                              step="0.05"
                              className="h-8 w-[80px] text-xs text-mono"
                              value={Number(z.position[axis] ?? 0).toFixed(2)}
                              onChange={(e) => handlePosChange(z, axis, e.target.value)}
                            />
                          </div>
                        ))}
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-8 w-8 p-0"
                          onClick={() => del.mutate({ id: z.id, car_template_id: z.car_template_id })}>
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
                Coordinates are in metres. Origin is the ground centre under the car. +X is forward, +Y is up, +Z is the driver-side lateral.
              </span>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
