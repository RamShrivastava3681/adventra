import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowRight,
  Wallet,
  Receipt,
  CreditCard,
  TrendingUp,
  Activity,
  Package,
  ShoppingCart,
  AlertCircle,
  RefreshCw,
  Clock,
  CheckCircle2,
  Calendar,
  Settings,
  Plus,
  Box,
  Truck,
  FileText,
  Search,
  ChevronRight,
  BarChart3,
  Users
} from "lucide-react";
import { useCommandData, num, pick } from "@/components/command-overview/useCommandData";
import { fmtCompact, fmtFull } from "@/components/command-overview/cards";
import { PriorityTable } from "@/components/command-overview/PriorityTable";
import React, { useState } from "react";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { isAdmin, isSuperAdmin, isTreasury, isOperations, isSalesRep, isChecker } = useAuth();
  const admin = isAdmin || isSuperAdmin;
  const canFinance = admin || isTreasury || isOperations;
  const canSales = admin || isOperations || isSalesRep;
  const canWarehouse = admin || isOperations;
  const canChecker = admin || isChecker;
  const canProcurement = admin || isOperations;

  const d = useCommandData();
  const initialLoading = d.loading;

  if (initialLoading) {
    return <div className="p-10 text-center text-muted-foreground flex items-center justify-center h-64"><RefreshCw className="h-6 w-6 animate-spin mr-3" /> Loading Command Centre...</div>;
  }

  return (
    <div className="bg-[#f4f7f9] min-h-screen pb-20 text-slate-800">
      
      {/* 1. EXECUTIVE HEADER */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="px-6 py-5 md:px-8 max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="bg-blue-900 text-white text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-sm">
                Command Centre
              </span>
              <span className="text-xs text-slate-500 font-medium flex items-center">
                <Activity className="h-3.5 w-3.5 mr-1 text-emerald-500" /> System Healthy
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-2">
              Good morning, Executive.
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Here's what needs your attention today.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-4 text-xs text-slate-500 font-medium">
              <span className="flex items-center"><Calendar className="h-3.5 w-3.5 mr-1.5"/> {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
              <span className="flex items-center"><Clock className="h-3.5 w-3.5 mr-1.5"/> Last synced: Just now <RefreshCw className="h-3 w-3 ml-2 cursor-pointer hover:text-slate-800" onClick={d.refetch.cash}/></span>
              <button className="flex items-center text-slate-400 hover:text-slate-700"><Settings className="h-4 w-4"/></button>
            </div>
            <Link to="/app/tasks" className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold py-2 px-5 rounded-md shadow-sm transition-all flex items-center">
              Open Action Centre <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
        
        {/* Business Health Strip */}
        <div className="border-t border-slate-100 bg-slate-50/50">
          <div className="px-6 py-3 md:px-8 max-w-[1600px] mx-auto flex flex-wrap gap-8 text-sm">
             <div className="flex items-center gap-2">
               <span className="text-slate-500 font-medium">Business Health:</span>
               <span className="text-emerald-700 font-bold flex items-center bg-emerald-100 px-2 py-0.5 rounded text-xs"><CheckCircle2 className="h-3.5 w-3.5 mr-1"/> Healthy</span>
             </div>
             <div className="w-px h-5 bg-slate-200"></div>
             <div className="flex items-center gap-2"><span className="text-slate-500">Cash:</span> <span className="text-emerald-600 font-semibold text-xs">Healthy</span></div>
             <div className="flex items-center gap-2"><span className="text-slate-500">Sales:</span> <span className="text-emerald-600 font-semibold text-xs">+{((d.sales.acceptedValue / 2000000)*100).toFixed(1)}%</span></div>
             <div className="flex items-center gap-2"><span className="text-slate-500">Inventory:</span> <span className="text-amber-600 font-semibold text-xs">{d.inventory.low} alerts</span></div>
             <div className="flex items-center gap-2"><span className="text-slate-500">Operations:</span> <span className="text-blue-600 font-semibold text-xs">{d.openTaskCount} pending</span></div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-4 py-8 md:px-8 space-y-8">

        {/* 14. QUICK ACTIONS */}
        <div className="flex flex-wrap gap-2 mb-2">
            {[
              { label: "Sales Order", icon: ShoppingCart, to: "/app/sales-orders/new" },
              { label: "Purchase Order", icon: Package, to: "/app/purchase-orders/new" },
              { label: "Invoice", icon: Receipt, to: "/app/invoices/new" },
              { label: "Customer", icon: Users, to: "/app/debtors/new" },
              { label: "Payment", icon: Wallet, to: "/app/queue" },
              { label: "Dispatch", icon: Truck, to: "/app/dispatches" }
            ].map((action, idx) => (
              <Link key={idx} to={action.to} className="bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 text-xs font-medium py-1.5 px-3 rounded-full flex items-center transition-colors shadow-sm">
                 <Plus className="h-3 w-3 mr-1 text-blue-600" /> {action.label}
              </Link>
            ))}
        </div>

        {/* 2. TOP EXECUTIVE KPI STRIP */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiBox 
            title="Available Cash" value={fmtFull(d.availableCash)} 
            trend="+4.8%" trendUp={true} 
            sub="vs last month" to="/app/cash-flow" 
          />
          <KpiBox 
            title="Receivables" value={fmtFull(d.receivables.total)} 
            trend={d.receivables.overdueCount > 0 ? `${fmtCompact(d.receivables.overdueTotal)} overdue` : "Healthy"} trendUp={d.receivables.overdueCount === 0}
            sub={`${d.receivables.count} open invoices`} to="/app/finance-invoices" critical={d.receivables.overdueCount > 0}
          />
          <KpiBox 
            title="Payables" value={fmtFull(d.payables.total)} 
            trend={d.payables.overdueCount > 0 ? `${fmtCompact(d.payables.overdueTotal)} overdue` : "Healthy"} trendUp={d.payables.overdueCount === 0}
            sub={`${d.payables.count} open bills`} to="/app/finance-purchases" critical={d.payables.overdueCount > 0}
          />
          <KpiBox 
            title="Sales MTD" value={fmtFull(d.sales.acceptedValue)} 
            trend="+18.4%" trendUp={true} 
            sub={`${d.sales.acceptedCount} confirmed`} to="/app/sales-orders" 
          />
          <KpiBox 
            title="Purchases MTD" value={fmtCompact(d.procurement.count * 150000)} 
            trend="+8.7%" trendUp={true} 
            sub={`${d.procurement.count} POs`} to="/app/purchase-orders" 
          />
          <KpiBox 
            title="Gross Profit" value={fmtCompact(d.sales.acceptedValue * 0.347)} 
            trend="34.7%" trendUp={true} 
            sub="Margin" to="/app/reports" 
          />
          <KpiBox 
            title="Inventory Value" value="₹18.4L" 
            trend="↓ 3.2%" trendUp={false} 
            sub={`${d.inventory.total} SKUs`} to="/app/forecast" 
          />
          <KpiBox 
            title="Attention" value={String(d.attentionCount)} 
            trend={`${d.openTaskCount} total`} trendUp={d.attentionCount === 0} 
            sub="Required actions" to="/app/tasks" critical={d.attentionCount > 0}
          />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 space-y-8">
             {/* 3. BUSINESS PERFORMANCE OVERVIEW */}
             <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h2 className="text-lg font-bold text-slate-800">Business Performance</h2>
                  <div className="flex gap-2">
                    {["Sales", "Purchases", "Gross Profit", "Cash Flow"].map(tab => (
                      <button key={tab} className={`px-3 py-1 text-xs font-semibold rounded-md ${tab==='Sales'?'bg-blue-100 text-blue-700':'text-slate-500 hover:bg-slate-100'}`}>{tab}</button>
                    ))}
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex gap-10 mb-6">
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Revenue</p>
                       <p className="text-2xl font-bold text-slate-900">{fmtFull(d.sales.acceptedValue)}</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Target</p>
                       <p className="text-2xl font-bold text-slate-900">₹22.5L</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Achievement</p>
                       <p className="text-2xl font-bold text-emerald-600">110.2%</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Growth</p>
                       <p className="text-2xl font-bold text-emerald-600">+18.4%</p>
                     </div>
                  </div>
                  {/* Mock Chart Area */}
                  <div className="h-64 w-full bg-slate-50 rounded-lg border border-slate-100 flex items-end justify-between px-4 pt-8 pb-4 relative">
                     <div className="absolute top-4 right-4 flex gap-2">
                       {["7D", "30D", "3M", "6M", "12M", "YTD"].map(t => (
                         <span key={t} className={`text-[10px] font-bold px-2 py-1 rounded cursor-pointer ${t==='12M'?'bg-white shadow-sm text-slate-800':'text-slate-400'}`}>{t}</span>
                       ))}
                     </div>
                     {/* Mock bars */}
                     {[40, 60, 45, 70, 65, 80, 75, 95, 85, 110, 100, 120].map((h, i) => (
                       <div key={i} className="w-[6%] flex flex-col justify-end h-full group relative">
                         <div className="w-full bg-blue-100 rounded-t-sm" style={{height: `${h}%`}}>
                            <div className="w-full bg-blue-600 rounded-t-sm absolute bottom-0" style={{height: `${h*0.7}%`}}></div>
                         </div>
                       </div>
                     ))}
                  </div>
                </div>
             </div>

             {/* 5. SALES FUNNEL / ORDER PIPELINE */}
             <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                  <h2 className="text-lg font-bold text-slate-800">Sales Pipeline</h2>
                  <Link to="/app/sales-orders" className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center">View Pipeline <ChevronRight className="h-3 w-3 ml-1"/></Link>
                </div>
                <div className="p-6 overflow-x-auto">
                   <div className="flex items-center min-w-[700px]">
                      <FunnelStage title="Enquiry" count="45" val="₹15.2L" color="slate" />
                      <FunnelStage title="Quotation" count="34" val="₹12.4L" color="slate" />
                      <FunnelStage title="Sales Order" count={d.sales.count} val={fmtCompact(d.sales.totalValue)} color="blue" />
                      <FunnelStage title="Confirmed" count={d.sales.acceptedCount} val={fmtCompact(d.sales.acceptedValue)} color="emerald" />
                      <FunnelStage title="Dispatched" count={d.sales.dispatchReadyCount} val="₹6.4L" color="emerald" />
                      <FunnelStage title="Invoiced" count={d.receivables.count} val={fmtCompact(d.receivables.total)} color="emerald" />
                      <FunnelStage title="Paid" count="9" val="₹3.9L" color="emerald" last />
                   </div>
                </div>
             </div>

             {/* 6. RECEIVABLES & PAYABLES */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                   <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center"><Receipt className="h-4 w-4 mr-2 text-blue-600"/> Receivables</h3>
                   <div className="flex justify-between items-end mb-6">
                      <div>
                        <p className="text-xs text-slate-500 font-semibold uppercase">Total Outstanding</p>
                        <p className="text-2xl font-bold text-slate-900">{fmtFull(d.receivables.total)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 font-semibold uppercase">Overdue</p>
                        <p className={`text-lg font-bold ${d.receivables.overdueCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtFull(d.receivables.overdueTotal)}</p>
                      </div>
                   </div>
                   
                   <p className="text-xs font-semibold text-slate-600 mb-2">Aging Summary</p>
                   <div className="flex h-3 rounded-full overflow-hidden mb-2 bg-slate-100">
                     <div className="bg-emerald-400 w-1/2"></div>
                     <div className="bg-amber-400 w-1/4"></div>
                     <div className="bg-orange-500 w-[15%]"></div>
                     <div className="bg-red-500 w-[10%]"></div>
                   </div>
                   <div className="flex justify-between text-[10px] text-slate-500 font-medium font-mono mb-6">
                     <span>Current</span>
                     <span>1-30d</span>
                     <span>31-60d</span>
                     <span>60d+</span>
                   </div>

                   <p className="text-xs font-semibold text-slate-600 mb-3">Top Overdue</p>
                   <div className="space-y-3">
                     {d.receivables.overdue.slice(0, 3).map((r, i) => (
                       <div key={i} className="flex justify-between text-sm">
                         <span className="text-slate-700 font-medium truncate max-w-[150px]">{d.debtorName(r.debtor_id)}</span>
                         <span className="text-red-600 font-semibold">{fmtCompact(r.amount)}</span>
                       </div>
                     ))}
                     {d.receivables.overdueCount === 0 && <span className="text-sm text-slate-500">No overdue receivables!</span>}
                   </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                   <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center"><CreditCard className="h-4 w-4 mr-2 text-blue-600"/> Payables</h3>
                   <div className="flex justify-between items-end mb-6">
                      <div>
                        <p className="text-xs text-slate-500 font-semibold uppercase">Total Outstanding</p>
                        <p className="text-2xl font-bold text-slate-900">{fmtFull(d.payables.total)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 font-semibold uppercase">Overdue</p>
                        <p className={`text-lg font-bold ${d.payables.overdueCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtFull(d.payables.overdueTotal)}</p>
                      </div>
                   </div>
                   
                   <p className="text-xs font-semibold text-slate-600 mb-2">Aging Summary</p>
                   <div className="flex h-3 rounded-full overflow-hidden mb-2 bg-slate-100">
                     <div className="bg-emerald-400 w-[60%]"></div>
                     <div className="bg-amber-400 w-[30%]"></div>
                     <div className="bg-red-500 w-[10%]"></div>
                   </div>
                   <div className="flex justify-between text-[10px] text-slate-500 font-medium font-mono mb-6">
                     <span>Current</span>
                     <span>1-30d</span>
                     <span>31d+</span>
                   </div>

                   <p className="text-xs font-semibold text-slate-600 mb-3">Top Due</p>
                   <div className="space-y-3">
                     {d.payables.overdue.slice(0, 3).map((p, i) => (
                       <div key={i} className="flex justify-between text-sm">
                         <span className="text-slate-700 font-medium truncate max-w-[150px]">{d.supplierName(p.supplier_id)}</span>
                         <span className="text-amber-600 font-semibold">{fmtCompact(p.amount)}</span>
                       </div>
                     ))}
                      {d.payables.overdueCount === 0 && <span className="text-sm text-slate-500">No overdue payables!</span>}
                   </div>
                </div>
             </div>

             {/* 7. INVENTORY INTELLIGENCE */}
             <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h2 className="text-lg font-bold text-slate-800">Inventory Intelligence</h2>
                  <Link to="/app/forecast" className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center">View Intelligence <ChevronRight className="h-3 w-3 ml-1"/></Link>
                </div>
                <div className="p-6">
                   <div className="flex gap-8 mb-6">
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase mb-1">Value</p>
                       <p className="text-xl font-bold text-slate-900">₹18.4L</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase mb-1">Total SKUs</p>
                       <p className="text-xl font-bold text-slate-900">{d.inventory.total}</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase mb-1">Low Stock</p>
                       <p className="text-xl font-bold text-amber-600">{d.inventory.low}</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase mb-1">Out of Stock</p>
                       <p className="text-xl font-bold text-red-600">{d.inventory.out}</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 font-semibold uppercase mb-1">Turnover</p>
                       <p className="text-xl font-bold text-blue-600">4.8x</p>
                     </div>
                   </div>

                   <table className="w-full text-left border-collapse">
                     <thead>
                       <tr className="border-b border-slate-200 text-xs text-slate-500 font-semibold uppercase">
                         <th className="pb-2 font-semibold">SKU / Product</th>
                         <th className="pb-2 font-semibold text-right">Stock</th>
                         <th className="pb-2 font-semibold text-right">Reorder</th>
                         <th className="pb-2 font-semibold text-center">Status</th>
                         <th className="pb-2 font-semibold text-right">Action</th>
                       </tr>
                     </thead>
                     <tbody className="text-sm">
                       {d.inventory.alerts.slice(0, 4).map(a => (
                         <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                           <td className="py-3">
                             <div className="font-semibold text-slate-800">{a.sku}</div>
                             <div className="text-xs text-slate-500 truncate max-w-[200px]">{a.name}</div>
                           </td>
                           <td className="py-3 text-right font-mono font-medium">{a.stock}</td>
                           <td className="py-3 text-right font-mono text-slate-500">{a.reorderLevel ?? '-'}</td>
                           <td className="py-3 text-center">
                             <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                               a.severity === 'critical' ? 'bg-red-100 text-red-700' :
                               a.severity === 'attention' ? 'bg-amber-100 text-amber-700' :
                               'bg-blue-100 text-blue-700'
                             }`}>{a.status}</span>
                           </td>
                           <td className="py-3 text-right">
                             <button className="text-xs font-semibold text-blue-600 hover:text-blue-800">Reorder</button>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                </div>
             </div>

             {/* 8. PROCUREMENT & 9. OPERATIONS (Split half/half) */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                   <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center"><Package className="h-4 w-4 mr-2 text-blue-600"/> Procurement</h3>
                   <div className="grid grid-cols-2 gap-4 mb-5">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <div className="text-2xl font-bold text-slate-800">{d.procurement.count}</div>
                        <div className="text-[10px] text-slate-500 font-semibold uppercase mt-1">Open POs</div>
                      </div>
                      <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                        <div className="text-2xl font-bold text-red-700">{d.procurement.delayedGrn}</div>
                        <div className="text-[10px] text-red-600 font-semibold uppercase mt-1">Delayed POs</div>
                      </div>
                   </div>
                   <div className="space-y-3">
                      {d.procurement.pendingConfirmRows.map((p, i) => (
                        <div key={i} className="flex justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                          <div>
                            <span className="text-slate-800 font-semibold block">{p.doc_number ?? 'PO'}</span>
                            <span className="text-slate-500 text-xs">{d.supplierName(p.supplier_id)}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-amber-600 font-medium text-xs bg-amber-50 px-2 py-0.5 rounded">Awaiting</span>
                          </div>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                   <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center"><Box className="h-4 w-4 mr-2 text-blue-600"/> Operations Status</h3>
                   <div className="grid grid-cols-2 gap-4 mb-5">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <div className="text-2xl font-bold text-slate-800">{d.sales.dispatchReadyCount}</div>
                        <div className="text-[10px] text-slate-500 font-semibold uppercase mt-1">To Dispatch</div>
                      </div>
                      <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                        <div className="text-2xl font-bold text-emerald-700">72%</div>
                        <div className="text-[10px] text-emerald-600 font-semibold uppercase mt-1">Whs Capacity</div>
                      </div>
                   </div>
                   <div className="relative pt-2">
                     <div className="absolute left-[11px] top-4 bottom-2 w-[2px] bg-slate-200"></div>
                     <div className="space-y-4 relative">
                        <div className="flex items-center text-sm"><div className="w-6 h-6 rounded-full bg-blue-100 border-2 border-blue-500 flex items-center justify-center z-10 mr-3 text-[10px] font-bold text-blue-700">12</div> <span className="font-medium text-slate-700">Ready to Dispatch</span></div>
                        <div className="flex items-center text-sm"><div className="w-6 h-6 rounded-full bg-amber-100 border-2 border-amber-500 flex items-center justify-center z-10 mr-3 text-[10px] font-bold text-amber-700">7</div> <span className="font-medium text-slate-700">Awaiting Picking</span></div>
                        <div className="flex items-center text-sm"><div className="w-6 h-6 rounded-full bg-slate-100 border-2 border-slate-300 flex items-center justify-center z-10 mr-3 text-[10px] font-bold text-slate-500">4</div> <span className="font-medium text-slate-500">Awaiting Packing</span></div>
                     </div>
                   </div>
                </div>
             </div>

          </div>
          
          <div className="space-y-8">
             {/* 4. CASH FLOW COMMAND */}
             <div className="bg-blue-900 rounded-xl shadow-lg text-white overflow-hidden border border-blue-800">
                <div className="px-6 py-5 border-b border-blue-800 flex justify-between items-center">
                  <h2 className="text-lg font-bold flex items-center"><Wallet className="h-5 w-5 mr-2 opacity-80"/> Cash Flow Command</h2>
                </div>
                <div className="p-6">
                   <div className="mb-8">
                     <p className="text-blue-200 text-xs font-semibold uppercase tracking-wider mb-1">Current Cash Position</p>
                     <p className="text-4xl font-bold">{fmtFull(d.availableCash)}</p>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-4 mb-8">
                     <div className="bg-blue-800/50 p-4 rounded-lg">
                       <p className="text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1">Exp. Inflows</p>
                       <p className="text-xl font-bold">{fmtCompact(d.receivables.total)}</p>
                     </div>
                     <div className="bg-blue-800/50 p-4 rounded-lg">
                       <p className="text-red-300 text-xs font-semibold uppercase tracking-wider mb-1">Exp. Outflows</p>
                       <p className="text-xl font-bold">{fmtCompact(d.payables.total)}</p>
                     </div>
                   </div>

                   <div className="mb-4">
                     <p className="text-blue-200 text-xs font-semibold uppercase tracking-wider mb-3">30-Day Projection</p>
                     <div className="relative h-24 border-b border-l border-blue-700">
                        {/* Mock projection chart */}
                        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
                          <path d="M0,80 Q50,60 100,70 T200,40 T300,50" fill="none" stroke="#60a5fa" strokeWidth="3" />
                          <path d="M0,80 L0,100 L300,100 L300,50 Q200,40 100,70 Q50,60 0,80" fill="url(#gradient)" opacity="0.2" />
                          <defs>
                            <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#60a5fa" stopOpacity="1" />
                              <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                        </svg>
                        <div className="absolute bottom-[20%] left-0 right-0 border-t border-dashed border-red-400/50 flex items-center">
                          <span className="text-[9px] text-red-300 bg-blue-900 pr-1 -mt-2">Min Threshold: ₹7.5L</span>
                        </div>
                     </div>
                     <div className="flex justify-between text-[10px] text-blue-300 mt-2 font-mono">
                       <span>Today</span>
                       <span>+15d</span>
                       <span>+30d</span>
                     </div>
                   </div>

                   <Link to="/app/cash-flow" className="block w-full text-center py-3 bg-blue-800 hover:bg-blue-700 rounded-lg text-sm font-semibold transition-colors">
                     View Cash Forecast →
                   </Link>
                </div>
             </div>

             {/* 10. AI BUSINESS INSIGHTS */}
             <div className="bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                <div className="px-6 py-4 border-b border-slate-100 bg-indigo-50/30">
                  <h2 className="text-lg font-bold text-slate-800 flex items-center">
                    <AlertCircle className="h-4 w-4 mr-2 text-indigo-600"/> Command Insights
                  </h2>
                </div>
                <div className="p-0">
                  <div className="p-5 border-b border-slate-100 hover:bg-slate-50 transition-colors group cursor-pointer">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 px-2 py-0.5 rounded">High Priority</span>
                      <span className="text-xs font-bold text-slate-700">Receivables Risk</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                      <strong className="text-slate-800">{fmtFull(d.receivables.overdueTotal)}</strong> in receivables are overdue. 62% comes from 4 customers.
                    </p>
                    <Link to="/app/finance-invoices" className="text-xs font-semibold text-indigo-600 flex items-center opacity-80 group-hover:opacity-100">Review Receivables <ArrowRight className="h-3 w-3 ml-1"/></Link>
                  </div>
                  
                  <div className="p-5 border-b border-slate-100 hover:bg-slate-50 transition-colors group cursor-pointer">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Warning</span>
                      <span className="text-xs font-bold text-slate-700">Inventory Alert</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                      <strong className="text-slate-800">{d.inventory.out} SKUs</strong> are currently out of stock, affecting pending sales orders.
                    </p>
                    <Link to="/app/forecast" className="text-xs font-semibold text-indigo-600 flex items-center opacity-80 group-hover:opacity-100">View Inventory <ArrowRight className="h-3 w-3 ml-1"/></Link>
                  </div>

                  <div className="p-5 hover:bg-slate-50 transition-colors group cursor-pointer">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Insight</span>
                      <span className="text-xs font-bold text-slate-700">Cash Flow Healthy</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                      Cash remains above your ₹7.5L minimum threshold for the next 30 days based on projected commitments.
                    </p>
                  </div>
                </div>
             </div>

             {/* 11. ACTION CENTRE PREVIEW */}
             <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h2 className="text-lg font-bold text-slate-800 flex items-center">Requires Attention <span className="ml-2 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{d.attentionCount}</span></h2>
                </div>
                <div className="p-0">
                   {d.priorities.slice(0, 5).map((p, i) => (
                     <Link to={p.to} key={p.id} className="block p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <div className="flex justify-between items-start mb-1">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${p.overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {p.overdue ? 'HIGH' : 'MEDIUM'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">{p.area}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-800 mb-1 truncate">{p.item}</p>
                        <p className="text-xs text-slate-500 mb-2 truncate">{p.nextStep}</p>
                        <div className="text-[10px] text-slate-400 flex items-center">
                          <Users className="h-3 w-3 mr-1" /> {p.owner}
                        </div>
                     </Link>
                   ))}
                   <div className="p-4 bg-slate-50 text-center border-t border-slate-100">
                     <Link to="/app/tasks" className="text-sm font-semibold text-blue-600 hover:text-blue-800">Open Action Centre →</Link>
                   </div>
                </div>
             </div>
          </div>
        </div>

        {/* 12. CROSS-FUNCTIONAL PRIORITIES (Full width table) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
           <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
             <h2 className="text-lg font-bold text-slate-800">Cross-Functional Priorities</h2>
             <div className="flex gap-2">
                <button className="text-xs font-semibold px-3 py-1.5 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 flex items-center"><Search className="h-3 w-3 mr-1"/> Filter</button>
             </div>
           </div>
           <PriorityTable
              rows={d.priorities.filter(r => {
                if (r.area === "Sales" && !canSales) return false;
                if (r.area === "Procurement" && !canProcurement) return false;
                if (r.area === "Warehouse" && !canWarehouse) return false;
                if (r.area === "Finance" && !canFinance) return false;
                if (r.area === "Checker" && !canChecker) return false;
                return true;
              })}
              loading={d.prioritiesLoading}
              limit={7}
            />
        </div>
      </div>
    </div>
  );
}

// Subcomponents

function KpiBox({ title, value, trend, sub, to, trendUp, critical = false }: any) {
  return (
    <Link to={to} className={`block bg-white p-4 rounded-xl border ${critical ? 'border-red-200 shadow-[0_0_0_1px_rgba(239,68,68,0.1)]' : 'border-slate-200 shadow-sm'} hover:border-blue-300 hover:shadow-md transition-all group relative overflow-hidden`}>
      <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">{title}</h3>
      <div className="text-xl md:text-2xl font-bold text-slate-900 mb-2 truncate">{value}</div>
      <div className="flex items-center justify-between mt-auto">
        <span className={`text-xs font-semibold flex items-center ${trendUp ? 'text-emerald-600' : 'text-red-600'}`}>
           {trendUp && trend.includes('%') ? <TrendingUp className="h-3 w-3 mr-1"/> : null}
           {trend}
        </span>
      </div>
      <p className="text-[10px] text-slate-400 mt-1 truncate">{sub}</p>
    </Link>
  );
}

function FunnelStage({ title, count, val, color, last }: any) {
  const colors: Record<string, string> = {
    slate: "bg-slate-100 border-slate-200 text-slate-700",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800"
  };
  return (
    <div className="flex items-center">
      <div className={`flex flex-col items-center justify-center p-4 rounded-lg border w-32 ${colors[color]}`}>
        <span className="text-[10px] font-bold uppercase tracking-wider mb-2 opacity-80">{title}</span>
        <span className="text-xl font-bold mb-1">{count}</span>
        <span className="text-xs font-semibold opacity-75">{val}</span>
      </div>
      {!last && (
        <div className="w-8 flex items-center justify-center text-slate-300">
          <ArrowRight className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
