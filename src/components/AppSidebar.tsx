import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Car,
  LayoutDashboard,
  Box,
  Wrench,
  PlayCircle,
  BarChart3,
  GitCompareArrows,
  FileDown,
  Activity,
  Wind,
} from "lucide-react";

const primary = [
  { title: "Garage", url: "/garage", icon: Car },
  { title: "Build Workspace", url: "/build", icon: LayoutDashboard },
];

const buildNav = [
  { title: "Geometry", url: "/geometry", icon: Box },
  { title: "Aero Parts", url: "/parts", icon: Wrench },
  { title: "Simulation Setup", url: "/simulation", icon: PlayCircle },
  { title: "Results", url: "/results", icon: BarChart3 },
  { title: "Compare", url: "/compare", icon: GitCompareArrows },
];

const system = [
  { title: "Exports & Reports", url: "/exports", icon: FileDown },
  { title: "System Status", url: "/system", icon: Activity },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  const renderItems = (items: typeof primary) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          tooltip={item.title}
          className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
          data-active={isActive(item.url)}
        >
          <NavLink
            to={item.url}
            end
            className="group/nav relative flex items-center gap-3 rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeClassName="!text-primary !bg-sidebar-accent"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate text-sm">{item.title}</span>}
            {isActive(item.url) && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-glow" />
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
            <Wind className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-foreground">AeroLab</span>
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                v0.4 · build 218
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupLabel className="text-mono text-[10px] uppercase tracking-widest">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(primary)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-mono text-[10px] uppercase tracking-widest">
            Build
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(buildNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-mono text-[10px] uppercase tracking-widest">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(system)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed ? (
          <div className="px-2 py-2">
            <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/60 px-2.5 py-2">
              <div className="h-7 w-7 rounded-full bg-gradient-primary text-[11px] font-semibold text-primary-foreground flex items-center justify-center">
                MK
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-xs font-medium text-foreground">M. Kovács</div>
                <div className="truncate text-[10px] text-muted-foreground">Engineer · Pro</div>
              </div>
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-2">
            <div className="h-7 w-7 rounded-full bg-gradient-primary text-[11px] font-semibold text-primary-foreground flex items-center justify-center">
              MK
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
