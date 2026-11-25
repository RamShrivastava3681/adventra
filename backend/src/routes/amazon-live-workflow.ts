/**
 * Live marketplace workflow routes. Uses the authenticated client's tenant and shared Hub workflow.
 */
import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { PipelineError } from "../services/marketplace-fulfilment.service.js";
import { AmazonLiveWorkflowService as Live } from "../services/amazon-live-workflow.service.js";

const router = Router();

function actorOf(req: Request) {
  return { userId: req.user?.userId ?? null, email: req.user?.email ?? "marketplace-user" };
}

function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (err: any) {
      if (err instanceof PipelineError) return res.status(err.status).json({ error: err.message, code: err.code });
      res.status(500).json({ error: err?.message ?? "Live marketplace workflow error" });
    }
  };
}

const base = "/amazon/live";

router.get(`${base}/state`, authMiddleware, handle((req) => Live.getState(actorOf(req), req.user!.userId)));
router.post(`${base}/orders`, authMiddleware, handle((req) => Live.createOrder(req.body ?? {}, actorOf(req), req.user!.userId)));
router.post(`${base}/orders/import`, authMiddleware, handle((req) => Live.createOrder(req.body ?? {}, actorOf(req), req.user!.userId)));
router.post(`${base}/sku-mappings`, authMiddleware, handle((req) => Live.addSkuMapping(req.body ?? {}, actorOf(req), req.user!.userId)));
router.post(`${base}/stock`, authMiddleware, handle((req) => Live.addStock(req.body ?? {}, actorOf(req), req.user!.userId)));

router.post(`${base}/orders/:orderNo/invoice`, authMiddleware, handle((req) => Live.receiveInvoice(req.params.orderNo, actorOf(req), req.user!.userId)));
router.post(`${base}/orders/:orderNo/pack`, authMiddleware, handle((req) => Live.markPacked(req.params.orderNo, actorOf(req), req.user!.userId)));
router.post(
  `${base}/orders/:orderNo/dispatch`,
  authMiddleware,
  handle((req) => Live.confirmDispatch(req.params.orderNo, actorOf(req), req.user!.userId, req.body ?? {})),
);
router.post(`${base}/orders/:orderNo/deliver`, authMiddleware, handle((req) => Live.markDelivered(req.params.orderNo, actorOf(req), req.user!.userId)));

router.post(`${base}/returns`, authMiddleware, handle((req) => Live.createReturn(req.body ?? {}, actorOf(req), req.user!.userId)));
router.post(`${base}/returns/damaged`, authMiddleware, handle((req) => Live.createDamagedReturn(req.body ?? {}, actorOf(req), req.user!.userId)));
router.post(
  `${base}/returns/:id/:action`,
  authMiddleware,
  handle((req) => Live.returnAction(req.params.id, req.params.action, req.body ?? {}, actorOf(req), req.user!.userId)),
);

router.post(`${base}/refunds`, authMiddleware, handle((req) => Live.simulateRefund(req.body ?? {}, actorOf(req), req.user!.userId)));
router.post(`${base}/settlements`, authMiddleware, handle((req) => Live.simulateSettlement(req.body ?? {}, actorOf(req), req.user!.userId)));
router.post(
  `${base}/settlements/:id/bank-receipt`,
  authMiddleware,
  handle((req) => Live.recordBankReceipt(req.params.id, req.body ?? {}, actorOf(req), req.user!.userId)),
);
router.post(`${base}/settlements/:id/reconcile`, authMiddleware, handle((req) => Live.reconcileSettlement(req.params.id, actorOf(req), req.user!.userId)));

router.post(
  `${base}/errors/:id/retry`,
  authMiddleware,
  handle((req) => Live.retryFailedEvent(req.params.id, req.body ?? {}, actorOf(req), req.user!.userId)),
);

/** Document PDFs for live orders */
router.get(`${base}/documents/:kind/:orderNo`, authMiddleware, async (req: Request, res: Response) => {
  const kind = req.params.kind;
  if (kind !== "invoice" && kind !== "packing-slip" && kind !== "settlement") {
    return res.status(400).json({ error: "kind must be invoice, packing-slip or settlement" });
  }
  try {
    const { filename, pdf } = await Live.getDocument(kind, req.params.orderNo, actorOf(req), req.user!.userId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(err instanceof PipelineError ? err.status : 500).json({ error: err?.message ?? "Document error" });
  }
});

export default router;
