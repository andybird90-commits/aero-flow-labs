import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useJobRealtime } from "@/lib/repo";

function RealtimeBridge() {
  const { user } = useAuth();
  useJobRealtime(user?.id);
  return null;
}
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth";
import Garage from "./pages/Garage";
import Build from "./pages/Build";
import Geometry from "./pages/Geometry";
import Parts from "./pages/Parts";
import Simulation from "./pages/Simulation";
import Results from "./pages/Results";
import Compare from "./pages/Compare";
import Exports from "./pages/Exports";
import SystemStatus from "./pages/SystemStatus";
import DesignSystem from "./pages/DesignSystem";
import Optimization from "./pages/Optimization";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RealtimeBridge />
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/garage" element={<ProtectedRoute><Garage /></ProtectedRoute>} />
            <Route path="/build" element={<ProtectedRoute><Build /></ProtectedRoute>} />
            <Route path="/geometry" element={<ProtectedRoute><Geometry /></ProtectedRoute>} />
            <Route path="/parts" element={<ProtectedRoute><Parts /></ProtectedRoute>} />
            <Route path="/simulation" element={<ProtectedRoute><Simulation /></ProtectedRoute>} />
            <Route path="/optimization" element={<ProtectedRoute><Optimization /></ProtectedRoute>} />
            <Route path="/results" element={<ProtectedRoute><Results /></ProtectedRoute>} />
            <Route path="/compare" element={<ProtectedRoute><Compare /></ProtectedRoute>} />
            <Route path="/exports" element={<ProtectedRoute><Exports /></ProtectedRoute>} />
            <Route path="/system" element={<ProtectedRoute><SystemStatus /></ProtectedRoute>} />
            <Route path="/design-system" element={<DesignSystem />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
