import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Shapes, Upload } from "lucide-react";

/**
 * Body Skin Library — placeholder.
 *
 * A body skin is a full bodyswap shell (donor-car-targeted, AI/Meshy
 * generated, not directly printable). Phase 2 introduces a `body_skins` table
 * and uploader; Phase 5 adds the Shell Fit Mode that aligns these skins to
 * the donor car using hardpoints.
 *
 * For now this page exists so the sidebar route resolves.
 */
export default function BodySkinLibrary() {
  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-5xl space-y-8">
        <PageHeader
          eyebrow="Library"
          title="Body Skin Library"
          description="Full bodyswap shells generated from concept renders. Used in Shell Fit Mode to drape over a donor car."
          actions={
            <Button disabled>
              <Upload className="h-4 w-4 mr-1.5" /> Upload skin
            </Button>
          }
        />

        <div className="glass rounded-xl p-10 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
            <Shapes className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold">No body skins yet</h2>
          <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
            Body skins land here once you generate one in Meshy Admin or upload
            a GLB. Until then, browse the part library or design a concept.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/part-library">Open part library</Link>
            </Button>
            <Button asChild>
              <Link to="/concept-studio">Design a concept</Link>
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
