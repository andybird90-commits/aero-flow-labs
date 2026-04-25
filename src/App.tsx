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
import Settings from "./pages/Settings";
import AdminCarStls from "./pages/AdminCarStls";
import Styles from "./pages/Styles";
import Garage from "./pages/Garage";
import Library from "./pages/Library";
import Marketplace from "./pages/Marketplace";
import Prototyper from "./pages/Prototyper";
import Parts from "./pages/Parts";
import Refine from "./pages/Refine";
import Exports from "./pages/Exports";

// APEX NEXT — new IA shell
import Dashboard from "./pages/Dashboard";
import BuildStudio from "./pages/BuildStudio";
import BodySkinLibrary from "./pages/BodySkinLibrary";
import MeshyAdmin from "./pages/MeshyAdmin";
import BlenderJobs from "./pages/BlenderJobs";
import SnapZonesAdmin from "./pages/SnapZonesAdmin";
import HardpointsAdmin from "./pages/HardpointsAdmin";

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

            {/* APEX NEXT — primary IA */}
            <Route path="/dashboard"         element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/concept-studio"    element={<ProtectedRoute><Concepts /></ProtectedRoute>} />
            <Route path="/build-studio"      element={<ProtectedRoute><BuildStudio /></ProtectedRoute>} />
            <Route path="/part-library"      element={<ProtectedRoute><Library /></ProtectedRoute>} />
            <Route path="/body-skin-library" element={<ProtectedRoute><BodySkinLibrary /></ProtectedRoute>} />
            <Route path="/car-library"       element={<ProtectedRoute><Garage /></ProtectedRoute>} />
            <Route path="/meshy-admin"       element={<ProtectedRoute><MeshyAdmin /></ProtectedRoute>} />
            <Route path="/blender-jobs"      element={<ProtectedRoute><BlenderJobs /></ProtectedRoute>} />
            <Route path="/snap-zones-admin"  element={<ProtectedRoute><SnapZonesAdmin /></ProtectedRoute>} />
            <Route path="/hardpoints-admin"  element={<ProtectedRoute><HardpointsAdmin /></ProtectedRoute>} />
            <Route path="/projects"          element={<ProtectedRoute><Projects /></ProtectedRoute>} />
            <Route path="/settings"          element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/settings/car-stls" element={<ProtectedRoute><AdminCarStls /></ProtectedRoute>} />

            {/* Legacy routes — still reachable, hidden from sidebar */}
            <Route path="/upload"      element={<Navigate to="/concept-studio" replace />} />
            <Route path="/brief"       element={<ProtectedRoute><Brief /></ProtectedRoute>} />
            <Route path="/concepts"    element={<ProtectedRoute><Concepts /></ProtectedRoute>} />
            <Route path="/styles"      element={<ProtectedRoute><Styles /></ProtectedRoute>} />
            <Route path="/garage"      element={<ProtectedRoute><Garage /></ProtectedRoute>} />
            <Route path="/parts"       element={<ProtectedRoute><Parts /></ProtectedRoute>} />
            <Route path="/refine"      element={<ProtectedRoute><Refine /></ProtectedRoute>} />
            <Route path="/library"     element={<ProtectedRoute><Library /></ProtectedRoute>} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/prototyper"  element={<ProtectedRoute><Prototyper /></ProtectedRoute>} />
            <Route path="/exports"     element={<ProtectedRoute><Exports /></ProtectedRoute>} />

            {/* Legacy redirects (very old routes) */}
            <Route path="/build"         element={<Navigate to="/dashboard" replace />} />
            <Route path="/geometry"      element={<Navigate to="/concept-studio" replace />} />
            <Route path="/simulation"    element={<Navigate to="/concept-studio" replace />} />
            <Route path="/results"       element={<Navigate to="/concept-studio" replace />} />
            <Route path="/compare"       element={<Navigate to="/concept-studio" replace />} />
            <Route path="/optimization"  element={<Navigate to="/concept-studio" replace />} />
            <Route path="/system"        element={<Navigate to="/dashboard" replace />} />
            <Route path="/design-system" element={<Navigate to="/" replace />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
