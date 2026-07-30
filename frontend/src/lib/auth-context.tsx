import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import api from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

export type AppRole = "client" | "factor_admin" | "treasury" | "checker" | "sales_rep";

export type AuthUser = {
  id: string;
  email: string;
  companyName?: string;
  contactName?: string;
  roles?: AppRole[];
};

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isTreasury: boolean;
  isChecker: boolean;
  isClient: boolean;
  isSalesRep: boolean;
  refreshRoles: () => Promise<void>;
  refreshAuth: () => Promise<void>;
};

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const router = useRouter();

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) { setRoles([]); return; }
    try {
      const data = await api.auth.me();
      setRoles((data.roles ?? []) as AppRole[]);
    } catch {
      setRoles([]);
    }
  };

  const checkAuth = async () => {
    const storedToken = localStorage.getItem("auth_token");
    if (!storedToken) {
      setUser(null);
      setToken(null);
      setRoles([]);
      setLoading(false);
      return;
    }
    setToken(storedToken);
    try {
      const data = await api.auth.me();
      const authUser: AuthUser = {
        id: data.id,
        email: data.email,
        companyName: data.companyName ?? data.company_name,
        contactName: data.contactName ?? data.contact_name,
        roles: data.roles,
      };
      setUser(authUser);
      setRoles((data.roles ?? []) as AppRole[]);
    } catch {
      localStorage.removeItem("auth_token");
      setToken(null);
      setUser(null);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  };

  // Listen for storage changes (login/logout from other tabs)
  useEffect(() => {
    checkAuth();
    const handler = (e: StorageEvent) => {
      if (e.key === "auth_token") {
        setLoading(true);
        checkAuth();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
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
  const isClient = roles.includes("client") || (!isAdmin && !isTreasury && !isChecker && !isSalesRep);

  const value: AuthState = {
    user,
    token,
    roles,
    loading,
    isAdmin,
    isTreasury,
    isChecker,
    isClient,
    isSalesRep,
    refreshRoles: () => loadRoles(user?.id),
    refreshAuth,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
