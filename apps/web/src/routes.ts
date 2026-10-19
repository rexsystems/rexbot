import type { Conversation } from "@rex/shared";

export type AppRoute =
  | { kind: "home" }
  | { kind: "bot"; id: string }
  | { kind: "group"; id: string };

export function conversationPath(conversation: Pick<Conversation, "id" | "kind">): string {
  const id = encodeURIComponent(conversation.id);
  return conversation.kind === "group" ? `/group/${id}` : `/bot/${id}`;
}

export function parseAppPath(pathname: string): AppRoute {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "bot" && parts[1]) {
    return { kind: "bot", id: decodeURIComponent(parts[1]) };
  }
  if (parts.length === 2 && parts[0] === "group" && parts[1]) {
    return { kind: "group", id: decodeURIComponent(parts[1]) };
  }
  return { kind: "home" };
}

export function syncUrl(path: string, mode: "push" | "replace" = "push") {
  if (typeof window === "undefined" || window.location.pathname === path) return;
  if (mode === "replace") window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
}

export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
