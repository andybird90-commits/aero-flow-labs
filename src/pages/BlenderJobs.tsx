import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Hammer, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/lib/repo";
import { Navigate } from "react-router-dom";

/**
 * Blender Jobs — placeholder (admin-only).
 *
 * Operational queue for the external Blender worker (trim_part_to_car,
 * thicken_shell, panelise_body_skin, cut_window_openings, etc.). The worker
 * itself lives in `blender-worker/` and is not deployed by Lovable. Phase 7
 * wires this UI to a `blender_jobs` table + dispatch / poll edge functions.
 */
export default function BlenderJobs() {
  const { user } = useAuth();
  const { data: isAdmin, isLoading } = useIsAdmin(user?.id);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="container mx-auto p-8 text-sm text-muted-foreground">Checking access…</div>
      </AppLayout>
    );
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-5xl space-y-8">
        <PageHeader
          eyebrow="Admin"
          title="Blender Jobs"
          description="Queue and monitor Blender backend operations: trim, panelise, conform, thicken, repair, export."
          actions={
            <Button disabled>
              <Hammer className="h-4 w-4 mr-1.5" /> New job
            </Button>
          }
        />

        <div className="glass rounded-xl p-10 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold">Job queue UI coming in Phase 7</h2>
          <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
            The Blender worker contract and 13 operation types are documented
            in <code className="text-mono text-xs">blender-worker/</code>. The
            dispatcher and queue table land alongside the production-ready
            worker in a later iteration.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
