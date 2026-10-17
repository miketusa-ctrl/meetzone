import { errorResponse, json } from "../lib/http.js";
import {
  ABSOLUTE_MAX_ZONES_SEARCH_LIMIT,
  PLAN_CLAMPED_HEADER,
  clampResultLimit,
  planClampedHeaderValue,
  planLimitMessage,
  planNoteForClamp,
  resolvePlan,
} from "../lib/plan.js";
import { searchZones } from "../lib/zones-data.js";
import {
  isValidIanaZone,
  parseYmd,
  utcOffsetMinutes,
  zoneAbbreviation,
  zonedLocalToUtcMs,
} from "../lib/tz.js";

export function handleZonesSearch(url: URL, request?: Request): Response {
  const caps = resolvePlan(request?.headers.get("X-RapidAPI-Subscription") ?? null);

  const q = url.searchParams.get("q") ?? "";
  const limitRaw = url.searchParams.get("limit");
  let limit = caps.defaultZonesSearchLimit;
  let clamped = false;

  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1) {
      return errorResponse(400, "validation_error", "limit must be an integer ≥ 1");
    }
    if (limit > ABSOLUTE_MAX_ZONES_SEARCH_LIMIT) {
      return errorResponse(
        400,
        "validation_error",
        `limit must be an integer 1–${ABSOLUTE_MAX_ZONES_SEARCH_LIMIT}`,
      );
    }
    // BASIC (and any plan below absolute max): clamp result count instead of 400
    if (limit > caps.maxZonesSearchLimit) {
      // PRO+ should never hit this (max === absolute); keep hard reject as safety
      if (caps.maxZonesSearchLimit >= ABSOLUTE_MAX_ZONES_SEARCH_LIMIT) {
        return errorResponse(
          400,
          "plan_limit_exceeded",
          planLimitMessage(caps.plan, "search results (limit)", caps.maxZonesSearchLimit),
          {
            plan: caps.plan,
            field: "limit",
            max: caps.maxZonesSearchLimit,
            got: limit,
          },
        );
      }
      const c = clampResultLimit(limit, caps.maxZonesSearchLimit);
      limit = c.limit;
      clamped = c.clamped;
    }
  }

  const date = url.searchParams.get("date");
  let noonUtcForOffset: number | undefined;
  if (date) {
    try {
      const { y, mo, d } = parseYmd(date);
      // Use UTC noon as a stable probe; per-zone offset computed at that zone's local noon-ish via zonedLocalToUtcMs
      noonUtcForOffset = Date.UTC(y, mo - 1, d, 12, 0, 0);
    } catch (e) {
      return errorResponse(400, "validation_error", (e as Error).message);
    }
  }

  const found = searchZones(q, limit);

  // If q looks like a raw IANA id not in catalog but valid, include it
  const trimmed = q.trim();
  if (
    trimmed.includes("/") &&
    isValidIanaZone(trimmed) &&
    !found.some((z) => z.id === trimmed)
  ) {
    found.unshift({
      id: trimmed,
      name: trimmed,
      aliases: [],
      region: trimmed.split("/")[0] ?? "",
    });
    if (found.length > limit) found.length = limit;
  }

  const zones = found.map((z) => {
    const base: Record<string, unknown> = {
      id: z.id,
      name: z.name,
      aliases: z.aliases,
      region: z.region,
    };
    if (date && noonUtcForOffset !== undefined) {
      try {
        const { y, mo, d } = parseYmd(date);
        const localNoon = zonedLocalToUtcMs(y, mo, d, 12, 0, z.id);
        base.utc_offset_minutes = utcOffsetMinutes(localNoon, z.id);
        base.abbreviation = zoneAbbreviation(localNoon, z.id);
      } catch {
        base.utc_offset_minutes = utcOffsetMinutes(noonUtcForOffset, z.id);
        base.abbreviation = zoneAbbreviation(noonUtcForOffset, z.id);
      }
    }
    return base;
  });

  const body: Record<string, unknown> = {
    ok: true,
    query: q,
    count: zones.length,
    zones,
  };
  const extraHeaders: Record<string, string> = {};
  if (clamped) {
    body.plan_note = planNoteForClamp(
      caps.plan,
      caps.maxZonesSearchLimit,
      ABSOLUTE_MAX_ZONES_SEARCH_LIMIT,
    );
    extraHeaders[PLAN_CLAMPED_HEADER] = planClampedHeaderValue(limit);
  }

  return json(body, 200, extraHeaders);
}
