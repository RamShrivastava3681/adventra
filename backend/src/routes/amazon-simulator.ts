/**
 * Amazon Demo Simulator API. Every handler runs in the MARKETPLACE-DEMO tenant (see
 * services/amazon-demo-simulator.service.ts), so nothing here can read or change live data.
 */
import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { DemoIsolationError } from "../lib/demo-context.js";
import { PipelineError } from "../services/marketplace-fulfilment.service.js";
import { AmazonDemoSimulatorService as Sim, ERROR_KINDS, type ErrorKind } from "../services/amazon-demo-simulator.service.js";

const router = Router();

function actorOf(req: Request) {
  return { userId: req.user?.userId ?? null, email: req.user?.email ?? "demo-user" };
}

/** Wrap a handler: pipeline rule breaks → 4xx with the reason; anything else → 500. */
function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (err: any) {
      if (err instanceof PipelineError) return res.status(err.status).json({ error: err.message, code: err.code });
      if (err instanceof DemoIsolationError) return res.status(403).json({ error: err.message, code: "DemoIsolation" });
      res.status(500).json({ error: err?.message ?? "Demo simulator error" });
    }
  };
}

const base = "/amazon/simulator";

router.get(`${base}/state`, authMiddleware, handle((req) => Sim.getState(actorOf(req))));
router.post(`${base}/reset`, authMiddleware, handle((req) => Sim.resetDemoBaseline(actorOf(req))));
router.post(`${base}/journey/run`, authMiddleware, handle((req) => Sim.runFullDemoJourney(actorOf(req))));

router.post(`${base}/orders`, authMiddleware, handle((req) => Sim.addDemoAmazonOrder(req.body ?? {}, actorOf(req))));
router.post(`${base}/sku-mappings`, authMiddleware, handle((req) => Sim.addSkuMapping(req.body ?? {}, actorOf(req))));
router.post(`${base}/stock`, authMiddleware, handle((req) => Sim.addDemoStock(req.body ?? {}, actorOf(req))));

router.post(`${base}/orders/:orderNo/invoice`, authMiddleware, handle((req) => Sim.receiveInvoice(req.params.orderNo, actorOf(req))));
router.post(`${base}/orders/:orderNo/pack`, authMiddleware, handle((req) => Sim.markPacked(req.params.orderNo, actorOf(req))));
router.post(
  `${base}/orders/:orderNo/dispatch`,
  authMiddleware,
  handle((req) => Sim.confirmDemoDispatch(req.params.orderNo, actorOf(req), req.body ?? {})),
);
router.post(`${base}/orders/:orderNo/deliver`, authMiddleware, handle((req) => Sim.markDelivered(req.params.orderNo, actorOf(req))));

router.post(`${base}/returns`, authMiddleware, handle((req) => Sim.createDemoReturn(req.body ?? {}, actorOf(req))));
router.post(`${base}/returns/damaged`, authMiddleware, handle((req) => Sim.createDamagedReturn(req.body ?? {}, actorOf(req))));
router.post(
  `${base}/returns/:id/:action`,
  authMiddleware,
  handle((req) => Sim.returnAction(req.params.id, req.params.action, req.body ?? {}, actorOf(req))),
);

router.post(`${base}/refunds`, authMiddleware, handle((req) => Sim.simulateRefund(req.body ?? {}, actorOf(req))));
router.post(`${base}/settlements`, authMiddleware, handle((req) => Sim.simulateSettlement(req.body ?? {}, actorOf(req))));
router.post(
  `${base}/settlements/:id/bank-receipt`,
  authMiddleware,
  handle((req) => Sim.recordBankReceipt(req.params.id, req.body ?? {}, actorOf(req))),
);
router.post(`${base}/settlements/:id/reconcile`, authMiddleware, handle((req) => Sim.reconcileSettlement(req.params.id, actorOf(req))));

router.post(
  `${base}/errors`,
  authMiddleware,
  handle(async (req) => {
    const kind = String(req.body?.kind ?? "") as ErrorKind;
    if (!ERROR_KINDS.includes(kind)) throw new PipelineError(`kind must be one of ${ERROR_KINDS.join(", ")}`, "Validation");
    return Sim.simulateError(kind, actorOf(req));
  }),
);
router.post(
  `${base}/errors/:id/retry`,
  authMiddleware,
  handle((req) => Sim.retryFailedEvent(req.params.id, req.body ?? {}, actorOf(req))),
);

/** Simulated documents: invoice, packing slip and settlement report PDFs. */
router.get(`${base}/documents/:kind/:orderNo`, authMiddleware, async (req: Request, res: Response) => {
  const kind = req.params.kind;
  if (kind !== "invoice" && kind !== "packing-slip" && kind !== "settlement") {
    return res.status(400).json({ error: "kind must be invoice, packing-slip or settlement" });
  }
  try {
    const { filename, pdf } = await Sim.getDocument(kind, req.params.orderNo, actorOf(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
    res.send(pdf);
  } catch (err: any) {
    res.status(err instanceof PipelineError ? err.status : 500).json({ error: err?.message ?? "Document error" });
  }
});

export default router;
