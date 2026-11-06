/**
 * Amazon SP-API marketplace-region configuration and validation utility.
 *
 * Amazon India belongs to the EU selling region for SP-API:
 *   endpoint: https://sellingpartnerapi-eu.amazon.com
 *   signing region: eu-west-1
 *   signing service: execute-api
 *   country: IN
 *
 * This module validates that the configured endpoint, signing region, and
 * marketplace ID are consistent. It fails fast (logs ERROR + throws) when they
 * are not, so the integration never silently signs requests to the wrong region.
 *
 * Never logs credentials, access tokens, refresh tokens, or secret keys.
 */

import { config } from "../config.js";
import { AmazonDebugLogger } from "./amazon-debug-logger.js";

type MarketplaceRegion = {
  marketplaceId: string;
  marketplaceName: string;
  countryCode: string;
  spapiEndpoint: string;
  signingRegion: string;
  signingService: string;
};

// Known Amazon SP-API marketplace → region mappings.
// Only the endpoint/region combinations that are valid for SP-API are listed.
const MARKETPLACE_REGIONS: Record<string, MarketplaceRegion> = {
  A21TJRUUN4KGV: {
    marketplaceId: "A21TJRUUN4KGV",
    marketplaceName: "Amazon India",
    countryCode: "IN",
    spapiEndpoint: "https://sellingpartnerapi-eu.amazon.com",
    signingRegion: "eu-west-1",
    signingService: "execute-api",
  },
  A1PA6795UKMFR9: {
    marketplaceId: "A1PA6795UKMFR9",
    marketplaceName: "Amazon Germany",
    countryCode: "DE",
    spapiEndpoint: "https://sellingpartnerapi-eu.amazon.com",
    signingRegion: "eu-west-1",
    signingService: "execute-api",
  },
  A1RKKUPIHCS9HS: {
    marketplaceId: "A1RKKUPIHCS9HS",
    marketplaceName: "Amazon Spain",
    countryCode: "ES",
    spapiEndpoint: "https://sellingpartnerapi-eu.amazon.com",
    signingRegion: "eu-west-1",
    signingService: "execute-api",
  },
  A1F83G8C2ARO7P: {
    marketplaceId: "A1F83G8C2ARO7P",
    marketplaceName: "Amazon United Kingdom",
    countryCode: "GB",
    spapiEndpoint: "https://sellingpartnerapi-eu.amazon.com",
    signingRegion: "eu-west-1",
    signingService: "execute-api",
  },
  ATVPDKIKX0DER: {
    marketplaceId: "ATVPDKIKX0DER",
    marketplaceName: "Amazon United States",
    countryCode: "US",
    spapiEndpoint: "https://sellingpartnerapi-na.amazon.com",
    signingRegion: "us-east-1",
    signingService: "execute-api",
  },
};

const log = new AmazonDebugLogger({ module: "marketplace-config" });

export interface MarketplaceConfigValidation {
  valid: boolean;
  configured: boolean;
  marketplaceId: string | null;
  sellerId: string | null;
  marketplaceName: string | null;
  countryCode: string | null;
  endpoint: string | null;
  signingRegion: string | null;
  signingService: string | null;
  endpointMatch: boolean;
  regionMatch: boolean;
  errors: string[];
  warnings: string[];
}

/** Read the effective Amazon config, supporting both new and legacy env var names. */
function effectiveAmazonConfig(): {
  endpoint: string;
  region: string;
  marketplaceId: string;
  sellerId: string;
  countryCode: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  return {
    endpoint:
      process.env.AMAZON_SP_API_ENDPOINT ||
      process.env.AMAZON_SPAPI_ENDPOINT ||
      config.amazon.spapiEndpoint ||
      "",
    region:
      process.env.AMAZON_SP_API_REGION ||
      process.env.AMAZON_REGION ||
      config.amazon.region ||
      "",
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || config.amazon.marketplaceId || "",
    sellerId: process.env.AMAZON_SELLER_ID || config.amazon.sellerId || "",
    countryCode: process.env.AMAZON_COUNTRY_CODE || null,
    clientId: process.env.AMAZON_CLIENT_ID || config.amazon.clientId || "",
    clientSecret: process.env.AMAZON_CLIENT_SECRET || config.amazon.clientSecret || "",
    refreshToken: process.env.AMAZON_REFRESH_TOKEN || config.amazon.refreshToken || "",
  };
}

/** Validate that endpoint, signing region, and marketplace are consistent. */
export function validateMarketplaceConfig(): MarketplaceConfigValidation {
  const cfg = effectiveAmazonConfig();
  const errors: string[] = [];
  const warnings: string[] = [];

  const configured = Boolean(cfg.endpoint && cfg.region && cfg.marketplaceId);

  let marketplace: MarketplaceRegion | null = null;
  let endpointMatch = false;
  let regionMatch = false;

  if (cfg.marketplaceId) {
    marketplace = MARKETPLACE_REGIONS[cfg.marketplaceId] ?? null;
  }

  if (!cfg.endpoint) {
    errors.push("AMAZON_SP_API_ENDPOINT (or AMAZON_SPAPI_ENDPOINT) is not set");
  }
  if (!cfg.region) {
    errors.push("AMAZON_SP_API_REGION (or AMAZON_REGION) is not set");
  }
  if (!cfg.marketplaceId) {
    errors.push("AMAZON_MARKETPLACE_ID is not set");
  }
  if (!cfg.sellerId) {
    warnings.push("AMAZON_SELLER_ID is not set — seller identification may be missing from requests");
  }

  if (marketplace) {
    if (cfg.endpoint && cfg.endpoint !== marketplace.spapiEndpoint) {
      errors.push(
        `Endpoint mismatch: configured "${cfg.endpoint}" but marketplace ${cfg.marketplaceId} requires "${marketplace.spapiEndpoint}"`,
      );
    } else {
      endpointMatch = true;
    }

    if (cfg.region && cfg.region !== marketplace.signingRegion) {
      errors.push(
        `Signing region mismatch: configured "${cfg.region}" but marketplace ${cfg.marketplaceId} requires "${marketplace.signingRegion}"`,
      );
    } else {
      regionMatch = true;
    }

    if (cfg.countryCode && cfg.countryCode !== marketplace.countryCode) {
      warnings.push(
        `Country code mismatch: configured "${cfg.countryCode}" but marketplace ${cfg.marketplaceId} is "${marketplace.countryCode}"`,
      );
    }
  } else if (cfg.marketplaceId) {
    warnings.push(`Marketplace ID "${cfg.marketplaceId}" is not in the known SP-API marketplace registry`);
  }

  // Application status warning (DRAFT) — cannot verify from code alone; surface via diagnostics.
  if (process.env.AMAZON_APPLICATION_STATUS === "DRAFT") {
    warnings.push(
      "Amazon application is still in Draft status. Production access may be unavailable until registration, role approval and seller authorization are completed.",
    );
  }

  // Log the validation result (no secrets).
  if (errors.length > 0) {
    log.error({
      operation: "validateMarketplaceConfig",
      stage: "config-check",
      errorCode: "ConfigurationInvalid",
      errorMessage: errors.join("; "),
      config: {
        endpointConfigured: Boolean(cfg.endpoint),
        regionConfigured: Boolean(cfg.region),
        marketplaceIdConfigured: Boolean(cfg.marketplaceId),
        marketplaceId: cfg.marketplaceId ? `[present:${cfg.marketplaceId.length}]` : null,
        endpointMatch,
        regionMatch,
      },
    });
  } else if (configured) {
    log.info({
      operation: "validateMarketplaceConfig",
      stage: "config-check",
      config: {
        marketplaceId: cfg.marketplaceId ? `[present:${cfg.marketplaceId.length}]` : null,
        marketplaceName: marketplace?.marketplaceName ?? null,
        countryCode: marketplace?.countryCode ?? cfg.countryCode ?? null,
        endpoint: cfg.endpoint ? `[present:${cfg.endpoint.length}]` : null,
        signingRegion: marketplace?.signingRegion ?? cfg.region ?? null,
        endpointMatch,
        regionMatch,
        valid: true,
      },
    });
  }

  return {
    valid: errors.length === 0 && configured,
    configured,
    marketplaceId: cfg.marketplaceId || null,
    sellerId: cfg.sellerId || null,
    marketplaceName: marketplace?.marketplaceName ?? null,
    countryCode: marketplace?.countryCode ?? cfg.countryCode ?? null,
    endpoint: cfg.endpoint || null,
    signingRegion: (marketplace?.signingRegion ?? cfg.region) || null,
    signingService: marketplace?.signingService ?? "execute-api",
    endpointMatch,
    regionMatch,
    errors,
    warnings,
  };
}

/** Get the expected signing config for the configured marketplace. */
export function getSigningConfig(): {
  service: string;
  region: string;
  host: string;
} | null {
  const cfg = effectiveAmazonConfig();
  if (!cfg.marketplaceId) return null;
  const m = MARKETPLACE_REGIONS[cfg.marketplaceId];
  if (!m) return null;
  const endpoint = cfg.endpoint || m.spapiEndpoint;
  const host = endpoint.replace(/^https?:\/\//, "");
  return {
    service: m.signingService,
    region: cfg.region || m.signingRegion,
    host,
  };
}

/** Throw if the marketplace configuration is invalid. Call at startup or before sync. */
export function requireValidMarketplaceConfig(): void {
  const validation = validateMarketplaceConfig();
  if (!validation.valid) {
    throw new Error(
      `Amazon SP-API marketplace configuration is invalid: ${validation.errors.join("; ")}`,
    );
  }
}

export { MARKETPLACE_REGIONS };
export type { MarketplaceRegion };
