import { findByAmazonOrderId, updateStatus } from "../models/marketplace-amazon-order.js";
import { findByChannelSku } from "../models/marketplace-amazon-sku-mapping.js";
import { create as createShipment, update as updateShipment } from "../models/marketplace-amazon-shipment.js";
import * as db from "../dynamodb.js";

export class AmazonFulfilmentService {

  static async createWarehouseTask(data: {
    clientId: string;
    amazonOrderId: string;
    whizunikSalesOrderId: string;
    amazonSku: string;
    colour: string | null;
    size: string | null;
    quantity: number;
    warehouseLocation: string;
    packingRequirements: string;
    dispatchDeadline: string;
    fulfilmentType: "FBA" | "SellerFlex" | "MCF" | "Dropship" | "Vendor";
  }) {
    // Check prerequisites: SKU mapping, stock reservation, invoice
    const mapping = await findByChannelSku(data.clientId, data.amazonSku);
    if (!mapping) {
      throw new Error("SKU mapping not found for Amazon SKU: " + data.amazonSku);
    }

    // Check invoice status
    const order = await findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (!order) {
      throw new Error("Amazon order not found: " + data.amazonOrderId);
    }

    if (order.invoiceStatus !== "InvoiceReceived") {
      throw new Error("Invoice not received yet. Current status: " + order.invoiceStatus);
    }

    // Check stock availability
    const { items } = await db.queryByGSI1(data.clientId, {
      entityType: "MarketplaceAllocation",
      limit: 500,
    });
    const activeAllocations = (items as any[])
      .filter((a: any) => a.status === "active" && a.sku === mapping.whizunikSku);

    let totalReserved = 0;
    for (const alloc of activeAllocations) {
      totalReserved += Number(alloc.reservedQuantity) || 0;
    }

    if (totalReserved < data.quantity) {
      throw new Error(`Insufficient reserved stock. Required: ${data.quantity}, Reserved: ${totalReserved}`);
    }

    // Create warehouse task
    const task = await createShipment({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      quantity: data.quantity,
      warehouseLocation: data.warehouseLocation,
      packingRequirements: data.packingRequirements,
      dispatchDeadline: data.dispatchDeadline,
      fulfilmentType: data.fulfilmentType,
      deliveryStatus: "Pending",
    });

    // Update order status
    await updateStatus(data.amazonOrderId, "AwaitingWarehouseAction");

    return task;
  }

  static async updateDispatch(data: {
    shipmentId: string;
    awbNumber: string;
    trackingNumber: string;
    carrierName: string;
    dispatchDate: string;
  }) {
    return await updateShipment(data.shipmentId, {
      awbNumber: data.awbNumber,
      trackingNumber: data.trackingNumber,
      carrierName: data.carrierName,
      dispatchDate: data.dispatchDate,
      deliveryStatus: "Dispatched",
    });
  }
}
