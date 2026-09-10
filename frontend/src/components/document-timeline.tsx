import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare,
  Paperclip,
  AtSign,
  CalendarClock,
  ShieldAlert,
  History,
  Send,
  Loader2,
  Download,
  ArrowLeftRight,
  Bot,
} from "lucide-react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { fmtDate } from "@/components/ledger-ui";

/**
 * DocumentTimelinePanel (PDF-3 §2) — one visible activity timeline per
 * document. Users add notes, attachments, rejection reasons, UTR proofs,
 * mentions and revised dates; automatic system entries (assignments,
 * status changes, emails) appear in the same view. Earlier updates are
 * never lost when the task moves to the next team.
 */

export type TimelineKind =
  | "note"
  | "attachment"
  | "rejection"
  | "payment_proof"
  | "delivery_note"
  | "supplier_invoice"
  | "mention"
  | "revised_date"
  | "status_change"
  | "assignment"
  | "system";

const KIND_META: Record<string, { label: string; cls: string }> = {
  note: { label: "Note", cls: "bg-muted/60 text-muted-foreground border-border" },
  attachment: { label: "Attachment", cls: "bg-sem-info/10 text-sem-info border-sem-info/30" },
  rejection: { label: "Rejected", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  payment_proof: { label: "Payment proof", cls: "bg-sem-success/10 text-sem-success border-sem-success/30" },
  delivery_note: { label: "Delivery note", cls: "bg-sem-info/10 text-sem-info border-sem-info/30" },
  supplier_invoice: { label: "Supplier invoice", cls: "bg-sem-info/10 text-sem-info border-sem-info/30" },
  mention: { label: "Mention", cls: "bg-primary/10 text-primary border-primary/30" },
  revised_date: { label: "Revised date", cls: "bg-sem-attention/10 text-sem-attention border-sem-attention/30" },
  status_change: { label: "Status", cls: "bg-muted/60 text-muted-foreground border-border" },
  assignment: { label: "Assigned", cls: "bg-primary/10 text-primary border-primary/30" },
  system: { label: "System", cls: "bg-muted/60 text-muted-foreground border-border" },
};

const QUICK_KINDS: Array<{ kind: TimelineKind; label: string }> = [
  { kind: "note", label: "Update" },
  { kind: "rejection", label: "Rejection reason" },
  { kind: "payment_proof", label: "UTR / payment proof" },
  { kind: "delivery_note", label: "Delivery note" },
  { kind: "supplier_invoice", label: "Supplier invoice" },
  { kind: "revised_date", label: "Revised expected date" },
];

const API_URL = import.meta.env.VITE_API_URL || "/api";

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${fmtDate(iso)} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function DocumentTimelinePanel({
  docType,
  docId,
  docNumber,
  colleagues,
}: {
  docType: string;
  docId: string;
  docNumber?: string | null;
  /** Emails of team members for @mentions. */
  colleagues?: Array<{ id?: string; email?: string }>;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<TimelineKind>("note");
  const [mentionedUser, setMentionedUser] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["timeline", docType, docId],
    queryFn: () => api.timeline.list(docType, docId),
    enabled: !!docType && !!docId,
  });

  const add = useMutation({
    mutationFn: () =>
      api.timeline.add(docType, docId, {
        text: text.trim() || undefined,
        kind,
        mentionedUser: mentionedUser || undefined,
        docNumber: docNumber ?? undefined,
      }),
    onSuccess: () => {
      setText("");
      setMentionedUser("");
      setKind("note");
      qc.invalidateQueries({ queryKey: ["timeline", docType, docId] });
      toast.success("Update added to the timeline");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add update"),
  });

  const openAttachment = async (path: string) => {
    try {
      const res = await fetch(`${API_URL}/upload/${encodeURIComponent(path)}/url`, {
        credentials: "include",
      });
      const data = await res.json();
      window.open(data.url ?? data.signedUrl, "_blank", "noopener");
    } catch {
      toast.error("Could not open the attachment");
    }
  };

  const entries = q.data?.entries ?? [];
  const notifications = q.data?.notifications ?? [];
  const kindOptions = QUICK_KINDS;

  const submit = () => {
    if (busy) return;
    if (!text.trim()) {
      toast.error("Write an update first");
      return;
    }
    setBusy(true);
    add.mutate(undefined, { onSettled: () => setBusy(false) });
  };

  return (
    <div className="rounded-lg border border-border/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Activity timeline</h4>
        {notifications.length > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            {notifications.length} email{notifications.length === 1 ? "" : "s"} sent
          </span>
        )}
      </div>

      {/* Composer */}
      <div className="mb-4 space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an update for the next team — what changed and why…"
          rows={2}
          className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-xs outline-none focus:border-primary"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TimelineKind)}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs"
          >
            {kindOptions.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>            {(colleagues?.filter((c) => c.email && c.email !== user?.email).length ?? 0) > 0 && (
            <select
              value={mentionedUser}
              onChange={(e) => setMentionedUser(e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              <option value="">Mention someone…</option>
              {colleagues
                ?.filter((c) => c.email && c.email !== user?.email)
                .map((c) => (
                  <option key={c.email} value={c.email}>
                    @{c.email}
                  </option>
                ))}
            </select>
          )}
          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Add update
          </button>
        </div>
      </div>

      {/* Entries */}
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading timeline…
        </div>
      ) : entries.length === 0 ? (
        <div className="py-4 text-xs text-muted-foreground">
          No updates yet — the first note, attachment or status change will appear here.
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((e: any) => {
            const meta = KIND_META[e.kind] ?? KIND_META.note;
            const isSystem = ["system", "status_change", "assignment"].includes(e.kind);
            return (
              <li key={e.id} className="flex gap-2.5">
                <div className="mt-0.5 shrink-0">
                  {isSystem ? (
                    e.kind === "assignment" ? (
                      <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                    )
                  ) : e.kind === "mention" ? (
                    <AtSign className="h-3.5 w-3.5 text-primary" />
                  ) : e.kind === "attachment" ? (
                    <Paperclip className="h-3.5 w-3.5 text-sem-info" />
                  ) : e.kind === "rejection" ? (
                    <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                  ) : e.kind === "revised_date" ? (
                    <CalendarClock className="h-3.5 w-3.5 text-sem-attention" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1 rounded-md border border-border/40 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    <span className="font-medium normal-case tracking-normal text-foreground">
                      {e.actor_email ?? "System"}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 ${meta.cls}`}>{meta.label}</span>
                    {e.prev_status && e.new_status && (
                      <span className="normal-case tracking-normal">
                        {String(e.prev_status)} → {String(e.new_status)}
                      </span>
                    )}
                    {e.mentioned_user && (
                      <span className="normal-case tracking-normal text-primary">@{e.mentioned_user}</span>
                    )}
                    <span className="ml-auto normal-case tracking-normal">{fmtDateTime(e.created_at)}</span>
                  </div>
                  {e.text && <p className="mt-1 whitespace-pre-wrap text-xs">{e.text}</p>}
                  {e.attachment?.name && (
                    <button
                      onClick={() => openAttachment(e.attachment.url)}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Download className="h-3 w-3" /> {e.attachment.name}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
