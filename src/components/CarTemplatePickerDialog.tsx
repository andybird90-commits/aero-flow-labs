import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Car as CarIcon } from "lucide-react";
import { useCarTemplates, useUpdateCar, type Car, type CarTemplate } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  car: Car | null;
}

/**
 * Assign or clear a car_template on a project's car. Once a template is set,
 * the Build Studio resolves the correct hero STL automatically (no fallback).
 */
export function CarTemplatePickerDialog({ open, onOpenChange, car }: Props) {
  const { toast } = useToast();
  const { data: templates = [] } = useCarTemplates();
  const update = useUpdateCar();
  const [value, setValue] = useState<string>(NONE);

  useEffect(() => {
    if (open) setValue(car?.template_id ?? NONE);
  }, [open, car]);

  const handleSave = async () => {
    if (!car) return;
    try {
      await update.mutateAsync({
        id: car.id,
        patch: { template_id: value === NONE ? null : value } as Partial<Car>,
      });
      toast({
        title: value === NONE ? "Template cleared" : "Template assigned",
        description: value === NONE
          ? "Build Studio will fall back to the most recent uploaded hero STL."
          : "Build Studio will load the matching hero STL.",
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Couldn't update", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign car template</DialogTitle>
          <DialogDescription>
            Pick the donor car for this project. The Build Studio uses this to load the correct hero STL and snap zones.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><CarIcon className="h-3.5 w-3.5" /> Car template</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— None —</SelectItem>
              {templates.map((t: CarTemplate) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.make} {t.model}{t.trim ? ` ${t.trim}` : ""}{t.year_range ? ` · ${t.year_range}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={update.isPending || !car}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
