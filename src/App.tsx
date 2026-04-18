import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/garage" element={<Garage />} />
          <Route path="/build" element={<Build />} />
          <Route path="/geometry" element={<Geometry />} />
          <Route path="/parts" element={<Parts />} />
          <Route path="/simulation" element={<Simulation />} />
          <Route path="/results" element={<Results />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/exports" element={<Exports />} />
          <Route path="/system" element={<SystemStatus />} />
          <Route path="/design-system" element={<DesignSystem />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
