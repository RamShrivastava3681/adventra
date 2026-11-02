import {
  findByAmazonOrderId,
  create as createOrder,
  update as updateOrder,
  updateStatus as updateOrderStatus,
  list as listOrders,
  get as getOrder,
} from "../models/marketplace-amazon-order.js";
import { findByChannelSku } from "../models/marketplace-amazon-sku-mapping.js";
import { update as updateAllocation } from "../models/marketplace-allocation.js";
import type { MarketplaceAllocation } from "../models/marketplace-allocation.js";
import type { MarketplaceAmazonOrder } from "../models/marketplace-amazon-order.js";
import { create as createException } from "../models/marketplace-amazon-exception.js";
import * as db from "../dynamodb.js";

export class AmazonOrderImportService {

  static async importOrder(data: {
    clientId: string;
    amazonOrderId: string;
    orderDate: string;
    amazonSku: string;
    productName: string;
    colour: string | null;
    size: string | null;
    quantity: number;
    sellingPrice: number;
    discount: number;
    taxInformation: {
      taxableAmount: number;
      taxAmount: number;
      taxRate: number;
    };
    deliveryAddress: {
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
    shippingMethod: string;
    fulfilmentType: string;
    expectedDispatchDate: string | null;
    amazonOrderStatus: string;
    invoiceStatus: string;
  }) {
    // Check for duplicate order prevention
    const existing = await findByAmazonOrderId(data.clientId, data.amazonOrderId);
    if (existing) {
      // Update existing order if it's a new sync
      return await updateOrder(existing.id, {
        orderDate: data.orderDate,
        amazonOrderStatus: data.amazonOrderStatus as any,
        invoiceStatus: data.invoiceStatus as any,
      });
    }

    // Map Amazon SKU to WhizUnik SKU
    const mapping = await findByChannelSku(data.clientId, data.amazonSku);

    let whizunikSku = data.amazonSku;
    if (mapping) {
      whizunikSku = mapping.whizunikSku;
    }

    // Create the Amazon order record
    const order = await createOrder({
      clientId: data.clientId,
      amazonOrderId: data.amazonOrderId,
      orderDate: data.orderDate,
      amazonSku: data.amazonSku,
      productName: data.productName,
      colour: data.colour,
      size: data.size,
      quantity: data.quantity,
      sellingPrice: data.sellingPrice,
      discount: data.discount,
      taxInformation: data.taxInformation,
      deliveryAddress: data.deliveryAddress,
      shippingMethod: data.shippingMethod,
      fulfilmentType: data.fulfilmentType as MarketplaceAmazonOrder["fulfilmentType"],
      expectedDispatchDate: data.expectedDispatchDate,
      amazonOrderStatus: data.amazonOrderStatus as MarketplaceAmazonOrder["amazonOrderStatus"],
      invoiceStatus: data.invoiceStatus as MarketplaceAmazonOrder["invoiceStatus"],
    });

    // If SKU is mapped, check stock reservation
    if (mapping && mapping.whizunikSku) {
      await this.reserveStock(data.clientId, whizunikSku, data.quantity, order.id);
    } else {
      // Mark order as awaiting SKU mapping
      await updateOrderStatus(order.id, "AwaitingSKUMapping");
    }

    return order;
  }

  static async list(clientId: string) {
    return await listOrders(clientId);
  }

  static async get(id: string) {
    return await getOrder(id);
  }

  static async updateStatus(amazonOrderId: string, status: string, invoiceStatus?: string) {
    return await updateOrderStatus(amazonOrderId, status, invoiceStatus);
  }

  private static async reserveStock(
    clientId: string,
    whizunikSku: string,
    quantity: number,
    amazonOrderId: string
  ) {
    // Check existing marketplace allocations for this SKU
    const { items } = await db.queryByGSI1(clientId, {
      entityType: "MarketplaceAllocation",
      limit: 500,
    });

    const activeAllocations = (items as MarketplaceAllocation[])
      .filter((a) => a.status === "active" && a.sku === whizunikSku);

    let remaining = quantity;
    for (const allocation of activeAllocations) {
      if (remaining <= 0) break;
      const take = Math.min(allocation.reservedQuantity || 0, remaining);
      if (take <= 0) continue;
      await updateAllocation(allocation.id, {
        reservedQuantity: (Number(allocation.reservedQuantity) || 0) - take,
        consumedQuantity: (Number(allocation.consumedQuantity) || 0) + take,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      // Stock shortage - mark order as awaiting stock
      await updateOrderStatus(amazonOrderId, "AwaitingStock");
      // Generate exception
      await createException({
        clientId,
        affectedOrder: amazonOrderId,
        errorReason: "StockShortage",
        errorMessage: `Insufficient stock for SKU ${whizunikSku}. Required: ${quantity}, Available after allocation: ${remaining}`,
        affectedItem: whizunikSku,
        maxRetries: 3,
        responsibleUser: null,
      });
    }
  }

  static async processSkuMapping(clientId: string, amazonSku: string) {
    // Find existing mapping
    const mapping = await findByChannelSku(clientId, amazonSku);

    if (!mapping) {
      // Generate exception - unmapped SKU
      await createException({
        clientId,
        affectedOrder: "",
        errorReason: "UnmappedSKU",
        errorMessage: `Amazon SKU "${amazonSku}" is not mapped to a WhizUnik SKU`,
        affectedItem: amazonSku,
        maxRetries: 3,
        responsibleUser: null,
      });
      return null;
    }

    return mapping;
  }
}
