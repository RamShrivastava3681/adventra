import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RotateCcw, CheckCircle2, XCircle, FileText, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import { PageHeader, Card } from "@/components/ledger-ui";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/app/tally-connector")({
  component: TallyConnectorPage,
});

function inr(n: number | null | undefined) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function when(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

type Pushable = {
  id: string;
  number: string;
  name?: string | null;
  party: string | null;
  amount: number;
  status: string | null;
  alreadyPushed: boolean;
  date?: string | null;
};

const TAB_LABELS: Array<{ key: string; label: string; icon: any }> = [
  { key: "pair", label: "Pair Connector", icon: RotateCcw },
  { key: "sales-invoices", label: "Sales Invoices", icon: FileText },
  { key: "purchase-invoices", label: "Purchase Invoices", icon: FileText },
  { key: "products", label: "Inventory Items", icon: LinkIcon },
  { key: "sales-orders", label: "Sales Orders", icon: FileText },
  { key: "purchase-orders", label: "Purchase Orders", icon: FileText },
  { key: "credit-debit-notes", label: "Credit / Debit Notes", icon: FileText },
  { key: "debtors", label: "Customers", icon: LinkIcon },
  { key: "suppliers", label: "Suppliers", icon: LinkIcon },
];

export function TallyConnectorPage() {
  const [pairing, setPairing] = useState({
    pairingCode: "",
    deviceId: "",
    deviceName: "",
    companyName: "",
  });
  const [busy, setBusy] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ["tally-status"],
    queryFn: () => api.tally.status(),
    refetchInterval: 30_000,
  });

  const pushablesQ = useQuery({
    queryKey: ["tally-pushables"],
    queryFn: () => api.tally.pushables(),
    enabled: !!statusQ.data?.paired,
  });

  const paired = Boolean(statusQ.data?.paired);
  const connector = (statusQ.data as any)?.connector ?? null;
  const isLoading = statusQ.isLoading;
  const error = statusQ.error || pushablesQ.error;
  const pushables: Record<string, Pushable[]> = (pushablesQ.data as any)?.pushables ?? {};

  const pair = async () => {
    setBusy("pair");
    try {
      const r = await api.tally.pair(pairing);
      toast.success(r?.message ?? "Paired with Tally connector");
      setPairing({ pairingCode: "", deviceId: "", deviceName: "", companyName: "" });
    } catch (e: any) {
      toast.error(e?.message ?? "Pairing failed");
    } finally {
      setBusy(null);
    }
  };

  const unpair = async () => {
    setBusy("unpair");
    try {
      await api.tally.unpair();
      toast.success("Unpaired from Tally connector");
    } catch (e: any) {
      toast.error(e?.message ?? "Unpair failed");
    } finally {
      setBusy(null);
    }
  };

  const pushEntity = async (entityType: string, id: string) => {
    setBusy(`push-${entityType}-${id}`);
    try {
      await api.tally.push(entityType, id);
      toast.success(`Pushed to Tally`);
    } catch (e: any) {
      toast.error(e?.message ?? "Push to Tally failed");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Tally connector…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-sm text-rose-600">
        Could not load Tally connector: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        eyebrow="Integrations"
        title="Tally Connector"
        description="Pair your Tally desktop connector, then push sales/purchase invoices, inventory items, orders, credit-debit notes and party ledgers to Tally."
        icon={<RotateCcw className="h-5 w-5" />}
      />

      <Tabs defaultValue="pair" value="pair">
        <TabsList className="w-full">
          {TAB_LABELS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.icon && <t.icon className="mr-2 h-4 w-4" />}{t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Pair Connector tab */}
        <TabsContent value="pair" className="space-y-4">
          <section className="rounded-lg border bg-card p-4 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              {paired ? (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Paired
                </Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Not paired
                </Badge>
              )}
            </div>

            {!paired ? (
              <>
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label>Pairing code</Label>
                      <Input
                        value={pairing.pairingCode}
                        onChange={(e) => setPairing({ ...pairing, pairingCode: e.target.value })}
                        placeholder="e.g. WZ-TALLY-1234"
                      />
                    </div>
                    <div>
                      <Label>Device ID</Label>
                      <Input
                        value={pairing.deviceId}
                        onChange={(e) => setPairing({ ...pairing, deviceId: e.target.value })}
                        placeholder="Tally device ID"
                      />
                    </div>
                    <div>
                      <Label>Device name</Label>
                      <Input
                        value={pairing.deviceName}
                        onChange={(e) => setPairing({ ...pairing, deviceName: e.target.value })}
                        placeholder="My Tally Desktop"
                      />
                    </div>
                    <div>
                      <Label>Company name</Label>
                      <Input
                        value={pairing.companyName}
                        onChange={(e) => setPairing({ ...pairing, companyName: e.target.value })}
                        placeholder="Tally Company"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={pair}
                    disabled={
                      busy === "pair" ||
                      !pairing.pairingCode ||
                      !pairing.deviceId ||
                      !pairing.deviceName
                    }
                  >
                    {busy === "pair" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-4 w-4" />
                    )}
                    Pair with Tally Connector
                  </Button>
                </div>

                <div className="mt-4 p-3 rounded bg-amber-50/50 border border-amber-100 text-xs text-amber-800">
                  Get the pairing code and device ID from your Tally desktop connector app, then
                  enter them here to connect WhizUnik to Tally.
                </div>
              </>
            ) : (
              <>
                <Card title="Connected connector">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr>
                        <td className="w-1/3 text-muted-foreground">Connector ID</td>
                        <td className="font-mono">{connector?.connectorId}</td>
                      </tr>
                      <tr>
                        <td className="w-1/3 text-muted-foreground">Company</td>
                        <td>{connector?.companyName}</td>
                      </tr>
                      <tr>
                        <td className="w-1/3 text-muted-foreground">Device</td>
                        <td>{connector?.deviceName}</td>
                      </tr>
                      <tr>
                        <td className="w-1/3 text-muted-foreground">Paired at</td>
                        <td>{when(connector?.pairedAt)}</td>
                      </tr>
                    </tbody>
                  </table>
                </Card>
                <Button variant="outline" onClick={unpair} disabled={busy === "unpair"}>
                  {busy === "unpair" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-2 h-4 w-4" />
                  )}
                  Unpair
                </Button>
              </>
            )}
          </section>
        </TabsContent>

        {/* Entity push tabs */}
        {TAB_LABELS
          .filter((t) => t.key !== "pair")
          .map((tab) => {
            const items: Pushable[] = pushables[tab.key] ?? [];
            return (
              <TabsContent key={tab.key} value={tab.key} className="space-y-4">
                {!paired ? (
                  <section className="rounded-lg border bg-card p-4 md:p-6 text-center">
                    <XCircle className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                    <h3 className="text-sm font-medium">Pair a connector first</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Go to the "Pair Connector" tab and pair with your Tally desktop connector before
                      pushing {tab.label.toLowerCase()}.
                    </p>
                  </section>
                ) : (
                  <>
                    <section className="rounded-lg border bg-card p-4 md:p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="text-sm font-semibold">{tab.label}</h2>
                          <p className="text-xs text-muted-foreground">
                            Select items to push their voucher/ledger to Tally.
                          </p>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-20">#</TableHead>
                              <TableHead>Name / Number</TableHead>
                              <TableHead className="w-48">Party</TableHead>
                              <TableHead className="text-right w-24">Amount</TableHead>
                              <TableHead className="text-center w-20">Date</TableHead>
                              <TableHead className="text-center w-24">Status</TableHead>
                              <TableHead className="text-center w-24">Tally</TableHead>
                              <TableHead className="text-right w-44">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                                  No {tab.label.toLowerCase()} found.
                                </TableCell>
                              </TableRow>
                            ) : (
                              items.map((item) => (
                                <TableRow key={item.id} className="align-top">
                                  <TableCell className="font-mono font-medium">{item.number}</TableCell>
                                  <TableCell>
                                    <div className="font-medium">{item.name || item.number}</div>
                                    {item.party && (
                                      <div className="text-xs text-muted-foreground">{item.party}</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="w-48 text-right">{inr(item.amount)}</TableCell>
                                  <TableCell className="text-center text-xs">{when(item.date)}</TableCell>
                                  <TableCell className="text-center text-xs">
                                    <Badge variant="outline">{item.status || "—"}</Badge>
                                  </TableCell>
                                  <TableCell className="text-center text-xs">
                                    {item.alreadyPushed ? (
                                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                        Pushed
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                        Pending
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      onClick={() => pushEntity(tab.key, item.id)}
                                      disabled={
                                        item.alreadyPushed ||
                                        busy === `push-${tab.key}-${item.id}`
                                      }
                                    >
                                      {busy === `push-${tab.key}-${item.id}` ? (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      ) : (
                                        item.alreadyPushed ? (
                                          <CheckCircle2 className="mr-1 h-3 w-3" />
                                        ) : (
                                          <FileText className="mr-1 h-3 w-3" />
                                        )
                                      )}
                                      {item.alreadyPushed ? "Pushed" : "Push to Tally"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                  </>
                )}
              </TabsContent>
            );
          })}
      </Tabs>
    </div>
  );
}
