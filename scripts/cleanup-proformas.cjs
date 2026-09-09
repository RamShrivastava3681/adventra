const fs = require("fs");
const p = "src/routes/app.proformas.tsx";
let s = fs.readFileSync(p, "utf8");

// Brace-matching function cutter (quotes are rare at top level in these modals;
// count braces only, which is safe for balanced JSX blocks).
function cutFn(src, name) {
  const marker = "function " + name;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(name + " not found");
  let i = src.indexOf("{", start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(name + " end not found");
  while (end < src.length && (src[end] === "\n" || src[end] === "\r")) {
    const nx = src[end + 1];
    end++;
    if (nx !== "\n" && nx !== "\r") break;
  }
  return src.slice(0, start).trimEnd() + "\n" + src.slice(end).replace(/^\n+/, "\n");
}

s = cutFn(s, "FundModal");
s = cutFn(s, "ConvertModal");

const drop = [
  "  // Sales proforma \u2192 auto-create a DRAFT sales order and link it.\n  const convertSo = useMutation({\n    mutationFn: async (id: string) => api.purchaseOrders.convertToSO(id),\n    onSuccess: (res) => {\n      qc.invalidateQueries({ queryKey: [\"proformas\"] });\n      qc.invalidateQueries({ queryKey: [\"sales-orders\"] });\n      toast.success(`Draft sales order ${(res as any)?.salesOrder?.soNumber ?? \"\"} created`);\n    },\n    onError: (e) => toast.error(e instanceof Error ? e.message : \"Failed\"),\n  });\n\n",
  "  const del = useMutation({\n    mutationFn: async (id: string) => {\n      await api.purchaseOrders.delete(id);\n    },\n    onSuccess: () => {\n      qc.invalidateQueries({ queryKey: [\"proformas\"] });\n      toast.success(\"Removed\");\n    },\n    onError: (e) => toast.error(e instanceof Error ? e.message : \"Failed\"),\n  });\n\n",
  "  // After a checker rejection the maker can fix the proforma and send it back\n  // into the approval pipeline (backend allows pending_review from rejected).\n  const resubmit = useMutation({\n    mutationFn: async (id: string) => {\n      await api.purchaseOrders.update(id, { proforma_status: \"pending_review\" });\n    },\n    onSuccess: () => {\n      qc.invalidateQueries({ queryKey: [\"proformas\"] });\n      toast.success(\"Submitted for checker approval again\");\n    },\n    onError: (e) => toast.error(e instanceof Error ? e.message : \"Failed\"),\n  });\n\n",
  "  const setDocStatus = useMutation({\n    mutationFn: async ({ id, status }: { id: string; status: string }) => {\n      await api.purchaseOrders.update(id, { status });\n    },\n    onSuccess: () => {\n      qc.invalidateQueries({ queryKey: [\"proformas\"] });\n      toast.success(\"Status updated\");\n    },\n    onError: (e) => toast.error(e instanceof Error ? e.message : \"Failed\"),\n  });\n\n",
  "  const [convertFor, setConvertFor] = useState<PF | null>(null);\n",
  "  const [fundFor, setFundFor] = useState<PF | null>(null);\n",
  "  // Goods POs available to link when converting a proforma.\n  const goodsPosQ = useQuery({\n    queryKey: [\"goods-pos-for-convert\"],\n    queryFn: async () => api.goodsPurchaseOrders.list(),\n    enabled: !!convertFor,\n  });\n\n",
  "      {convertFor && (\n        <ConvertModal\n          pf={convertFor}\n          goodsPos={goodsPosQ.data ?? []}\n          loading={goodsPosQ.isLoading}\n          onClose={() => setConvertFor(null)}\n          onConverted={() => {\n            qc.invalidateQueries({ queryKey: [\"proformas\"] });\n            setConvertFor(null);\n          }}\n        />\n      )}\n",
  "      {fundFor && user && (\n        <FundModal pf={fundFor} userId={user.id} onClose={() => setFundFor(null)} />\n      )}\n"
];

for (const block of drop) {
  if (!s.includes(block)) {
    console.error("WARN not found: " + block.slice(0, 70).replace(/\n/g, "\\n"));
    continue;
  }
  s = s.replace(block, "");
}

fs.writeFileSync(p, s);
console.log("cleanup done");
