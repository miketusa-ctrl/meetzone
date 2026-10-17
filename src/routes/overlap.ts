import { errorResponse, json } from "../lib/http.js";
import {
  OverlapValidationError,
  UnknownZoneError,
  computeOverlap,
} from "../lib/overlap.js";
import {
  ABSOLUTE_MAX_OVERLAP_LIMIT,
  PLAN_CLAMPED_HEADER,
  clampResultLimit,
  planClampedHeaderValue,
  planLimitMessage,
  planNoteForClamp,
  resolvePlan,
} from "../lib/plan.js";
import type { OverlapRequest, OverlapResponse } from "../lib/types.js";

export async function handleOverlap(request: Request): Promise<Response> {
  let body: OverlapRequest;
  try {
    body = (await request.json()) as OverlapRequest;
  } catch {
    return errorResponse(400, "validation_error", "Invalid JSON body");
  }

  const caps = resolvePlan(request.headers.get("X-RapidAPI-Subscription"));

  // Plan-aware hard caps for zones / days (cannot truncate honestly → 400)
  if (Array.isArray(body.zones) && body.zones.length > caps.maxZones) {
    return errorResponse(
      400,
      "plan_limit_exceeded",
      planLimitMessage(caps.plan, "zones", caps.maxZones),
      { plan: caps.plan, field: "zones", max: caps.maxZones, got: body.zones.length },
    );
  }
  if (
    body.days !== undefined &&
    body.days !== null &&
    Array.isArray(body.days) &&
    body.days.length > caps.maxDays
  ) {
    return errorResponse(
      400,
      "plan_limit_exceeded",
      planLimitMessage(caps.plan, "days", caps.maxDays),
      { plan: caps.plan, field: "days", max: caps.maxDays, got: body.days.length },
    );
  }

  // Result-count limit: clamp on BASIC (and any plan below absolute max)
  let clamped = false;
  let effectiveLimit = body.limit;
  if (body.limit !== undefined && body.limit !== null) {
    const n = Number(body.limit);
    if (!Number.isInteger(n) || n < 1) {
      return errorResponse(400, "validation_error", "limit must be an integer 1–20");
    }
    if (n > ABSOLUTE_MAX_OVERLAP_LIMIT) {
      return errorResponse(
        400,
        "validation_error",
        `limit must be an integer 1–${ABSOLUTE_MAX_OVERLAP_LIMIT}`,
      );
    }
    if (n > caps.maxOverlapLimit) {
      if (caps.maxOverlapLimit >= ABSOLUTE_MAX_OVERLAP_LIMIT) {
        return errorResponse(
          400,
          "plan_limit_exceeded",
          planLimitMessage(caps.plan, "results (limit)", caps.maxOverlapLimit),
          {
            plan: caps.plan,
            field: "limit",
            max: caps.maxOverlapLimit,
            got: n,
          },
        );
      }
      const c = clampResultLimit(n, caps.maxOverlapLimit);
      effectiveLimit = c.limit;
      clamped = c.clamped;
    }
  }

  const requestForCompute: OverlapRequest = {
    ...body,
    ...(effectiveLimit !== undefined && effectiveLimit !== null
      ? { limit: Number(effectiveLimit) }
      : {}),
  };

  try {
    const result = computeOverlap(requestForCompute) as OverlapResponse & {
      plan_note?: string;
      query: OverlapResponse["query"] & { plan_note?: string };
    };
    const extraHeaders: Record<string, string> = {};
    if (clamped) {
      const note = planNoteForClamp(
        caps.plan,
        caps.maxOverlapLimit,
        ABSOLUTE_MAX_OVERLAP_LIMIT,
      );
      result.plan_note = note;
      result.query = { ...result.query, plan_note: note };
      extraHeaders[PLAN_CLAMPED_HEADER] = planClampedHeaderValue(
        caps.maxOverlapLimit,
      );
    }
    return json(result, 200, extraHeaders);
  } catch (e) {
    if (e instanceof OverlapValidationError) {
      return errorResponse(400, e.code, e.message, e.details);
    }
    if (e instanceof UnknownZoneError) {
      return errorResponse(404, e.code, e.message, e.details);
    }
    if (e instanceof Error && /Invalid HH:mm|Invalid YYYY-MM-DD|Invalid calendar/.test(e.message)) {
      return errorResponse(400, "validation_error", e.message);
    }
    throw e;
  }
}
