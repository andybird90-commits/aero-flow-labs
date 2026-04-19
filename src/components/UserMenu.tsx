import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LogOut, User as UserIcon, Zap } from "lucide-react";

interface ProfileBits { display_name: string | null; credits: number; plan: string; }

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileBits | null>(null);

  useEffect(() => {
    if (!user) { setProfile(null); return; }
    supabase.from("profiles")
      .select("display_name, credits, plan")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => data && setProfile(data as ProfileBits));
  }, [user]);

  if (!user) return null;

  const name = profile?.display_name ?? user.email?.split("@")[0] ?? "Engineer";
  const initials = name.slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-2 px-2 hover:bg-surface-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-mono text-[10px] font-semibold text-primary">
            {initials}
          </div>
          <span className="hidden sm:inline text-mono text-[11px] text-foreground">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-surface-1 border-border">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium truncate">{name}</div>
          <div className="text-mono text-[10px] text-muted-foreground truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-2 py-2 flex items-center justify-between">
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Credits</span>
          <span className="inline-flex items-center gap-1 text-mono text-[11px] text-primary">
            <Zap className="h-3 w-3" /> {profile?.credits ?? "—"}
          </span>
        </div>
        <div className="px-2 pb-2 flex items-center justify-between">
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Plan</span>
          <span className="text-mono text-[10px] uppercase tracking-widest text-foreground">{profile?.plan ?? "—"}</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive cursor-pointer">
          <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
