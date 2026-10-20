import { useCallback, useEffect, useMemo, useState } from "react";
import { Center, Loader, Stack, Text, Button } from "@mantine/core";
import type { AuthState, AuthUser } from "@rex/shared";
import { App } from "./App";
import { AuthScreen } from "./AuthScreen";
import { AdminPanel, isAdminSection } from "./admin/AdminPanel";
import { Landing } from "./Landing";
import * as api from "./api";
import { isAppRoute, parseAppPath, syncUrl } from "./routes";
import { SessionContext, type Session } from "./session";

export function Root() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const navigate = useCallback((next: string, mode: "push" | "replace" = "push") => {
    syncUrl(next, mode);
    setPath(next);
  }, []);

  const loadAuth = useCallback(() => {
    setAuthError(null);
    api.authState().then(setAuth).catch((err) => setAuthError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    const onEnded = () => loadAuth();
    window.addEventListener("popstate", onPop);
    window.addEventListener(api.SESSION_ENDED, onEnded);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(api.SESSION_ENDED, onEnded);
    };
  }, [loadAuth]);

  const route = parseAppPath(path);
  const appRoute = isAppRoute(route);
  useEffect(() => {
    if (appRoute && !auth) loadAuth();
  }, [appRoute, auth, loadAuth]);

  const session = useMemo<Session | null>(() => {
    if (!auth?.user) return null;
    return {
      user: auth.user,
      workspaceName: auth.workspaceName,
      setUser: (user: AuthUser) => setAuth((current) => (current ? { ...current, user } : current)),
      signOut: async () => {
        await api.signOut().catch(() => undefined);
        setAuth((current) => (current ? { ...current, user: null } : current));
        navigate("/login", "replace");
      },
    };
  }, [auth, navigate]);

  // Signed-in people never sit on the sign-in pages, and only admins open the admin panel.
  useEffect(() => {
    if (!session) return;
    if (route.kind === "login" || route.kind === "signup") navigate("/app", "replace");
    else if (route.kind === "admin" && session.user.role !== "admin") navigate("/app", "replace");
  }, [navigate, route.kind, session]);

  if (!appRoute) return <Landing onOpenApp={() => navigate("/app")} />;

  if (!auth) {
    return (
      <Center h="100%">
        {authError ? (
          <Stack align="center" gap="sm">
            <Text c="dimmed">Rex could not reach its server: {authError}</Text>
            <Button variant="light" onClick={loadAuth}>Try again</Button>
          </Stack>
        ) : <Loader aria-label="Loading" />}
      </Center>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        state={auth}
        mode={route.kind === "signup" ? "signup" : "signin"}
        onModeChange={(mode) => navigate(mode === "signup" ? "/signup" : "/login", "replace")}
        onSignedIn={(user) => {
          setAuth({ ...auth, user, needsSetup: false });
          if (route.kind === "login" || route.kind === "signup") navigate("/app", "replace");
        }}
      />
    );
  }

  if (route.kind === "admin" && session.user.role === "admin") {
    return (
      <SessionContext.Provider value={session}>
        <AdminPanel
          section={isAdminSection(route.section) ? route.section : "overview"}
          onNavigate={(section) => setPath(section === "overview" ? "/admin" : `/admin/${section}`)}
          onBack={() => navigate("/app")}
        />
      </SessionContext.Provider>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <App key={session.user.id} />
    </SessionContext.Provider>
  );
}
