// ===========================================================================
// Frontend API Client — replaces all direct Supabase calls
// All data fetching goes through this module, which talks to the Express backend
// ===========================================================================

const API_URL = import.meta.env.VITE_API_URL || "/api";

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error: any = new Error(body.error || `Request failed: ${res.status}`);
    error.status = res.status;
    console.error(`[API] ${options.method || "GET"} ${path} → ${res.status}:`, body.error || res.statusText);
    // Log full error body in development for debugging
    if (import.meta.env.DEV) console.debug("[API] Response body:", body);
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// Convenience methods
const api = {
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: any) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T = any>(path: string, body?: any) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T = any>(path: string) => request<T>(path, { method: "DELETE" }),

  // Auth
  auth: {
    login: (email: string, password: string) =>
      api.post<{ token: string; user: any }>("/auth/login", { email, password }),
    signup: (data: { email: string; password: string; companyName?: string; contactName?: string }) =>
      api.post<{ token: string; user: any }>("/auth/signup", data),
    me: () => api.get<any>("/auth/me"),
    updateProfile: (data: any) => api.put<any>("/auth/profile", data),
    setToken: (token: string) => localStorage.setItem("auth_token", token),
    clearToken: () => localStorage.removeItem("auth_token"),
  },

  // Products
  products: {
    list: () => api.get<any[]>("/products"),
    get: (id: string) => api.get<any>(`/products/${id}`),
    create: (data: any) => api.post<any>("/products", data),
    update: (id: string, data: any) => api.put<any>(`/products/${id}`, data),
    delete: (id: string) => api.delete(`/products/${id}`),
  },

  // Stock Movements
  stockMovements: {
    list: (productId?: string) =>
      api.get<any[]>(`/stock-movements${productId ? `?productId=${productId}` : ""}`),
    create: (data: any) => api.post<any>("/stock-movements", data),
    delete: (id: string) => api.delete(`/stock-movements/${id}`),
  },

  // Debtors
  debtors: {
    list: () => api.get<any[]>("/debtors"),
    get: (id: string) => api.get<any>(`/debtors/${id}`),
    create: (data: any) => api.post<any>("/debtors", data),
    update: (id: string, data: any) => api.put<any>(`/debtors/${id}`, data),
    delete: (id: string) => api.delete(`/debtors/${id}`),
  },

  // Vendors
  vendors: {
    list: () => api.get<any[]>("/vendors"),
    create: (data: any) => api.post<any>("/vendors", data),
    update: (id: string, data: any) => api.put<any>(`/vendors/${id}`, data),
    delete: (id: string) => api.delete(`/vendors/${id}`),
  },

  // Suppliers
  suppliers: {
    list: () => api.get<any[]>("/suppliers"),
    create: (data: any) => api.post<any>("/suppliers", data),
    update: (id: string, data: any) => api.put<any>(`/suppliers/${id}`, data),
    delete: (id: string) => api.delete(`/suppliers/${id}`),
  },

  // Invoices (Sales)
  invoices: {
    list: () => api.get<any[]>("/invoices"),
    get: (id: string) => api.get<any>(`/invoices/${id}`),
    create: (data: any) => api.post<any>("/invoices", data),
    update: (id: string, data: any) => api.put<any>(`/invoices/${id}`, data),
    delete: (id: string) => api.delete(`/invoices/${id}`),
  },

  // Purchase Invoices
  purchaseInvoices: {
    list: () => api.get<any[]>("/purchase-invoices"),
    create: (data: any) => api.post<any>("/purchase-invoices", data),
    update: (id: string, data: any) => api.put<any>(`/purchase-invoices/${id}`, data),
    delete: (id: string) => api.delete(`/purchase-invoices/${id}`),
  },

  // Purchase Orders (Proformas)
  purchaseOrders: {
    list: () => api.get<any[]>("/purchase-orders"),
    create: (data: any) => api.post<any>("/purchase-orders", data),
    update: (id: string, data: any) => api.put<any>(`/purchase-orders/${id}`, data),
    delete: (id: string) => api.delete(`/purchase-orders/${id}`),
  },

  // Expenses
  expenses: {
    list: () => api.get<any[]>("/expenses"),
    create: (data: any) => api.post<any>("/expenses", data),
    update: (id: string, data: any) => api.put<any>(`/expenses/${id}`, data),
    delete: (id: string) => api.delete(`/expenses/${id}`),
  },

  // Advances
  advances: {
    list: () => api.get<any[]>("/advances"),
    create: (data: any) => api.post<any>("/advances", data),
    update: (id: string, data: any) => api.put<any>(`/advances/${id}`, data),
    delete: (id: string) => api.delete(`/advances/${id}`),
  },

  // Alerts
  alerts: {
    list: () => api.get<any[]>("/alerts"),
    markRead: (id: string) => api.put(`/alerts/${id}/read`),
    generate: () => api.post("/alerts/generate"),
  },

  // Accounting
  chartOfAccounts: {
    list: () => api.get<any[]>("/chart-of-accounts"),
    create: (data: any) => api.post<any>("/chart-of-accounts", data),
    update: (id: string, data: any) => api.put<any>(`/chart-of-accounts/${id}`, data),
    delete: (id: string) => api.delete(`/chart-of-accounts/${id}`),
    seed: () => api.post("/chart-of-accounts/seed"),
  },

  journals: {
    list: () => api.get<any[]>("/journals"),
    get: (id: string) => api.get<any>(`/journals/${id}`),
    create: (data: any) => api.post<any>("/journals", data),
    delete: (id: string) => api.delete(`/journals/${id}`),
  },

  accountTransactions: (accountId: string) =>
    api.get<any>(`/account-transactions/${accountId}`),

  // Credit/Debit Notes
  creditDebitNotes: {
    list: () => api.get<any[]>("/credit-debit-notes"),
    create: (data: any) => api.post<any>("/credit-debit-notes", data),
    update: (id: string, data: any) => api.put<any>(`/credit-debit-notes/${id}`, data),
    delete: (id: string) => api.delete(`/credit-debit-notes/${id}`),
  },

  // Balance Sheet
  balanceEntries: {
    list: () => api.get<any[]>("/balance-entries"),
    create: (data: any) => api.post<any>("/balance-entries", data),
    update: (id: string, data: any) => api.put<any>(`/balance-entries/${id}`, data),
    delete: (id: string) => api.delete(`/balance-entries/${id}`),
  },

  // Invoice Templates
  invoiceTemplates: {
    get: () => api.get<any>("/invoice-templates"),
    update: (data: any) => api.put<any>("/invoice-templates", data),
  },

  // CRM
  crm: {
    leads: {
      list: () => api.get<any[]>("/crm/leads"),
      create: (data: any) => api.post<any>("/crm/leads", data),
      update: (id: string, data: any) => api.put<any>(`/crm/leads/${id}`, data),
      delete: (id: string) => api.delete(`/crm/leads/${id}`),
    },
    opportunities: {
      list: () => api.get<any[]>("/crm/opportunities"),
      create: (data: any) => api.post<any>("/crm/opportunities", data),
      update: (id: string, data: any) => api.put<any>(`/crm/opportunities/${id}`, data),
      delete: (id: string) => api.delete(`/crm/opportunities/${id}`),
    },
    activities: {
      list: () => api.get<any[]>("/crm/activities"),
      create: (data: any) => api.post<any>("/crm/activities", data),
      update: (id: string, data: any) => api.put<any>(`/crm/activities/${id}`, data),
      delete: (id: string) => api.delete(`/crm/activities/${id}`),
    },
  },

  // Dashboard
  dashboard: () => api.get<any>("/dashboard"),

  // Forecast
  forecast: () => api.get<any>("/forecast"),

  // NOA
  noa: {
    get: (token: string) => api.get<any>(`/noa/${token}`),
    respond: (token: string, decision: string, comments?: string) =>
      api.post(`/noa/${token}/respond`, { decision, comments }),
  },

  // Reminder Logs & Manual Reminders
  reminderLogs: {
    list: () => api.get<any[]>("/reminder-logs"),
  },
  reminders: {
    send: (invoiceId: string) => api.post<any>(`/invoices/${invoiceId}/send-reminder`),
    sendPurchase: (invoiceId: string) => api.post<any>(`/purchase-invoices/${invoiceId}/send-reminder`),
    runAll: () => api.post<any>("/reminders/run"),
  },

  // Admin
  admin: {
    users: () => api.get<any[]>("/admin/users"),
    updateRole: (userId: string, role: string, add: boolean) =>
      api.put("/admin/users/role", { userId, role, add }),
  },
};

export default api;
