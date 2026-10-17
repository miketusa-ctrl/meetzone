/**
 * RapidAPI subscription plan → server-side hard caps.
 * Header: X-RapidAPI-Subscription (BASIC | PRO | ULTRA | MEGA | CUSTOM).
 * Missing / unknown → BASIC.
 *
 * Result-count limits (zones search `limit`, overlap `limit`) are CLAMPED on
 * BASIC (with X-MeetZone-Plan-Clamped + plan_note) so Hub playground defaults
 * don't 400. Zones count and days still hard-reject with plan_limit_exceeded.
 */

export interface PlanCaps {
  /** Normalized plan label used in error messages */
  plan: string;
  maxZones: number;
  maxOverlapLimit: number;
  maxDays: number;
  maxZonesSearchLimit: number;
  defaultZonesSearchLimit: number;
}

const BASIC: PlanCaps = {
  plan: "BASIC",
  maxZones: 5,
  maxOverlapLimit: 5,
  maxDays: 7,
  maxZonesSearchLimit: 5,
  defaultZonesSearchLimit: 5,
};

const PRO: PlanCaps = {
  plan: "PRO",
  maxZones: 12,
  maxOverlapLimit: 20,
  maxDays: 31,
  maxZonesSearchLimit: 50,
  defaultZonesSearchLimit: 20,
};

/** Absolute schema maxima (PRO caps); requests above these are validation errors. */
export const ABSOLUTE_MAX_ZONES_SEARCH_LIMIT = PRO.maxZonesSearchLimit;
export const ABSOLUTE_MAX_OVERLAP_LIMIT = PRO.maxOverlapLimit;

const PAID = new Set(["PRO", "ULTRA", "MEGA", "CUSTOM"]);

export function resolvePlan(subscriptionHeader: string | null | undefined): PlanCaps {
  const raw = (subscriptionHeader ?? "").trim().toUpperCase();
  if (PAID.has(raw)) {
    return { ...PRO, plan: raw };
  }
  return { ...BASIC };
}

export function planLimitMessage(
  plan: string,
  what: string,
  max: number,
  upgradeHint = "upgrade to PRO for more",
): string {
  return `${plan} plan allows at most ${max} ${what}; ${upgradeHint}`;
}

/** Response header when a result-count limit was clamped to the plan max. */
export const PLAN_CLAMPED_HEADER = "X-MeetZone-Plan-Clamped";

export function planClampedHeaderValue(clampedLimit: number): string {
  return `limit=${clampedLimit}`;
}

export function planNoteForClamp(plan: string, planMax: number, upgradeMax: number): string {
  return `${plan} plan returns at most ${planMax} results; upgrade to PRO for up to ${upgradeMax}`;
}

/**
 * Apply plan result-count limit. Returns clamped limit + whether clamping happened.
 * Caller must already have validated positive integer and absolute max.
 */
export function clampResultLimit(requested: number, planMax: number): {
  limit: number;
  clamped: boolean;
} {
  if (requested > planMax) {
    return { limit: planMax, clamped: true };
  }
  return { limit: requested, clamped: false };
}
