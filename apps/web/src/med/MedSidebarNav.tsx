/** T3 Med: the four patient rows above the sidebar's thread list, each with its count. */
import { Link, useLocation } from "@tanstack/react-router";
import { BellIcon, CalendarIcon, InboxIcon, UsersRoundIcon } from "lucide-react";

import { Badge } from "../components/ui/badge";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { useEnvironmentQuery } from "../state/query";
import { countsAtom } from "./medData";

const ROWS = [
  { to: "/inbox", label: "Inbox", count: "inbox", Icon: InboxIcon, waits: true },
  { to: "/patients", label: "Patients", count: "patients", Icon: UsersRoundIcon, waits: false },
  { to: "/needs-you", label: "Needs you", count: "needsYou", Icon: BellIcon, waits: true },
  { to: "/upcoming", label: "Upcoming", count: "upcoming", Icon: CalendarIcon, waits: false },
] as const;

export function MedSidebarNav() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const counts = useEnvironmentQuery(countsAtom).data;
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <SidebarGroup>
      <nav aria-label="Patients">
        <SidebarMenu>
          {ROWS.map(({ to, label, count, Icon, waits }) => {
            // Until the counts load there is no number to show, and a zero would be a claim.
            const value = counts?.[count];
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  isActive={pathname === to || pathname.startsWith(`${to}/`)}
                  render={<Link to={to} onClick={closeMobileSidebar} />}
                >
                  <Icon aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {value === undefined ? null : waits && value > 0 ? (
                    <Badge variant="info" size="sm">
                      {value}
                    </Badge>
                  ) : (
                    <span className="shrink-0 font-normal text-xs tabular-nums">{value}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  );
}
