/**
 * SpecPartDialog — turn a description (and optional reference image) into a
 * 3D part via Meshy and drop it straight into the user's part library.
 *
 * Calls the `spec-part-from-prompt` edge function (start) then polls it
 * (status) every 4s until status flips to complete or failed.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, ImagePlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Phase = "idle" | "starting" | "running" | "done" | "error";

export function SpecPartDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const genIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const reset = () => {
    setPrompt(""); setImageDataUrl(null); setPhase("idle");
    setProgress(0); setErrMsg(null); genIdRef.current = null;
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleClose = (v: boolean) => {
    if (!v && (phase === "starting" || phase === "running")) {
      // Allow closing — generation continues server-side, user can refresh later.
    }
    onOpenChange(v);
    if (!v) setTimeout(reset, 200);
  };

  const handlePickImage = async (file: File | null) => {
    if (!file) { setImageDataUrl(null); return; }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const start = async () => {
    if (!prompt.trim()) {
      toast({ title: "Add a description", variant: "destructive" });
      return;
    }
    setPhase("starting"); setErrMsg(null); setProgress(5);
    try {
      const { data, error } = await supabase.functions.invoke("spec-part-from-prompt", {
        body: { action: "start", prompt: prompt.trim(), image_data_url: imageDataUrl },
      });
      if (error) throw error;
      const gid = (data as any)?.generation_id as string | undefined;
      if (!gid) throw new Error("No generation_id returned");
      genIdRef.current = gid;
      setPhase("running");
      setProgress(15);
      poll();
    } catch (e: any) {
      console.error(e);
      setPhase("error");
      setErrMsg(e?.message ?? "Failed to start");
    }
  };

  const poll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const gid = genIdRef.current;
      if (!gid) return;
      try {
        const { data, error } = await supabase.functions.invoke("spec-part-from-prompt", {
          body: { action: "status", generation_id: gid },
        });
        if (error) throw error;
        const status = (data as any)?.status as string;
        if (status === "complete") {
          setPhase("done");
          setProgress(100);
          if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
          qc.invalidateQueries({ queryKey: ["library_items"] });
          toast({ title: "Spec part added to your library" });
        } else if (status === "failed") {
          setPhase("error");
          setErrMsg((data as any)?.error ?? "Generation failed");
          if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
        } else {
          const p = Math.min(95, Math.max(20, Number((data as any)?.progress ?? progress + 5)));
          setProgress(p);
        }
      } catch (e: any) {
        console.warn("poll error", e);
      }
    }, 4000);
  };

  const busy = phase === "starting" || phase === "running";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Build a spec part
          </DialogTitle>
          <DialogDescription>
            Describe a part — optionally attach a reference image — and we'll
            generate a 3D mesh and drop it straight into your library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="spec-prompt" className="text-xs">Description</Label>
            <Textarea
              id="spec-prompt"
              placeholder="e.g. front splitter with twin canards, ~3mm shell, motorsport style"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              disabled={busy || phase === "done"}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <ImagePlus className="h-3 w-3" /> Reference image (optional)
            </Label>
            {imageDataUrl ? (
              <div className="relative inline-block">
                <img
                  src={imageDataUrl}
                  alt="reference"
                  className="h-24 w-24 rounded-md border border-border object-cover"
                />
                <button
                  type="button"
                  className="absolute -right-2 -top-2 rounded-full bg-background border border-border p-0.5"
                  onClick={() => setImageDataUrl(null)}
                  disabled={busy}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
                disabled={busy || phase === "done"}
                className="text-xs"
              />
            )}
            <p className="text-[10px] text-muted-foreground">
              No image? We'll generate a clean reference render from your description first.
            </p>
          </div>

          {(busy || phase === "done") && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {phase === "starting" && "Preparing reference…"}
                {phase === "running" && `Meshing… ${progress}%  (this can take 1–3 minutes)`}
                {phase === "done" && "Done — added to your library."}
              </p>
            </div>
          )}

          {phase === "error" && errMsg && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {errMsg}
            </div>
          )}
        </div>

        <DialogFooter>
          {phase === "done" ? (
            <Button onClick={() => handleClose(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={false}>
                {busy ? "Run in background" : "Cancel"}
              </Button>
              <Button onClick={start} disabled={busy || !prompt.trim()}>
                {busy ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Generating…</> : "Generate part"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
