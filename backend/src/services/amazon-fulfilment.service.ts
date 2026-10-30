import { MarketplaceAmazonShipment, MarketplaceAmazonShipmentModel } from "../models/marketplace-amazon-shipment.js";
import { MarketplaceAmazonOrder, MarketplaceAmazonOrderModel } from "../models/marketplace-amazon-order.js";
import { MarketplaceAmazonSkuMapping, MarketplaceAmazonSkuMappingModel } from "../models/marketplace-amazon-sku-mapping.js";
import * as db from "../dynamodb.js";
import { MarketplaceAllocation } from "../models/marketplace-allocation.js";

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
    fulfilmentType: string;
  }) {
    // Check prerequisites: SKU mapping, stock reservation, invoice
    const mapping = await MarketplaceAmazonSkuMappingModel.findByChannelSku(data.clientId, data.amazonSku);
    if (!mapping) {
      throw new Error("SKU mapping not found for Amazon SKU: " + data.amazonSku);
    }

    // Check invoice status
    const order = await MarketplaceAmazonOrderModel.findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (!order) {
      throw new Error("Amazon order not found: " + data.amazonOrderId);
    }

    if (order.invoiceStatus !== "InvoiceReceived") {
      throw new Error("Invoice not received yet. Current status: " + order.invoiceStatus);
    }

    // Check stock availability via marketplace allocations
    const allocations = await db.queryByGSI1(data.clientId, {
      entityType: "MarketplaceAllocation",
      limit: 500,
    });
    const activeAllocations = (allocations as any[])
      .filter((a: any) => a.status === "active" && a.sku === mapping.whizunikSku);

    let totalReserved = 0;
    for (const alloc of activeAllocations) {
      totalReserved += Number(alloc.reservedQuantity) || 0;
    }

    if (totalReserved < data.quantity) {
      // Generate stock shortage exception
      await this.generateStockShortageException(data.clientId, data.amazonOrderId, mapping.whizunikSku, data.quantity - totalReserved);
      throw new Error(`Insufficient reserved stock. Required: ${data.quantity}, Reserved: ${totalReserved}`);
    }

    // Create warehouse task (shipment record)
    const task = await MarketplaceAmazonShipmentModel.create({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      whizunikSalesOrderId: data.whizunikSalesOrderId,
      amazonSku: data.amazonSku,
      colour: data.colour,
      size: data.size,
      quantity: data.quantity,
      warehouseLocation: data.warehouseLocation,
      packingRequirements: data.packingRequirements,
      dispatchDeadline: data.dispatchDeadline,
      fulfilmentType: data.fulfilmentType,
      deliveryStatus: "Pending",
    });

    // Update order status
    await MarketplaceAmazonOrderModel.updateStatus(data.amazonOrderId, "AwaitingWarehouseAction");

    return task;
  }

  static async updateDispatch(data: {
    shipmentId: string;
    awbNumber: string;
    trackingNumber: string;
    carrierName: string;
    dispatchDate: string;
  }) {
    return await MarketplaceAmazonShipmentModel.update(data.shipmentId, {
      awbNumber: data.awbNumber,
      trackingNumber: data.trackingNumber,
      carrierName: data.carrierName,
      dispatchDate: data.dispatchDate,
      deliveryStatus: "Dispatched",
    });
  }

  private static async generateStockShortageException(
    clientId: string,
    amazonOrderId: string,
    whizunikSku: string,
    shortageQuantity: number
  ) {
    await MarketplaceAmazonExceptionModel.create({
      clientId,
      affectedOrder: amazonOrderId,
      errorReason: "StockShortage",
      errorMessage: `Insufficient stock for SKU ${whizunikSku}. Required: ${data.quantity ?? 0}, Available: ${data.totalReserved ?? 0}, Shortage: ${shortageQuantity}`,
      affectedItem: whizunikSku,
      maxRetries: 3,
      responsibleUser: null,
    });
  }
}