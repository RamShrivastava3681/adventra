import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "@/lib/api-client";
import { fmtMoney, fmtDate } from "@/components/ledger-ui";
import { ShieldCheck, Check, X, MessageSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/noa/$token")({
  component: NoaPage,
});

function NoaPage() {
  const { token } = useParams({ from: "/noa/$token" });
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | "accept" | "reject" | "comment">(null);
  const [comments, setComments] = useState("");

  const noaQ = useQuery({
    queryKey: ["noa", token],
    queryFn: async () => {
      const data = await api.noa.get(token);
      return data.invoice ?? null;
    },
  });

  const respond = useMutation({
    mutationFn: async ({ decision, comments }: { decision: "accepted" | "rejected" | "commented"; comments: string | null }) => {
      await api.noa.respond(token, decision, comments ?? undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["noa", token] });
      toast.success("Response recorded");
      setMode(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (noaQ.isLoading) return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  const inv = noaQ.data;
  if (!inv) return <div className="grid min-h-screen place-items-center text-muted-foreground">This Notice of Assignment link is invalid or expired.</div>;

  const decided = ["accepted", "rejected", "commented"].includes(inv.noa_status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Notice of Assignment</div>
          <h1 className="font-display text-2xl">Invoice verification</h1>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-vault">
        <p className="text-sm text-muted-foreground">
          {inv.client_company || "Your supplier"} has assigned the following invoice to a factoring facility.
          Please digitally verify the invoice details and confirm that payment, when due, will be remitted to the assignee.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Debtor</dt><dd>{inv.debtor_name}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Contact</dt><dd>{inv.debtor_contact_name || "—"}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Invoice #</dt><dd className="font-mono">{inv.invoice_number}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Amount</dt><dd className="num">{fmtMoney(Number(inv.amount))}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Issue date</dt><dd>{fmtDate(inv.issue_date)}</dd></div>
          <div><dt className="text-xs uppercase tracking-widest text-muted-foreground">Due date</dt><dd>{fmtDate(inv.due_date)}</dd></div>
        </dl>

        <div className="mt-6 border-t border-border pt-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Current status</div>
          <div className="mt-1 text-lg capitalize">{inv.noa_status.replace("_", " ")}</div>
          {inv.noa_comments && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Comments</div>
              {inv.noa_comments}
            </div>
          )}
        </div>

        {!decided && !mode && (
          <div className="mt-6 grid gap-2 md:grid-cols-3">
            <button onClick={() => setMode("accept")} className="inline-flex items-center justify-center gap-2 rounded-md border border-success/50 px-3 py-2 text-sm text-success hover:bg-success/10"><Check className="h-4 w-4" /> Accept</button>
            <button onClick={() => setMode("reject")} className="inline-flex items-center justify-center gap-2 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"><X className="h-4 w-4" /> Reject</button>
            <button onClick={() => setMode("comment")} className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"><MessageSquare className="h-4 w-4" /> Reply with comments</button>
          </div>
        )}

        {!decided && mode && (
          <div className="mt-6 space-y-3">
            {(mode === "reject" || mode === "comment") && (
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                required
                placeholder={mode === "reject" ? "Reason for rejection…" : "Your comments…"}
                className="w-full rounded-md border border-border bg-background p-3 text-sm"
              />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setMode(null); setComments(""); }} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
              <button
                disabled={respond.isPending || ((mode === "reject" || mode === "comment") && !comments.trim())}
                onClick={() => respond.mutate({
                  decision: mode === "accept" ? "accepted" : mode === "reject" ? "rejected" : "commented",
                  comments: mode === "accept" ? null : comments.trim(),
                })}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {respond.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm {mode === "accept" ? "acceptance" : mode === "reject" ? "rejection" : "comments"}
              </button>
            </div>
          </div>
        )}

        {decided && (
          <div className="mt-6 rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            Thank you — your response has been recorded and shared with the factor.
          </div>
        )}
      </div>
    </div>
  );
}
