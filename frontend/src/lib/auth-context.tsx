import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import api from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";

export type AppRole =
  | "client"
  | "factor_admin"
  | "treasury"
  | "checker"
  | "sales_rep"
  | "operations"
  | "reporting_manager";

export type AuthUser = {
  id: string;
  email: string;
  companyName?: string;
  contactName?: string;
  photoUrl?: string;
  roles?: AppRole[];
};

type AuthState = {
  user: AuthUser | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isTreasury: boolean;
  isChecker: boolean;
  isClient: boolean;
  isSalesRep: boolean;
  isOperations: boolean;
  isReportingManager: boolean;
  signOut: () => void;
  refreshRoles: () => Promise<void>;
  refreshAuth: () => Promise<void>;
};

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  // Migration: drop any JWT left in localStorage by the old bearer-token flow.
  // Sessions are now httpOnly cookies; anything in localStorage is stale.
  useEffect(() => {
    localStorage.removeItem("auth_token");
  }, []);

  // Monotonic guard for concurrent checkAuth() runs (login page, refreshAuth).
  // A stale /auth/me response must never overwrite a newer session.
  const checkSeq = useRef(0);

  const checkAuth = async () => {
    const seq = ++checkSeq.current;
    try {
      const data = await api.auth.me();
      // A newer auth check superseded this one — drop the stale result.
      if (seq !== checkSeq.current) return;
      const authUser: AuthUser = {
        id: data.id,
        email: data.email,
        companyName: data.companyName ?? data.company_name,
        contactName: data.contactName ?? data.contact_name,
        roles: data.roles,
      };
      setUser(authUser);
      setRoles((data.roles ?? []) as AppRole[]);
    } catch (err) {
      if (seq !== checkSeq.current) return;
      // 401 (no/invalid cookie) or a network failure → signed out.
      console.error("[Auth] checkAuth /auth/me failed:", err);
      setUser(null);
      setRoles([]);
    } finally {
      if (seq === checkSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Expose a way to re-check auth without page reload
  const refreshAuth = async () => {
    setLoading(true);
    await checkAuth();
  };

  const isAdmin = roles.includes("factor_admin");
  const isTreasury = roles.includes("treasury");
  const isChecker = roles.includes("checker");
  const isSalesRep = roles.includes("sales_rep");
  const isOperations = roles.includes("operations");
  const isReportingManager = roles.includes("reporting_manager");
  const isClient =
    roles.includes("client") ||
    (!isAdmin && !isTreasury && !isChecker && !isSalesRep && !isOperations && !isReportingManager);

  const value: AuthState = {
    user,
    roles,
    loading,
    isAdmin,
    isTreasury,
    isChecker,
    isClient,
    isSalesRep,
    isOperations,
    isReportingManager,
    signOut: () => {
      // Best-effort server-side logout (clears the httpOnly cookie).
      api.auth.logout().catch(() => {});
      // Bump the sequence guard so an in-flight /auth/me can't resurrect the
      // session after the user has signed out.
      checkSeq.current++;
      setUser(null);
      setRoles([]);
      qc.clear();
    },
    refreshRoles: async () => {
      try {
        const data = await api.auth.me();
        setRoles((data.roles ?? []) as AppRole[]);
      } catch (err) {
        console.error("[Auth] loadRoles error:", err);
      }
    },
    refreshAuth,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
