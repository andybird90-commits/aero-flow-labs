import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/lib/repo";
import { Button } from "@/components/ui/button";
import { Settings as SettingsIcon, LogOut, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function Settings() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Settings</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Account</h1>
        </div>

        <div className="glass rounded-xl">
          <div className="border-b border-border px-4 py-3 flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Profile</h3>
          </div>
          <div className="p-4 space-y-2 text-sm">
            <Row label="Display name" value={profile?.display_name ?? "—"} />
            <Row label="Email" value={user?.email ?? "—"} />
            <Row label="Plan" value={(profile?.plan ?? "free").toString()} />
            <Row label="Credits" value={(profile?.credits ?? 0).toString()} />
          </div>
        </div>

        <div className="glass rounded-xl">
          <div className="border-b border-border px-4 py-3 flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Session</h3>
          </div>
          <div className="p-4">
            <Button variant="glass" onClick={() => supabase.auth.signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
