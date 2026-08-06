// ===========================================================================
// Frontend API Client — replaces all direct Supabase calls
// All data fetching goes through this module, which talks to the Express backend
// ===========================================================================

const API_URL = import.meta.env.VITE_API_URL || "/api";

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Auto-forward viewAsUserId from browser URL search params to API calls
  // This enables the reporting manager's view-as mode to work across all API requests
  let apiPath = path;
  if (!options.method || options.method === "GET") {
    const urlParams = new URLSearchParams(window.location.search);
    const viewAsUserId = urlParams.get("viewAsUserId");
    if (viewAsUserId) {
      const separator = apiPath.includes("?") ? "&" : "?";
      apiPath = `${apiPath}${separator}viewAsUserId=${encodeURIComponent(viewAsUserId)}`;
    }
  }

  const res = await fetch(`${API_URL}${apiPath}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error: any = new Error(body.error || `Request failed: ${res.status}`);
    error.status = res.status;
    console.error(
      `[API] ${options.method || "GET"} ${path} → ${res.status}:`,
      body.error || res.statusText,
    );
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
    signup: (data: {
      email: string;
      password: string;
      companyName?: string;
      contactName?: string;
    }) => api.post<{ token: string; user: any }>("/auth/signup", data),
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

  // Catalogue settings (default minimum margin for products without their own)
  catalogueSettings: {
    get: () => api.get<any>("/catalogue-settings"),
    update: (data: any) => api.put<any>("/catalogue-settings", data),
  },

  // Stock Movements
  stockMovements: {
    list: (productId?: string) =>
      api.get<any[]>(`/stock-movements${productId ? `?productId=${productId}` : ""}`),
    create: (data: any) => api.post<any>("/stock-movements", data),
    confirm: (id: string) => api.post<any>(`/stock-movements/${id}/confirm`, {}),
    cancel: (id: string) => api.post<any>(`/stock-movements/${id}/cancel`, {}),
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
    issue: (id: string) => api.post<any>(`/invoices/${id}/issue`, {}),
    recordPayment: (id: string, data: { amountReceived: number; receiptDate?: string }) =>
      api.post<any>(`/invoices/${id}/payment`, data),
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
    // Auto-create a DRAFT sales order from a sales proforma and link it.
    convertToSO: (id: string) => api.post<any>(`/purchase-orders/${id}/convert-to-so`, {}),
  },

  // Goods Purchase Orders (catalogue-backed procurement POs)
  goodsPurchaseOrders: {
    list: () => api.get<any[]>("/goods-purchase-orders"),
    create: (data: any) => api.post<any>("/goods-purchase-orders", data),
    update: (id: string, data: any) => api.put<any>(`/goods-purchase-orders/${id}`, data),
    delete: (id: string) => api.delete(`/goods-purchase-orders/${id}`),
  },

  // Goods Receipts (GRNs — credit inventory when goods arrive)
  goodsReceipts: {
    list: () => api.get<any[]>("/goods-receipts"),
    create: (data: any) => api.post<any>("/goods-receipts", data),
    update: (id: string, data: any) => api.put<any>(`/goods-receipts/${id}`, data),
    delete: (id: string) => api.delete(`/goods-receipts/${id}`),
    confirm: (id: string, data?: any) => api.post<any>(`/goods-receipts/${id}/confirm`, data ?? {}),
    cancel: (id: string) => api.post<any>(`/goods-receipts/${id}/cancel`, {}),
  },

  // Quotations (offers to customers — never touch stock or accounting)
  quotations: {
    list: () => api.get<any[]>("/quotations"),
    get: (id: string) => api.get<any>(`/quotations/${id}`),
    create: (data: any) => api.post<any>("/quotations", data),
    update: (id: string, data: any) => api.put<any>(`/quotations/${id}`, data),
    delete: (id: string) => api.delete(`/quotations/${id}`),
    convert: (id: string) => api.post<any>(`/quotations/${id}/convert`, {}),
  },

  // Goods Sales Orders (catalogue-backed customer orders — never touch stock)
  goodsSalesOrders: {
    list: () => api.get<any[]>("/goods-sales-orders"),
    create: (data: any) => api.post<any>("/goods-sales-orders", data),
    update: (id: string, data: any) => api.put<any>(`/goods-sales-orders/${id}`, data),
    delete: (id: string) => api.delete(`/goods-sales-orders/${id}`),
  },

  // Goods Dispatches (dispatch notes — DEBIT inventory when confirmed)
  goodsDispatches: {
    list: () => api.get<any[]>("/goods-dispatches"),
    get: (id: string) => api.get<any>(`/goods-dispatches/${id}`),
    create: (data: any) => api.post<any>("/goods-dispatches", data),
    update: (id: string, data: any) => api.put<any>(`/goods-dispatches/${id}`, data),
    delete: (id: string) => api.delete(`/goods-dispatches/${id}`),
    confirm: (id: string, data?: any) => api.post<any>(`/goods-dispatches/${id}/confirm`, data ?? {}),
    cancel: (id: string) => api.post<any>(`/goods-dispatches/${id}/cancel`, {}),
    deliver: (id: string, data: any) => api.post<any>(`/goods-dispatches/${id}/deliver`, data),
    return: (id: string, data: any) => api.post<any>(`/goods-dispatches/${id}/return`, data),
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

  accountTransactions: (accountId: string) => api.get<any>(`/account-transactions/${accountId}`),

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

  // Forecast Variables (persisted snapshots from backend)
  forecastVariables: {
    list: () =>
      api.get<{
        computedDate: string | null;
        wasRecomputed: boolean;
        snapshots: any[];
        products: any[];
      }>("/forecast-variables"),
    recompute: () =>
      api.post<{ computedDate: string; count: number; message: string }>(
        "/forecast-variables/recompute",
      ),
  },

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
    sendPurchase: (invoiceId: string) =>
      api.post<any>(`/purchase-invoices/${invoiceId}/send-reminder`),
    runAll: () => api.post<any>("/reminders/run"),
  },

  // Submissions (Visits, Travel, Expenses, Leave)
  submissions: {
    list: (type?: string) => api.get<any[]>(`/submissions${type ? `?type=${type}` : ""}`),
    create: (data: { type: string; data: any }) => api.post<any>("/submissions", data),
    update: (id: string, data: any) => api.put<any>(`/submissions/${id}`, data),
    delete: (id: string) => api.delete(`/submissions/${id}`),
  },

  // Reporting Manager: Team Requests
  requests: {
    list: (type?: string) => api.get<any[]>(`/requests${type ? `?type=${type}` : ""}`),
    updateStatus: (id: string, status: string) => api.put(`/requests/${id}/status`, { status }),
  },

  // User Progress (for reporting managers)
  userProgress: () => api.get<any>("/user-progress"),

  // Admin
  admin: {
    users: () => api.get<any[]>("/admin/users"),
    createUser: (data: {
      email: string;
      password: string;
      contactName?: string;
      role: string;
      managerId?: string;
    }) => api.post<any>("/admin/users/create", data),
    updateRole: (userId: string, role: string, add: boolean) =>
      api.put("/admin/users/role", { userId, role, add }),
    listManagers: () => api.get<any[]>("/admin/users/managers"),
    assignManager: (userId: string, managerId: string | null) =>
      api.put(`/admin/users/${userId}/assign-manager`, { managerId }),
    getReports: (managerId: string) => api.get<any[]>(`/admin/users/${managerId}/reports`),
    getUser: (id: string) => api.get<any>(`/users/${id}`),
  },
};

export default api;
