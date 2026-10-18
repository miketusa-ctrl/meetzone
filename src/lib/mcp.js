/**
 * MeetZone remote MCP server (v0.2.0). Hand-rolled JSON-RPC 2.0 over Streamable HTTP; no SDK, no dependencies.
 * Transport/protocol code adapted from DnsGuard src/lib/mcp.js, incl. CertGuard c2606ed (modern 2026-07-28 tool results
 * keep _meta["meetzone/error"] next to serverInfo).
 *
 * Dual-era and stateless:
 *  - Modern (MCP 2026-07-28): per-request params._meta protocolVersion + MCP-Protocol-Version / Mcp-Method / Mcp-Name
 *    headers. Methods: server/discover, tools/list, tools/call.
 *  - Legacy (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05): initialize, ping, tools/list, tools/call; batches
 *    (max 10 messages, at most one tools/call).
 *  - No sessions; GET/DELETE → 405; responses are always application/json.
 *
 * FREE TIER ONLY. The MCP endpoint always runs the BASIC plan caps (5 zones, 7 days, 5 slots, 5 search results) via
 * the exact REST route handlers (src/lib/core.ts runTool → handleOverlap / handleZonesSearch). It takes no API key;
 * PRO stays on RapidAPI (the paid path). Each tools/call = one call against the per-IP (/64) limiter.
 */
import { BASIC_CAPS, RAPIDAPI_URL, SUPPORT_EMAIL, VERSION, MCP_CALLS_PER_MIN } from './meta.js';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_BATCH = 10;
export const MAX_CHECKS_PER_REQUEST = 1;
export const DISCOVERY_PER_MIN = 120; // per IP (/64) per isolate, non-tools/call messages
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';
const PASS_HEADERS = ['retry-after', 'x-meetzone-plan-clamped'];

export const E = {
  PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603,
  SERVER: -32000, HEADER_MISMATCH: -32020, UNSUPPORTED_VERSION: -32022,
};

export const MCP_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, x-api-key, mcp-protocol-version, mcp-method, mcp-name',
  'access-control-expose-headers': ['mcp-protocol-version', ...PASS_HEADERS].join(', '),
  'access-control-max-age': '86400',
};

export const SERVER_INFO = { name: 'meetzone-api', title: 'MeetZone', version: VERSION };
export const INSTRUCTIONS = `MeetZone finds meeting times that fall inside working hours in several IANA time zones at once, DST-aware. `
  + `Use search_timezones to turn a city or country name into an IANA zone id, then find_meeting_overlap with 2-${BASIC_CAPS.maxZones} zones. `
  + `This MCP endpoint is the free tier: up to ${BASIC_CAPS.maxZones} zones, ${BASIC_CAPS.maxDays} days, ${BASIC_CAPS.maxOverlapLimit} ranked slots and ${BASIC_CAPS.maxZonesSearchLimit} search results per call, about ${MCP_CALLS_PER_MIN} tool calls per minute per IP. No API key. `
  + `Larger plans (PRO) are on RapidAPI: ${RAPIDAPI_URL}. Contact: ${SUPPORT_EMAIL}.`;

const HM = '^([01][0-9]|2[0-3]):[0-5][0-9]$';
const YMD = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
const zoneLocal = { type: 'object', properties: { zone: { type: 'string' }, start_local: { type: 'string' }, end_local: { type: 'string' }, utc_offset_minutes: { type: 'number' }, abbreviation: { type: 'string' } } };
export const TOOLS = [
  {
    name: 'find_meeting_overlap',
    title: 'Find meeting times that overlap working hours across time zones',
    description: `Given 2-${BASIC_CAPS.maxZones} IANA time zones (e.g. America/New_York, Europe/London, Asia/Tokyo), a local working window applied in every zone (default 09:00-17:00) and up to ${BASIC_CAPS.maxDays} calendar days, returns up to ${BASIC_CAPS.maxOverlapLimit} ranked meeting slots in UTC with each zone's local time, UTC offset and abbreviation, DST-aware, plus an optional ICS event for the top slot. Read-only, pure computation (no calendars are read). Same engine as POST /v1/overlap on the free BASIC plan.`,
    inputSchema: {
      type: 'object',
      properties: {
        zones: { type: 'array', minItems: 2, maxItems: BASIC_CAPS.maxZones, items: { type: 'string', minLength: 1, maxLength: 64 }, description: 'IANA zone ids, e.g. ["America/New_York","Europe/London"]' },
        work_hours: { type: 'object', properties: { start: { type: 'string', pattern: HM, maxLength: 5 }, end: { type: 'string', pattern: HM, maxLength: 5 } }, required: ['start', 'end'], additionalProperties: false, description: 'Local working window applied in each zone (default 09:00-17:00)' },
        days: { type: 'array', maxItems: BASIC_CAPS.maxDays, items: { type: 'string', pattern: YMD, maxLength: 10 }, description: 'Dates YYYY-MM-DD (default: today + 6 days, UTC)' },
        duration_minutes: { type: 'integer', minimum: 5, maximum: 480, description: 'Meeting length in minutes (default 30)' },
        limit: { type: 'integer', minimum: 1, maximum: BASIC_CAPS.maxOverlapLimit, description: `Max ranked slots (default 5, max ${BASIC_CAPS.maxOverlapLimit})` },
        include_ics: { type: 'boolean', description: 'Include an ICS VEVENT for the top slot (default true)' },
      },
      required: ['zones'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        query: { type: 'object', properties: { zones: { type: 'array', items: { type: 'string' } }, work_hours: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' } } }, days: { type: 'array', items: { type: 'string' } }, duration_minutes: { type: 'number' }, plan_note: { type: 'string' } } },
        count: { type: 'number' },
        slots: { type: 'array', items: { type: 'object', properties: { rank: { type: 'number' }, start_utc: { type: 'string' }, end_utc: { type: 'string' }, duration_minutes: { type: 'number' }, local: { type: 'array', items: zoneLocal } } } },
        plan_note: { type: 'string' },
        ics: { type: 'string' },
      },
      required: ['ok', 'count', 'slots'],
    },
    annotations: { title: 'Find meeting overlap', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'search_timezones',
    title: 'Search IANA time zones by city, country or abbreviation',
    description: `Look up IANA time zone ids by city, country, alias or a raw IANA id (e.g. "tokyo", "india", "PST"). Returns up to ${BASIC_CAPS.maxZonesSearchLimit} matches; with a date, also each zone's UTC offset and abbreviation on that day. Read-only. Same engine as GET /v1/zones/search on the free BASIC plan.`,
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 64, description: 'Search text, e.g. "london"' },
        limit: { type: 'integer', minimum: 1, maximum: BASIC_CAPS.maxZonesSearchLimit, description: `Max results (default ${BASIC_CAPS.defaultZonesSearchLimit})` },
        date: { type: 'string', pattern: YMD, maxLength: 10, description: 'Optional YYYY-MM-DD for offsets/abbreviations' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        query: { type: 'string' },
        count: { type: 'number' },
        zones: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, region: { type: 'string' }, utc_offset_minutes: { type: 'number' }, abbreviation: { type: 'string' } } } },
        plan_note: { type: 'string' },
      },
      required: ['ok', 'count', 'zones'],
    },
    annotations: { title: 'Search time zones', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
const TOOL_ARGS = Object.fromEntries(TOOLS.map((t) => [t.name, new Set(Object.keys(t.inputSchema.properties))]));

const clip = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s);

function toolError(message, data, extra = {}) {
  return { content: [{ type: 'text', text: message }], isError: true, ...(data ? { _meta: { 'meetzone/error': data } } : {}), ...extra };
}

const isStrArr = (a, maxItems, maxLen) => Array.isArray(a) && a.length <= maxItems && a.every((x) => typeof x === 'string' && x.length <= maxLen);
const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

/** Light type/size validation before the REST engine (which applies the full rules). Returns an error string or null. */
function validateArgs(name, a) {
  if (name === 'find_meeting_overlap') {
    if (!isStrArr(a.zones, 64, 64)) return 'zones must be an array of IANA zone id strings (each at most 64 chars).';
    if (a.work_hours !== undefined) {
      const w = a.work_hours;
      if (!w || typeof w !== 'object' || Array.isArray(w) || Object.keys(w).some((k) => k !== 'start' && k !== 'end')
        || typeof w.start !== 'string' || typeof w.end !== 'string' || w.start.length > 5 || w.end.length > 5) return 'work_hours must be {"start":"HH:mm","end":"HH:mm"}.';
    }
    if (a.days !== undefined && !isStrArr(a.days, 64, 10)) return 'days must be an array of YYYY-MM-DD strings.';
    if (a.duration_minutes !== undefined && !isInt(a.duration_minutes)) return 'duration_minutes must be an integer 5-480.';
    if (a.limit !== undefined && !isInt(a.limit)) return `limit must be an integer 1-${BASIC_CAPS.maxOverlapLimit}.`;
    if (a.include_ics !== undefined && typeof a.include_ics !== 'boolean') return 'include_ics must be a boolean.';
    return null;
  }
  if (typeof a.q !== 'string' || a.q.length > 64) return 'q must be a string of at most 64 characters.';
  if (a.limit !== undefined && !isInt(a.limit)) return `limit must be an integer 1-${BASIC_CAPS.maxZonesSearchLimit}.`;
  if (a.date !== undefined && (typeof a.date !== 'string' || a.date.length > 10)) return 'date must be YYYY-MM-DD.';
  return null;
}

export function summaryText(name, b) {
  if (name === 'search_timezones') {
    const lines = [`${b.count} time zone match(es) for "${clip(String(b.query), 64)}":`];
    for (const z of b.zones) lines.push(`- ${z.id} (${z.name}${z.abbreviation ? `, ${z.abbreviation}` : ''}${typeof z.utc_offset_minutes === 'number' ? `, UTC${z.utc_offset_minutes >= 0 ? '+' : '-'}${Math.floor(Math.abs(z.utc_offset_minutes) / 60)}:${String(Math.abs(z.utc_offset_minutes) % 60).padStart(2, '0')}` : ''})`);
    if (b.plan_note) lines.push('', b.plan_note);
    return lines.join('\n');
  }
  const lines = [b.count ? `${b.count} meeting slot(s) inside ${b.query.work_hours.start}-${b.query.work_hours.end} local in ${b.query.zones.join(', ')}:` : `No ${b.query.duration_minutes}-minute slot fits ${b.query.work_hours.start}-${b.query.work_hours.end} local in all of ${b.query.zones.join(', ')} on the requested days.`];
  for (const s of b.slots) lines.push(`${s.rank}. ${s.start_utc} - ${s.end_utc} UTC | ${s.local.map((l) => `${l.zone} ${l.start_local.slice(11)}${l.abbreviation ? ` ${l.abbreviation}` : ''}`).join(' | ')}`);
  if (b.plan_note) lines.push('', b.plan_note);
  return lines.join('\n');
}

/** tools/call. Returns { result } or { error } (protocol error), plus HTTP headers to surface. */
async function callTool(params, deps, auth) {
  const { name } = params;
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!Object.hasOwn(TOOL_ARGS, String(name))) return { error: { code: E.INVALID_PARAMS, message: `Unknown tool: ${clip(String(name), 80)}` } };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: { code: E.INVALID_PARAMS, message: 'arguments must be an object' } };
  const allowed = TOOL_ARGS[name];
  const unknown = Object.keys(args).filter((k) => !allowed.has(k));
  if (unknown.length) {
    return { result: toolError(`Unknown argument(s): ${clip(unknown.slice(0, 5).join(', '), 80)}. Allowed: ${[...allowed].join(', ')}.`, { code: 'invalid_arguments', httpStatus: 400 }) };
  }
  const bad = validateArgs(name, args);
  if (bad) return { result: toolError(bad, { code: 'validation_error', httpStatus: 400 }) };
  const r = await deps.runTool({ name, args, auth, env: deps.env, ctx: deps.ctx, ipBucket: deps.ipBucket });
  const headers = { ...(r.headers || {}) };
  if (!r.ok) {
    const retry = r.headers && r.headers['retry-after'] ? Number(r.headers['retry-after']) : undefined;
    const hint = r.code === 'plan_limit_exceeded' ? ` This MCP endpoint is the free tier; PRO limits are on RapidAPI: ${RAPIDAPI_URL}` : '';
    const msg = `${clip(String(r.message), 300)}${retry ? ` (retry after ${retry} seconds)` : ''}${hint}`;
    return { result: toolError(msg, { code: r.code, httpStatus: r.status, ...(retry ? { retryAfterSeconds: retry } : {}) }), headers };
  }
  return { result: { content: [{ type: 'text', text: summaryText(name, r.body) }], structuredContent: r.body, isError: false }, headers };
}

// ---------- transport helpers ----------

/** Origin policy: absent = OK (CLI / server-side clients). Present: must be a bare https origin or an http loopback
 * origin, or (if MCP_ALLOWED_ORIGINS is set) same-origin / listed. Malformed, "null" and plain-http remote → 403. */
export function originAllowed(origin, selfOrigin, allowList) {
  if (origin === null || origin === undefined) return true;
  if (origin === selfOrigin) return true;
  if (allowList) return String(allowList).split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.origin !== origin) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

async function readCapped(request, cap) {
  const cl = Number(request.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > cap) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(buf);
}

function decodeHeaderValue(v) {
  if (v == null) return v;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0))); } catch { return null; }
}

const isId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), error: { code, message, ...(data !== undefined ? { data } : {}) } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

/**
 * Handle one JSON-RPC message. Returns { response?, status?, headers?, isCheck? }.
 * `response` undefined = notification accepted (202 when it's the whole request).
 */
async function handleMessage(msg, { modern, request, deps, auth, checkBudget }) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { response: rpcError(null, E.INVALID_REQUEST, 'Invalid Request'), status: 400 };
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  if (msg.jsonrpc !== '2.0') return { response: rpcError(hasId && isId(msg.id) ? msg.id : null, E.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"'), status: 400 };
  if (typeof msg.method !== 'string') {
    // A JSON-RPC response or garbage. Legacy clients may POST responses → accept like a notification.
    if (!modern && hasId && ('result' in msg || 'error' in msg)) return {};
    return { response: rpcError(hasId && isId(msg.id) ? msg.id : null, E.INVALID_REQUEST, 'Invalid Request: method is required'), status: 400 };
  }
  if (!hasId) return {}; // notification (notifications/initialized, cancelled, …): accepted, nothing to do
  if (!isId(msg.id)) return { response: rpcError(null, E.INVALID_REQUEST, 'Invalid Request: id must be a string or number'), status: 400 };
  const { id, method } = msg;
  const params = msg.params === undefined ? {} : msg.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { response: rpcError(id, E.INVALID_PARAMS, 'params must be an object') };

  const done = (result) => ({ response: rpcResult(id, modern ? { resultType: 'complete', ...result, _meta: { ...(result._meta || {}), [META_SERVER]: SERVER_INFO } } : result) });
  // ^ CertGuard c2606ed: modern results keep a tool error's _meta["meetzone/error"] alongside serverInfo.
  const notFound = () => ({ response: rpcError(id, E.METHOD_NOT_FOUND, `Method not found: ${clip(method, 80)}`), status: modern ? 404 : 200 });

  if (modern) {
    // MCP 2026-07-28 per-request validation (version, capabilities, mirrored headers).
    const hName = decodeHeaderValue(request.headers.get('mcp-name'));
    if (request.headers.get('mcp-method') !== method) return { response: rpcError(id, E.HEADER_MISMATCH, 'Header mismatch: Mcp-Method header is missing or does not match the body method'), status: 400 };
    if (!params._meta || typeof params._meta[META_CAPS] !== 'object' || params._meta[META_CAPS] === null) {
      return { response: rpcError(id, E.INVALID_PARAMS, `Missing required _meta field ${META_CAPS}`), status: 400 };
    }
    if (method === 'tools/call' && hName !== params.name) return { response: rpcError(id, E.HEADER_MISMATCH, 'Header mismatch: Mcp-Name header is missing or does not match params.name'), status: 400 };
    if (method === 'server/discover') {
      return done({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: 'public' });
    }
    if (method === 'tools/list') return done({ tools: TOOLS, ttlMs: 3_600_000, cacheScope: 'public' });
    if (method !== 'tools/call') return notFound(); // includes initialize and ping (removed in 2026-07-28)
  } else {
    if (method === 'initialize') {
      const req = params.protocolVersion;
      const protocolVersion = LEGACY_VERSIONS.includes(req) ? req : LEGACY_VERSIONS[0];
      return done({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    if (method === 'ping') return done({});
    if (method === 'tools/list') return done({ tools: TOOLS });
    if (method === 'server/discover') return done({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    if (method !== 'tools/call') return notFound();
  }

  // tools/call
  if (typeof params.name !== 'string') return { response: rpcError(id, E.INVALID_PARAMS, 'params.name (tool name) is required') };
  if (checkBudget.used >= MAX_CHECKS_PER_REQUEST) {
    return { response: rpcError(id, E.INVALID_REQUEST, `At most ${MAX_CHECKS_PER_REQUEST} tools/call per HTTP request; send each call as its own request.`) };
  }
  checkBudget.used++;
  const r = await callTool(params, deps, auth);
  if (r.error) return { response: rpcError(id, r.error.code, r.error.message), isCheck: true };
  return { ...done(r.result), headers: r.headers, isCheck: true };
}

/** Entry point from the router for every request to /mcp. */
export async function handleMcp(request, env, ctx, deps) {
  const base = { ...deps.cors, ...deps.security };
  const reply = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { 'content-type': 'application/json; charset=utf-8' }), 'cache-control': 'no-store', ...base, ...extra },
  });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...deps.cors } });
  if (!originAllowed(request.headers.get('origin'), deps.origin, deps.allowedOrigins)) {
    return reply(403, rpcError(undefined, E.SERVER, 'Forbidden: Origin not allowed'));
  }
  if (request.method !== 'POST') {
    return reply(405, rpcError(undefined, E.SERVER, 'Method not allowed. This MCP endpoint is stateless: POST JSON-RPC messages (no SSE stream, no sessions). Docs: /llms.txt'), { allow: 'POST, OPTIONS' });
  }
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return reply(413, rpcError(undefined, E.INVALID_REQUEST, `Request body too large (max ${MAX_BODY_BYTES} bytes)`));
  let payload;
  try { payload = JSON.parse(text); } catch { return reply(400, rpcError(null, E.PARSE, 'Parse error: body must be valid JSON')); }

  // Era detection. Modern = per-request _meta version or a modern MCP-Protocol-Version header.
  const hVer = request.headers.get('mcp-protocol-version');
  const single = !Array.isArray(payload);
  const metaVer = single && payload && typeof payload === 'object' && payload.params && typeof payload.params === 'object'
    && payload.params._meta && typeof payload.params._meta === 'object' ? payload.params._meta[META_VERSION] : undefined;
  const modern = metaVer !== undefined || MODERN_VERSIONS.includes(hVer);
  const idOf = (p) => (p && typeof p === 'object' && isId(p.id) ? p.id : null);
  if (modern) {
    if (!single) return reply(400, rpcError(null, E.INVALID_REQUEST, 'JSON-RPC batches are not supported in protocol 2026-07-28; send one message per POST'));
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'id')) {
      if (metaVer === undefined && typeof payload.method === 'string') {
        return reply(400, rpcError(idOf(payload), E.INVALID_PARAMS, `Missing required _meta field ${META_VERSION}`));
      }
      if (metaVer !== undefined && !SUPPORTED_VERSIONS.includes(metaVer)) {
        return reply(400, rpcError(idOf(payload), E.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: clip(String(metaVer), 40) }));
      }
      if (metaVer !== undefined && !MODERN_VERSIONS.includes(metaVer)) {
        return reply(400, rpcError(idOf(payload), E.UNSUPPORTED_VERSION, `Protocol version ${metaVer} uses the initialize handshake; per-request _meta requires one of: ${MODERN_VERSIONS.join(', ')}`, { supported: SUPPORTED_VERSIONS, requested: metaVer }));
      }
      if (hVer !== metaVer) return reply(400, rpcError(idOf(payload), E.HEADER_MISMATCH, 'Header mismatch: MCP-Protocol-Version header is missing or does not match _meta protocolVersion'));
    }
  } else if (hVer && !LEGACY_VERSIONS.includes(hVer)) {
    return reply(400, rpcError(single ? idOf(payload) : null, E.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: clip(hVer, 40) }));
  }

  const msgs = single ? [payload] : payload;
  if (!msgs.length) return reply(400, rpcError(null, E.INVALID_REQUEST, 'Invalid Request: empty batch'));
  if (msgs.length > MAX_BATCH) return reply(400, rpcError(null, E.INVALID_REQUEST, `Batch too large (max ${MAX_BATCH} messages)`));

  // Light per-IP cap on non-check messages (checks are governed by the /api/check limits inside runCheck).
  const nonCheck = msgs.filter((m) => !(m && m.method === 'tools/call')).length;
  for (let i = 0; i < nonCheck; i++) {
    if (!deps.memLimit(`mcp:${deps.ipBucket}`, DISCOVERY_PER_MIN, 60_000)) {
      return reply(429, rpcError(single ? idOf(payload) : null, E.SERVER, `Too many MCP requests from your IP (about ${DISCOVERY_PER_MIN} per minute). Retry in a minute.`, { code: 'rate_limited', retryAfterSeconds: 60 }), { 'retry-after': '60' });
    }
  }

  // Same key gate as /api/check, evaluated once per HTTP request (bad key → 401 for every method).
  const auth = await deps.authenticate(request, env);
  if (!auth.ok) {
    // No WWW-Authenticate on /mcp: MCP clients treat a 401 Bearer challenge as "start OAuth discovery", which this
    // server doesn't offer; the JSON-RPC error body (data.code = invalid_api_key) is the useful signal.
    const extra = { ...(auth.headers || {}) };
    return reply(auth.status, rpcError(single ? idOf(payload) : null, E.SERVER, auth.message, { code: auth.code, httpStatus: auth.status }), extra);
  }

  const mdeps = { ...deps, env, ctx };
  const checkBudget = { used: 0 };
  const responses = [];
  let status = 200;
  let headers = {};
  for (const m of msgs) {
    let out;
    try {
      out = await handleMessage(m, { modern, request, deps: mdeps, auth, checkBudget });
    } catch {
      out = { response: rpcError(idOf(m), E.INTERNAL, 'Internal error') };
    }
    if (out.response) responses.push(out.response);
    if (single) status = out.status || 200;
    if (out.headers) headers = { ...headers, ...out.headers }; // batches too
  }
  if (!responses.length) return reply(202, null);
  const exposed = {};
  for (const h of PASS_HEADERS) if (headers[h]) exposed[h] = headers[h];
  return reply(status, single ? responses[0] : responses, exposed);
}
