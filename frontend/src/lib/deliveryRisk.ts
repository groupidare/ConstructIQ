import type { ConstructionRiskLevel } from "@/types/weather";

export interface DeliveryRiskInput {
  number: string;
  projectName: string;
  supplier: string;
  status: string;
  expectedDate: string;
}

export type AtRiskPurchaseOrder<T> = T & { bufferDays: number; reason: string };

// Only orders still in motion can be delayed by weather — delivered/cancelled ones can't.
const ACTIVE_STATUSES = new Set(["PENDING", "APPROVED"]);

const BUFFER_DAYS_BY_LEVEL: Record<ConstructionRiskLevel, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  extreme: 3,
};

/**
 * R4: monitor supplier delivery performance and integrate weather risk data to
 * adjust material delivery timing and reorder points.
 */
export function computeWeatherAtRiskOrders<T extends DeliveryRiskInput>(
  orders: T[],
  riskLevel: ConstructionRiskLevel,
  conditionLabel: string
): AtRiskPurchaseOrder<T>[] {
  if (riskLevel === "low") return [];
  const bufferDays = BUFFER_DAYS_BY_LEVEL[riskLevel];
  return orders
    .filter((o) => ACTIVE_STATUSES.has(o.status))
    .map((o) => ({
      ...o,
      bufferDays,
      reason: `${conditionLabel} may delay ground transport — recommend pushing the expected delivery back ${bufferDays} day${bufferDays > 1 ? "s" : ""}.`,
    }));
}
