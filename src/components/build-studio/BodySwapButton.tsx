/**
 * BodySwapButton — toolbar action that trims the active body shell to fit
 * flush on the donor car using a client-side CSG SUBTRACTION boolean.
 *
 * Disabled until both a donor car and a Shell Fit body shell are loaded.
 * On success the new trimmed shell is added to the user's body_skins library
 * and selected as the active overlay so the result is visible immediately.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Replace } from "lucide-react";
import { toast } from "sonner";
import { useBodySwap } from "@/lib/build-studio/body-swap";
import type { BodySkin } from "@/lib/body-skins";

interface Props {
  /** Active body shell (from the Shell Fit selector). */
  activeSkin: BodySkin | null;
  /** Owning user id (required). */
  userId: string | null;
  /** Donor car template id, used for naming + linkage. */
  donorCarTemplateId?: string | null;
  /** Donor car display name (e.g. "Porsche 986 Boxster"). */
  donorCarLabel?: string | null;
  /** Called with the new body skin id once the swap completes. */
  onSwapComplete?: (newSkinId: string) => void;
}

export function BodySwapButton({
  activeSkin,
  userId,
  donorCarTemplateId,
  donorCarLabel,
  onSwapComplete,
}: Props) {
  const swap = useBodySwap();
  const [running, setRunning] = useState(false);

  const disabled = !activeSkin || !userId || running || swap.isPending;

  const handleClick = async () => {
    if (!activeSkin || !userId) {
      toast.error("Pick a body shell from the Shell Fit menu first.");
      return;
    }
    setRunning(true);
    const t = toast.loading("Body Swap: trimming shell to donor car…");
    try {
      const res = await swap.mutateAsync({
        sourceSkin: activeSkin,
        donorCarTemplateId,
        donorCarLabel,
        userId,
      });
      toast.success(
        `Body Swap done in ${(res.processing_ms / 1000).toFixed(1)}s · ${res.triangles_out.toLocaleString()} tris`,
        { id: t },
      );
      onSwapComplete?.(res.new_body_skin.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Body Swap failed", { id: t });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-9 px-3 text-xs"
      onClick={handleClick}
      disabled={disabled}
      title={
        !activeSkin
          ? "Select a body shell in the Shell Fit menu to enable Body Swap"
          : "Trim the body shell to sit flush on the donor car"
      }
    >
      {running || swap.isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Replace className="mr-1.5 h-3.5 w-3.5" />
      )}
      Body Swap
    </Button>
  );
}
