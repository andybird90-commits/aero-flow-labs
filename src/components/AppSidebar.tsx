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
  LayoutGrid,
  FileText,
  Sparkles,
  Settings,
  Hexagon,
  FileBox,
  Palette,
  Car,
  Library as LibraryIcon,
  Store,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/lib/repo";

// NOTE: Prototyper was removed from primary nav as part of the strategic
// pivot to geometry-first fitting for body-conforming parts. The /prototyper
// route still works for legacy prototypes opened from /library.
const projectsNav = [
  { title: "Projects", url: "/projects", icon: LayoutGrid },
  { title: "Garage", url: "/garage", icon: Car },
  { title: "Styles", url: "/styles", icon: Palette },
  { title: "My Library", url: "/library", icon: LibraryIcon },
  { title: "Marketplace", url: "/marketplace", icon: Store },
];

const studioNav = [
  { title: "Design Brief", url: "/brief", icon: FileText },
  { title: "Concepts", url: "/concepts", icon: Sparkles },
];

const systemNav = [{ title: "Settings", url: "/settings", icon: Settings }];
const adminNav = [{ title: "Hero-car STLs", url: "/settings/car-stls", icon: FileBox }];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const [search] = useSearchParams();
  const projectId = search.get("project");
  const { user } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id);
  const isActive = (path: string) => location.pathname === path;

  // Preserve project context across studio navigation
  const withProject = (url: string) =>
    studioNav.some((s) => s.url === url) && projectId
      ? `${url}?project=${projectId}`
      : url;

  const renderItems = (items: typeof projectsNav) =>
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
              <span className="text-sm font-semibold tracking-tight text-foreground">BodyKit Studio</span>
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                AI aero design
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
            <SidebarMenu>{renderItems(projectsNav)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-mono text-[10px] uppercase tracking-widest">
            Studio
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(studioNav)}</SidebarMenu>
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
            v1.0 · Studio
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
