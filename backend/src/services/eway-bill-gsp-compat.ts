// ---------------------------------------------------------------------------
// E-Way Bill Compatibility Helpers
// ---------------------------------------------------------------------------
// These helper functions were previously in eway-bill-gsp.ts (WhiteBooks).
// They are kept here for backward compatibility with the service layer
// that imports them.
// ---------------------------------------------------------------------------

/** Map our transport mode string to NIC numeric code. */
export function mapTransportMode(mode: string): "1" | "2" | "3" | "4" {
  const map: Record<string, "1" | "2" | "3" | "4"> = {
    road: "1",
    rail: "2",
    air: "3",
    ship: "4",
  };
  return map[mode?.toLowerCase()] || "1";
}

/**
 * Determine transaction type from state codes.
 * NIC codes:
 *   1 = Regular
 *   2 = Bill To - Ship To
 *   3 = Bill From - Dispatch From
 *   4 = Combination
 */
export function determineTransactionType(fromState: number, toState: number): number {
  return fromState === toState ? 1 : 4;
}

/**
 * Determine supply type from direction.
 * "O" = Outward (our default — sales dispatch)
 * "I" = Inward (purchase — for future inbound EWB)
 */
export function determineSupplyType(direction: "outbound" | "inbound"): "O" | "I" {
  return direction === "outbound" ? "O" : "I";
}
