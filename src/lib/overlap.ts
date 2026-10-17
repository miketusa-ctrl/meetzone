/**
 * Deterministic meeting-overlap math.
 * Shared local work_hours applied per zone → UTC intervals → intersection → ranked slots.
 */

import type { OverlapRequest, OverlapResponse, OverlapSlot, WorkHours } from "./types.js";
import {
  defaultDays,
  formatLocalYmdHm,
  hmToMinutes,
  isValidIanaZone,
  parseHm,
  parseYmd,
  toIsoZ,
  utcOffsetMinutes,
  zoneAbbreviation,
  zonedLocalToUtcMs,
} from "./tz.js";

const DEFAULT_WORK: WorkHours = { start: "09:00", end: "17:00" };

export class OverlapValidationError extends Error {
  code = "validation_error" as const;
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

export class UnknownZoneError extends Error {
  code = "unknown_zone" as const;
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

interface UtcInterval {
  start: number;
  end: number;
}

function localWindowUtc(
  ymd: string,
  startHm: string,
  endHm: string,
  zone: string,
): UtcInterval | null {
  const { y, mo, d } = parseYmd(ymd);
  return windowForDay({ y, mo, d }, workMinutes(startHm, endHm), zone);
}

interface WorkMinutes {
  sh: number;
  sm: number;
  eh: number;
  em: number;
}

/** Parse + validate the shared work window once per request. */
function workMinutes(startHm: string, endHm: string): WorkMinutes {
  const startM = hmToMinutes(startHm);
  const endM = hmToMinutes(endHm);
  if (endM <= startM) {
    throw new OverlapValidationError(
      "work_hours.end must be after work_hours.start (same-day windows only in Day-1)",
      { start: startHm, end: endHm },
    );
  }
  return {
    sh: Math.floor(startM / 60),
    sm: startM % 60,
    eh: Math.floor(endM / 60),
    em: endM % 60,
  };
}

/**
 * One zone's work window on one civil day, as a UTC interval. DST is handled by
 * zonedLocalToUtcMs (start and end resolved independently, so a window that
 * crosses a transition gets the right length).
 */
function windowForDay(
  day: { y: number; mo: number; d: number },
  w: WorkMinutes,
  zone: string,
): UtcInterval | null {
  const start = zonedLocalToUtcMs(day.y, day.mo, day.d, w.sh, w.sm, zone);
  const end = zonedLocalToUtcMs(day.y, day.mo, day.d, w.eh, w.em, zone);
  if (end <= start) return null; // pathological DST — skip
  return { start, end };
}

function intersectAll(sets: UtcInterval[][]): UtcInterval[] {
  if (sets.length === 0) return [];
  let acc = sets[0]!;
  for (let i = 1; i < sets.length; i++) {
    acc = intersectTwo(acc, sets[i]!);
    if (acc.length === 0) return [];
  }
  return acc;
}

function intersectTwo(a: UtcInterval[], b: UtcInterval[]): UtcInterval[] {
  const out: UtcInterval[] = [];
  let i = 0;
  let j = 0;
  const as = [...a].sort((x, y) => x.start - y.start);
  const bs = [...b].sort((x, y) => x.start - y.start);
  while (i < as.length && j < bs.length) {
    const start = Math.max(as[i]!.start, bs[j]!.start);
    const end = Math.min(as[i]!.end, bs[j]!.end);
    if (start < end) out.push({ start, end });
    if (as[i]!.end < bs[j]!.end) i++;
    else j++;
  }
  return out;
}

/** Carve duration-sized candidate starts every `stepMinutes` within intervals. */
function rankSlots(
  intervals: UtcInterval[],
  durationMs: number,
  limit: number,
  stepMinutes = 30,
): UtcInterval[] {
  const step = stepMinutes * 60_000;
  const candidates: UtcInterval[] = [];
  for (const iv of intervals) {
    if (iv.end - iv.start < durationMs) continue;
    // Prefer packing from the start of each intersection
    for (let t = iv.start; t + durationMs <= iv.end; t += step) {
      candidates.push({ start: t, end: t + durationMs });
    }
    // Also offer the latest aligned slot ending at iv.end if not already covered
    const lastStart = iv.end - durationMs;
    if (lastStart > iv.start && (lastStart - iv.start) % step !== 0) {
      candidates.push({ start: lastStart, end: iv.end });
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  // Dedupe identical starts
  const seen = new Set<number>();
  const unique: UtcInterval[] = [];
  for (const c of candidates) {
    if (seen.has(c.start)) continue;
    seen.add(c.start);
    unique.push(c);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function buildIcs(slot: OverlapSlot, summary = "MeetZone overlap"): string {
  const fmt = (iso: string) =>
    iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/Z$/, "Z");
  const dtStart = fmt(slot.start_utc);
  const dtEnd = fmt(slot.end_utc);
  const stamp = fmt(new Date().toISOString());
  const uid = `meetzone-${slot.rank}-${dtStart}@meetzone`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MeetZone//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:Zones: ${slot.local.map((l) => l.zone).join(", ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\n");
}

export function computeOverlap(raw: OverlapRequest): OverlapResponse {
  if (!raw || typeof raw !== "object") {
    throw new OverlapValidationError("Body must be a JSON object");
  }
  if (!Array.isArray(raw.zones)) {
    throw new OverlapValidationError("zones must be an array of IANA timezone ids");
  }
  const zones = raw.zones.map((z) => String(z).trim()).filter(Boolean);
  if (zones.length < 2 || zones.length > 12) {
    throw new OverlapValidationError("zones must contain between 2 and 12 IANA ids", {
      count: zones.length,
    });
  }
  const unknown = zones.filter((z) => !isValidIanaZone(z));
  if (unknown.length) {
    throw new UnknownZoneError(`Unknown IANA timezone(s): ${unknown.join(", ")}`, {
      unknown,
    });
  }

  const work_hours: WorkHours = {
    start: raw.work_hours?.start ?? DEFAULT_WORK.start,
    end: raw.work_hours?.end ?? DEFAULT_WORK.end,
  };
  // Validate HH:mm
  parseHm(work_hours.start);
  parseHm(work_hours.end);

  let days: string[];
  if (raw.days === undefined || raw.days === null) {
    days = defaultDays(7);
  } else if (!Array.isArray(raw.days) || raw.days.length === 0) {
    throw new OverlapValidationError("days must be a non-empty array of YYYY-MM-DD");
  } else {
    days = raw.days.map((d) => {
      parseYmd(String(d));
      return String(d);
    });
    if (days.length > 31) {
      throw new OverlapValidationError("days may contain at most 31 dates");
    }
  }

  const duration_minutes =
    raw.duration_minutes === undefined || raw.duration_minutes === null
      ? 30
      : Number(raw.duration_minutes);
  if (
    !Number.isFinite(duration_minutes) ||
    duration_minutes < 5 ||
    duration_minutes > 480 ||
    !Number.isInteger(duration_minutes)
  ) {
    throw new OverlapValidationError("duration_minutes must be an integer 5–480");
  }

  const limit =
    raw.limit === undefined || raw.limit === null ? 5 : Number(raw.limit);
  if (!Number.isFinite(limit) || limit < 1 || limit > 20 || !Number.isInteger(limit)) {
    throw new OverlapValidationError("limit must be an integer 1–20");
  }

  const include_ics = raw.include_ics !== false;
  const durationMs = duration_minutes * 60_000;

  // Per zone: one UTC window per requested day (computed once per zone/day, no per-slot
  // Intl calls), then interval-list intersection. Days/work hours are parsed once.
  const work = workMinutes(work_hours.start, work_hours.end);
  const parsedDays = days.map((d) => parseYmd(d));
  const perZone: UtcInterval[][] = zones.map((zone) => {
    const windows: UtcInterval[] = [];
    for (const day of parsedDays) {
      const w = windowForDay(day, work, zone);
      if (w) windows.push(w);
    }
    return windows;
  });

  const intersection = intersectAll(perZone);
  const picked = rankSlots(intersection, durationMs, limit);

  const slots: OverlapSlot[] = picked.map((iv, idx) => ({
    rank: idx + 1,
    start_utc: toIsoZ(iv.start),
    end_utc: toIsoZ(iv.end),
    duration_minutes,
    local: zones.map((zone) => ({
      zone,
      start_local: formatLocalYmdHm(iv.start, zone),
      end_local: formatLocalYmdHm(iv.end, zone),
      utc_offset_minutes: utcOffsetMinutes(iv.start, zone),
      abbreviation: zoneAbbreviation(iv.start, zone),
    })),
  }));

  const response: OverlapResponse = {
    ok: true,
    query: { zones, work_hours, days, duration_minutes },
    count: slots.length,
    slots,
  };
  if (include_ics && slots[0]) {
    response.ics = buildIcs(slots[0]);
  }
  return response;
}

/** Exported for unit tests: intersection of two UTC intervals lists */
export const __test = { intersectTwo, intersectAll, localWindowUtc, rankSlots };

/**
 * Isolate warm-up: run one tiny DST-aware request at Worker global scope so the first real
 * request on a fresh isolate doesn't pay ICU initialisation + lazy compilation inside its 10
 * ms CPU budget. Deliberately generic (fixed zones/dates), never throws.
 */
export function warmOverlap(): void {
  try {
    // Big enough (4 zones x 14 days, 20 slots, DST days) for V8 to tier up the hot loops.
    const days: string[] = [];
    for (let i = 0; i < 14; i++) {
      days.push(new Date(Date.UTC(2026, 9, 25 + i)).toISOString().slice(0, 10));
    }
    for (let i = 0; i < 3; i++) {
      computeOverlap({
        zones: ["UTC", "America/New_York", "Europe/London", "Australia/Sydney"],
        days,
        work_hours: { start: "00:00", end: "23:59" },
        duration_minutes: 15,
        limit: 20,
        include_ics: true,
      });
    }
  } catch {
    // warm-up must never break startup
  }
}
