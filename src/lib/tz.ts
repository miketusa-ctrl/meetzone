/**
 * Timezone helpers using Intl (ICU / IANA data baked into the JS runtime).
 * Zero dependencies; DST transitions handled by the host ICU database.
 *
 * Performance. The Day-1 code built a new Intl.DateTimeFormat (~50-75 us) and ran formatToParts (~5 us) on every
 * call, thousands of times for a 12-zone x 31-day request (167 ms locally, ~100 ms CPU on Workers). Now:
 *  - one cached Intl.DateTimeFormat per zone, giving wall-clock fields AND the
 *    short abbreviation from a single format() call (verified identical to the
 *    separate formatters across all 417 zones, 1890-2100, 8.2M instants);
 *  - a per-zone UTC-offset cache: the offset is sampled every 48 h (UTC midnight of
 *    even epoch days); if two adjacent samples agree the whole 48 h bucket has that
 *    offset, otherwise the single DST/offset transition inside the bucket is found to
 *    the second by bisection (15-min grid first) and cached. Wall-clock fields and local->UTC conversion are then
 *    pure arithmetic on cached offsets, with no Intl call.
 *  Assumption: at most one offset/abbreviation transition per 48 h bucket. tzdata
 *  1900-2100 has a minimum gap of ~95 h between transitions in any zone (Africa/Freetown
 *  1939); since 1970 the minimum is ~166 h.
 *  If a computed offset is implausible (> 26 h or not whole seconds, e.g. an
 *  engine using a Julian calendar for old dates) the exact legacy Intl path is used.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
/** Offset-sampling bucket; must stay well below the minimum gap between tz transitions. */
const BUCKET_MS = 2 * DAY_MS;
const QUARTER_HOUR_MS = 900_000;
const MAX_PLAUSIBLE_OFFSET_MS = 26 * 3_600_000;
/** en-US, 2-digit month/day/h/m/s, numeric year, h23, short zone: "10/05/2026, 09:30:00 EDT" */
const EN_US_SHAPE = /^(\d{2})\/(\d{2})\/(\d+), (\d{2}):(\d{2}):(\d{2}) (.+)$/;

// Bounds so a stream of odd-but-valid inputs can't grow isolate memory without limit.
const MAX_CACHED_ZONES = 512;
const MAX_SAMPLES_PER_ZONE = 4096;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface Sample {
  /** UTC offset in ms (local wall clock minus UTC) */
  off: number;
  abbr: string;
}

interface ZoneCache {
  zone: string;
  fmt: Intl.DateTimeFormat;
  /** bucket index k -> sample at k * BUCKET_MS */
  samples: Map<number, Sample>;
  /** bucket index k -> first whole-second instant with the new offset (only when samples differ) */
  transitions: Map<number, number>;
  /** bucket index k -> abbreviation valid for the whole bucket, or null if it changes inside */
  bucketAbbr: Map<number, string | null>;
}

const zoneCaches = new Map<string, ZoneCache>();

/** Throws RangeError for unknown zones (same as `new Intl.DateTimeFormat`). */
function zoneCache(zone: string): ZoneCache {
  let c = zoneCaches.get(zone);
  if (c) return c;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  if (zoneCaches.size >= MAX_CACHED_ZONES) zoneCaches.clear();
  c = { zone, fmt, samples: new Map(), transitions: new Map(), bucketAbbr: new Map() };
  zoneCaches.set(zone, c);
  return c;
}

/** Exact legacy behavior: Intl formatToParts (wall-clock fields + abbreviation). */
function intlParts(c: ZoneCache, utcMs: number): Parts & { abbr: string } {
  const parts = c.fmt.formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    abbr: parts.find((p) => p.type === "timeZoneName")?.value ?? c.zone,
  };
}

/** Intl sample at an instant, using the cheaper format() string when it has the expected shape. */
function rawSample(c: ZoneCache, utcMs: number): Sample {
  const m = EN_US_SHAPE.exec(c.fmt.format(utcMs));
  let p: Parts;
  let abbr: string;
  if (m) {
    p = {
      year: Number(m[3]),
      month: Number(m[1]),
      day: Number(m[2]),
      hour: Number(m[4]),
      minute: Number(m[5]),
      second: Number(m[6]),
    };
    abbr = m[7]!;
  } else {
    const ip = intlParts(c, utcMs);
    p = ip;
    abbr = ip.abbr;
  }
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
  return { off, abbr };
}

function sampleAt(c: ZoneCache, k: number): Sample {
  let s = c.samples.get(k);
  if (s === undefined) {
    if (c.samples.size >= MAX_SAMPLES_PER_ZONE) {
      c.samples.clear();
      c.transitions.clear();
      c.bucketAbbr.clear();
    }
    s = rawSample(c, k * BUCKET_MS);
    c.samples.set(k, s);
  }
  return s;
}

function transitionIn(c: ZoneCache, k: number, before: number): number {
  let at = c.transitions.get(k);
  if (at !== undefined) return at;
  // Invariant: offset(lo) === before, offset(hi) !== before; both whole seconds.
  let lo = k * BUCKET_MS;
  let hi = lo + BUCKET_MS;
  // Almost every real transition sits on a 15-minute boundary: bisect that grid first
  // (~7 Intl calls), confirm with one probe 1 s earlier, and only then go to seconds.
  while (hi - lo > QUARTER_HOUR_MS) {
    const mid = lo + Math.floor((hi - lo) / (2 * QUARTER_HOUR_MS)) * QUARTER_HOUR_MS;
    if (rawSample(c, mid).off === before) lo = mid;
    else hi = mid;
  }
  if (rawSample(c, hi - 1000).off !== before) hi -= 1000;
  else lo = hi - 1000;
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
    if (rawSample(c, mid).off === before) lo = mid;
    else hi = mid;
  }
  at = hi;
  c.transitions.set(k, at);
  return at;
}

/** Cached offset (ms) at an instant; NaN when the fast path must not be trusted. */
function cachedOffsetMs(c: ZoneCache, utcMs: number): number {
  const k = Math.floor(utcMs / BUCKET_MS);
  const a = sampleAt(c, k).off;
  const b = sampleAt(c, k + 1).off;
  let off = a;
  if (a !== b) {
    // tzdata transitions are on whole seconds; ICU compares in ms, so `utcMs < at` matches Intl.
    off = utcMs < transitionIn(c, k, a) ? a : b;
  }
  if (!(Math.abs(off) <= MAX_PLAUSIBLE_OFFSET_MS) || off % 1000 !== 0) return NaN;
  return off;
}

/** Parts of an instant in a given IANA zone */
function zonedParts(utcMs: number, zone: string): Parts {
  const c = zoneCache(zone);
  const off = cachedOffsetMs(c, utcMs);
  if (Number.isNaN(off)) return intlParts(c, utcMs);
  const d = new Date(utcMs + off);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

export function parseHm(hm: string): { h: number; m: number } {
  const m = HHMM.exec(hm);
  if (!m) throw new Error(`Invalid HH:mm: ${hm}`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function parseYmd(ymd: string): { y: number; mo: number; d: number } {
  const m = YMD.exec(ymd);
  if (!m) throw new Error(`Invalid YYYY-MM-DD: ${ymd}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Validate calendar date via UTC Date
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`Invalid calendar date: ${ymd}`);
  }
  return { y, mo, d };
}

export function isValidIanaZone(zone: string): boolean {
  try {
    // Throws RangeError for unknown zones in modern engines
    zoneCache(zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a local civil datetime in `zone` to a UTC epoch ms.
 * Handles DST gaps/overlaps by probing nearby candidates (prefer earlier offset on overlap).
 */
export function zonedLocalToUtcMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  zone: string,
): number {
  if (y >= 100) {
    // Years < 100 are skipped: Date.UTC maps them to 19xx, so `wanted` below would differ.
    const fast = localToUtcFromOffsets(zoneCache(zone), Date.UTC(y, mo - 1, d, h, mi, 0));
    if (fast !== null) return fast;
  }
  return localToUtcViaParts(y, mo, d, h, mi, zone);
}

/**
 * Same iteration as localToUtcViaParts, expressed on cached offsets (no Date objects).
 * `guess` stays on whole seconds (wanted is whole minutes, offsets whole seconds), so
 * the wall clock as UTC is exactly guess + off, and "local y/mo/d/h/mi equal" means
 * wanted <= guess + off < wanted + 1 min. Returns null to request the generic path.
 */
function localToUtcFromOffsets(c: ZoneCache, wanted: number): number | null {
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const off = cachedOffsetMs(c, guess);
    if (Number.isNaN(off)) return null;
    const diff = wanted - (guess + off);
    if (diff === 0) return guess;
    guess += diff;
  }
  let off = cachedOffsetMs(c, guess);
  if (Number.isNaN(off)) return null;
  const sameMinute = (g: number, o: number) => g + o >= wanted && g + o < wanted + 60_000;
  if (!sameMinute(guess, off)) {
    for (let step = 0; step < 8; step++) {
      guess += 15 * 60 * 1000;
      off = cachedOffsetMs(c, guess);
      if (Number.isNaN(off)) return null;
      if (sameMinute(guess, off)) return guess;
    }
  }
  return guess;
}

/** Day-1 algorithm, unchanged (only zonedParts got cheaper). */
function localToUtcViaParts(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  zone: string,
): number {
  // Initial guess: treat local as UTC
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, zone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const wanted = Date.UTC(y, mo - 1, d, h, mi, 0);
    const diff = wanted - asUtc;
    if (diff === 0) return guess;
    guess += diff;
  }
  // DST spring-forward gap: local time may not exist. Snap forward to next valid minute.
  const verify = zonedParts(guess, zone);
  if (
    verify.year !== y ||
    verify.month !== mo ||
    verify.day !== d ||
    verify.hour !== h ||
    verify.minute !== mi
  ) {
    // Walk forward up to 2 hours in 15-min steps looking for a matching local clock
    for (let step = 0; step < 8; step++) {
      guess += 15 * 60 * 1000;
      const p = zonedParts(guess, zone);
      if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi) {
        return guess;
      }
    }
  }
  return guess;
}

/** UTC offset of `zone` at instant `utcMs`, in minutes east of UTC. */
export function utcOffsetMinutes(utcMs: number, zone: string): number {
  const p = zonedParts(utcMs, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

/** Short abbreviation when cheap (e.g. MST, EDT). May be GMT±N in some locales. */
export function zoneAbbreviation(utcMs: number, zone: string): string {
  const c = zoneCache(zone);
  const k = Math.floor(utcMs / BUCKET_MS);
  let cached = c.bucketAbbr.get(k);
  if (cached === undefined) {
    // Constant for the whole bucket iff offset and abbreviation agree at both ends
    // (at most one transition per bucket, see header).
    const s0 = sampleAt(c, k);
    const s1 = sampleAt(c, k + 1);
    cached = s0.off === s1.off && s0.abbr === s1.abbr ? s0.abbr : null;
    c.bucketAbbr.set(k, cached);
  }
  return cached ?? rawSample(c, utcMs).abbr;
}

export function formatLocalYmdHm(utcMs: number, zone: string): string {
  const p = zonedParts(utcMs, zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function toIsoZ(utcMs: number): string {
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Today's UTC YYYY-MM-DD plus the next `n-1` days. */
export function defaultDays(n = 7, fromUtcMs = Date.now()): string[] {
  const out: string[] = [];
  const start = new Date(fromUtcMs);
  const y = start.getUTCFullYear();
  const mo = start.getUTCMonth();
  const d = start.getUTCDate();
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, mo, d + i));
    const pad = (x: number) => String(x).padStart(2, "0");
    out.push(
      `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    );
  }
  return out;
}

export function hmToMinutes(hm: string): number {
  const { h, m } = parseHm(hm);
  return h * 60 + m;
}

/**
 * Pay the one-time ICU/Intl initialisation and lazy-compile cost of these helpers up front.
 * Called from the Worker's global scope (isolate startup, which has its own 1 s budget)
 * so the first request on a fresh isolate doesn't carry it in its 10 ms CPU budget.
 */
export function warmTz(zones: readonly string[] = ["UTC"]): void {
  for (const z of zones) {
    try {
      const t = Date.UTC(2026, 0, 1, 12);
      zonedLocalToUtcMs(2026, 1, 1, 9, 0, z);
      formatLocalYmdHm(t, z);
      utcOffsetMinutes(t, z);
      zoneAbbreviation(t, z);
      intlParts(zoneCache(z), t);
    } catch {
      // never let warm-up break startup
    }
  }
}

/**
 * Create (and touch) the cached formatter for each zone so ICU loads its tz data at
 * isolate startup instead of inside a request. Meant for the public zone catalog.
 */
export function prewarmZoneFormatters(zones: readonly string[]): void {
  for (const z of zones) {
    try {
      zoneCache(z).fmt.format(0);
    } catch {
      // ignore unknown ids; warm-up must never break startup
    }
  }
}

/** Exported for unit tests / diagnostics only. */
export const __tzTest = {
  clearCaches: () => zoneCaches.clear(),
  cacheStats: () => ({ zones: zoneCaches.size }),
};
