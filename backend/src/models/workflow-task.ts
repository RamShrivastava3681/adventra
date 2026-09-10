import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

/**
 * WorkflowTask — the unified queue engine (PDF-3 §1, §5, §10).
 * Every handoff creates exactly one open task per (docType + docId + stage);
 * completing it closes the task and the route layer opens the next one.
 */

export type WorkflowType =
  | "sales_order"
  | "purchase_order"
  | "purchase_invoice"
  | "sales_invoice"
  | "proforma"
  | "payment"
  | "grn"
  | "dispatch";

export type TaskStatus = "open" | "done" | "cancelled";

export interface WorkflowTask {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "WorkflowTask";
  id: string;
  clientId: string;
  workflowType: WorkflowType;
  /** Stage key, e.g. "stock_check", "checker_approval", "client_acceptance",
   *  "create_proforma", "create_invoice", "payment_confirmation",
   *  "record_irn", "prepare_dispatch", "generate_ewb", "confirm_dispatch",
   *  "send_to_supplier", "record_supplier_invoice", "treasury_payment",
   *  "await_goods", "create_grn". Unique with docType+docId while open. */
  stage: string;
  docType: string;
  docId: string;
  docNumber: string | null;
  counterparty: string | null;
  docStatus: string | null;
  ownerRole: string;
  assignedUser: string | null;
  prevOwner: string | null;
  requiredAction: string;
  nextAction: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  dueDate: string | null;
  amount: number | null;
  paymentStatus: string | null;
  inventoryStatus: string | null;
  linkedDocs: Array<{ type: string; id: string; number: string | null }>;
  latestUpdate: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  completedBy: string | null;
}

export interface OpenTaskInput {
  clientId: string;
  workflowType: WorkflowType;
  stage: string;
  docType: string;
  docId: string;
  docNumber?: string | null;
  counterparty?: string | null;
  docStatus?: string | null;
  ownerRole: string;
  assignedUser?: string | null;
  requiredAction: string;
  nextAction?: string | null;
  priority?: WorkflowTask["priority"];
  dueDate?: string | null;
  amount?: number | null;
  paymentStatus?: string | null;
  inventoryStatus?: string | null;
  linkedDocs?: WorkflowTask["linkedDocs"];
  latestUpdate?: string | null;
}

function taskKey(id: string) {
  return { pk: `WTASK#${id}`, sk: `WTASK#${id}` };
}

/** Idempotency reference: DocType + DocID + Stage (PDF-3 §10). */
export function taskRef(docType: string, docId: string, stage: string): string {
  return `${docType}#${docId}#${stage}`;
}

export async function listOpen(clientId?: string): Promise<WorkflowTask[]> {
  const items = clientId
    ? (await db.queryByGSI1(clientId, { entityType: "WorkflowTask", limit: 500 })).items
    : await db.scanByType("WorkflowTask", { limit: 2000 });
  return (items as WorkflowTask[]).filter((t) => t.status === "open");
}

export async function listForDoc(docType: string, docId: string): Promise<WorkflowTask[]> {
  const items = await db.scanByType("WorkflowTask", { limit: 2000 });
  return (items as WorkflowTask[]).filter((t) => t.docType === docType && t.docId === docId);
}

/**
 * Open the next task for a document. Closes any other open task for the same
 * document first (exactly one open task per document), and returns the
 * existing open task untouched when the same stage is already open
 * (prevents duplicate tasks / duplicate emails).
 */
export async function openTask(input: OpenTaskInput, actor?: { userId?: string | null; email?: string | null }): Promise<{ task: WorkflowTask; created: boolean }> {
  const now = db.nowISO();
  const siblings = await listForDoc(input.docType, input.docId);
  const same = siblings.find((t) => t.status === "open" && t.stage === input.stage);
  if (same) return { task: same, created: false };
  for (const t of siblings.filter((x) => x.status === "open")) {
    const { pk, sk } = taskKey(t.id);
    await db.updateItem(pk, sk, {
      status: "done",
      completedAt: now,
      completedBy: actor?.email ?? actor?.userId ?? "system",
      latestUpdate: `Advanced to ${input.stage}`,
      updatedAt: now,
    });
  }
  const id = uuid();
  const { pk, sk } = taskKey(id);
  const item: WorkflowTask = {
    pk,
    sk,
    gsi1pk: `CLIENT#${input.clientId}`,
    gsi1sk: `WorkflowTask#${now}`,
    entityType: "WorkflowTask",
    id,
    clientId: input.clientId,
    workflowType: input.workflowType,
    stage: input.stage,
    docType: input.docType,
    docId: input.docId,
    docNumber: input.docNumber ?? null,
    counterparty: input.counterparty ?? null,
    docStatus: input.docStatus ?? null,
    ownerRole: input.ownerRole,
    assignedUser: input.assignedUser ?? null,
    prevOwner: siblings[0]?.ownerRole ?? null,
    requiredAction: input.requiredAction,
    nextAction: input.nextAction ?? null,
    priority: input.priority ?? "normal",
    dueDate: input.dueDate ?? null,
    amount: input.amount ?? null,
    paymentStatus: input.paymentStatus ?? null,
    inventoryStatus: input.inventoryStatus ?? null,
    linkedDocs: input.linkedDocs ?? [],
    latestUpdate: input.latestUpdate ?? null,
    status: "open",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    completedBy: null,
  };
  await db.putItem(item);
  return { task: item, created: true };
}

export async function closeTasksForDoc(
  docType: string,
  docId: string,
  actor?: { userId?: string | null; email?: string | null },
  note?: string,
): Promise<void> {
  const now = db.nowISO();
  const tasks = await listForDoc(docType, docId);
  for (const t of tasks.filter((x) => x.status === "open")) {
    const { pk, sk } = taskKey(t.id);
    await db.updateItem(pk, sk, {
      status: "done",
      completedAt: now,
      completedBy: actor?.email ?? actor?.userId ?? "system",
      latestUpdate: note ?? "Completed",
      updatedAt: now,
    });
  }
}

export async function touchTask(
  id: string,
  patch: Partial<Pick<WorkflowTask, "latestUpdate" | "docStatus" | "paymentStatus" | "inventoryStatus" | "dueDate" | "priority" | "assignedUser">>,
): Promise<void> {
  const { pk, sk } = taskKey(id);
  await db.updateItem(pk, sk, { ...patch, updatedAt: db.nowISO() });
}

export function isOverdue(t: Pick<WorkflowTask, "dueDate" | "status">, today = db.todayDate()): boolean {
  return t.status === "open" && !!t.dueDate && t.dueDate < today;
}
