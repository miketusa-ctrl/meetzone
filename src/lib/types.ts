/** Shared request/response types for MeetZone Day-1 API */

export interface WorkHours {
  /** Local HH:mm inclusive start (default "09:00") */
  start: string;
  /** Local HH:mm exclusive end (default "17:00") */
  end: string;
}

export interface OverlapRequest {
  /** IANA timezone ids, 2–12 (BASIC plan capped at 5 server-side) */
  zones: string[];
  /**
   * Shared local work window applied independently in each zone.
   * Example: start "09:00" end "17:00" means 9am–5pm local in every listed zone.
   */
  work_hours?: WorkHours;
  /**
   * Calendar days to search as YYYY-MM-DD (UTC calendar date labels for the query).
   * Each day is evaluated in each zone's local calendar for that civil date.
   * Default: today + next 6 days (7 days total) in UTC.
   * BASIC plan capped at 7; PRO at 31.
   */
  days?: string[];
  /** Desired meeting length in minutes (default 30). Must be 5–480. */
  duration_minutes?: number;
  /** Max ranked slots to return (default 5; BASIC clamps above 5, PRO max 20). */
  limit?: number;
  /** If true, include an ICS VEVENT string for the top-ranked slot (default true). */
  include_ics?: boolean;
}

export interface ZoneLocalWindow {
  zone: string;
  start_local: string; // YYYY-MM-DDTHH:mm
  end_local: string;
  utc_offset_minutes: number;
  abbreviation?: string;
}

export interface OverlapSlot {
  rank: number;
  start_utc: string; // ISO-8601 Z
  end_utc: string;
  duration_minutes: number;
  local: ZoneLocalWindow[];
}

export interface OverlapResponse {
  ok: true;
  query: {
    zones: string[];
    work_hours: WorkHours;
    days: string[];
    duration_minutes: number;
    /** Present when BASIC clamped result-count limit */
    plan_note?: string;
  };
  count: number;
  slots: OverlapSlot[];
  /** Present when BASIC clamped result-count limit */
  plan_note?: string;
  /** ICS calendar fragment for the top slot when include_ics !== false and slots.length > 0 */
  ics?: string;
}

export interface ZoneInfo {
  id: string;
  name: string;
  aliases: string[];
  region?: string;
  utc_offset_minutes?: number;
  abbreviation?: string;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Env {
  VERSION?: string;
  RAPIDAPI_PROXY_SECRET?: string;
  /** Workers Rate Limiting binding for MCP tools/call (10/60s per IP /64). */
  MCP_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** Daily-unique-visitor hashes only (uv:<day>:<hash>, TTL 9 days). */
  MEETZONE_KV?: KVNamespace;
  /** Secret; unset = visitor counter off. */
  VISITOR_SALT?: string;
  FLEET_UA_MARKERS?: string;
  MCP_ALLOWED_ORIGINS?: string;
  /** Official MCP Registry HTTP proof (public key record only). */
  MCP_REGISTRY_AUTH?: string;
}
