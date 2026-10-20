import { createContext, useContext } from "react";
import type { AuthUser } from "@rex/shared";

export interface Session {
  user: AuthUser;
  workspaceName: string;
  setUser: (user: AuthUser) => void;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession needs a signed-in SessionContext.");
  return session;
}
