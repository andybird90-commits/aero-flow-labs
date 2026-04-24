/**
 * CadWorkerSetupCard
 *
 * Inline guided-setup UI shown inside the "Build with CAD" dialog when the
 * worker integration is not ready. Walks the user through:
 *
 *   missing_secrets → click "Add secrets" (opens the platform secret form)
 *   unauthorized    → token mismatch — guide to update CAD_WORKER_TOKEN
 *   unreachable     → URL wrong or worker down — guide to update CAD_WORKER_URL
 *   unhealthy       → worker /health returned non-2xx — show http status
 *
 * After the user enters/fixes the secrets, "Re-check" re-probes via the
 * cad-worker-status edge function.
 */
import { Loader2, AlertTriangle, KeyRound, RefreshCw, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CadWorkerStatus,
  useRecheckCadWorkerStatus,
} from "@/lib/cad-worker-status";

interface Props {
  status: CadWorkerStatus | undefined;
  loading: boolean;
  onAddSecrets: (names: string[]) => void;
}

export function CadWorkerSetupCard({ status, loading, onAddSecrets }: Props) {
  const recheck = useRecheckCadWorkerStatus();

  if (loading || !status) {
    return (
      <div className="rounded-md border border-border bg-surface-0 p-4 flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Checking CAD worker status…
      </div>
    );
  }

  if (status.state === "ok") return null;

  const missingNames: string[] = [];
  if (!status.has_url) missingNames.push("CAD_WORKER_URL");
  if (!status.has_token) missingNames.push("CAD_WORKER_TOKEN");

  const isMissing = status.state === "missing_secrets";
  const isAuth = status.state === "unauthorized";
  const isReach = status.state === "unreachable";
  const isUnhealthy = status.state === "unhealthy";

  const title =
    isMissing ? "CAD worker not configured" :
    isAuth ? "CAD worker rejected the token" :
    isReach ? "CAD worker is unreachable" :
    "CAD worker is unhealthy";

  const helpText =
    isMissing
      ? "Add your worker URL and bearer token. These are stored as Lovable Cloud secrets and only used by the dispatch-cad-job edge function."
      : isAuth
        ? "The worker returned 401/403. The CAD_WORKER_TOKEN saved here doesn't match the value the worker expects. Update it to match exactly."
        : isReach
          ? "The CAD_WORKER_URL is set but the worker didn't respond. Check the URL is correct and that the worker is running."
          : `The worker /health endpoint responded with ${status.http_status ?? "an error"}. The worker is up but reporting a problem.`;

  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-4 space-y-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">{title}</div>
          <div className="text-muted-foreground mt-1">{helpText}</div>
        </div>
      </div>

      {/* Status grid: which secret is set / which isn't */}
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <SecretBadge name="CAD_WORKER_URL" set={status.has_url} />
        <SecretBadge name="CAD_WORKER_TOKEN" set={status.has_token} />
      </div>

      {status.worker_url && (
        <div className="text-xs text-muted-foreground font-mono inline-flex items-center gap-1">
          Pointed at: <span className="text-foreground">{status.worker_url}</span>
          <a href={status.worker_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            <ExternalLink className="h-3 w-3 inline" />
          </a>
        </div>
      )}

      {status.detail && (
        <pre className="text-xs font-mono whitespace-pre-wrap rounded bg-surface-0 border border-border p-2 max-h-32 overflow-auto">
          {status.detail}
        </pre>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {isMissing && (
          <Button
            size="sm"
            onClick={() => onAddSecrets(missingNames.length ? missingNames : ["CAD_WORKER_URL", "CAD_WORKER_TOKEN"])}
          >
            <KeyRound className="h-4 w-4 mr-1" />
            Add {missingNames.length === 2 ? "secrets" : missingNames[0]}
          </Button>
        )}
        {isAuth && (
          <Button size="sm" onClick={() => onAddSecrets(["CAD_WORKER_TOKEN"])}>
            <KeyRound className="h-4 w-4 mr-1" /> Update CAD_WORKER_TOKEN
          </Button>
        )}
        {isReach && (
          <Button size="sm" onClick={() => onAddSecrets(["CAD_WORKER_URL"])}>
            <KeyRound className="h-4 w-4 mr-1" /> Update CAD_WORKER_URL
          </Button>
        )}
        {(isAuth || isReach || isUnhealthy) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAddSecrets(["CAD_WORKER_URL", "CAD_WORKER_TOKEN"])}
          >
            <KeyRound className="h-4 w-4 mr-1" /> Edit both
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => recheck.mutate()}
          disabled={recheck.isPending}
        >
          {recheck.isPending
            ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Re-checking…</>
            : <><RefreshCw className="h-4 w-4 mr-1" /> Re-check</>}
        </Button>
      </div>
    </div>
  );
}

function SecretBadge({ name, set }: { name: string; set: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded border px-2 py-1.5 ${
        set
          ? "border-success/40 bg-success/10 text-success"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      }`}
    >
      {set ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      <span className="truncate">{name}</span>
      <span className="ml-auto text-[10px] uppercase tracking-widest opacity-70">
        {set ? "set" : "missing"}
      </span>
    </div>
  );
}
