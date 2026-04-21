import { Button } from "@/components/ui/button";
import { Sparkles, Snowflake, Move } from "lucide-react";

export type PrototyperMode = "generate" | "freeze" | "place";

interface Props {
  mode: PrototyperMode;
  onChange: (m: PrototyperMode) => void;
  placeEnabled: boolean;
}

export function ModeSwitcher({ mode, onChange, placeEnabled }: Props) {
  const buttons: Array<{ id: PrototyperMode; label: string; icon: React.ReactNode; disabled?: boolean }> = [
    { id: "generate", label: "Generate", icon: <Sparkles className="h-4 w-4" /> },
    { id: "freeze",   label: "Freeze Part", icon: <Snowflake className="h-4 w-4" /> },
    { id: "place",    label: "Place", icon: <Move className="h-4 w-4" />, disabled: !placeEnabled },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-1 p-1">
      {buttons.map((b) => (
        <Button
          key={b.id}
          size="sm"
          variant={mode === b.id ? "default" : "ghost"}
          disabled={b.disabled}
          onClick={() => onChange(b.id)}
          className="gap-1.5"
        >
          {b.icon}
          {b.label}
        </Button>
      ))}
    </div>
  );
}
