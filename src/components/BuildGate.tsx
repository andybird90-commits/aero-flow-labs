import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentBuild } from "@/hooks/useCurrentBuild";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { AppLayout } from "@/components/AppLayout";
import { Wind, Sparkles, Plus } from "lucide-react";
import { useSeedDemo } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";

/**
 * Wraps any workspace page that requires a current build.
 * Shows a friendly empty state if the user has no builds yet.
 */
export function BuildGate({
  children,
}: {
  children: (ctx: ReturnType<typeof useCurrentBuild>) => React.ReactNode;
}) {
  const { user } = useAuth();
  const ctx = useCurrentBuild();
  const seedDemo = useSeedDemo();
  const { toast } = useToast();

  if (!user) return null;

  if (ctx.isLoading) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-[1400px] px-6 py-8">
          <LoadingState />
        </div>
      </AppLayout>
    );
  }

  if (ctx.isEmpty || !ctx.build) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-[1400px] px-6 py-8">
          <EmptyState
            icon={<Wind className="h-5 w-5 text-primary" />}
            title="No build selected"
            description="Open a build from the Garage, or load the GR86 demo to explore the full workflow."
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="hero"
                  size="sm"
                  disabled={seedDemo.isPending}
                  onClick={async () => {
                    try {
                      await seedDemo.mutateAsync();
                      toast({ title: "Demo build ready" });
                    } catch (e: any) {
                      toast({ title: "Couldn't load demo", description: e.message, variant: "destructive" });
                    }
                  }}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  {seedDemo.isPending ? "Loading…" : "Load GR86 demo"}
                </Button>
                <Button variant="glass" size="sm" asChild>
                  <Link to="/garage"><Plus className="mr-2 h-3.5 w-3.5" /> Go to garage</Link>
                </Button>
              </div>
            }
          />
        </div>
      </AppLayout>
    );
  }

  return <>{children(ctx)}</>;
}
