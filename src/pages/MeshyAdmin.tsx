import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Wand2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/lib/repo";
import { Navigate, Link } from "react-router-dom";

/**
 * Meshy Admin — placeholder (admin-only).
 *
 * Production mesh-generation control panel. Will eventually wrap the
 * existing meshify-part / meshify-prototype edge functions plus a body-skin
 * generation mode and a prompt-template gallery.
 */
export default function MeshyAdmin() {
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
          title="Meshy Admin"
          description="Generate parts and body skins from prompt + image references. Save results to the part or skin library."
          actions={
            <Button disabled>
              <Wand2 className="h-4 w-4 mr-1.5" /> New generation
            </Button>
          }
        />

        <div className="glass rounded-xl p-10 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold">Coming next iteration</h2>
          <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
            Behind the scenes the meshing edge functions (Hunyuan3D) are
            already live. This admin UI — prompt templates, generation type
            picker, prompt history — arrives in Phase 6.
          </p>
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link to="/concept-studio">Use the existing concept flow</Link>
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
