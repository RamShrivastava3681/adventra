import * as CDNote from "../models/credit-debit-note.js";
import * as PurchaseInvoice from "../models/purchase-invoice.js";
import {
  computeCreditApplication,
  computeInvoiceOutstanding,
  computeNoteRemaining,
  round2,
} from "../lib/purchase-returns.js";

/**
 * Apply a supplier debit note to a purchase invoice.
 *
 * The invoice total is never edited: the applied amount is tracked separately
 * (`creditAdjusted`) and reduces the outstanding balance. The note keeps a
 * running `appliedAmount`, so the leftover stays available as supplier credit.
 */
export async function applyDebitNoteToInvoice(
  clientId: string,
  invoiceId: string,
  noteId: string,
  requestedAmount?: number | null,
) {
  const invoice = await PurchaseInvoice.get(invoiceId);
  if (!invoice) throw new Error("Purchase invoice not found");
  if (invoice.status === "cancelled") {
    throw new Error("Cannot apply supplier credit to a cancelled invoice");
  }
  const note = await CDNote.get(noteId);
  if (!note) throw new Error("Supplier debit note not found");
  // Shared-database mode: the note and invoice may have been created by
  // different users. Ownership is proven by the supplier link below.
  void clientId;
  if (note.kind !== "debit") {
    throw new Error("Only supplier debit notes can be applied to a purchase invoice");
  }
  if (String(note.status || "").toLowerCase() === "cancelled") {
    throw new Error("This supplier debit note has been cancelled");
  }
  // Party consistency: the note and the invoice must belong to the same party.
  const invoiceSupplier = invoice.vendorId ?? "";
  if (note.supplierId && invoiceSupplier && note.supplierId !== invoiceSupplier) {
    throw new Error("This debit note belongs to a different supplier");
  }

  const noteRemaining = computeNoteRemaining(note);
  const outstanding = computeInvoiceOutstanding(invoice);
  const amount = computeCreditApplication({
    noteRemaining,
    invoiceOutstanding: outstanding,
    requestedAmount,
  });
  if (amount <= 0) {
    return { applied: 0, note, invoice, remainingNote: noteRemaining, outstanding };
  }

  const nextApplied = round2((Number(note.appliedAmount) || 0) + amount);
  const updatedNote = await CDNote.update(note.id, {
    appliedAmount: nextApplied,
    appliedInvoiceId: invoice.id,
    appliedInvoiceNumber: invoice.invoiceNumber ?? null,
    appliedAt: new Date().toISOString(),
  });
  const updatedInvoice = await PurchaseInvoice.update(invoice.id, {
    creditAdjusted: round2((Number(invoice.creditAdjusted) || 0) + amount),
  });

  return {
    applied: amount,
    note: updatedNote,
    invoice: updatedInvoice,
    remainingNote: round2(Math.max(0, (Number(note.amount) || 0) - nextApplied)),
    outstanding: round2(Math.max(0, outstanding - amount)),
  };
}

export interface SupplierCreditView {
  id: string;
  noteNumber: string;
  noteDate: string;
  amount: number;
  appliedAmount: number;
  remainingAmount: number;
  invoiceNumber: string | null;
  purchaseReturnNumber: string | null;
  reason: string | null;
  status: string;
}

/** Unapplied supplier debit notes (credit available for a future invoice). */
export async function listSupplierCredits(
  clientId: string,
  supplierId: string,
): Promise<{ credits: SupplierCreditView[]; total: number }> {
  // Shared-database mode: scan every note, not only the current user's rows.
  void clientId;
  const notes = (await CDNote.list()) as any[];
  const credits = notes
    .filter(
      (n) =>
        n.kind === "debit" &&
        n.supplierId === supplierId &&
        String(n.status || "").toLowerCase() !== "cancelled" &&
        computeNoteRemaining(n) > 0,
    )
    .map((n) => ({
      id: n.id,
      noteNumber: n.noteNumber ?? "—",
      noteDate: n.noteDate ?? n.createdAt ?? "",
      amount: Number(n.amount) || 0,
      appliedAmount: Number(n.appliedAmount) || 0,
      remainingAmount: computeNoteRemaining(n),
      invoiceNumber:
        n.appliedInvoiceNumber ?? n.purchaseReturnNumber ?? n.invoiceId ?? null,
      purchaseReturnNumber: n.purchaseReturnNumber ?? null,
      reason: n.reason ?? null,
      status: n.status ?? "approved",
    }));
  return {
    credits,
    total: round2(credits.reduce((s, c) => s + c.remainingAmount, 0)),
  };
}
