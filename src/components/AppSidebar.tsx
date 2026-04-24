import { NavLink } from "@/components/NavLink";
import { useLocation, useSearchParams } from "react-router-dom";
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
  LayoutDashboard,
  Sparkles,
  Boxes,
  Library as LibraryIcon,
  Shapes,
  Car,
  FolderKanban,
  Settings,
  Wand2,
  Hammer,
  Hexagon,
  Magnet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/lib/repo";

/**
 * APEX NEXT — primary navigation.
 *
 * Workspace flow (top-down): see overview, design a concept, build it in 3D,
 * pick parts/skins/cars, manage projects.
 *
 * Admin flow: production tools (Meshy generation, Blender job queue) and
 * legacy maintenance (hero-car STL uploads).
 */
const workspaceNav = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Concept Studio", url: "/concept-studio", icon: Sparkles },
  { title: "3D Build Studio", url: "/build-studio", icon: Boxes },
  { title: "Part Library", url: "/part-library", icon: LibraryIcon },
  { title: "Body Skin Library", url: "/body-skin-library", icon: Shapes },
  { title: "Car Library", url: "/car-library", icon: Car },
  { title: "Projects", url: "/projects", icon: FolderKanban },
];

const systemNav = [{ title: "Settings", url: "/settings", icon: Settings }];

const adminNav = [
  { title: "Meshy Admin", url: "/meshy-admin", icon: Wand2 },
  { title: "Blender Jobs", url: "/blender-jobs", icon: Hammer },
  { title: "Snap Zones", url: "/snap-zones-admin", icon: Magnet },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const [search] = useSearchParams();
  const projectId = search.get("project");
  const { user } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id);
  const isActive = (path: string) => location.pathname === path;

  // Preserve project context when navigating between concept-studio / build-studio.
  const projectScoped = new Set(["/concept-studio", "/build-studio"]);
  const withProject = (url: string) =>
    projectScoped.has(url) && projectId ? `${url}?project=${projectId}` : url;

  const renderItems = (items: Array<{ title: string; url: string; icon: any }>) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          tooltip={item.title}
          className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
          data-active={isActive(item.url)}
        >
          <NavLink
            to={withProject(item.url)}
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
            <Hexagon className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-foreground">APEX NEXT</span>
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Aero design studio
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
            <SidebarMenu>{renderItems(workspaceNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-mono text-[10px] uppercase tracking-widest">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(systemNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-mono text-[10px] uppercase tracking-widest">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(adminNav)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-2 py-2 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            APEX NEXT · v0.1
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
