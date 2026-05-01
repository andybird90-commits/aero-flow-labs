import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2 } from "lucide-react";

const PART_KIND_OPTIONS = [
  "ducktail", "front_splitter", "rear_diffuser", "side_skirt",
  "front_arch", "rear_arch", "canard", "rear_wing", "bonnet_vent",
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId?: string;
  onCreated?: (jobId: string) => void;
}

export function GeneratePartDialog({ open, onOpenChange, projectId, onCreated }: Props) {
  const { toast } = useToast();
  const [partKind, setPartKind] = useState("ducktail");
  const [stylePrompt, setStylePrompt] = useState("aggressive motorsport style, clean shutlines");
  const [envW, setEnvW] = useState(800);
  const [envL, setEnvL] = useState(800);
  const [envH, setEnvH] = useState(400);
  const [symmetry, setSymmetry] = useState<"x" | "none">("x");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-blender-job", {
        body: {
          operation_type: "generate_part",
          parameters: {
            part_kind: partKind,
            style_prompt: stylePrompt,
            envelope_mm: [envW, envL, envH],
            symmetry,
          },
          project_id: projectId ?? null,
        },
      });
      if (error) throw error;
      const errMsg = (data as any)?.error;
      if (errMsg) throw new Error(errMsg);
      const jobId = (data as any)?.job_id;
      toast({
        title: "Generation started",
        description: `Job ${jobId?.slice(0, 8)} queued. Watch progress in Blender Jobs.`,
      });
      onCreated?.(jobId);
      onOpenChange(false);
    } catch (e: any) {
      const msg = String(e.message ?? e);
      toast({
        title: "Failed to start generation",
        description: msg.includes("403") ? "Admin role required for AI part generation." : msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Generate part with AI
          </DialogTitle>
          <DialogDescription>
            Drives the Claude-as-actor loop in Blender. Outputs a GLB + thumbnail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Part kind</Label>
            <Select value={partKind} onValueChange={setPartKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PART_KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Style prompt</Label>
            <Textarea
              rows={3}
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="aggressive motorsport, clean shutlines, carbon look"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Envelope (mm) — width × length × height</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" value={envW} onChange={(e) => setEnvW(+e.target.value)} />
              <Input type="number" value={envL} onChange={(e) => setEnvL(+e.target.value)} />
              <Input type="number" value={envH} onChange={(e) => setEnvH(+e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Symmetry</Label>
            <Select value={symmetry} onValueChange={(v) => setSymmetry(v as "x" | "none")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="x">Mirror across X (left/right symmetric)</SelectItem>
                <SelectItem value="none">No mirroring</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Dispatching…</> : <><Sparkles className="mr-2 h-4 w-4" /> Generate</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
