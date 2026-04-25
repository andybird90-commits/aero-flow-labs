/**
 * Renders a list of typed fields (number/text/url/boolean/select/multiselect)
 * for the Blender Jobs dispatcher dialog. Stateless — parent owns the values.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Field } from "@/lib/blender-jobs-schema";

interface Props {
  fields: Field[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function TypedFieldGroup({ fields, values, onChange }: Props) {
  function set(key: string, v: unknown) {
    onChange({ ...values, [key]: v });
  }

  return (
    <div className="space-y-3">
      {fields.map((f) => {
        const v = values[f.key];
        return (
          <div key={f.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`fld-${f.key}`} className="text-xs">
                {f.label}
                {f.required && <span className="text-destructive ml-1">*</span>}
                {"unit" in f && f.unit && (
                  <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">{f.unit}</span>
                )}
              </Label>
              {f.kind === "boolean" && (
                <Switch
                  id={`fld-${f.key}`}
                  checked={!!v}
                  onCheckedChange={(checked) => set(f.key, checked)}
                />
              )}
            </div>

            {f.kind === "number" && (
              <Input
                id={`fld-${f.key}`}
                type="number"
                value={v === undefined ? "" : String(v)}
                min={f.min}
                max={f.max}
                step={f.step ?? "any"}
                onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))}
              />
            )}

            {(f.kind === "text" || f.kind === "url") && (
              <Input
                id={`fld-${f.key}`}
                type={f.kind === "url" ? "url" : "text"}
                value={(v as string | undefined) ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}

            {f.kind === "select" && (
              <Select value={(v as string | undefined) ?? f.options[0]?.value} onValueChange={(val) => set(f.key, val)}>
                <SelectTrigger id={`fld-${f.key}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {f.kind === "multiselect" && (
              <div className="flex flex-wrap gap-1.5">
                {f.options.map((o) => {
                  const arr = Array.isArray(v) ? (v as string[]) : [];
                  const on = arr.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() =>
                        set(f.key, on ? arr.filter((x) => x !== o.value) : [...arr, o.value])
                      }
                    >
                      <Badge
                        variant={on ? "default" : "outline"}
                        className="cursor-pointer text-[11px]"
                      >
                        {o.label}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}

            {f.description && (
              <p className="text-[11px] text-muted-foreground">{f.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
