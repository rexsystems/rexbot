import type { Conversation } from "@rex/shared";

export type AppRoute =
  | { kind: "landing" }
  | { kind: "login" }
  | { kind: "signup" }
  | { kind: "admin"; section?: string }
  | { kind: "app" }
  | { kind: "bot"; id: string }
  | { kind: "group"; id: string };

export function conversationPath(conversation: Pick<Conversation, "id" | "kind">): string {
  const id = encodeURIComponent(conversation.id);
  return conversation.kind === "group" ? `/group/${id}` : `/bot/${id}`;
}

export function parseAppPath(pathname: string): AppRoute {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "landing" };
  if (parts.length === 1 && parts[0] === "app") return { kind: "app" };
  if (parts.length === 1 && parts[0] === "login") return { kind: "login" };
  if (parts.length === 1 && parts[0] === "signup") return { kind: "signup" };
  if (parts[0] === "admin" && parts.length <= 2) return { kind: "admin", section: parts[1] };
  if (parts.length === 2 && parts[0] === "bot" && parts[1]) {
    return { kind: "bot", id: decodeURIComponent(parts[1]) };
  }
  if (parts.length === 2 && parts[0] === "group" && parts[1]) {
    return { kind: "group", id: decodeURIComponent(parts[1]) };
  }
  return { kind: "landing" };
}

export function isAppRoute(route: AppRoute): boolean {
  return route.kind === "app" || route.kind === "bot" || route.kind === "group" || route.kind === "admin" || route.kind === "login" || route.kind === "signup";
}

export function syncUrl(path: string, mode: "push" | "replace" = "push") {
  if (typeof window === "undefined" || window.location.pathname === path) return;
  if (mode === "replace") window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
}

export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
