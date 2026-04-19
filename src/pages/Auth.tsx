import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Wind, ArrowRight, Loader2 } from "lucide-react";

const REMEMBER_KEY = "aerolab.remember_me";

const emailSchema = z.string().trim().email("Invalid email").max(255);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(72);
const nameSchema = z.string().trim().min(1, "Required").max(80);

type Mode = "signin" | "signup";

const Auth = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [remember, setRemember] = useState(() => {
    const stored = localStorage.getItem(REMEMBER_KEY);
    return stored === null ? true : stored === "true";
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const from = (location.state as { from?: string } | null)?.from ?? "/garage";

  useEffect(() => {
    if (user && !loading) navigate(from, { replace: true });
  }, [user, loading, from, navigate]);

  if (user) return <Navigate to={from} replace />;

  const validate = () => {
    const e: Record<string, string> = {};
    const em = emailSchema.safeParse(email);
    if (!em.success) e.email = em.error.issues[0].message;
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) e.password = pw.error.issues[0].message;
    if (mode === "signup") {
      const nm = nameSchema.safeParse(displayName);
      if (!nm.success) e.displayName = nm.error.issues[0].message;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    // Persist preference so the AuthProvider can clear the session on tab close when off.
    localStorage.setItem(REMEMBER_KEY, String(remember));

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/garage`,
            data: { display_name: displayName },
          },
        });
        if (error) throw error;
        toast({ title: "Account created", description: "You're signed in. Welcome to AeroLab." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "Welcome back" });
      }
    } catch (err: any) {
      const msg = err?.message ?? "Authentication failed";
      const friendly =
        msg.includes("Invalid login") ? "Email or password is incorrect." :
        msg.includes("already registered") ? "An account with this email already exists. Try signing in." :
        msg;
      toast({ title: "Couldn't sign in", description: friendly, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 grid-bg-fine opacity-[0.18]" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,hsl(188_95%_55%/0.10),transparent_60%)]" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-border/40">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/40 bg-primary/10">
            <Wind className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-mono text-[11px] uppercase tracking-widest text-foreground">AeroLab</span>
        </Link>
        <Link to="/" className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </Link>
      </header>

      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-mono text-[10px] uppercase tracking-widest text-primary">
              {mode === "signin" ? "Sign in" : "Create account"}
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              {mode === "signin" ? "Open the wind tunnel" : "Build your first variant"}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {mode === "signin" ? "Sign in to access your builds and runs." : "Get 100 solver credits to start. No payment required."}
            </p>
          </div>

          <div className="glass rounded-xl p-6 border-primary/20">
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="displayName" className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Display name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Jane Engineer"
                    autoComplete="name"
                    className="bg-surface-1 border-border"
                  />
                  {errors.displayName && <p className="text-xs text-destructive">{errors.displayName}</p>}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@team.com"
                  autoComplete="email"
                  required
                  className="bg-surface-1 border-border"
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  className="bg-surface-1 border-border"
                />
                {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              </div>

              {mode === "signin" && (
                <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                  <Checkbox
                    id="remember"
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                    className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-xs text-muted-foreground">
                    Remember me on this device
                  </span>
                </label>
              )}

              <Button type="submit" variant="hero" className="w-full" disabled={submitting}>
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working…</>
                ) : (
                  <>{mode === "signin" ? "Sign in" : "Create account"} <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </form>

            <div className="mt-5 pt-5 border-t border-border/60 text-center">
              <button
                type="button"
                onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErrors({}); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {mode === "signin" ? (
                  <>New to AeroLab? <span className="text-primary">Create an account</span></>
                ) : (
                  <>Already have an account? <span className="text-primary">Sign in</span></>
                )}
              </button>
            </div>
          </div>

          <p className="mt-5 text-center text-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            Secured by Lovable Cloud · RLS-protected workspace
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
