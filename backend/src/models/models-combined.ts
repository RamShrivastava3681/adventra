import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

// ==================== Manual Balance Entry ====================
export interface ManualBalanceEntry {
  pk: string; sk: string; entityType: "ManualBalanceEntry";
  id: string; clientId: string;
  section: string; name: string;
  description: string | null; amount: number;
  entryDate: string; accountId: string | null;
  isOpeningBalance: boolean; notes: string | null;
  createdAt: string; updatedAt: string;
}

export async function listManualEntries(clientId: string) {
  const all = await db.scanByType("ManualBalanceEntry");
  return all.filter((e: any) => e.clientId === clientId) as ManualBalanceEntry[];
}

export async function getManualEntry(id: string) {
  return db.getItem(`BAL_ENTRY#${id}`) as Promise<ManualBalanceEntry | null>;
}

export async function createManualEntry(data: Partial<ManualBalanceEntry> & { clientId: string; section: string; name: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: ManualBalanceEntry = {
    pk: `BAL_ENTRY#${id}`, sk: `BAL_ENTRY#${id}`,
    entityType: "ManualBalanceEntry", id, clientId: data.clientId,
    section: data.section, name: data.name,
    description: data.description || null, amount: data.amount || 0,
    entryDate: data.entryDate || db.todayDate(),
    accountId: data.accountId || null, isOpeningBalance: data.isOpeningBalance || false,
    notes: data.notes || null, createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function updateManualEntry(id: string, updates: Partial<ManualBalanceEntry>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["section","name","description","amount","entryDate","accountId","isOpeningBalance","notes"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`BAL_ENTRY#${id}`, `BAL_ENTRY#${id}`, patch);
}

export async function deleteManualEntry(id: string) { return db.deleteItem(`BAL_ENTRY#${id}`); }

// ==================== Invoice Template ====================
export interface InvoiceTemplate {
  pk: string; sk: string; entityType: "InvoiceTemplate";
  id: string; clientId: string;
  companyName: string; companyAddress: string | null; companyEmail: string | null; companyPhone: string | null;
  taxId: string | null; logoUrl: string | null;
  primaryColor: string; accentColor: string;
  currency: string; currencySymbol: string; defaultTaxRate: number;
  bankDetails: string | null; terms: string | null; footerText: string | null;
  signatureLabel: string | null;
  createdAt: string; updatedAt: string;
}

export async function getTemplate(clientId: string) {
  const all = await db.scanByType("InvoiceTemplate");
  return all.find((t: any) => t.clientId === clientId) as InvoiceTemplate | null;
}

export async function upsertTemplate(data: Partial<InvoiceTemplate> & { clientId: string }) {
  const existing = await getTemplate(data.clientId);
  const now = db.nowISO();
  if (existing) {
    const patch: Record<string, any> = { updatedAt: now };
    const allowed = ["companyName","companyAddress","companyEmail","companyPhone","taxId","logoUrl","primaryColor","accentColor","currency","currencySymbol","defaultTaxRate","bankDetails","terms","footerText","signatureLabel"];
    for (const k of allowed) { if ((data as any)[k] !== undefined) patch[k] = (data as any)[k]; }
    return db.updateItem(existing.pk, existing.sk, patch);
  }
  const id = uuid();
  const item: InvoiceTemplate = {
    pk: `INV_TEMPLATE#${id}`, sk: `INV_TEMPLATE#${id}`,
    entityType: "InvoiceTemplate", id, clientId: data.clientId,
    companyName: data.companyName || "", companyAddress: data.companyAddress || null,
    companyEmail: data.companyEmail || null, companyPhone: data.companyPhone || null,
    taxId: data.taxId || null, logoUrl: data.logoUrl || null,
    primaryColor: data.primaryColor || "#0EA5E9", accentColor: data.accentColor || "#0F172A",
    currency: data.currency || "INR", currencySymbol: data.currencySymbol || "₹",
    defaultTaxRate: data.defaultTaxRate || 0,
    bankDetails: data.bankDetails || null, terms: data.terms || null,
    footerText: data.footerText || null, signatureLabel: data.signatureLabel || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

// ==================== Lead (CRM) ====================
export interface Lead {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Lead";
  id: string; clientId: string;
  name: string; company: string | null;
  email: string | null; phone: string | null;
  source: string; status: string;
  estimatedValue: number; assignedTo: string | null;
  notes: string | null;
  createdAt: string; updatedAt: string;
}

export async function listLeads(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Lead", limit: 500, reverse: true });
    return items as Lead[];
  }
  return db.scanByType("Lead") as Promise<Lead[]>;
}

export async function getLead(id: string) { return db.getItem(`LEAD#${id}`) as Promise<Lead | null>; }

export async function createLead(data: Partial<Lead> & { clientId: string; name: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: Lead = {
    pk: `LEAD#${id}`, sk: `LEAD#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Lead#${now}`,
    entityType: "Lead", id, clientId: data.clientId,
    name: data.name, company: data.company || null,
    email: data.email || null, phone: data.phone || null,
    source: data.source || "other", status: data.status || "new",
    estimatedValue: data.estimatedValue || 0,
    assignedTo: data.assignedTo || null, notes: data.notes || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function updateLead(id: string, updates: Partial<Lead>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["name","company","email","phone","source","status","estimatedValue","assignedTo","notes"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`LEAD#${id}`, `LEAD#${id}`, patch);
}

export async function deleteLead(id: string) { return db.deleteItem(`LEAD#${id}`); }

// ==================== Opportunity (CRM) ====================
export interface Opportunity {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Opportunity";
  id: string; clientId: string;
  leadId: string | null; name: string; accountName: string | null;
  stage: string; amount: number; probability: number;
  expectedCloseDate: string | null; assignedTo: string | null;
  productInterest: any[]; notes: string | null;
  wonAt: string | null; lostReason: string | null;
  createdAt: string; updatedAt: string;
}

export async function listOpportunities(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "Opportunity", limit: 500, reverse: true });
    return items as Opportunity[];
  }
  return db.scanByType("Opportunity") as Promise<Opportunity[]>;
}

export async function getOpportunity(id: string) { return db.getItem(`OPP#${id}`) as Promise<Opportunity | null>; }

export async function createOpportunity(data: Partial<Opportunity> & { clientId: string; name: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: Opportunity = {
    pk: `OPP#${id}`, sk: `OPP#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Opportunity#${now}`,
    entityType: "Opportunity", id, clientId: data.clientId,
    leadId: data.leadId || null, name: data.name,
    accountName: data.accountName || null, stage: data.stage || "prospecting",
    amount: data.amount || 0, probability: data.probability || 20,
    expectedCloseDate: data.expectedCloseDate || null,
    assignedTo: data.assignedTo || null,
    productInterest: data.productInterest || [],
    notes: data.notes || null, wonAt: null, lostReason: null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function updateOpportunity(id: string, updates: Partial<Opportunity>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["leadId","name","accountName","stage","amount","probability","expectedCloseDate","assignedTo","productInterest","notes","wonAt","lostReason"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`OPP#${id}`, `OPP#${id}`, patch);
}

export async function deleteOpportunity(id: string) { return db.deleteItem(`OPP#${id}`); }

// ==================== CRM Activity ====================
export interface CrmActivity {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "CrmActivity";
  id: string; clientId: string;
  leadId: string | null; opportunityId: string | null;
  activityType: string; subject: string;
  description: string | null; dueDate: string | null;
  completed: boolean; completedAt: string | null;
  assignedTo: string | null; createdBy: string | null;
  createdAt: string; updatedAt: string;
}

export async function listActivities(clientId?: string) {
  if (clientId) {
    const { items } = await db.queryByGSI1(clientId, { entityType: "CrmActivity", limit: 500, reverse: true });
    return items as CrmActivity[];
  }
  return db.scanByType("CrmActivity") as Promise<CrmActivity[]>;
}

export async function createActivity(data: Partial<CrmActivity> & { clientId: string; subject: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: CrmActivity = {
    pk: `CRM_ACT#${id}`, sk: `CRM_ACT#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `CrmActivity#${now}`,
    entityType: "CrmActivity", id, clientId: data.clientId,
    leadId: data.leadId || null, opportunityId: data.opportunityId || null,
    activityType: data.activityType || "note", subject: data.subject,
    description: data.description || null, dueDate: data.dueDate || null,
    completed: data.completed || false, completedAt: data.completedAt || null,
    assignedTo: data.assignedTo || null, createdBy: data.createdBy || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function updateActivity(id: string, updates: Partial<CrmActivity>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["leadId","opportunityId","activityType","subject","description","dueDate","completed","completedAt","assignedTo"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`CRM_ACT#${id}`, `CRM_ACT#${id}`, patch);
}

export async function deleteActivity(id: string) { return db.deleteItem(`CRM_ACT#${id}`); }
