import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useJobRealtime } from "@/lib/repo";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import Projects from "./pages/Projects";

import Brief from "./pages/Brief";
import Concepts from "./pages/Concepts";
import Parts from "./pages/Parts";
import Refine from "./pages/Refine";
import Exports from "./pages/Exports";
import Settings from "./pages/Settings";

function RealtimeBridge() {
  const { user } = useAuth();
  useJobRealtime(user?.id);
  return null;
}

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RealtimeBridge />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/upload" element={<Navigate to="/brief" replace />} />
            <Route path="/brief" element={<ProtectedRoute><Brief /></ProtectedRoute>} />
            <Route path="/concepts" element={<ProtectedRoute><Concepts /></ProtectedRoute>} />
            <Route path="/parts" element={<ProtectedRoute><Parts /></ProtectedRoute>} />
            <Route path="/refine" element={<ProtectedRoute><Refine /></ProtectedRoute>} />
            <Route path="/exports" element={<ProtectedRoute><Exports /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

            {/* Legacy redirects */}
            <Route path="/garage" element={<Navigate to="/projects" replace />} />
            <Route path="/build" element={<Navigate to="/projects" replace />} />
            <Route path="/geometry" element={<Navigate to="/brief" replace />} />
            <Route path="/simulation" element={<Navigate to="/concepts" replace />} />
            <Route path="/results" element={<Navigate to="/concepts" replace />} />
            <Route path="/compare" element={<Navigate to="/concepts" replace />} />
            <Route path="/optimization" element={<Navigate to="/parts" replace />} />
            <Route path="/system" element={<Navigate to="/projects" replace />} />
            <Route path="/design-system" element={<Navigate to="/" replace />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
