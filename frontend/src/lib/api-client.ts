// ===========================================================================
// Frontend API Client — replaces all direct Supabase calls
// All data fetching goes through this module, which talks to the Express backend
// ===========================================================================

const API_URL = import.meta.env.VITE_API_URL || "/api";

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

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
    // Send the httpOnly session cookie (JWT is never in localStorage).
    credentials: "include",
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

  // Auth — the session JWT is held in an httpOnly cookie set by the server;
  // client JS never sees or stores it.
  auth: {
    login: (email: string, password: string) =>
      api.post<{ user: any }>("/auth/login", { email, password }),
    signup: (data: {
      email: string;
      password: string;
      companyName?: string;
      contactName?: string;
    }) => api.post<{ user: any }>("/auth/signup", data),
    me: () => api.get<any>("/auth/me"),
    updateProfile: (data: any) => api.put<any>("/auth/profile", data),
    logout: () => api.post<{ success: boolean }>("/auth/logout"),
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
    bulkCreate: (data: {
      productId: string;
      reason?: string;
      warehouse?: string;
      notes?: string;
      status?: string;
      movements: Array<{ date: string; direction: "in" | "out"; quantity: number }>;
    }) => api.post<any>("/stock-movements/bulk", data),
    update: (id: string, data: any) => api.put<any>(`/stock-movements/${id}`, data),
    confirm: (id: string) => api.post<any>(`/stock-movements/${id}/confirm`, {}),
    cancel: (id: string) => api.post<any>(`/stock-movements/${id}/cancel`, {}),
    delete: (id: string) => api.delete(`/stock-movements/${id}`),
  },

  // Stock Locations
  stockLocations: {
    list: () => api.get<any[]>("/stock-locations"),
    get: (id: string) => api.get<any>(`/stock-locations/${id}`),
    create: (data: any) => api.post<any>("/stock-locations", data),
    update: (id: string, data: any) => api.put<any>(`/stock-locations/${id}`, data),
    delete: (id: string) => api.delete(`/stock-locations/${id}`),
  },

  // Stock Summary (location-wise)
  stockSummary: {
    list: (productId?: string) =>
      api.get<any[]>(`/stock-summary${productId ? `?productId=${productId}` : ""}`),
  },

  // Stock Transfers
  stockTransfers: {
    create: (data: any) => api.post<any>("/stock-transfers", data),
    receive: (transferId: string, data: any) =>
      api.post<any>(`/stock-transfers/${transferId}/receive`, data),
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
    // scope="all" returns every client's invoices (shared dashboard).
    list: (scope?: "all") => api.get<any[]>(`/invoices${scope ? `?scope=${scope}` : ""}`),
    get: (id: string) => api.get<any>(`/invoices/${id}`),
    create: (data: any) => api.post<any>("/invoices", data),
    update: (id: string, data: any) => api.put<any>(`/invoices/${id}`, data),
    delete: (id: string) => api.delete(`/invoices/${id}`),
    issue: (id: string) => api.post<any>(`/invoices/${id}/issue`, {}),
    recordPayment: (id: string, data: { amountReceived: number; receiptDate?: string }) =>
      api.post<any>(`/invoices/${id}/payment`, data),
    // Email the Notice of Assignment to the buyer with the invoice PDF attached.
    sendNoa: (id: string) => api.post<any>(`/invoices/${id}/send-noa`, {}),
  },

  // Purchase Invoices
  purchaseInvoices: {
    // scope="all" returns every client's purchase invoices (shared dashboard).
    list: (scope?: "all") =>
      api.get<any[]>(`/purchase-invoices${scope ? `?scope=${scope}` : ""}`),
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
    // Email the PO PDF to the supplier for their approval.
    sendToSupplier: (id: string) => api.post<any>(`/goods-purchase-orders/${id}/send-to-supplier`, {}),
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
    sendToDebtor: (id: string) => api.post<any>(`/quotations/${id}/send-to-debtor`, {}),
  },

  // Goods Sales Orders (catalogue-backed customer orders — never touch stock)
  goodsSalesOrders: {
    list: () => api.get<any[]>("/goods-sales-orders"),
    create: (data: any) => api.post<any>("/goods-sales-orders", data),
    update: (id: string, data: any) => api.put<any>(`/goods-sales-orders/${id}`, data),
    delete: (id: string) => api.delete(`/goods-sales-orders/${id}`),
    sendToDebtor: (id: string) => api.post<any>(`/goods-sales-orders/${id}/send-to-debtor`, {}),
  },

  // Debtor document approvals (public, token-authenticated — no login)
  approvals: {
    get: (token: string) => api.get<any>(`/approvals/${token}`),
    respond: (token: string, decision: "approved" | "rejected", comments?: string) =>
      api.post<any>(`/approvals/${token}/respond`, { decision, comments }),
  },

  // Goods Dispatches (dispatch notes — DEBIT inventory when confirmed)
  goodsDispatches: {
    list: () => api.get<any[]>("/goods-dispatches"),
    get: (id: string) => api.get<any>(`/goods-dispatches/${id}`),
    create: (data: any) => api.post<any>("/goods-dispatches", data),
    update: (id: string, data: any) => api.put<any>(`/goods-dispatches/${id}`, data),
    delete: (id: string) => api.delete(`/goods-dispatches/${id}`),
    confirm: (id: string, data?: any) =>
      api.post<any>(`/goods-dispatches/${id}/confirm`, data ?? {}),
    cancel: (id: string) => api.post<any>(`/goods-dispatches/${id}/cancel`, {}),
    deliver: (id: string, data: any) => api.post<any>(`/goods-dispatches/${id}/deliver`, data),
    return: (id: string, data: any) => api.post<any>(`/goods-dispatches/${id}/return`, data),
  },

  // Expenses
  expenses: {
    // scope="all" returns every client's expenses (shared dashboard).
    list: (scope?: "all") => api.get<any[]>(`/expenses${scope ? `?scope=${scope}` : ""}`),
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

  // Audit trail (admin) — workflow activity feed
  audit: {
    activity: () => api.get<any[]>("/audit/activity"),
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

  // Cash Flow & Treasury
  cashFlow: {
    // Settings
    settings: {
      get: () => api.get<any>("/cash-flow/settings"),
      update: (data: any) => api.put<any>("/cash-flow/settings", data),
    },
    // Cash Accounts
    accounts: {
      list: () => api.get<any[]>("/cash-accounts"),
      get: (id: string) => api.get<any>(`/cash-accounts/${id}`),
      create: (data: any) => api.post<any>("/cash-accounts", data),
      update: (id: string, data: any) => api.put<any>(`/cash-accounts/${id}`, data),
      delete: (id: string) => api.delete(`/cash-accounts/${id}`),
      reconcile: (id: string, data: { actualBalance: number; notes?: string }) =>
        api.post<any>(`/cash-accounts/${id}/reconcile`, data),
    },
    // Expected Inflows
    inflows: {
      list: () => api.get<any[]>("/cash-flow/inflows"),
      get: (id: string) => api.get<any>(`/cash-flow/inflows/${id}`),
      create: (data: any) => api.post<any>("/cash-flow/inflows", data),
      update: (id: string, data: any) => api.put<any>(`/cash-flow/inflows/${id}`, data),
      delete: (id: string) => api.delete(`/cash-flow/inflows/${id}`),
    },
    // Expected Outflows
    outflows: {
      list: () => api.get<any[]>("/cash-flow/outflows"),
      get: (id: string) => api.get<any>(`/cash-flow/outflows/${id}`),
      create: (data: any) => api.post<any>("/cash-flow/outflows", data),
      update: (id: string, data: any) => api.put<any>(`/cash-flow/outflows/${id}`, data),
      delete: (id: string) => api.delete(`/cash-flow/outflows/${id}`),
    },
    // Purchase Commitments
    commitments: {
      list: () => api.get<any[]>("/cash-flow/commitments"),
      create: (data: any) => api.post<any>("/cash-flow/commitments", data),
      update: (id: string, data: any) => api.put<any>(`/cash-flow/commitments/${id}`, data),
      delete: (id: string) => api.delete(`/cash-flow/commitments/${id}`),
    },
    // Uninvoiced Purchase Orders (POs without a linked Purchase Invoice)
    uninvoicedPos: {
      list: () => api.get<any[]>("/cash-flow/uninvoiced-pos"),
    },
    // Recurring Expenses
    recurring: {
      list: () => api.get<any[]>("/cash-flow/recurring"),
      create: (data: any) => api.post<any>("/cash-flow/recurring", data),
      update: (id: string, data: any) => api.put<any>(`/cash-flow/recurring/${id}`, data),
      delete: (id: string) => api.delete(`/cash-flow/recurring/${id}`),
    },
    // Marketplace Settlements
    settlements: {
      list: () => api.get<any[]>("/cash-flow/settlements"),
      create: (data: any) => api.post<any>("/cash-flow/settlements", data),
      update: (id: string, data: any) => api.put<any>(`/cash-flow/settlements/${id}`, data),
      delete: (id: string) => api.delete(`/cash-flow/settlements/${id}`),
    },
    // Forecast
    forecast: {
      get: (mode?: string, view?: string) => {
        const params = new URLSearchParams();
        if (mode) params.set("mode", mode);
        if (view) params.set("view", view);
        const qs = params.toString();
        return api.get<any>(`/cash-flow/forecast${qs ? `?${qs}` : ""}`);
      },
      daily: (view?: string) => api.get<any>(`/cash-flow/forecast/daily${view ? `?view=${view}` : ""}`),
      weekly: (view?: string) => api.get<any>(`/cash-flow/forecast/weekly${view ? `?view=${view}` : ""}`),
      monthly: (view?: string) => api.get<any>(`/cash-flow/forecast/monthly${view ? `?view=${view}` : ""}`),
    },
    // Traceability
    trace: (sourceType: string, sourceId: string) =>
      api.get<any>(`/cash-flow/trace/${sourceType}/${sourceId}`),
    // Dashboard Summary
    summary: () => api.get<any>("/cash-flow/summary"),
  },

  // E-Way Bill
  ewayBill: {
    list: (status?: string) => api.get<any[]>(`/eway-bills${status ? `?status=${status}` : ""}`),
    get: (id: string) => api.get<any>(`/eway-bills/${id}`),
    getByDispatch: (dispatchId: string) => api.get<any>(`/eway-bills/dispatch/${dispatchId}`),
    generate: (data: {
      dispatchId: string;
      supplierGstin?: string;
      recipientGstin?: string;
      distance?: number;
      transportMode?: string;
      vehicleNumber?: string;
      transporterGstin?: string;
      transporterName?: string;
    }) => api.post<any>("/eway-bills", data),
    updateVehicle: (id: string, data: {
      vehicleNumber: string;
      fromPlace?: string;
      fromState?: number;
      transportMode?: string;
      reasonCode?: string;
      reasonRemarks?: string;
    }) => api.post<any>(`/eway-bills/${id}/vehicle`, data),
    cancel: (id: string, data: { reason: string; remarks: string }) =>
      api.post<any>(`/eway-bills/${id}/cancel`, data),
    extend: (id: string, data?: { remainingDistance?: number; reason?: string; remarks?: string }) =>
      api.post<any>(`/eway-bills/${id}/extend`, data || {}),
    sync: (id: string) => api.post<any>(`/eway-bills/${id}/sync`, {}),
  },
};

export default api;
