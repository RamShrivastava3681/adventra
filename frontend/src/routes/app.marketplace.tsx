import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Store,
  RotateCcw,
  Play,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Package,
  Truck,
  FileText,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Layers,
  Search,
  Check,
  XCircle,
  HelpCircle,
  Clock,
  DollarSign,
  Boxes,
  UserCheck,
  Eye,
  FileCheck2,
  BarChart3,
  ShoppingBag,
  Warehouse,
  Settings,
  Plus,
  Info,
  Sparkles,
  BookOpen,
  Tag,
  MapPin,
  CreditCard,
  Send,
  ChevronDown,
  ChevronUp,
  Calendar,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import {
  loadDemoState,
  saveDemoState,
  resetDemoState,
  getLedgerCheckpoints,
  BASELINE_MAPPINGS,
  BASELINE_ORDERS,
  WORKFLOW_STEPS,
  DemoWorkflowState,
  SkuMapping,
  EcommerceOrder,
} from "@/lib/marketplace-demo-store";

export const Route = createFileRoute("/app/marketplace")({
  component: MarketplaceHubPage,
});

export const PLAIN_ENGLISH_STEPS = [
  {
    step: 1,
    title: "1. Order Arrives from Customer",
    badge: "Order Ingested",
    shortDesc: "Customer places order on Amazon/Flipkart/Shopify or phone/manual entry",
    explanation:
      "A customer buys your product online (or you take a phone order). The system captures the items, quantity, buyer details, and delivery pincode.",
    documentCreated: "Order Event Captured (Not an invoice yet!)",
    documentType: "none",
    stockImpact: "Inventory on shelf is not changed yet; waiting for product matching.",
    whoDoesThis: "Customer & Marketplace API / Sales Operator",
  },
  {
    step: 2,
    title: "2. Check Product & Barcode",
    badge: "SKU Matching",
    shortDesc: "Matches online listing barcode to warehouse inventory",
    explanation:
      "The system matches the marketplace barcode (e.g. AMZ-TS-BLK-M) to your warehouse product code (AD-TS-BLK-M) so staff picks the right shirt and size.",
    documentCreated: "Product Mapping Verified",
    documentType: "none",
    stockImpact: "Verifies that sufficient physical stock exists in WH-DEMO warehouse.",
    whoDoesThis: "Automated Catalog Matcher",
  },
  {
    step: 3,
    title: "3. Hold Stock & Create Sales Order",
    badge: "★ SALES ORDER CREATED",
    shortDesc: "Generates Sales Order and locks stock so you don't oversell",
    explanation:
      "KEY RULE: The system creates a SALES ORDER and immediately RESERVES the items. Why not an invoice? Because the customer might cancel or change address before shipping. The Sales Order locks stock safely without creating premature tax/accounting liabilities!",
    documentCreated: "Sales Order Generated (SO-DEMO-1001)",
    documentType: "sales_order",
    stockImpact:
      "2 units marked as Reserved. Available stock drops from 20 to 18. Physical boxes remain on shelf.",
    whoDoesThis: "Sales Engine & Inventory Controller",
  },
  {
    step: 4,
    title: "4. Warehouse Staff Packs Parcel",
    badge: "Pick & Pack",
    shortDesc: "Warehouse operator picks items and packs shipping box",
    explanation:
      "Warehouse staff receives a digital packing slip, picks the shirts from the warehouse shelf, verifies sizes, and boxes them up safely with a shipping label.",
    documentCreated: "Packing Slip Verified",
    documentType: "none",
    stockImpact: "2 units physically packed into the shipping carton. Available stock remains 18.",
    whoDoesThis: "Warehouse Packer",
  },
  {
    step: 5,
    title: "5. Generate Tax Invoice & Dispatch Courier",
    badge: "★ TAX INVOICE CREATED",
    shortDesc: "Official Tax Invoice is issued and handed to courier",
    explanation:
      "KEY RULE: NOW the official TAX INVOICE is generated! The courier (BlueDart) collects the box. Only at this dispatch stage is physical on-hand stock deducted from the warehouse ledger.",
    documentCreated: "Tax Invoice Generated (INV-DEMO-1001) + Courier Tracking",
    documentType: "invoice",
    stockImpact:
      "Physical On-Hand stock officially decreases from 20 to 18. Reservation is cleared.",
    whoDoesThis: "Finance & Courier Dispatcher (BlueDart Express)",
  },
  {
    step: 6,
    title: "6. Send Tracking Number to Customer",
    badge: "Tracking Sync",
    shortDesc: "Live tracking link pushed to Amazon / Flipkart app",
    explanation:
      "The BlueDart courier tracking code (TRK-DEMO-1001) is automatically sent back to the marketplace so the customer can track their delivery in real-time.",
    documentCreated: "Marketplace Shipping Confirmation Receipt",
    documentType: "none",
    stockImpact: "Items in transit in courier truck. Stock ledger remains 18.",
    whoDoesThis: "Automated Marketplace Connector",
  },
  {
    step: 7,
    title: "7. Customer Return Received (If Any)",
    badge: "Return Received",
    shortDesc: "Returned package arrives back at warehouse dock",
    explanation:
      "If the customer returns an item (e.g. wrong size), it arrives back at your warehouse. It goes into a Quality Check (QC) quarantine area — NOT directly back on shelf.",
    documentCreated: "Customer Return Docket (RET-DEMO-1001)",
    documentType: "none",
    stockImpact:
      "Physical stock increases to 19, but held in QC Quarantine. Available stock stays 18.",
    whoDoesThis: "Inbound Receiving Dock Staff",
  },
  {
    step: 8,
    title: "8. Quality Inspection & Restock to Shelf",
    badge: "QC Pass & Restock",
    shortDesc: "Inspector checks item and returns good items to sale",
    explanation:
      "A quality supervisor inspects the returned shirt. If pristine and unworn, they sign 'Pass / Resalable'. The unit is released from QC Hold back to usable stock for other buyers!",
    documentCreated: "QC Inspection Approval Certificate",
    documentType: "none",
    stockImpact: "1 unit released from QC Quarantine. Final Available stock increases to 19!",
    whoDoesThis: "Quality Assurance (QC) Lead",
  },
];

const ROLE_CONFIG: Record<
  string,
  {
    title: string;
    subtitle: string;
    tab: "orders" | "workflow" | "inventory" | "mappings" | "exceptions" | "finance" | "architecture";
    highlight: string;
    icon: any;
  }
> = {
  all: {
    title: "All Roles (Full Access View)",
    subtitle: "Complete operational visibility: orders, stock ledger, mappings, fulfillment, finance, and system settings.",
    tab: "workflow",
    highlight: "All operational modules and technical queues are currently visible.",
    icon: UserCheck,
  },
  management: {
    title: "Management View",
    subtitle: "Combined sales performance, channel GMV distribution, return rate & settlement pipeline across all 5 channels.",
    tab: "orders",
    highlight: "Executive overview: channel revenue split, return rate analytics, and combined portfolio health.",
    icon: BarChart3,
  },
  sales: {
    title: "Sales & Operations View",
    subtitle: "Customer order ingestion, promised delivery dates, cancellations, and real-time fulfillment status.",
    tab: "orders",
    highlight: "Central order processing: orders, customer addresses, and dispatch pipeline without logging into Amazon/Flipkart.",
    icon: ShoppingBag,
  },
  warehouse: {
    title: "Warehouse Fulfillment View",
    subtitle: "Single unified pick/pack queue, dispatch confirmation with carrier tracking, and return receipt into QC hold.",
    tab: "inventory",
    highlight: "Warehouse operations: pick & pack tasks, dispatch confirmation, and return receipt into QC buffer.",
    icon: Warehouse,
  },
  finance: {
    title: "Finance & Accounts View",
    subtitle: "Customer invoices (DEMO watermark), marketplace referral commissions, TCS (1%), logistics fees, and net settlement receivables.",
    tab: "finance",
    highlight: "Finance ledger: verifies invoices, tracks deductions (commission, shipping, TCS), and reconciles net receivables.",
    icon: DollarSign,
  },
  checker: {
    title: "Checker & Approvals View",
    subtitle: "Exception review queue: verify unmapped SKU bindings, QC restock approvals, and settlement reconciliation mismatches.",
    tab: "exceptions",
    highlight: "Exception gatekeeper: review unmapped SKU mappings, approval of return restocks, and sync retry authorization.",
    icon: ShieldCheck,
  },
  admin: {
    title: "System Administrator View",
    subtitle: "Marketplace credentials, listing mappings, sync frequencies, connector framework, and baseline fixtures reset.",
    tab: "mappings",
    highlight: "Admin control: multi-channel SKU mappings, API connectors, and integration framework settings.",
    icon: Settings,
  },
};

const CHANNEL_CONFIG: Record<
  string,
  { label: string; tag: string; badgeClass: string }
> = {
  amazon: {
    label: "Amazon India",
    tag: "AMZ-IN",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-700",
  },
  flipkart: {
    label: "Flipkart",
    tag: "FK-IN",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-300 dark:border-blue-700",
  },
  myntra: {
    label: "Myntra",
    tag: "MYN-IN",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-700",
  },
  shopify: {
    label: "Shopify Store",
    tag: "SH-DIRECT",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700",
  },
  marketplace4: {
    label: "Marketplace 4",
    tag: "MKT4",
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-300 dark:border-purple-700",
  },
  manual: {
    label: "Manual / Direct Sales",
    tag: "MANUAL",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700",
  },
};

export default function MarketplaceHubPage() {
  const [state, setState] = useState<DemoWorkflowState>(loadDemoState);
  const [activeTab, setActiveTab] = useState<
    "orders" | "workflow" | "inventory" | "mappings" | "exceptions" | "finance" | "architecture"
  >("workflow");
  const [mappings, setMappings] = useState<SkuMapping[]>(BASELINE_MAPPINGS);
  const [selectedMappingFilter, setSelectedMappingFilter] = useState("all");
  const [mappingSearch, setMappingSearch] = useState("");
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapTargetSku, setMapTargetSku] = useState("AD-TS-WHT-M");

  // Non-tech / Plain-English mode toggle
  const [plainEnglishMode, setPlainEnglishMode] = useState(true);

  // Manual Order & Order Detail Modal states
  const [showManualOrderModal, setShowManualOrderModal] = useState(false);
  const [showOrderDetailsModal, setShowOrderDetailsModal] = useState(false);
  const [selectedOrderForModal, setSelectedOrderForModal] = useState<EcommerceOrder | null>(null);

  // Search & Filter in Orders Queue tab
  const [ordersSearch, setOrdersSearch] = useState("");
  const [ordersChannelFilter, setOrdersChannelFilter] = useState("all");

  // Manual Order Form fields
  const [manualChannel, setManualChannel] = useState<
    "amazon" | "flipkart" | "shopify" | "myntra" | "marketplace4" | "manual"
  >("manual");
  const [manualOrderId, setManualOrderId] = useState(`ORD-MAN-${Math.floor(1000 + Math.random() * 9000)}`);
  const [manualCustomerName, setManualCustomerName] = useState("");
  const [manualCustomerCity, setManualCustomerCity] = useState("");
  const [manualSku, setManualSku] = useState("AD-TS-BLK-M");
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualUnitPrice, setManualUnitPrice] = useState(1000);
  const [manualPaymentMethod, setManualPaymentMethod] = useState<"Prepaid" | "COD">("Prepaid");
  const [manualNotes, setManualNotes] = useState("");

  const handleSelectRole = (roleId: string) => {
    setState((prev) => ({ ...prev, selectedRole: roleId as any }));
    const conf = ROLE_CONFIG[roleId];
    if (conf && roleId !== "all") {
      setActiveTab(conf.tab);
      toast.info(`Switched to ${conf.title}`, {
        description: conf.highlight,
      });
    } else {
      toast.info("Showing Full Access View (All Roles)");
    }
  };

  // Sync state changes to storage
  useEffect(() => {
    saveDemoState(state);
  }, [state]);

  // Derived current metrics based on state step
  const hasScriptedOrder = state.currentStep >= 1;
  const hasScriptedReturn = state.currentStep >= 7;

  // Filtered channels
  const activeChannelData = state.channels.map((ch) => {
    if (ch.id === "amazon") {
      return {
        ...ch,
        orders: 12 + (hasScriptedOrder ? 1 : 0),
        grossValue: 24000 + (hasScriptedOrder ? 2000 : 0),
        returns: 1 + (hasScriptedReturn ? 1 : 0),
      };
    }
    return ch;
  });

  const totalOrders = activeChannelData.reduce((acc, c) => acc + c.orders, 0);
  const totalGmv = activeChannelData.reduce((acc, c) => acc + c.grossValue, 0);
  const totalReturns = activeChannelData.reduce((acc, c) => acc + c.returns, 0);

  // Filtered for current selected channel
  const currentChannelView =
    state.selectedChannel === "all"
      ? null
      : activeChannelData.find((c) => c.id === state.selectedChannel);

  const displayOrders = currentChannelView ? currentChannelView.orders : totalOrders;
  const displayGmv = currentChannelView ? currentChannelView.grossValue : totalGmv;
  const displayReturns = currentChannelView ? currentChannelView.returns : totalReturns;

  // Real-time checkpoints for Main SKU (AD-TS-BLK-M)
  const ledgerCheckpoints = getLedgerCheckpoints(state.currentStep);

  // Workflow Handlers
  const handleReset = () => {
    const fresh = resetDemoState();
    setState(fresh);
    setMappings(BASELINE_MAPPINGS);
    toast.success("Demo state successfully reset to Baseline fixtures!");
  };

  const handleNextStep = async () => {
    if (state.currentStep >= 8) {
      toast.info("Demonstration journey complete! Use 'Reset Baseline' to restart.");
      return;
    }
    const next = state.currentStep + 1;

    // Step 3: e-commerce order -> creates demo sales order (idempotent).
    if (next === 3 && !state.demoSoId) {
      try {
        const res = await api.cashFlow.marketplaceDemo.createOrder({
          marketplace: "amazon",
          externalOrderId: state.externalOrderId,
          eventId: state.eventId,
          channelSku: "AMZ-TS-BLK-M",
          whizunikSku: "AD-TS-BLK-M",
          quantity: 2,
          unitPrice: 1000,
        });
        const order = (res as any)?.order ?? res;
        const soNum = order?.soNumber ?? state.soId;
        setState((prev) => {
          const updatedOrders = (prev.orders || BASELINE_ORDERS).map((o) =>
            o.id === prev.activeOrderId
              ? {
                  ...o,
                  status: "reserved" as const,
                  salesOrderId: soNum,
                }
              : o
          );
          return {
            ...prev,
            currentStep: next,
            demoSoId: order?.id ?? prev.demoSoId,
            demoSoNumber: soNum,
            orders: updatedOrders,
          };
        });
        toast.success(
          (res as any)?.duplicate
            ? `Step 3: Reused demo sales order ${order?.soNumber} (duplicate blocked)`
            : `Step 3: Created demo sales order ${order?.soNumber ?? state.soId}`
        );
        return;
      } catch (err: any) {
        // Backend unreachable or mapping error — fall back to mock IDs so the
        // visual 8-step demo still runs.
        toast.warning(
          `Demo SO API unavailable, using mock ${state.soId}: ${err?.message ?? err}`
        );
      }
    }

    // Step 5: payment collected -> creates demo invoice (one SO -> one invoice).
    if (next === 5 && state.demoSoId && !state.demoInvoiceId) {
      try {
        const res = await api.cashFlow.marketplaceDemo.recordPayment(state.demoSoId);
        const invoice = (res as any)?.invoice ?? res;
        const order = (res as any)?.order;
        const invNum = invoice?.invoiceNumber ?? state.invoiceId;
        setState((prev) => {
          const updatedOrders = (prev.orders || BASELINE_ORDERS).map((o) =>
            o.id === prev.activeOrderId
              ? {
                  ...o,
                  status: "dispatched" as const,
                  invoiceId: invNum,
                  carrier: prev.carrier,
                  trackingNumber: prev.trackingNumber,
                  paymentStatus: "collected_by_marketplace" as const,
                }
              : o
          );
          return {
            ...prev,
            currentStep: next,
            outboundSyncStatus: "Queued",
            demoInvoiceId: invoice?.id ?? prev.demoInvoiceId,
            demoInvoiceNumber: invNum,
            paymentStatus: "collected_by_marketplace",
            demoSoNumber: order?.soNumber ?? prev.demoSoNumber,
            orders: updatedOrders,
          };
        });
        toast.success(
          (res as any)?.duplicate
            ? `Step 5: Reused demo invoice ${invoice?.invoiceNumber} (one SO -> one invoice)`
            : `Step 5: Payment collected -> invoice ${invoice?.invoiceNumber ?? state.invoiceId}`
        );
        return;
      } catch (err: any) {
        toast.warning(
          `Demo invoice API unavailable, using mock ${state.invoiceId}: ${err?.message ?? err}`
        );
      }
    }

    setState((prev) => {
      const updatedOrders = (prev.orders || BASELINE_ORDERS).map((o) => {
        if (o.id === prev.activeOrderId) {
          if (next === 4) return { ...o, status: "picked_packed" as const };
          if (next === 5) {
            return {
              ...o,
              status: "dispatched" as const,
              invoiceId: prev.demoInvoiceNumber ?? prev.invoiceId,
              carrier: prev.carrier,
              trackingNumber: prev.trackingNumber,
            };
          }
          if (next === 7) return { ...o, status: "return_qc" as const };
        }
        return o;
      });
      return {
        ...prev,
        currentStep: next,
        orders: updatedOrders,
        outboundSyncStatus:
          next === 5 ? "Queued" : next === 6 ? "Simulated Acknowledged" : prev.outboundSyncStatus,
      };
    });
    toast.success(`Executed Step ${next}: ${WORKFLOW_STEPS[next - 1]?.title}`);
  };

  // Create Manual E-Commerce Order
  const handleCreateManualOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!manualSku) {
      toast.error("Please select a product SKU");
      return;
    }
    if (manualQuantity <= 0) {
      toast.error("Quantity must be at least 1");
      return;
    }

    const targetInventory = state.inventory.find((inv) => inv.whizunikSku === manualSku);
    const availableStock = targetInventory ? targetInventory.available : 0;
    if (availableStock < manualQuantity) {
      toast.warning(
        `Notice: Requested quantity (${manualQuantity}) exceeds available stock (${availableStock}). Reservation will proceed.`
      );
    }

    const orderRef = manualOrderId.trim() || `ORD-MAN-${Math.floor(1000 + Math.random() * 9000)}`;
    const soRef = `SO-MAN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;
    const targetMapping =
      mappings.find((m) => m.whizunikSku === manualSku) ||
      BASELINE_MAPPINGS.find((m) => m.whizunikSku === manualSku);
    const totalVal = manualQuantity * manualUnitPrice;

    const newOrder: EcommerceOrder = {
      id: orderRef,
      channel: manualChannel,
      channelName: CHANNEL_CONFIG[manualChannel]?.label || "Manual Direct Sales",
      externalOrderId: orderRef,
      customerName: manualCustomerName.trim() || "Retail Direct Customer",
      customerCity: manualCustomerCity.trim() || "Mumbai, MH",
      sku: manualSku,
      productName: targetMapping?.productName || "Adventra Apparel",
      variant: targetMapping?.variant || "Standard",
      quantity: manualQuantity,
      unitPrice: manualUnitPrice,
      totalValue: totalVal,
      paymentMethod: manualPaymentMethod,
      paymentStatus: manualPaymentMethod === "Prepaid" ? "collected" : "pending",
      salesOrderId: soRef,
      invoiceId: null,
      status: "reserved",
      isManual: true,
      notes: manualNotes,
      createdAt: "Just now",
    };

    // Update inventory reservations
    const updatedInventory = state.inventory.map((inv) => {
      if (inv.whizunikSku === manualSku) {
        const reserved = inv.reserved + manualQuantity;
        const available = Math.max(0, inv.onHand - reserved - inv.qcHold);
        return { ...inv, reserved, available };
      }
      return inv;
    });

    // Update channel stats
    const updatedChannels = state.channels.map((ch) => {
      if (ch.id === manualChannel) {
        return {
          ...ch,
          orders: ch.orders + 1,
          grossValue: ch.grossValue + totalVal,
        };
      }
      return ch;
    });

    // Try backend persistence if online
    let realSoRef = soRef;
    let backendOrderId: string | null = null;
    try {
      const resp = await api.cashFlow.marketplaceDemo.createOrder({
        marketplace: manualChannel,
        externalOrderId: orderRef,
        eventId: `EVT-${orderRef}`,
        channelSku: targetMapping?.channelSku || manualSku,
        whizunikSku: manualSku,
        quantity: manualQuantity,
        unitPrice: manualUnitPrice,
      });
      if (resp?.data?.order?.soNumber) {
        realSoRef = resp.data.order.soNumber;
        newOrder.salesOrderId = realSoRef;
      }
      if (resp?.data?.order?.id) {
        backendOrderId = resp.data.order.id;
      }
    } catch (err) {
      console.warn("Backend demo order not saved, continuing in local store:", err);
    }

    setState((prev) => ({
      ...prev,
      orders: [newOrder, ...(prev.orders || BASELINE_ORDERS)],
      inventory: updatedInventory,
      channels: updatedChannels,
      activeOrderId: newOrder.id,
      orderId: newOrder.id,
      externalOrderId: newOrder.externalOrderId,
      soId: realSoRef,
      demoSoNumber: realSoRef,
      demoSoId: backendOrderId,
      invoiceId: `INV-${newOrder.id}`,
      demoInvoiceNumber: null,
      currentStep: 3, // Immediately at step 3: Sales Order Created & Stock Reserved!
    }));

    setShowManualOrderModal(false);
    setActiveTab("orders");
    setManualOrderId(`ORD-MAN-${Math.floor(1000 + Math.random() * 9000)}`);
    setManualCustomerName("");
    setManualCustomerCity("");
    setManualNotes("");

    toast.success(
      `Manual Order ${orderRef} created! Sales Order ${realSoRef} generated & ${manualQuantity} unit(s) reserved.`,
      {
        description:
          "An e-commerce order creates a Sales Order first to reserve stock. Tax Invoice will be generated upon dispatch.",
      }
    );
  };

  // Load an existing order into the 8-step fulfillment workflow
  const handleLoadOrderInWorkflow = (order: EcommerceOrder) => {
    setState((prev) => ({
      ...prev,
      activeOrderId: order.id,
      orderId: order.id,
      externalOrderId: order.externalOrderId,
      soId: order.salesOrderId,
      invoiceId: order.invoiceId || `INV-${order.id}`,
      demoInvoiceNumber: order.invoiceId || null,
      demoSoNumber: order.salesOrderId || null,
      currentStep:
        order.status === "dispatched" || order.status === "delivered"
          ? 6
          : order.status === "picked_packed"
          ? 4
          : order.status === "return_qc"
          ? 7
          : 3,
    }));
    setActiveTab("workflow");
    toast.info(`Loaded ${order.id} into Fulfillment Workflow!`, {
      description: `Sales Order: ${order.salesOrderId} • Status: ${order.status}`,
    });
  };

  // Quick Dispatch & Invoice an order directly from the table
  const handleQuickDispatchOrder = (order: EcommerceOrder) => {
    const invNumber =
      order.invoiceId ||
      `INV-DEMO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;
    const trkNumber = `TRK-BD-${Math.floor(10000000 + Math.random() * 90000000)}`;
    const carrier = "BlueDart Express";

    const updatedOrders = (state.orders || BASELINE_ORDERS).map((o) => {
      if (o.id === order.id) {
        return {
          ...o,
          status: "dispatched" as const,
          invoiceId: invNumber,
          carrier,
          trackingNumber: trkNumber,
          paymentStatus: "collected" as const,
        };
      }
      return o;
    });

    // Debit physical stock: decrement onHand and release reserved
    const updatedInventory = state.inventory.map((inv) => {
      if (inv.whizunikSku === order.sku) {
        const onHand = Math.max(0, inv.onHand - order.quantity);
        const reserved = Math.max(0, inv.reserved - order.quantity);
        const available = Math.max(0, onHand - reserved - inv.qcHold);
        return { ...inv, onHand, reserved, available };
      }
      return inv;
    });

    setState((prev) => ({
      ...prev,
      orders: updatedOrders,
      inventory: updatedInventory,
      ...(prev.activeOrderId === order.id
        ? {
            currentStep: 6,
            invoiceId: invNumber,
            demoInvoiceNumber: invNumber,
            trackingNumber: trkNumber,
            carrier,
            outboundSyncStatus: "Simulated Acknowledged",
          }
        : {}),
    }));

    toast.success(`Tax Invoice ${invNumber} generated! Order ${order.id} dispatched via ${carrier}.`, {
      description: `Physical stock deducted (${order.quantity} units). Courier Tracking: ${trkNumber}`,
    });
  };

  const handleJumpToStep = (stepNumber: number) => {
    setState((prev) => ({
      ...prev,
      currentStep: stepNumber,
      outboundSyncStatus:
        stepNumber >= 6
          ? "Simulated Acknowledged"
          : stepNumber === 5
          ? "Queued"
          : "Idle",
    }));
    toast.info(`Jumped to Step ${stepNumber}`);
  };

  const handleAutoPlay = () => {
    toast.promise(
      new Promise<void>((resolve) => {
        let cur = 0;
        const interval = setInterval(() => {
          cur += 1;
          setState((prev) => ({
            ...prev,
            currentStep: cur,
            outboundSyncStatus: cur >= 6 ? "Simulated Acknowledged" : cur === 5 ? "Queued" : "Idle",
          }));
          if (cur >= 8) {
            clearInterval(interval);
            resolve();
          }
        }, 1200);
      }),
      {
        loading: "Running Path Demonstration...",
        success: "Path Demonstration completed (All 8 steps verified)!",
        error: "Simulation interrupted",
      }
    );
  };

  // Exception Handlers
  const handleResolveUnmappedSku = () => {
    setMappings((prev) =>
      prev.map((m) =>
        m.channelSku === "AMZ-UNKNOWN"
          ? {
              ...m,
              whizunikSku: mapTargetSku,
              status: "Mapped",
              productName: "Adventra Classic Tee",
              variant: "White / M",
            }
          : m
      )
    );
    setState((prev) => ({
      ...prev,
      unmappedErrorStatus: "resolved",
      unmappedSkuAssigned: mapTargetSku,
    }));
    setShowMapModal(false);
    toast.success(
      `Resolved AMZ-UNKNOWN -> mapped to ${mapTargetSku}. Re-processed event created SO-ERR-01 cleanly!`
    );
  };

  const handleForceSyncFailure = () => {
    setState((prev) => ({
      ...prev,
      outboundSyncStatus: "Failed (504 Timeout)",
    }));
    toast.error("Simulated outbound failure: HTTP 504 Gateway Timeout from channel endpoint.");
  };

  const handleRetryOutboundSync = () => {
    setState((prev) => ({
      ...prev,
      outboundSyncStatus: "Simulated Acknowledged",
      outboundRetryCount: prev.outboundRetryCount + 1,
    }));
    toast.success(
      "Outbound sync retry succeeded! Acknowledgement updated without re-dispatching or duplicating stock."
    );
  };

  const handleTestIdempotency = () => {
    toast.info(
      "Replayed Event EVT-1001: Idempotency Key Matched. System recognized duplicate and returned existing sales order. Zero extra reservations created!"
    );
    setState((prev) => ({
      ...prev,
      idempotencyReplayMessage:
        "EVT-1001 previously processed. No duplicate sales order or inventory deduction permitted.",
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950/60 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ─── ACTION TOOLBAR ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => setShowManualOrderModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-sm cursor-pointer"
          title="Add a manual e-commerce order from any channel"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          Add Manual Order
        </button>
        {/* View Mode Segmented Toggle: Non-Tech vs Technical ERP */}
        <div className="inline-flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-950/80 shadow-xs">
          <button
            type="button"
            onClick={() => setPlainEnglishMode(true)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              plainEnglishMode
                ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm ring-1 ring-slate-200/80 dark:ring-slate-800"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
            title="Non-Tech View: Clear plain-language explanations of Sales Orders, Tax Invoices, and stock changes"
          >
            <span>Non-Tech View</span>
          </button>
          <button
            type="button"
            onClick={() => setPlainEnglishMode(false)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              !plainEnglishMode
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm ring-1 ring-slate-200/80 dark:ring-slate-800"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
            title="Technical / ERP Mode: Raw API endpoints, event payloads, and ledger debit/credits"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>Technical / ERP</span>
          </button>
        </div>
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shadow-sm cursor-pointer"
          title="Restore Baseline Fixtures"
        >
          <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          Reset Demo Baseline
        </button>
        <button
          onClick={handleAutoPlay}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm cursor-pointer"
          title="Run 8-Step Path Demonstration Automatically"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          Auto-Play Journey
        </button>
      </div>

      {/* ─── PAGE HEADER & ROLE SELECTOR ────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Marketplace Integration Hub
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Centralized channel synchronization, stock reservation ledger, fulfillment & exception queues
              </p>
            </div>
          </div>
        </div>

        {/* Role View Filter (PDF 3 §4 & §9) */}
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 shadow-sm text-xs">
          <span className="text-slate-400 font-medium px-2 flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5" />
            Role View:
          </span>
          {(
            [
              { id: "all", label: "All Roles" },
              { id: "management", label: "Management" },
              { id: "sales", label: "Sales" },
              { id: "warehouse", label: "Warehouse" },
              { id: "finance", label: "Finance" },
              { id: "checker", label: "Checker" },
              { id: "admin", label: "Admin" },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              onClick={() => handleSelectRole(r.id)}
              className={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer ${
                state.selectedRole === r.id
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>


      {/* ─── ROLE PERSONA SPOTLIGHT BANNER (PDF 3 §4 & §9) ───────────────── */}
      {state.selectedRole !== "all" && ROLE_CONFIG[state.selectedRole] && (
        <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs transition-all animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-600 text-white shadow-xs">
              {(() => {
                const IconComponent = ROLE_CONFIG[state.selectedRole].icon;
                return <IconComponent className="w-5 h-5" />;
              })()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {ROLE_CONFIG[state.selectedRole].title}
                </h4>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 font-bold uppercase tracking-wider">
                  Active Department Filter
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                {ROLE_CONFIG[state.selectedRole].highlight}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-[11px] text-slate-500 hidden md:inline">
              Focused Tab: <strong className="text-indigo-600 dark:text-indigo-400 capitalize">{ROLE_CONFIG[state.selectedRole].tab}</strong>
            </span>
            <button
              onClick={() => handleSelectRole("all")}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold transition whitespace-nowrap shadow-xs text-xs cursor-pointer"
            >
              Reset to All Roles
            </button>
          </div>
        </div>
      )}

      {/* ─── CHANNEL SELECTOR TABS & SUMMARY ROW (PDF 3 §5) ────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setState((prev) => ({ ...prev, selectedChannel: "all" }))}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
              state.selectedChannel === "all"
                ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-950 dark:border-white shadow-sm"
                : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
            }`}
          >
            All Channels ({totalOrders} orders • ₹{totalGmv.toLocaleString("en-IN")})
          </button>

          {activeChannelData.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setState((prev) => ({ ...prev, selectedChannel: ch.id as any }))}
              className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition border flex items-center gap-2 ${
                state.selectedChannel === ch.id
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
              }`}
            >
              <span>{ch.name}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  state.selectedChannel === ch.id
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {ch.orders}
              </span>
            </button>
          ))}
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Total Orders
              <Package className="w-4 h-4 text-slate-400" />
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              {displayOrders}
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium flex items-center gap-1">
              <Check className="w-3 h-3" />
              {hasScriptedOrder ? "+1 Scripted DEMO-AMZ-1001" : "Baseline day count"}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Gross Order Value
              <DollarSign className="w-4 h-4 text-slate-400" />
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              ₹{displayGmv.toLocaleString("en-IN")}
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
              {hasScriptedOrder ? "+₹2,000 scripted order" : "Before tax and fees"}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Return Cases
              <RotateCcw className="w-4 h-4 text-slate-400" />
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              {displayReturns}
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
              {hasScriptedReturn ? "+1 Return (RET-DEMO-1001)" : "Cases, not units"}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
              Stock Sync State
              <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin-slow" />
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100">Simulated OK</p>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              All 5 channels in demo mode
            </p>
          </div>
        </div>
      </div>

      {/* ─── IN-PAGE TAB BAR ─────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
        {[
          {
            id: "orders",
            label: `Orders Queue (${(state.orders || BASELINE_ORDERS).length})`,
            icon: ShoppingBag,
          },
          { id: "workflow", label: "Fulfillment Journey (8 Steps)", icon: Play },
          { id: "inventory", label: "Inventory Ledger (6 Checkpoints)", icon: Boxes },
          { id: "mappings", label: "SKU Mappings & Listings", icon: Layers },
          { id: "exceptions", label: "Exception & Error Queues", icon: AlertTriangle },
          { id: "finance", label: "Settlement & Finance", icon: DollarSign },
          { id: "architecture", label: "Connector Architecture", icon: ExternalLink },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition flex items-center gap-2 cursor-pointer ${
                isActive
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400 font-semibold"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: E-COMMERCE ORDERS QUEUE (LIVE & MANUAL ORDERS)                */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "orders" && (
        <div className="space-y-6">
          {/* Orders Metric Highlights */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                Total Orders Ingested
                <Package className="w-4 h-4 text-indigo-500" />
              </span>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {(state.orders || BASELINE_ORDERS).length}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Marketplaces & Manual entries
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                Sales Orders Issued
                <FileCheck2 className="w-4 h-4 text-indigo-600" />
              </span>
              <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                {(state.orders || BASELINE_ORDERS).filter((o) => o.salesOrderId).length}
              </p>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" />
                100% orders reserved stock via SO
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                Dispatched & Invoiced
                <Truck className="w-4 h-4 text-emerald-500" />
              </span>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {(state.orders || BASELINE_ORDERS).filter((o) => o.status === "dispatched" || o.invoiceId).length}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Tax invoices generated upon handover
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between">
                Total Order Value (GMV)
                <DollarSign className="w-4 h-4 text-amber-500" />
              </span>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                ₹
                {(state.orders || BASELINE_ORDERS)
                  .reduce((acc, o) => acc + (o.totalValue || 0), 0)
                  .toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Across all sales channels
              </p>
            </div>
          </div>

          {/* Search, Filter, and Action Bar */}
          <div className="rounded-xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by Order ID, customer, SKU, or SO number..."
                  value={ordersSearch}
                  onChange={(e) => setOrdersSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowManualOrderModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  Add Manual Order
                </button>
              </div>
            </div>

            {/* Channel Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <span className="text-slate-400 font-medium mr-1 flex items-center gap-1 shrink-0">
                <Filter className="w-3 h-3" /> Filter Channel:
              </span>
              {[
                { id: "all", label: "All Channels" },
                { id: "amazon", label: "Amazon" },
                { id: "flipkart", label: "Flipkart" },
                { id: "shopify", label: "Shopify" },
                { id: "myntra", label: "Myntra" },
                { id: "marketplace4", label: "Marketplace 4" },
                { id: "manual", label: "Manual Direct" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setOrdersChannelFilter(f.id)}
                  className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                    ordersChannelFilter === f.id
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Orders Table */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-3 px-4">Order ID & Channel</th>
                    <th className="py-3 px-4">Customer & City</th>
                    <th className="py-3 px-4">Item & SKU</th>
                    <th className="py-3 px-3 text-right">Qty</th>
                    <th className="py-3 px-3 text-right">Total (₹)</th>
                    <th className="py-3 px-4">Sales Order (Step 3)</th>
                    <th className="py-3 px-4">Tax Invoice (Step 5)</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {(() => {
                    const filtered = (state.orders || BASELINE_ORDERS).filter((ord) => {
                      const matchChannel =
                        ordersChannelFilter === "all" || ord.channel === ordersChannelFilter;
                      const matchSearch =
                        !ordersSearch ||
                        ord.id.toLowerCase().includes(ordersSearch.toLowerCase()) ||
                        ord.customerName.toLowerCase().includes(ordersSearch.toLowerCase()) ||
                        ord.sku.toLowerCase().includes(ordersSearch.toLowerCase()) ||
                        (ord.salesOrderId &&
                          ord.salesOrderId.toLowerCase().includes(ordersSearch.toLowerCase())) ||
                        (ord.invoiceId &&
                          ord.invoiceId.toLowerCase().includes(ordersSearch.toLowerCase()));
                      return matchChannel && matchSearch;
                    });

                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-slate-400">
                            <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40" />
                            <p className="font-medium text-slate-600 dark:text-slate-300">
                              No e-commerce orders found
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">
                              Try clearing filters or click "Add Manual Order" to create one.
                            </p>
                          </td>
                        </tr>
                      );
                    }

                    return filtered.map((ord) => {
                      const channelInfo = CHANNEL_CONFIG[ord.channel] || {
                        label: ord.channelName,
                        tag: ord.channel.toUpperCase(),
                        badgeClass: "bg-slate-100 text-slate-800 border-slate-300",
                      };

                      return (
                        <tr
                          key={ord.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-850/40 transition"
                        >
                          {/* Order ID & Channel */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${channelInfo.badgeClass}`}
                              >
                                {channelInfo.label}
                              </span>
                              <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                {ord.id}
                              </div>
                              <span className="text-[10px] text-slate-400 block">
                                {ord.createdAt}
                              </span>
                            </div>
                          </td>

                          {/* Customer & City */}
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {ord.customerName}
                            </div>
                            <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 text-slate-400" />
                              {ord.customerCity}
                            </span>
                          </td>

                          {/* Item & SKU */}
                          <td className="py-3.5 px-4">
                            <div className="text-slate-800 dark:text-slate-200 font-medium">
                              {ord.productName}
                            </div>
                            <div className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400">
                              {ord.sku} • {ord.variant}
                            </div>
                          </td>

                          {/* Qty */}
                          <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                            {ord.quantity}
                          </td>

                          {/* Total Value */}
                          <td className="py-3.5 px-3 text-right">
                            <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                              ₹{ord.totalValue.toLocaleString("en-IN")}
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                              {ord.paymentMethod}
                            </span>
                          </td>

                          {/* Sales Order (Step 3) */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300">
                                <CheckCircle2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                {ord.salesOrderId}
                              </span>
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium block">
                                ✓ Stock Reserved
                              </span>
                            </div>
                          </td>

                          {/* Tax Invoice (Step 5) */}
                          <td className="py-3.5 px-4">
                            {ord.invoiceId ? (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-bold bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                                  <FileCheck2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                  {ord.invoiceId}
                                </span>
                                <span className="text-[10px] text-slate-500 block">
                                  Issued at Dispatch
                                </span>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 italic">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  Pending Dispatch
                                </span>
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium block">
                                  Generates at courier handover
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                ord.status === "dispatched" || ord.status === "delivered"
                                  ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300"
                                  : ord.status === "picked_packed"
                                  ? "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300"
                                  : ord.status === "return_qc"
                                  ? "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300"
                                  : "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300"
                              }`}
                            >
                              {ord.status === "dispatched"
                                ? "Dispatched"
                                : ord.status === "picked_packed"
                                ? "Packed"
                                : ord.status === "return_qc"
                                ? "Return in QC"
                                : "Reserved"}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleLoadOrderInWorkflow(ord)}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                                title="Run this order in the 8-Step Fulfillment Stepper"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedOrderForModal(ord);
                                  setShowOrderDetailsModal(true);
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                                title="View Order Slip & Documents"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              {!ord.invoiceId && (
                                <button
                                  onClick={() => handleQuickDispatchOrder(ord)}
                                  className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-2xs cursor-pointer"
                                  title="Quick Dispatch & Generate Tax Invoice"
                                >
                                  <Truck className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: INTERACTIVE FULFILLMENT WORKFLOW (8 STEPS)                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "workflow" && (
        <div className="space-y-6">
          {/* Workflow Header & Order Switcher */}
          <div className="rounded-xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  Active Demonstration Order:
                </span>
                <select
                  value={state.activeOrderId || state.orderId}
                  onChange={(e) => {
                    const found = (state.orders || BASELINE_ORDERS).find((o) => o.id === e.target.value);
                    if (found) handleLoadOrderInWorkflow(found);
                  }}
                  className="font-mono text-xs font-bold px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 cursor-pointer"
                >
                  {(state.orders || BASELINE_ORDERS).map((ord) => (
                    <option key={ord.id} value={ord.id}>
                      {ord.id} ({ord.customerName} • {ord.channelName} • ₹{ord.totalValue})
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Target SKU:{" "}
                <strong className="font-mono text-slate-700 dark:text-slate-200">
                  {(state.orders || BASELINE_ORDERS).find((o) => o.id === (state.activeOrderId || state.orderId))?.sku || "AD-TS-BLK-M"}
                </strong>{" "}
                • Quantity:{" "}
                <strong>
                  {(state.orders || BASELINE_ORDERS).find((o) => o.id === (state.activeOrderId || state.orderId))?.quantity || 2} Units
                </strong>{" "}
                • Total:{" "}
                <strong>
                  ₹{((state.orders || BASELINE_ORDERS).find((o) => o.id === (state.activeOrderId || state.orderId))?.totalValue || 2000).toLocaleString("en-IN")}
                </strong>
              </p>
            </div>

            <div className="flex items-center gap-2 self-end md:self-auto">
              <button
                onClick={() => setShowManualOrderModal(true)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-2xs cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add New Order
              </button>
              <button
                onClick={() => handleJumpToStep(0)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Reset to Step 0
              </button>
              <button
                onClick={handleNextStep}
                disabled={state.currentStep >= 8}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg text-white shadow-xs flex items-center gap-1.5 transition cursor-pointer ${
                  state.currentStep >= 8
                    ? "bg-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700"
                }`}
              >
                Advance to Next Step
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 8-Step Progress Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {(plainEnglishMode ? PLAIN_ENGLISH_STEPS : WORKFLOW_STEPS).map((ws) => {
              const isPassed = state.currentStep >= ws.step;
              const isCurrent = state.currentStep === ws.step;
              const isSoStep = ws.step === 3;
              const isInvStep = ws.step === 5;

              return (
                <button
                  key={ws.step}
                  onClick={() => handleJumpToStep(ws.step)}
                  className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between cursor-pointer ${
                    isCurrent
                      ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 dark:border-indigo-500 shadow-xs ring-1 ring-indigo-500"
                      : isPassed
                      ? "border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/30 dark:bg-emerald-950/20"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 opacity-70"
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                        isCurrent
                          ? "bg-indigo-600 text-white"
                          : isPassed
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Step {ws.step}
                    </span>
                    {isPassed && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                  </div>

                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 line-clamp-2">
                    {ws.title}
                  </p>

                  {/* Plain English Document Milestone Pill */}
                  {isSoStep && (
                    <span className="mt-1 inline-block text-[9px] font-black uppercase text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/80 px-1.5 py-0.5 rounded">
                      Sales Order
                    </span>
                  )}
                  {isInvStep && (
                    <span className="mt-1 inline-block text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/80 px-1.5 py-0.5 rounded">
                      Tax Invoice
                    </span>
                  )}

                  <span className="text-[10px] text-slate-400 mt-2 block">
                    {"role" in ws ? ws.role.split("&")[0] : ws.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Current Step Active Card Spotlight */}
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
                  {state.currentStep === 0 ? "0" : state.currentStep}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {state.currentStep === 0
                        ? "Step 0: Baseline Initialized (Opening Stock = 20)"
                        : plainEnglishMode
                        ? PLAIN_ENGLISH_STEPS[state.currentStep - 1]?.title
                        : WORKFLOW_STEPS[state.currentStep - 1]?.title}
                    </h4>
                    {state.currentStep === 3 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 uppercase">
                        ★ Creates Sales Order
                      </span>
                    )}
                    {state.currentStep === 5 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 uppercase">
                        ★ Creates Tax Invoice
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {state.currentStep === 0
                      ? "Click 'Advance to Next Step' to simulate order import event from channel."
                      : plainEnglishMode
                      ? PLAIN_ENGLISH_STEPS[state.currentStep - 1]?.shortDesc
                      : WORKFLOW_STEPS[state.currentStep - 1]?.subtitle}
                  </p>
                </div>
              </div>

              {/* Action buttons inside spotlight */}
              <div className="flex items-center gap-2">
                {state.currentStep >= 5 && (
                  <button
                    onClick={() => setShowInvoiceModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Preview Tax Invoice ({state.demoInvoiceNumber ?? state.invoiceId})
                  </button>
                )}
                {state.currentStep < 8 ? (
                  <button
                    onClick={handleNextStep}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition shadow-xs cursor-pointer"
                  >
                    Run Step {state.currentStep + 1}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Workflow Complete
                  </span>
                )}
              </div>
            </div>

            {/* Non-Tech Plain English Spotlight Box */}
            {plainEnglishMode && state.currentStep > 0 && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50/80 via-white to-sky-50/60 dark:from-indigo-950/40 dark:via-slate-900 dark:to-slate-900 border border-indigo-200/80 dark:border-indigo-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">
                      Guide
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950 px-2 py-0.5 rounded-full">
                    Executive / Business View
                  </span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                  {PLAIN_ENGLISH_STEPS[state.currentStep - 1]?.explanation}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block font-medium">📄 Document Created:</span>
                    <strong className="text-slate-800 dark:text-slate-200 mt-0.5 block">
                      {PLAIN_ENGLISH_STEPS[state.currentStep - 1]?.documentCreated}
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block font-medium">📦 Warehouse Stock Change:</span>
                    <strong className="text-slate-800 dark:text-slate-200 mt-0.5 block">
                      {PLAIN_ENGLISH_STEPS[state.currentStep - 1]?.stockImpact}
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block font-medium">👤 Handled By:</span>
                    <strong className="text-slate-800 dark:text-slate-200 mt-0.5 block">
                      {PLAIN_ENGLISH_STEPS[state.currentStep - 1]?.whoDoesThis}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* Technical / ERP Mode Spotlight Box */}
            {!plainEnglishMode && state.currentStep > 0 && (
              <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2.5 font-mono">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider font-sans">
                      ERP Technical Architecture & Payload • Step {state.currentStep}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-full font-sans">
                    Technical / ERP View
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-sans">
                  {WORKFLOW_STEPS[state.currentStep - 1]?.subtitle}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block font-sans">API Endpoint:</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold block truncate">
                      {state.currentStep === 3
                        ? "POST /api/marketplace-demo/orders"
                        : state.currentStep === 5
                        ? "POST /api/dispatches/confirm"
                        : "PUT /api/marketplace-demo/status"}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block font-sans">ERP Transaction:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-bold block truncate">
                      {state.currentStep === 3
                        ? "SalesOrder.create() [SO Issued]"
                        : state.currentStep === 5
                        ? "Invoice.issue() [INV Issued]"
                        : "Inventory.sync()"}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 block font-sans">Ledger Event:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold block truncate">
                      {state.currentStep >= 5 ? "GST Output Tax Accrued" : "Zero Tax Liability (SO)"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Step Specific Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Order & Identifiers
                </span>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Marketplace / Channel:</span>
                    <strong className="text-slate-800 dark:text-slate-200">
                      {(state.orders || BASELINE_ORDERS).find((o) => o.id === (state.activeOrderId || state.orderId))?.channelName || "Amazon India"}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Order Reference:</span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">{state.orderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">External ID:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{state.externalOrderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sales Order (SO):</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                      {state.currentStep >= 3
                        ? state.demoSoNumber ?? state.soId
                        : "Pending Step 3 (Created on order arrival)"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Status:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.paymentStatus === "collected_by_marketplace"
                        ? "Collected by Channel"
                        : "Pending / COD"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tax Invoice (INV):</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                      {state.currentStep >= 5
                        ? state.demoInvoiceNumber ?? state.invoiceId
                        : "Pending Step 5 (Created on courier dispatch)"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Fulfillment & Dispatch
                </span>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Warehouse:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">WH-DEMO</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Pick / Pack Task:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 4 ? "Packed in carton box" : "Pending Pick/Pack"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Carrier Transporter:</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 5 ? state.carrier : "Awaiting dispatch"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Airway Bill / Tracking:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.currentStep >= 5 ? state.trackingNumber : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Channel Tracking Sync:</span>
                    <span
                      className={`font-semibold ${
                        state.currentStep >= 6
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-400"
                      }`}
                    >
                      {state.currentStep >= 6 ? "Simulated Acknowledged" : "Pending"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Return & QC Buffer
                </span>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Return Docket:</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {state.currentStep >= 7 ? state.returnId : "None"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Return Quantity:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 7 ? "1 Unit (Reason: Size issue)" : "0"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">QC Status:</span>
                    <span
                      className={`font-semibold ${
                        state.currentStep >= 8
                          ? "text-emerald-600 dark:text-emerald-400"
                          : state.currentStep === 7
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-slate-400"
                      }`}
                    >
                      {state.currentStep >= 8
                        ? "Pass / Resalable"
                        : state.currentStep === 7
                        ? "QC Hold (1 unit held)"
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Restock Disposition:</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 8 ? "Released to Available (Stock = 19)" : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: INVENTORY & 6-CHECKPOINT LEDGER (PDF 3 §4, §6, §7)            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "inventory" && (
        <div className="space-y-6">
          {/* Section 1: Target SKU Checkpoint Ledger Table */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  Verification Table (Section 7 in Guide)
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Target SKU Stock Ledger Checkpoints:{" "}
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">AD-TS-BLK-M</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Available = On-hand − Reserved − QC hold. Evaluated in real time from workflow actions.
                </p>
              </div>
              <div className="text-xs text-right text-slate-500">
                Current Workflow Step: <strong>Step {state.currentStep}</strong>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2.5 px-3">Checkpoint</th>
                    <th className="py-2.5 px-3 text-right">On-Hand</th>
                    <th className="py-2.5 px-3 text-right">Reserved</th>
                    <th className="py-2.5 px-3 text-right">QC Hold</th>
                    <th className="py-2.5 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                      Available
                    </th>
                    <th className="py-2.5 px-4">Audit Note & State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {ledgerCheckpoints.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`transition ${
                        row.isCurrent
                          ? "bg-indigo-50/70 dark:bg-indigo-950/40 font-semibold"
                          : row.isPassed
                          ? "hover:bg-slate-50/50 dark:hover:bg-slate-850/40"
                          : "opacity-40"
                      }`}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          {row.isCurrent ? (
                            <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                          ) : row.isPassed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span className={row.isCurrent ? "text-indigo-600 dark:text-indigo-400 font-bold" : ""}>
                            {row.checkpoint}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono">{row.onHand}</td>
                      <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                        {row.reserved}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-rose-600 dark:text-rose-400">
                        {row.qcHold}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
                        {row.available}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        {row.actionNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: All 6 Seeded Adventra SKUs Inventory Table */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Seeded Adventra Catalogue & Stock (Warehouse: WH-DEMO)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                All channel SKUs point to one central WhizUnik inventory record. No duplicates created.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2.5 px-3">WhizUnik SKU</th>
                    <th className="py-2.5 px-3">Variant Description</th>
                    <th className="py-2.5 px-3">Amazon SKU</th>
                    <th className="py-2.5 px-3">Shopify Variant</th>
                    <th className="py-2.5 px-3 text-right">On-Hand</th>
                    <th className="py-2.5 px-3 text-right">Reserved</th>
                    <th className="py-2.5 px-3 text-right">QC Hold</th>
                    <th className="py-2.5 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400">
                      Available Stock
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {state.inventory.map((inv) => {
                    const isMainSku = inv.whizunikSku === "AD-TS-BLK-M";
                    // compute active stock based on workflow step
                    const onHand = isMainSku
                      ? state.currentStep >= 7
                        ? 19
                        : state.currentStep >= 5
                        ? 18
                        : 20
                      : inv.onHand;
                    const reserved = isMainSku && state.currentStep >= 3 && state.currentStep < 5 ? 2 : 0;
                    const qcHold = isMainSku && state.currentStep === 7 ? 1 : 0;
                    const available = onHand - reserved - qcHold;

                    return (
                      <tr
                        key={inv.whizunikSku}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-850/40 transition ${
                          isMainSku ? "bg-indigo-50/30 dark:bg-indigo-950/20" : ""
                        }`}
                      >
                        <td className="py-3 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {inv.whizunikSku}
                          {isMainSku && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-sans">
                              Active Demo SKU
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-700 dark:text-slate-300">{inv.variant}</td>
                        <td className="py-3 px-3 font-mono text-slate-500">{inv.amazonSku}</td>
                        <td className="py-3 px-3 font-mono text-slate-500">{inv.shopifyVariant}</td>
                        <td className="py-3 px-3 text-right font-mono font-medium">{onHand}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                          {reserved}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-rose-600 dark:text-rose-400">
                          {qcHold}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400">
                          {available}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: SKU MAPPING & CHANNEL LINKS (PDF 1 §1, PDF 3 §6)              */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "mappings" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Cross-Channel SKU Mapping Table
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Multiple channel listings map to single WhizUnik child SKUs. Prevents inventory fragmentation.
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search SKU or Title..."
                    value={mappingSearch}
                    onChange={(e) => setMappingSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs w-48 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <select
                  value={selectedMappingFilter}
                  onChange={(e) => setSelectedMappingFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs font-medium focus:outline-hidden"
                >
                  <option value="all">All Channels</option>
                  <option value="Amazon">Amazon</option>
                  <option value="Shopify">Shopify</option>
                  <option value="Flipkart">Flipkart</option>
                </select>
              </div>
            </div>

            {/* Unmapped Exception Callout if unresolved */}
            {state.unmappedErrorStatus === "unresolved" && (
              <div className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-800/60 bg-rose-50/50 dark:bg-rose-950/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-rose-600 text-white">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-rose-900 dark:text-rose-200">
                      Unmapped Listing Exception: AMZ-UNKNOWN (Amazon India)
                    </h5>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300">
                      Order DEMO-AMZ-ERR-01 is paused. Auto-creation of inventory is blocked per Section 6 policy.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMapModal(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition shadow-xs whitespace-nowrap"
                >
                  Map to WhizUnik SKU
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-2.5 px-3">Channel</th>
                    <th className="py-2.5 px-3">Channel SKU / Listing ID</th>
                    <th className="py-2.5 px-3">WhizUnik Child SKU</th>
                    <th className="py-2.5 px-3">Product Title & Variant</th>
                    <th className="py-2.5 px-3">Warehouse</th>
                    <th className="py-2.5 px-3 text-right">MRP / Selling</th>
                    <th className="py-2.5 px-3">HSN / GST</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {mappings
                    .filter((m) =>
                      selectedMappingFilter === "all" ? true : m.channel === selectedMappingFilter
                    )
                    .filter((m) =>
                      mappingSearch
                        ? m.channelSku.toLowerCase().includes(mappingSearch.toLowerCase()) ||
                          m.whizunikSku.toLowerCase().includes(mappingSearch.toLowerCase()) ||
                          m.productName.toLowerCase().includes(mappingSearch.toLowerCase())
                        : true
                    )
                    .map((mapItem) => (
                      <tr
                        key={mapItem.id}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-850/40 transition ${
                          mapItem.status === "Error"
                            ? "bg-rose-50/30 dark:bg-rose-950/20"
                            : ""
                        }`}
                      >
                        <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                          {mapItem.channel}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {mapItem.channelSku}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {mapItem.listingId}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {mapItem.whizunikSku}
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-slate-800 dark:text-slate-200 font-medium">
                            {mapItem.productName}
                          </div>
                          <div className="text-[10px] text-slate-400">{mapItem.variant}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                          {mapItem.warehouse}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="text-slate-400 line-through mr-1">₹{mapItem.mrp}</span>
                          <strong className="text-slate-900 dark:text-slate-100">
                            ₹{mapItem.sellingPrice}
                          </strong>
                        </td>
                        <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                          {mapItem.hsn} ({mapItem.gstRate}%)
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              mapItem.status === "Active" || mapItem.status === "Mapped"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 animate-pulse"
                            }`}
                          >
                            {mapItem.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {mapItem.status === "Error" ? (
                            <button
                              onClick={() => setShowMapModal(true)}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded bg-rose-600 text-white hover:bg-rose-700 transition"
                            >
                              Resolve
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">Synced</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 4: EXCEPTIONS & RECOVERY QUEUES (PDF 1 §9, PDF 3 §8)            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "exceptions" && (
        <div className="space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Exception & Sync Recovery Center
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Simulate and verify the 3 required exception patterns from PDF 3 §8 (Unmapped SKU, Outbound Retry, Idempotency).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Exception 1: Unmapped SKU */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 uppercase">
                    Exception Scenario 1
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      state.unmappedErrorStatus === "resolved" ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {state.unmappedErrorStatus === "resolved" ? "Resolved" : "Active Error"}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-2">
                  Unmapped SKU Recovery
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Incoming order with fixture <code>AMZ-UNKNOWN</code> is paused. No sales order or reservation is created until mapped.
                </p>
                <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 text-xs font-mono text-slate-700 dark:text-slate-300">
                  <div>Event: DEMO-AMZ-ERR-01</div>
                  <div>Channel SKU: AMZ-UNKNOWN</div>
                  <div>
                    Status:{" "}
                    {state.unmappedErrorStatus === "resolved"
                      ? `Mapped -> ${state.unmappedSkuAssigned}`
                      : "Mapping Required"}
                  </div>
                </div>
              </div>

              <div className="pt-2">
                {state.unmappedErrorStatus === "resolved" ? (
                  <button
                    onClick={() => {
                      setState((prev) => ({ ...prev, unmappedErrorStatus: "unresolved" }));
                      setMappings(BASELINE_MAPPINGS);
                      toast.info("Reset unmapped SKU exception scenario.");
                    }}
                    className="w-full py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  >
                    Reset to Unmapped State
                  </button>
                ) : (
                  <button
                    onClick={() => setShowMapModal(true)}
                    className="w-full py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition shadow-xs"
                  >
                    Resolve & Reprocess
                  </button>
                )}
              </div>
            </div>

            {/* Exception 2: Outbound Sync Fail & Retry */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 uppercase">
                    Exception Scenario 2
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      state.outboundSyncStatus.includes("Failed")
                        ? "text-rose-600"
                        : state.outboundSyncStatus.includes("Acknowledged")
                        ? "text-emerald-600"
                        : "text-slate-500"
                    }`}
                  >
                    {state.outboundSyncStatus}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-2">
                  Failed Outbound Sync & Safe Retry
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Dispatched order tracking push fails. WhizUnik order stays Dispatched. Retry must not duplicate invoice or alter stock.
                </p>
                <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 text-xs font-mono text-slate-700 dark:text-slate-300">
                  <div>Order: DEMO-AMZ-1001</div>
                  <div>Tracking: TRK-DEMO-1001</div>
                  <div>Retry Count: {state.outboundRetryCount}</div>
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  onClick={handleForceSyncFailure}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition"
                >
                  Force 504 Timeout
                </button>
                <button
                  onClick={handleRetryOutboundSync}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs"
                >
                  Safe Retry
                </button>
              </div>
            </div>

            {/* Exception 3: Idempotency Protection */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 uppercase">
                    Exception Scenario 3
                  </span>
                  <span className="text-xs font-semibold text-emerald-600">Active Guard</span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-2">
                  Duplicate Event & Stock Protection
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Replays <code>EVT-1001</code> to prove that duplicate webhook delivery is safely ignored without extra reservation.
                </p>
                <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 text-xs font-mono text-slate-700 dark:text-slate-300">
                  <div>Idempotency Key: EVT-1001:AMZ:L1</div>
                  <div>Duplicate Protection: ENABLED</div>
                  <div>Guard Result: ZERO duplicate stock debit</div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleTestIdempotency}
                  className="w-full py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition shadow-xs"
                >
                  Replay Event EVT-1001
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 5: SETTLEMENT & FINANCE (PDF 1 §7, PDF 2 §6)                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "finance" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Finance & Accounting Rule (Section 7 in Developer Brief)
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Customer Payment vs Marketplace Settlement Ledger
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A customer payment marked "Collected by Marketplace" is NOT automatically marked as money received in WhizUnik Treasury.
              </p>
            </div>

            {/* Reconciliation Card for DEMO-AMZ-1001 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 space-y-3">
                <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Order Invoicing & Collection Status
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Order Reference:</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">DEMO-AMZ-1001</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Invoice Issued:</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {state.currentStep >= 5 ? "INV-DEMO-1001" : "Pending Dispatch"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Gross Invoice Value:</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">₹2,000.00</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200/60 dark:border-slate-800">
                    <span className="text-slate-500">Customer Payment State:</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                      Collected by Amazon India
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">WhizUnik Treasury Status:</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Awaiting Marketplace Settlement
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/20 dark:bg-indigo-950/20 space-y-3">
                <h4 className="text-xs font-bold uppercase text-indigo-700 dark:text-indigo-400 tracking-wider">
                  Settlement Deductions Breakdown (Estimated)
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50">
                    <span className="text-slate-600 dark:text-slate-400">Gross Sale Amount:</span>
                    <strong className="text-slate-900 dark:text-slate-100">₹2,000.00</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50 text-rose-600 dark:text-rose-400">
                    <span>Marketplace Referral Commission (12%):</span>
                    <span>−₹240.00</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50 text-rose-600 dark:text-rose-400">
                    <span>Pick & Pack / EasyShip Fee:</span>
                    <span>−₹90.00</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-indigo-100 dark:border-indigo-900/50 text-rose-600 dark:text-rose-400">
                    <span>TCS (Tax Collected at Source - 1%):</span>
                    <span>−₹20.00</span>
                  </div>
                  <div className="flex justify-between py-1.5 pt-2 text-sm font-bold border-t-2 border-indigo-200 dark:border-indigo-800">
                    <span className="text-slate-900 dark:text-slate-100">Net Expected Receivable:</span>
                    <span className="text-emerald-600 dark:text-emerald-400">₹1,650.00</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB 6: CONNECTOR ARCHITECTURE (PDF 1 §8, PDF 3 §3)                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "architecture" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Enterprise Interface Architecture
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Common Marketplace Framework & Connector Abstraction
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Marketplace-specific APIs never communicate directly with internal inventory tables. All traffic flows through the normalized common contract.
              </p>
            </div>

            {/* Architecture Pipeline Visual */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850/60 border border-slate-200 dark:border-slate-800">
              <div className="flex flex-col lg:flex-row items-center justify-between gap-3 text-center text-xs font-semibold">
                <div className="p-3 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 w-full lg:w-44">
                  <div className="text-[10px] text-amber-600 uppercase">Input Layer</div>
                  Mock Channel Event (Amazon / Shopify)
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 hidden lg:block" />
                <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700 w-full lg:w-44">
                  <div className="text-[10px] text-blue-600 uppercase">Adapter Layer</div>
                  Channel Adapter (Normalizer)
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 hidden lg:block" />
                <div className="p-3 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-900 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 w-full lg:w-48">
                  <div className="text-[10px] text-indigo-600 uppercase">Framework</div>
                  Common Integration Interface
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 hidden lg:block" />
                <div className="p-3 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 w-full lg:w-48">
                  <div className="text-[10px] text-emerald-600 uppercase">Core Master</div>
                  WhizUnik Sales & Inventory Ledger
                </div>
              </div>
            </div>

            {/* Interface Methods Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              {[
                { name: "authenticate()", desc: "Token handshake & credentials validation" },
                { name: "sync_products()", desc: "Catalogue & variant schema mapping" },
                { name: "sync_inventory()", desc: "Available stock push (Oversell prevention)" },
                { name: "import_orders()", desc: "Webhook / polling ingestion with idempotency" },
                { name: "update_order_status()", desc: "Pick / Pack milestone progression" },
                { name: "update_shipment()", desc: "Transporter & tracking code push" },
                { name: "import_returns()", desc: "Return request sync into QC Hold" },
                { name: "import_settlements()", desc: "TCS, fees & net remittance ingestion" },
              ].map((fn, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  <p className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    {fn.name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{fn.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 1: WATERMARKED DEMO INVOICE PREVIEW ──────────────────── */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative overflow-hidden space-y-4">
            {/* Watermark Diagonal Banner */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
              <span className="text-4xl sm:text-5xl font-black text-rose-600 -rotate-45 select-none uppercase">
                DEMO / NOT A TAX INVOICE
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-indigo-600" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100">
                  Demo Invoice Preview: {state.demoInvoiceNumber ?? state.invoiceId}
                </h4>
              </div>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                <strong>Demonstration Watermark Notice:</strong> This document represents an illustrative customer invoice. No statutory tax document has been submitted to GSTN / NIC portals.
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-850">
                <div>
                  <span className="text-slate-400 block text-[10px]">Seller</span>
                  <strong className="text-slate-800 dark:text-slate-200">WhizUnik / Adventra Lifestyle Pvt Ltd</strong>
                  <p className="text-[11px] text-slate-500">GSTIN: 29AAAAA0000A1Z5</p>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Buyer (Marketplace Customer)</span>
                  <strong className="text-slate-800 dark:text-slate-200">Rohan Sharma</strong>
                  <p className="text-[11px] text-slate-500">Order Ref: DEMO-AMZ-1001</p>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="p-2">Item Description</th>
                      <th className="p-2">HSN</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Rate</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100 dark:border-slate-800">
                      <td className="p-2">Adventra Classic Tee (Black - M) [AD-TS-BLK-M]</td>
                      <td className="p-2 font-mono">61091000</td>
                      <td className="p-2 text-right font-mono">2</td>
                      <td className="p-2 text-right font-mono">₹1,000.00</td>
                      <td className="p-2 text-right font-mono font-bold">₹2,000.00</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850 space-y-1 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>Taxable Value:</span>
                  <span>₹1,904.76</span>
                </div>
                <div className="flex justify-between">
                  <span>Integrated GST (5%):</span>
                  <span>₹95.24</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 text-xs pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span>Grand Total:</span>
                  <span>₹2,000.00</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                  <span>Mock IRN Token:</span>
                  <span>4b8f9e...demo-mock-irn</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: MAP UNMAPPED SKU MODAL ────────────────────────────── */}
      {showMapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-600" />
                <h4 className="font-bold text-slate-900 dark:text-slate-100">
                  Resolve Unmapped SKU: AMZ-UNKNOWN
                </h4>
              </div>
              <button
                onClick={() => setShowMapModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                Select the destination WhizUnik child SKU to bind <code>AMZ-UNKNOWN</code>. Per Section 8 exception script, map to <strong>AD-TS-WHT-M</strong>:
              </p>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">
                  Target WhizUnik SKU
                </label>
                <select
                  value={mapTargetSku}
                  onChange={(e) => setMapTargetSku(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-850 font-mono text-xs font-semibold focus:outline-hidden"
                >
                  <option value="AD-TS-WHT-M">AD-TS-WHT-M (White Tee M - 18 On-hand)</option>
                  <option value="AD-TS-BLK-L">AD-TS-BLK-L (Black Tee L - 15 On-hand)</option>
                  <option value="AD-PO-NVY-M">AD-PO-NVY-M (Navy Polo M - 10 On-hand)</option>
                </select>
              </div>

              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[11px]">
                Upon mapping, the pending error event <strong>DEMO-AMZ-ERR-01</strong> will reprocess automatically, creating 1 sales order and reserving 1 unit cleanly.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowMapModal(false)}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveUnmappedSku}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs"
              >
                Confirm Mapping & Reprocess
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── MODAL 3: ADD MANUAL E-COMMERCE ORDER MODAL ─────────────────── */}
      {showManualOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                    Add Manual E-Commerce Order
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Simulate an order or record direct sales with automatic Sales Order generation.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowManualOrderModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 text-sm rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Plain-English Explanation Banner */}
            <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/40 text-blue-900 dark:text-blue-300 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wide">
                <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                ERP Rule: Sales Order vs. Tax Invoice
              </div>
              <p className="text-[11px] leading-relaxed text-blue-800/90 dark:text-blue-300/90">
                Submitting this order will create a <strong>Sales Order (SO)</strong> immediately to lock
                and reserve inventory in <strong>WH-DEMO</strong>. The official <strong>Tax Invoice</strong> is
                only created later when the parcel is physically packed and dispatched with the courier.
              </p>
            </div>

            <form onSubmit={handleCreateManualOrder} className="space-y-4 text-xs">
              {/* Channel & Order ID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Sales Channel / Store *
                  </label>
                  <select
                    value={manualChannel}
                    onChange={(e) => setManualChannel(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-850 font-medium text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  >
                    <option value="amazon">Amazon India</option>
                    <option value="flipkart">Flipkart</option>
                    <option value="shopify">Shopify Store</option>
                    <option value="myntra">Myntra</option>
                    <option value="marketplace4">Marketplace 4</option>
                    <option value="manual">Manual / Direct Phone Order</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Channel Order ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={manualOrderId}
                    onChange={(e) => setManualOrderId(e.target.value)}
                    placeholder="e.g. ORD-MAN-4029"
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Customer Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={manualCustomerName}
                    onChange={(e) => setManualCustomerName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Delivery City / State *
                  </label>
                  <input
                    type="text"
                    required
                    value={manualCustomerCity}
                    onChange={(e) => setManualCustomerCity(e.target.value)}
                    placeholder="e.g. Bengaluru, Karnataka"
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Product SKU Selector with Live Availability */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                    Select Product SKU *
                  </label>
                  {(() => {
                    const inv = state.inventory.find((i) => i.whizunikSku === manualSku);
                    return inv ? (
                      <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                        Available in WH: <strong>{inv.available}</strong> (On-hand: {inv.onHand}, Res: {inv.reserved})
                      </span>
                    ) : null;
                  })()}
                </div>
                <select
                  value={manualSku}
                  onChange={(e) => {
                    const newSku = e.target.value;
                    setManualSku(newSku);
                    const mapping =
                      mappings.find((m) => m.whizunikSku === newSku) ||
                      BASELINE_MAPPINGS.find((m) => m.whizunikSku === newSku);
                    if (mapping?.sellingPrice) {
                      setManualUnitPrice(mapping.sellingPrice);
                    }
                  }}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  {state.inventory.map((inv) => {
                    const m =
                      mappings.find((x) => x.whizunikSku === inv.whizunikSku) ||
                      BASELINE_MAPPINGS.find((x) => x.whizunikSku === inv.whizunikSku);
                    const price = m?.sellingPrice || (inv.whizunikSku.includes("PO") ? 1400 : 1000);
                    return (
                      <option key={inv.whizunikSku} value={inv.whizunikSku}>
                        {inv.whizunikSku} — {inv.variant} (Available: {inv.available}) - ₹{price.toLocaleString("en-IN")}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Quantity, Unit Price & Total */}
              <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-800">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={manualQuantity}
                    onChange={(e) => setManualQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs font-semibold focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Unit Price (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={manualUnitPrice}
                    onChange={(e) => setManualUnitPrice(Math.max(1, parseFloat(e.target.value) || 0))}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs font-semibold focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Order Total
                  </label>
                  <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 font-mono font-bold text-xs text-indigo-700 dark:text-indigo-300 text-center">
                    ₹{(manualQuantity * manualUnitPrice).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                  Payment Collection Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition ${
                      manualPaymentMethod === "Prepaid"
                        ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="Prepaid"
                      checked={manualPaymentMethod === "Prepaid"}
                      onChange={() => setManualPaymentMethod("Prepaid")}
                      className="text-indigo-600"
                    />
                    <span>Prepaid (Escrow / Card)</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition ${
                      manualPaymentMethod === "COD"
                        ? "border-amber-600 bg-amber-50/50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-semibold"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="COD"
                      checked={manualPaymentMethod === "COD"}
                      onChange={() => setManualPaymentMethod("COD")}
                      className="text-amber-600"
                    />
                    <span>Cash on Delivery (COD)</span>
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                  Order Notes / Tags (Optional)
                </label>
                <input
                  type="text"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="e.g. Customer requested urgent evening dispatch"
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowManualOrderModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-sm flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Create Order & Issue Sales Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 4: ORDER DETAILS & DOCUMENT SLIP MODAL ────────────────── */}
      {showOrderDetailsModal && selectedOrderForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base font-mono">
                      {selectedOrderForModal.id}
                    </h4>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        CHANNEL_CONFIG[selectedOrderForModal.channel]?.badgeClass || "bg-slate-100"
                      }`}
                    >
                      {selectedOrderForModal.channelName}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Order Placed: {selectedOrderForModal.createdAt}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowOrderDetailsModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 text-sm rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Document Chain Flow Diagram */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  Document Flow & Audit Trail
                </span>
                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold">
                  {selectedOrderForModal.status.replace("_", " ").toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {/* Sales Order Box */}
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/60">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-indigo-500" />
                      Sales Order (SO)
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold">
                      Stock Reserved
                    </span>
                  </div>
                  <div className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                    {selectedOrderForModal.salesOrderId || "SO-PENDING"}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    Locks warehouse inventory without GST tax liability until physical handover.
                  </p>
                </div>

                {/* Tax Invoice Box */}
                <div
                  className={`p-2.5 rounded-lg border ${
                    selectedOrderForModal.invoiceId
                      ? "bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/60"
                      : "bg-slate-100/70 dark:bg-slate-850/80 border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[10px] font-bold uppercase flex items-center gap-1 ${
                        selectedOrderForModal.invoiceId
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-400"
                      }`}
                    >
                      {selectedOrderForModal.invoiceId ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Clock className="w-3 h-3 text-slate-400" />
                      )}
                      Tax Invoice
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                        selectedOrderForModal.invoiceId
                          ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                          : "bg-slate-200 dark:bg-slate-700 text-slate-500"
                      }`}
                    >
                      {selectedOrderForModal.invoiceId ? "Generated" : "Pending Dispatch"}
                    </span>
                  </div>
                  <div className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                    {selectedOrderForModal.invoiceId || "Awaiting Dispatch"}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    {selectedOrderForModal.invoiceId
                      ? "Official tax document with GST stamp issued upon courier handover."
                      : "Generated only when packed parcel is handed over to courier."}
                  </p>
                </div>
              </div>
            </div>

            {/* Customer & Courier Information */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Customer Details</span>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {selectedOrderForModal.customerName}
                </div>
                <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  {selectedOrderForModal.customerCity}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Fulfillment & Courier</span>
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  <Truck className="w-3 h-3 text-slate-400" />
                  {selectedOrderForModal.carrier || "Courier not yet assigned"}
                </div>
                {selectedOrderForModal.trackingNumber ? (
                  <div className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                    AWB: {selectedOrderForModal.trackingNumber}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">AWB created upon dispatch</div>
                )}
              </div>
            </div>

            {/* Line Items Table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-850 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-2.5">Item & SKU</th>
                    <th className="p-2.5 text-right">Qty</th>
                    <th className="p-2.5 text-right">Unit Price</th>
                    <th className="p-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <tr>
                    <td className="p-2.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {selectedOrderForModal.productName}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">
                        {selectedOrderForModal.sku} • {selectedOrderForModal.variant}
                      </div>
                    </td>
                    <td className="p-2.5 text-right font-mono font-semibold">
                      {selectedOrderForModal.quantity}
                    </td>
                    <td className="p-2.5 text-right font-mono">
                      ₹{selectedOrderForModal.unitPrice.toLocaleString("en-IN")}
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      ₹{selectedOrderForModal.totalValue.toLocaleString("en-IN")}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="p-2.5 bg-slate-50/80 dark:bg-slate-850/80 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-500 font-medium">Payment Method:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {selectedOrderForModal.paymentMethod} ({selectedOrderForModal.paymentStatus})
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => {
                  handleLoadOrderInWorkflow(selectedOrderForModal);
                  setShowOrderDetailsModal(false);
                }}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 transition flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                Open in Fulfillment Journey
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                {!selectedOrderForModal.invoiceId && (
                  <button
                    onClick={() => {
                      handleQuickDispatchOrder(selectedOrderForModal);
                      setShowOrderDetailsModal(false);
                    }}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition flex items-center gap-1.5"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    Dispatch & Issue Invoice
                  </button>
                )}
                <button
                  onClick={() => setShowOrderDetailsModal(false)}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
