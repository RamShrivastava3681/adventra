/** Live marketplace workflow adapter. Uses the authenticated client's tenant and shared Hub workflow. */
import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import * as Debtor from "../models/debtor.js";
import * as StockLocation from "../models/stock-location.js";
import * as P from "../services/marketplace-fulfilment.service.js";
import * as AmazonOrder from "../models/marketplace-amazon-order.js";
import * as AmazonReturn from "../models/marketplace-amazon-return.js";
import * as MarketplaceSettlement from "../models/marketplace-settlement.js";

const router = Router();
type Body = Record<string, any>;
function actor(req: Request): P.Actor { return { userId: req.user?.userId ?? null, email: req.user?.email ?? "marketplace-user" }; }
async function context(req: Request, body: Body): Promise<P.FulfilmentContext> {
  const clientId = req.user!.userId;
  const customerId = String(body.customerId || "").trim();
  if (!customerId) throw new P.PipelineError("customerId is required for the marketplace customer", "Validation");
  const customer = await Debtor.get(customerId);
  if (!customer || ((customer as any).clientId && (customer as any).clientId !== clientId)) throw new P.PipelineError("Marketplace customer was not found in this client account", "Forbidden", 403);
  const location = body.warehouseLocationId ? await StockLocation.get(String(body.warehouseLocationId)) : await StockLocation.getDefaultLocation(clientId);
  if (!location || location.clientId !== clientId || location.status !== "active") throw new P.PipelineError("An active warehouseLocationId is required", "Validation");
  const inspection = body.inspectionLocationId ? await StockLocation.get(String(body.inspectionLocationId)) : location;
  if (!inspection || inspection.clientId !== clientId || inspection.status !== "active") throw new P.PipelineError("inspectionLocationId must belong to this client account", "Validation");
  const channel = String(body.channel || "Amazon India").trim();
  return { clientId, channel, customerId: customer.id, customerName: customer.name, warehouseLocationId: location.id, warehouseName: location.name, inspectionLocationId: inspection.id, inspectionName: inspection.name, docPrefix: String(body.docPrefix || "MKT-"), auditPrefix: `marketplace_${channel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` };
}
function sendError(res: Response, err: any) { const status = err instanceof P.PipelineError ? err.status : 400; res.status(status).json({ success: false, error: err?.message || "Marketplace request failed", code: err?.code || "MarketplaceError" }); }

router.get("/amazon/live/state", authMiddleware, async (req, res) => {
  try { const clientId = req.user!.userId; const [orders, returns, settlements] = await Promise.all([AmazonOrder.list(clientId), AmazonReturn.list(clientId), MarketplaceSettlement.list(clientId)]); res.json({ success: true, mode: "live", orders, returns, settlements }); } catch (err) { sendError(res, err); }
});
router.post("/amazon/live/orders/import", authMiddleware, async (req, res) => {
  try { const b = req.body || {}; const order = await P.importOrder(await context(req, b), { amazonOrderId: b.amazonOrderId, orderDate: b.orderDate, amazonSku: b.amazonSku, internalSku: b.internalSku, productName: b.productName, colour: b.colour, size: b.size, quantity: b.quantity, sellingPrice: b.sellingPrice, discount: b.discount, taxRate: b.taxRate, deliveryAddress: b.deliveryAddress, expectedDispatchDate: b.expectedDispatchDate, fulfilmentType: b.fulfilmentType, shippingMethod: b.shippingMethod }, actor(req)); res.status(201).json({ success: true, order, sharedWorkflow: true }); } catch (err) { sendError(res, err); }
});
router.post("/amazon/live/orders/:orderNo/invoice", authMiddleware, async (req, res) => { try { const b = req.body || {}; const order = await P.recordChannelInvoice(await context(req, b), req.params.orderNo, { invoiceNumber: String(b.invoiceNumber || ""), invoiceDate: String(b.invoiceDate || ""), attachmentUrl: b.attachmentUrl || null }, actor(req)); res.json({ success: true, order, warehouseTaskCreated: Boolean(order.dispatchId) }); } catch (err) { sendError(res, err); } });
router.post("/amazon/live/orders/:orderNo/pack", authMiddleware, async (req, res) => { try { res.json({ success: true, order: await P.markPacked(await context(req, req.body || {}), req.params.orderNo, actor(req)) }); } catch (err) { sendError(res, err); } });
router.post("/amazon/live/orders/:orderNo/dispatch", authMiddleware, async (req, res) => { try { const b = req.body || {}; res.json({ success: true, order: await P.confirmDispatch(await context(req, b), req.params.orderNo, { courier: String(b.courier || ""), awbNumber: b.awbNumber || null }, actor(req)) }); } catch (err) { sendError(res, err); } });
router.post("/amazon/live/orders/:orderNo/deliver", authMiddleware, async (req, res) => { try { res.json({ success: true, order: await P.markDelivered(await context(req, req.body || {}), req.params.orderNo, actor(req)) }); } catch (err) { sendError(res, err); } });
router.post("/amazon/live/returns", authMiddleware, async (req, res) => { try { const b = req.body || {}; res.status(201).json({ success: true, return: await P.createReturn(await context(req, b), b.amazonOrderId, { quantity: b.quantity, reason: b.reason, amazonReturnId: b.amazonReturnId }, actor(req)) }); } catch (err) { sendError(res, err); } });
router.post("/amazon/live/settlements", authMiddleware, async (req, res) => { try { const b = req.body || {}; if (!b.amazonOrderId) throw new P.PipelineError("amazonOrderId is required for a settlement", "Validation"); res.status(201).json({ success: true, settlement: await P.createSettlement(await context(req, b), b.amazonOrderId, { commission: b.commission, shippingFee: b.shippingFee, otherDeductions: b.otherDeductions, settlementReference: b.settlementReference, expectedDate: b.expectedDate }, actor(req)) }); } catch (err) { sendError(res, err); } });
export default router;
