/**
 * Shared gate + limits for the MCP endpoint (agent-ready recipe r2 §1, adapted).
 * MeetZone's REST routes are only reachable through RapidAPI (proxy-secret gate in index.ts), so the REST contract
 * is untouched: runTool() calls the SAME route handlers (handleOverlap / handleZonesSearch) with a synthetic request
 * that carries no X-RapidAPI-Subscription header, i.e. always the BASIC (free) caps.
 */
// @ts-ignore -- plain JS module
import { MCP_CALLS_PER_MIN, RAPIDAPI_URL } from "./meta.js";
import { handleOverlap } from "../routes/overlap.js";
import { handleZonesSearch } from "../routes/zones.js";
import type { Env } from "./types.js";

export type Auth = { ok: true; tier: "free" } | { ok: false; status: number; code: string; message: string; headers?: Record<string, string> };
export type ToolResult =
  | { ok: true; body: any; headers: Record<string, string> }
  | { ok: false; status: number; code: string; message: string; headers: Record<string, string> };

/** The MCP endpoint is free-tier only and takes no key. A supplied key is rejected (401) rather than silently ignored. */
export async function authenticate(request: Request, _env: Env): Promise<Auth> {
  const authz = (request.headers.get("authorization") ?? "").trim();
  const xkey = (request.headers.get("x-api-key") ?? "").trim();
  if (authz || xkey) {
    return {
      ok: false,
      status: 401,
      code: "invalid_api_key",
      message: `The MeetZone MCP endpoint is free tier only and takes no API key; remove the Authorization / X-Api-Key header. For PRO limits use RapidAPI: ${RAPIDAPI_URL}`,
    };
  }
  return { ok: true, tier: "free" };
}

/** IPv4 as is; IPv6 → its /64 (same output as workdayapi/certguard ipBucket). */
export function ipBucket(ip: string | null | undefined): string {
  const s = String(ip || "unknown").trim().toLowerCase();
  if (!s.includes(":")) return s;
  if (s.includes(".")) return s.slice(s.lastIndexOf(":") + 1);
  const [h, t] = s.split("::");
  const head = h ? h.split(":") : [];
  const tail = t ? t.split(":") : [];
  const parts = t === undefined ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  return parts.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "") || "0").join(":") + "::/64";
}

const memLimits = new Map<string, { start: number; n: number }>();
/** Per-isolate fixed-window limiter (discovery cap; fallback when the MCP_LIMITER binding is absent, e.g. tests). */
export function memLimit(key: string, limit: number, periodMs: number): boolean {
  const now = Date.now();
  const e = memLimits.get(key);
  if (!e || now - e.start > periodMs) {
    if (memLimits.size > 5000) memLimits.clear();
    memLimits.set(key, { start: now, n: 1 });
    return true;
  }
  e.n++;
  return e.n <= limit;
}
export function resetMemLimits(): void { memLimits.clear(); }

async function toolAllowed(env: Env, bucket: string): Promise<boolean> {
  const lim = env.MCP_LIMITER;
  if (lim && typeof lim.limit === "function") {
    try { return (await lim.limit({ key: `mcp:${bucket}` })).success; } catch { /* fall through */ }
  }
  return memLimit(`mcpcall:${bucket}`, MCP_CALLS_PER_MIN, 60_000);
}

/** One tools/call = one limiter hit, then the REST handler on BASIC caps. */
export async function runTool(o: { name: string; args: Record<string, unknown>; env: Env; ipBucket: string }): Promise<ToolResult> {
  if (!(await toolAllowed(o.env, o.ipBucket))) {
    return { ok: false, status: 429, code: "rate_limited", message: `Too many tool calls from your IP (about ${MCP_CALLS_PER_MIN} per minute on the free tier)`, headers: { "retry-after": "60" } };
  }
  let res: Response;
  if (o.name === "find_meeting_overlap") {
    res = await handleOverlap(new Request("https://mcp.internal/v1/overlap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o.args) }));
  } else {
    const u = new URL("https://mcp.internal/v1/zones/search");
    u.searchParams.set("q", String(o.args.q ?? ""));
    if (o.args.limit !== undefined) u.searchParams.set("limit", String(o.args.limit));
    if (o.args.date !== undefined) u.searchParams.set("date", String(o.args.date));
    res = handleZonesSearch(u, new Request(u.toString()));
  }
  const headers: Record<string, string> = {};
  const clampedH = res.headers.get("x-meetzone-plan-clamped");
  if (clampedH) headers["x-meetzone-plan-clamped"] = clampedH;
  const body = (await res.json()) as any;
  if (!res.ok) {
    return { ok: false, status: res.status, code: String(body?.error?.code ?? "error"), message: String(body?.error?.message ?? "Request failed"), headers };
  }
  return { ok: true, body, headers };
}
