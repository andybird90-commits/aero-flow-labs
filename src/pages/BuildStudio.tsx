import { Link, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Boxes, Sparkles, ArrowRight } from "lucide-react";

/**
 * 3D Build Studio — placeholder.
 *
 * Phase 1 stub: lays down the route + framing UI so the sidebar resolves
 * cleanly. The real Build Studio (R3F viewport, part library rail, properties
 * panel, transform controls, snap zones) is delivered in Phase 3.
 *
 * For now we direct users to either the Concept Studio (to design what they
 * want) or the existing Refine flow (legacy 3D editor) so they aren't blocked.
 */
export default function BuildStudio() {
  const [search] = useSearchParams();
  const project = search.get("project");

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-6xl space-y-8">
        <PageHeader
          eyebrow="3D"
          title="Build Studio"
          description="Drag generated parts onto your car, snap them to body zones, save the design as JSON."
        />

        <div className="glass relative overflow-hidden rounded-xl p-10 text-center grid-bg">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
            <Boxes className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold">3D viewport coming next</h2>
          <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
            The full configurator (transform controls, snap zones, body-skin
            alignment, save/load) lands in the next iteration. For now you can
            still design concepts and review parts.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button asChild>
              <Link to={project ? `/concept-studio?project=${project}` : "/concept-studio"}>
                <Sparkles className="h-4 w-4 mr-1.5" />
                Open Concept Studio
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={project ? `/refine?project=${project}` : "/projects"}>
                Legacy refine view
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
