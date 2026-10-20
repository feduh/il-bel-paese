import {
  LayoutDashboard,
  User as UserIcon,
  CalendarClock,
  FileText,
  Mic,
  Bookmark,
  BookOpen,
  MapPin,
  UserPlus,
  Clock,
  ShieldCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type AreaTabValue =
  | "panoramica"
  | "profilo"
  | "calendario"
  | "articoli"
  | "podcast"
  | "preferiti"
  | "editoriale"
  | "editoriale-articoli"
  | "editoriale-curatela"
  | "realta"
  | "membri"
  | "moderazione"
  | "admin";

type Item = { value: AreaTabValue; label: string; icon: typeof UserIcon; badge?: number };
type Group = { label: string; items: Item[] };

type Props = {
  active: AreaTabValue;
  onChange: (v: AreaTabValue) => void;
  isStaff: boolean;
  isAdmin: boolean;
  isCurator: boolean;
  canProposeRealities: boolean;
  canInviteMembers: boolean;
  badges: Partial<Record<AreaTabValue, number>>;
};

const AreaSidebar = ({
  active,
  onChange,
  isStaff,
  isAdmin,
  isCurator,
  canProposeRealities,
  canInviteMembers,
  badges,
}: Props) => {
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSelect = (v: AreaTabValue) => {
    onChange(v);
    if (isMobile) setOpenMobile(false);
  };
  const groups: Group[] = [];

  groups.push({
    label: "",
    items: [{ value: "panoramica", label: "Panoramica", icon: LayoutDashboard }],
  });

  const mine: Item[] = [
    { value: "profilo", label: "Profilo", icon: UserIcon },
    { value: "calendario", label: "Calendario", icon: CalendarClock, badge: badges.calendario },
    { value: "articoli", label: "Articoli", icon: FileText, badge: badges.articoli },
  ];
  if (isStaff) mine.push({ value: "podcast", label: "Podcast", icon: Mic, badge: badges.podcast });
  mine.push({ value: "preferiti", label: "Preferiti", icon: Bookmark });
  groups.push({ label: "Il mio lavoro", items: mine });

  const editorial: Item[] = [
    { value: "editoriale", label: "Candidature", icon: BookOpen, badge: badges.editoriale },
    {
      value: "editoriale-articoli",
      label: "Articoli editoriali",
      icon: FileText,
      badge: badges["editoriale-articoli"],
    },
  ];
  if (isCurator)
    editorial.push({
      value: "editoriale-curatela",
      label: "Curatela",
      icon: BookOpen,
      badge: badges["editoriale-curatela"],
    });
  groups.push({ label: "Editoriale", items: editorial });

  const community: Item[] = [];
  if (canProposeRealities)
    community.push({ value: "realta", label: "Realtà", icon: MapPin, badge: badges.realta });
  if (canInviteMembers)
    community.push({ value: "membri", label: "Membri", icon: UserPlus });
  if (isStaff || isCurator)
    community.push({
      value: "moderazione",
      label: "Moderazione",
      icon: Clock,
      badge: badges.moderazione,
    });
  if (community.length) groups.push({ label: "Community", items: community });

  if (isAdmin) {
    groups.push({
      label: "",
      items: [
        { value: "admin", label: "Amministrazione", icon: ShieldCheck, badge: badges.admin },
      ],
    });
  }

  return (
    <Sidebar collapsible="icon" className="border-r !top-16 !h-[calc(100svh-4rem)]">
      <SidebarHeader className="px-4 pt-4 pb-2">
        <p className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Area personale
        </p>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g, i) => (
          <SidebarGroup key={i}>
            {g.label && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((it) => {
                  const Icon = it.icon;
                  const isActive = active === it.value;
                  return (
                    <SidebarMenuItem key={it.value}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => handleSelect(it.value)}
                        className={`font-body relative transition-colors ${
                          isActive
                            ? "!bg-primary !text-primary-foreground hover:!bg-primary/90 before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:rounded-r before:bg-primary-foreground"
                            : ""
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1 truncate">{it.label}</span>
                        {it.badge ? (
                          <span
                            className={`ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold ${
                              isActive
                                ? "bg-primary-foreground/20 text-primary-foreground"
                                : "bg-primary/15 text-primary"
                            }`}
                          >
                            {it.badge}
                          </span>
                        ) : null}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
};

export default AreaSidebar;
