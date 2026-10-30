import { MarketplaceAmazonSkuMapping, MarketplaceAmazonSkuMappingModel } from "../models/marketplace-amazon-sku-mapping.js";
import { MarketplaceAmazonOrder } from "../models/marketplace-amazon-order.js";
import * as db from "../dynamodb.js";

export class AmazonSkuMappingService {

  static async getMappings(clientId: string) {
    return await MarketplaceAmazonSkuMappingModel.list(clientId);
  }

  static async createMapping(data: {
    clientId: string;
    channelSku: string;
    listingId: string;
    whizunikSku: string;
    colour: string | null;
    size: string | null;
    productName: string;
    variant: string;
    warehouse: string;
    mrp: number;
    sellingPrice: number;
    hsn: string;
    gstRate: number;
    status?: "Mapped" | "Pending" | "Error";
    safetyStock?: number;
  }) {
    // Check for duplicate mapping
    const existing = await MarketplaceAmazonSkuMappingModel.findByChannelSku(data.clientId, data.channelSku);
    if (existing) {
      return await MarketplaceAmazonSkuMappingModel.update(existing.id, {
        whizunikSku: data.whizunikSku,
        colour: data.colour,
        size: data.size,
        productName: data.productName,
        variant: data.variant,
        warehouse: data.warehouse,
        mrp: data.mrp,
        sellingPrice: data.sellingPrice,
        hsn: data.hsn,
        gstRate: data.gstRate,
        status: data.status ?? "Mapped",
        safetyStock: data.safetyStock ?? 0,
      });
    }

    return await MarketplaceAmazonSkuMappingModel.create({
      clientId: data.clientId,
      channelSku: data.channelSku,
      listingId: data.listingId,
      whizunikSku: data.whizunikSku,
      colour: data.colour,
      size: data.size,
      productName: data.productName,
      variant: data.variant,
      warehouse: data.warehouse,
      mrp: data.mrp,
      sellingPrice: data.sellingPrice,
      hsn: data.hsn,
      gstRate: data.gstRate,
      status: data.status ?? "Pending",
      safetyStock: data.safetyStock ?? 0,
    });
  }

  static async updateMapping(id: string, updates: Partial<{
    whizunikSku: string;
    colour: string | null;
    size: string | null;
    productName: string;
    variant: string;
    warehouse: string;
    mrp: number;
    sellingPrice: number;
    hsn: string;
    gstRate: number;
    status: "Mapped" | "Pending" | "Error";
    safetyStock: number;
  }>) {
    return await MarketplaceAmazonSkuMappingModel.update(id, updates);
  }

  static async deleteMapping(id: string) {
    return await MarketplaceAmazonSkuMappingModel.remove(id);
  }

  static async validateSku(clientId: string, amazonSku: string): Promise<{
    isMapped: boolean;
    whizunikSku?: string;
    mapping?: any;
    error?: string;
  }> {
    const mapping = await MarketplaceAmazonSkuMappingModel.findByChannelSku(clientId, amazonSku);
    if (mapping) {
      return { isMapped: true, whizunikSku: mapping.whizunikSku, mapping };
    }
    return { isMapped: false, error: `Amazon SKU "${amazonSku}" is not mapped to a WhizUnik SKU. Manual mapping required.` };
  }

  static async getUnmappedSkus(clientId: string, amazonSkus: string[]): Promise<{
    unmapped: string[];
    mapped: Array<{ amazonSku: string; whizunikSku: string; productName: string }>;
  }> {
    const mapped: Array<{ amazonSku: string; whizunikSku: string; productName: string }> = [];
    const unmapped: string[] = [];

    for (const sku of amazonSkus) {
      const result = await this.validateSku(clientId, sku);
      if (result.isMapped) {
        mapped.push({
          amazonSku: result.mapping!.channelSku,
          whizunikSku: result.whizunikSku,
          productName: result.mapping!.productName,
        });
      } else {
        unmapped.push(sku);
      }
    }

    return { unmapped, mapped };
  }
}