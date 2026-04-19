import { WorkspaceShell } from "@/components/WorkspaceShell";
import { CarViewer3D } from "@/components/CarViewer3D";
import { MeshUpload } from "@/components/MeshUpload";
import { MeshOrientationControls } from "@/components/MeshOrientation";
import { useGeometry } from "@/lib/repo";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, AlertCircle, Layers } from "lucide-react";

export default function Upload() {
  return (
    <WorkspaceShell>
      {({ project, projectId }) => <UploadInner projectId={projectId!} project={project} />}
    </WorkspaceShell>
  );
}

function UploadInner({ projectId, project }: { projectId: string; project: any }) {
  const { data: geometry } = useGeometry(projectId);
  const template = project.car?.template ?? null;
  const hasMesh = !!geometry?.stl_path;
  const filename = (geometry?.metadata as any)?.mesh_filename ?? null;
  const bytes = (geometry?.metadata as any)?.mesh_bytes ?? null;

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div className="glass rounded-xl overflow-hidden h-[640px] relative">
        {geometry ? (
          <CarViewer3D template={template} geometry={geometry} hideParts />
        ) : (
          <div className="h-full grid place-items-center text-muted-foreground">Loading viewer…</div>
        )}
        <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-surface-0/80 backdrop-blur px-2.5 py-1.5 border border-border">
          <Layers className="h-3.5 w-3.5 text-primary" />
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Studio viewer · model preview
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {geometry && <MeshUpload geometry={geometry} />}
        {hasMesh && geometry && <MeshOrientationControls geometry={geometry} />}

        <div className="glass rounded-xl">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold tracking-tight">Model checks</h3>
          </div>
          <div className="p-4 space-y-2.5">
            <Check ok={hasMesh} label="Model uploaded" />
            <Check ok={hasMesh && (bytes ?? 0) < 100 * 1024 * 1024} label="Within 100 MB limit" />
            <Check ok={!!filename?.match(/\.(stl|obj)$/i)} label="STL or OBJ format" />
            <Check ok={hasMesh} label="Orientation set (Y-up after fix)" />
          </div>
        </div>

        <Button variant="hero" size="lg" className="w-full" disabled={!hasMesh} asChild>
          <Link to={`/brief?project=${projectId}`}>
            Continue to design brief <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
