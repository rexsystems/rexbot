import { useEffect, useState, type ReactNode } from "react";
import { ActionIcon, AppShell, Box, Group, ScrollArea, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { BlobAvatar } from "../BlobAvatar";
import { IconBack, IconDashboard, IconMenu, IconServers, IconSettings, IconUsage, IconUsers, IconX } from "../icons";
import { useSession } from "../session";
import { syncUrl } from "../routes";
import { Overview } from "./Overview";
import { Users } from "./Users";
import { Computers } from "./Computers";
import { Usage } from "./Usage";
import { WorkspaceSettings } from "./WorkspaceSettings";

export type AdminSection = "overview" | "users" | "computers" | "usage" | "settings";

const SECTIONS: Array<{ id: AdminSection; label: string; icon: ReactNode; hint: string }> = [
  { id: "overview", label: "Overview", icon: <IconDashboard size={24} />, hint: "The server at a glance" },
  { id: "users", label: "Users", icon: <IconUsers size={24} />, hint: "Accounts and access" },
  { id: "computers", label: "Computers", icon: <IconServers size={24} />, hint: "Image and VMs" },
  { id: "usage", label: "Usage", icon: <IconUsage size={24} />, hint: "Messages and tokens" },
  { id: "settings", label: "Settings", icon: <IconSettings size={24} />, hint: "Sign-up and limits" },
];

export function isAdminSection(value: string | undefined): value is AdminSection {
  return SECTIONS.some((section) => section.id === value);
}

export function AdminPanel({ section, onNavigate, onBack }: { section: AdminSection; onNavigate: (section: AdminSection) => void; onBack: () => void }) {
  const session = useSession();
  const [mobileNav, setMobileNav] = useState(false);
  const current = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0]!;

  useEffect(() => {
    document.title = `${current.label} · Admin · ${session.workspaceName}`;
  }, [current.label, session.workspaceName]);

  const go = (next: AdminSection) => {
    syncUrl(next === "overview" ? "/admin" : `/admin/${next}`);
    onNavigate(next);
    setMobileNav(false);
  };

  return (
    <AppShell className="app-shell" navbar={{ width: 290, breakpoint: "sm", collapsed: { mobile: !mobileNav } }} padding={0}>
      <AppShell.Navbar p="md">
        <Group gap="sm" mb="xl" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap"><BlobAvatar seed="rex-brand" size={46} /><div><Title order={3}>Admin</Title><Text size="xs" c="dimmed">{session.workspaceName}</Text></div></Group>
          <ActionIcon hiddenFrom="sm" aria-label="Close menu" variant="subtle" size={44} onClick={() => setMobileNav(false)}><IconX /></ActionIcon>
        </Group>
        <ScrollArea style={{ flex: 1 }} offsetScrollbars type="hover">
          <Stack gap={2} component="nav" aria-label="Admin sections">
            {SECTIONS.map((entry) => (
              <UnstyledButton key={entry.id} className={`chat-nav${entry.id === section ? " active" : ""}`} aria-current={entry.id === section ? "page" : undefined} onClick={() => go(entry.id)}>
                <Group gap="sm" wrap="nowrap">
                  <Box c={entry.id === section ? "ember.4" : "dimmed"} style={{ display: "flex" }}>{entry.icon}</Box>
                  <div style={{ minWidth: 0 }}>
                    <div className="chat-nav-title">{entry.label}</div>
                    <Text size="xs" c="dimmed" truncate>{entry.hint}</Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea>
        <Stack gap={6} className="sidebar-footer">
          <UnstyledButton className="chat-nav" onClick={onBack}>
            <Group gap="sm" wrap="nowrap"><IconBack size={22} /><Text size="sm" fw={500}>Back to chats</Text></Group>
          </UnstyledButton>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Group className="admin-topbar" gap="sm" wrap="nowrap">
          <ActionIcon hiddenFrom="sm" aria-label="Open menu" variant="subtle" onClick={() => setMobileNav(true)}><IconMenu /></ActionIcon>
          <Title order={2} size="h3">{current.label}</Title>
        </Group>
        <ScrollArea className="admin-scroll" type="auto">
          <div className="admin-content">
            {section === "overview" ? <Overview onOpen={go} /> : null}
            {section === "users" ? <Users /> : null}
            {section === "computers" ? <Computers /> : null}
            {section === "usage" ? <Usage /> : null}
            {section === "settings" ? <WorkspaceSettings /> : null}
          </div>
        </ScrollArea>
      </AppShell.Main>
    </AppShell>
  );
}
