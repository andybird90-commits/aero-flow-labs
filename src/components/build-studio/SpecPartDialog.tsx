/**
 * SpecPartDialog — two-phase spec part generation:
 *   1. Generate (or upload) a reference image; user can comment + revise.
 *   2. Approve → Meshy image-to-3D → drop GLB into the part library.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, ImagePlus, X, Check, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Phase =
  | "idle"
  | "generating_ref"     // creating first reference
  | "awaiting_approval"  // showing reference, accepting comments
  | "revising_ref"       // regenerating from a comment
  | "meshing"            // Meshy job running
  | "done"
  | "error";

export function SpecPartDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const genIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const reset = () => {
    setPrompt(""); setImageDataUrl(null); setRefUrl(null); setComment("");
    setPhase("idle"); setProgress(0); setErrMsg(null); genIdRef.current = null;
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(reset, 200);
  };

  const handlePickImage = async (file: File | null) => {
    if (!file) { setImageDataUrl(null); return; }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const generateRef = async () => {
    if (!prompt.trim()) {
      toast({ title: "Add a description", variant: "destructive" });
      return;
    }
    setPhase("generating_ref"); setErrMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("spec-part-from-prompt", {
        body: { action: "generate_ref", prompt: prompt.trim(), image_data_url: imageDataUrl },
      });
      if (error) throw error;
      const d = data as any;
      if (!d?.generation_id || !d?.reference_url) throw new Error("Missing reference response");
      genIdRef.current = d.generation_id;
      setRefUrl(d.reference_url);
      setPhase("awaiting_approval");
    } catch (e: any) {
      console.error(e);
      setPhase("error");
      setErrMsg(e?.message ?? "Failed to generate reference");
    }
  };

  const reviseRef = async () => {
    if (!genIdRef.current) return;
    setPhase("revising_ref"); setErrMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("spec-part-from-prompt", {
        body: { action: "revise_ref", generation_id: genIdRef.current, comment: comment.trim() },
      });
      if (error) throw error;
      const d = data as any;
      if (!d?.reference_url) throw new Error("No reference returned");
      setRefUrl(d.reference_url);
      setComment("");
      setPhase("awaiting_approval");
    } catch (e: any) {
      console.error(e);
      setPhase("awaiting_approval");
      setErrMsg(e?.message ?? "Revision failed");
    }
  };

  const approve = async () => {
    if (!genIdRef.current) return;
    setPhase("meshing"); setErrMsg(null); setProgress(10);
    try {
      const { error } = await supabase.functions.invoke("spec-part-from-prompt", {
        body: { action: "approve", generation_id: genIdRef.current },
      });
      if (error) throw error;
      poll();
    } catch (e: any) {
      console.error(e);
      setPhase("error");
      setErrMsg(e?.message ?? "Failed to start meshing");
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
        const d = data as any;
        if (d?.status === "complete") {
          setPhase("done"); setProgress(100);
          if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
          qc.invalidateQueries({ queryKey: ["library_items"] });
          qc.invalidateQueries({ queryKey: ["my-library"] });
          toast({ title: "Spec part added to your library" });
        } else if (d?.status === "failed") {
          setPhase("error");
          setErrMsg(d?.error ?? "Generation failed");
          if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
        } else {
          setProgress((p) => Math.min(95, Math.max(20, Number(d?.progress ?? p + 5))));
        }
      } catch (e) {
        console.warn("poll error", e);
      }
    }, 4000);
  };

  const busy =
    phase === "generating_ref" || phase === "revising_ref" || phase === "meshing";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Build a spec part
          </DialogTitle>
          <DialogDescription>
            Describe a part — we'll generate a reference render first for your
            approval, then turn it into a 3D mesh in your library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* STEP 1: prompt + optional ref */}
          {phase === "idle" || phase === "generating_ref" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="spec-prompt" className="text-xs">Description</Label>
                <Textarea
                  id="spec-prompt"
                  placeholder="e.g. front splitter with twin canards, ~3mm shell, motorsport style"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <ImagePlus className="h-3 w-3" /> Reference image (optional)
                </Label>
                {imageDataUrl ? (
                  <div className="relative inline-block">
                    <img src={imageDataUrl} alt="reference"
                      className="h-24 w-24 rounded-md border border-border object-cover" />
                    <button type="button"
                      className="absolute -right-2 -top-2 rounded-full bg-background border border-border p-0.5"
                      onClick={() => setImageDataUrl(null)} disabled={busy}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <Input type="file" accept="image/*"
                    onChange={(e) => handlePickImage(e.target.files?.[0] ?? null)}
                    disabled={busy} className="text-xs" />
                )}
                <p className="text-[10px] text-muted-foreground">
                  No image? We'll render a clean reference from your description.
                </p>
              </div>
            </>
          ) : null}

          {/* STEP 2: reference review */}
          {(phase === "awaiting_approval" || phase === "revising_ref") && refUrl && (
            <div className="space-y-2">
              <Label className="text-xs">Reference render</Label>
              <div className={`grid gap-2 ${imageDataUrl ? "grid-cols-2" : "grid-cols-1"}`}>
                {imageDataUrl && (
                  <div className="space-y-1">
                    <div className="overflow-hidden rounded-md border border-border bg-muted">
                      <img src={imageDataUrl} alt="your reference"
                        className="w-full object-contain aspect-square" />
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">Your reference</p>
                  </div>
                )}
                <div className="space-y-1">
                  <div className="relative overflow-hidden rounded-md border border-border bg-muted">
                    <img src={refUrl} alt="generated reference"
                      className="w-full object-contain aspect-square" />
                    {phase === "revising_ref" && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                  {imageDataUrl && (
                    <p className="text-[10px] text-muted-foreground text-center">Generated</p>
                  )}
                </div>
              </div>
              <Label htmlFor="spec-comment" className="text-xs">
                Want changes? Describe them and regenerate.
              </Label>
              <Textarea
                id="spec-comment"
                placeholder="e.g. make the canards bigger, sharper edges, less curve…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                disabled={phase === "revising_ref"}
              />
            </div>
          )}

          {/* STEP 3: meshing progress */}
          {(phase === "meshing" || phase === "done") && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${progress}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {phase === "meshing" && `Meshing… ${progress}% (1–3 minutes)`}
                {phase === "done" && "Done — added to your library."}
              </p>
            </div>
          )}

          {errMsg && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {errMsg}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {phase === "done" ? (
            <Button onClick={() => handleClose(false)}>Close</Button>
          ) : phase === "awaiting_approval" || phase === "revising_ref" ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}
                disabled={phase === "revising_ref"}>
                Cancel
              </Button>
              <Button variant="outline" onClick={reviseRef}
                disabled={phase === "revising_ref" || !comment.trim()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Regenerate
              </Button>
              <Button onClick={approve} disabled={phase === "revising_ref"}>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Approve & mesh
              </Button>
            </>
          ) : phase === "meshing" ? (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Run in background
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={generateRef} disabled={busy || !prompt.trim()}>
                {busy
                  ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Generating…</>
                  : "Generate reference"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
