import { v4 as uuid } from "uuid";
import * as db from "../dynamodb.js";

export interface Journal {
  pk: string; sk: string; gsi1pk: string; gsi1sk: string;
  entityType: "Journal";
  id: string; clientId: string;
  journalDate: string; reference: string | null; description: string | null;
  source: string; sourceId: string | null; status: string;
  createdBy: string | null;
  createdAt: string; updatedAt: string;
}

export interface JournalLine {
  pk: string; sk: string;
  entityType: "JournalLine";
  id: string; journalId: string;
  accountId: string; lineNo: number;
  debit: number; credit: number;
  taxRate: number; taxAmount: number;
  description: string | null;
}

export async function listJournals(clientId: string) {
  const { items } = await db.queryByGSI1(clientId, { entityType: "Journal", limit: 500, reverse: true });
  return items as Journal[];
}

export async function getJournal(id: string) { return db.getItem(`JOURNAL#${id}`) as Promise<Journal | null>; }

export async function createJournal(data: Partial<Journal> & { clientId: string }) {
  const id = uuid(); const now = db.nowISO();
  const item: Journal = {
    pk: `JOURNAL#${id}`, sk: `JOURNAL#${id}`,
    gsi1pk: `CLIENT#${data.clientId}`, gsi1sk: `Journal#${now}`,
    entityType: "Journal", id, clientId: data.clientId,
    journalDate: data.journalDate || db.todayDate(),
    reference: data.reference || null, description: data.description || null,
    source: data.source || "manual", sourceId: data.sourceId || null,
    status: data.status || "posted", createdBy: data.createdBy || null,
    createdAt: now, updatedAt: now,
  };
  await db.putItem(item);
  return item;
}

export async function updateJournal(id: string, updates: Partial<Journal>) {
  const patch: Record<string, any> = { updatedAt: db.nowISO() };
  const allowed = ["journalDate","reference","description","status"];
  for (const k of allowed) { if ((updates as any)[k] !== undefined) patch[k] = (updates as any)[k]; }
  return db.updateItem(`JOURNAL#${id}`, `JOURNAL#${id}`, patch);
}

export async function deleteJournal(id: string, source?: string) {
  if (source && source !== "manual") throw new Error("Can only delete manual journals");
  const lines = await getLinesByJournal(id);
  for (const line of lines) await db.deleteItem(line.pk, line.sk);
  return db.deleteItem(`JOURNAL#${id}`);
}

// Lines
export async function getLinesByJournal(journalId: string) {
  const allLines = await db.scanByType("JournalLine", { limit: 5000 });
  return allLines.filter((l: any) => l.journalId === journalId) as JournalLine[];
}

export async function createLines(lines: Partial<JournalLine>[]) {
  for (const data of lines) {
    if (!data.journalId || !data.accountId) continue;
    const id = uuid();
    const item: JournalLine = {
      pk: `JNL_LINE#${id}`, sk: `JNL_LINE#${id}`,
      entityType: "JournalLine", id,
      journalId: data.journalId, accountId: data.accountId,
      lineNo: data.lineNo || 1,
      debit: data.debit || 0, credit: data.credit || 0,
      taxRate: data.taxRate || 0, taxAmount: data.taxAmount || 0,
      description: data.description || null,
    };
    await db.putItem(item);
  }
}

export async function getAccountTransactions(accountId: string) {
  const allLines = await db.scanByType("JournalLine", { limit: 5000 });
  const lines = allLines.filter((l: any) => l.accountId === accountId) as JournalLine[];
  const journalIds = [...new Set(lines.map((l) => l.journalId))];
  const journals: Journal[] = [];
  for (const jid of journalIds) {
    const j = await getJournal(jid);
    if (j) journals.push(j);
  }
  return { lines, journals };
}
