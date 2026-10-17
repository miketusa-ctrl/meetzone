/** Agent-facing docs generated from code constants (recipe r2 §3-5, §13.2). Never hard-code a limit twice. */
import { TOOLS, SUPPORTED_VERSIONS, DISCOVERY_PER_MIN, SERVER_INFO } from './mcp.js';
import { BASIC_CAPS, MCP_CALLS_PER_MIN, RAPIDAPI_URL, SUPPORT_EMAIL, VERSION, PRO_PRICE } from './meta.js';
import { resolvePlan } from './plan.ts';

const PRO_CAPS = resolvePlan('PRO');
export const mcpClientConfig = (origin) => ({ mcpServers: { 'meetzone-api': { type: 'http', url: `${origin}/mcp` } } });

export const llmsTxt = (origin) => `# MeetZone

> Find meeting times that overlap working hours across several IANA time zones, DST-aware. Remote MCP server for AI agents (free tier) plus a JSON API on RapidAPI.

## For AI agents

- [MCP server](${origin}/mcp): remote MCP over Streamable HTTP (POST only, stateless, JSON responses). Protocol versions: ${SUPPORTED_VERSIONS.join(', ')}. Tools \`${TOOLS[0].name}\` (zones, work_hours, days, duration_minutes, limit, include_ics) and \`${TOOLS[1].name}\` (q, limit, date). Read-only. Client config (most MCP clients accept this; some use a different format, for example VS Code uses a \`servers\` key): \`${JSON.stringify(mcpClientConfig(origin))}\`
- [OpenAPI 3.1 spec](${origin}/openapi.json): machine-readable description of this origin's routes
- [Server card](${origin}/.well-known/mcp/server-card.json)

## JSON API (RapidAPI)

- The JSON API (\`POST /v1/overlap\`, \`GET /v1/zones/search\`, \`GET /v1/health\`) is served through RapidAPI: ${RAPIDAPI_URL}. Direct calls to ${origin}/v1/... without the RapidAPI gateway return HTTP 401 \`unauthorized\`.
- Errors: { "ok": false, "error": { "code", "message", "details"? } } with 400 validation_error / plan_limit_exceeded, 404 unknown_zone / not_found, 401 unauthorized, 500 internal_error.

## Limits and pricing

- MCP (free tier, no key): up to ${BASIC_CAPS.maxZones} zones, ${BASIC_CAPS.maxDays} days, ${BASIC_CAPS.maxOverlapLimit} ranked slots and ${BASIC_CAPS.maxZonesSearchLimit} search results per call; about ${MCP_CALLS_PER_MIN} tool calls per minute per IP (HTTP 200 tool error with retryAfterSeconds and Retry-After). Other MCP messages (initialize, tools/list, ping, server/discover) are capped at about ${DISCOVERY_PER_MIN}/min per IP (HTTP 429 + Retry-After). Sending an API key to /mcp returns HTTP 401.
- RapidAPI BASIC: same caps as MCP, with the monthly quota shown on RapidAPI. RapidAPI PRO (${PRO_PRICE}): up to ${PRO_CAPS.maxZones} zones, ${PRO_CAPS.maxDays} days, ${PRO_CAPS.maxOverlapLimit} slots, ${PRO_CAPS.maxZonesSearchLimit} search results.

## Optional

- [Privacy](${origin}/v1/privacy)
- Contact: ${SUPPORT_EMAIL}
`;

const errSchema = { type: 'object', properties: { ok: { type: 'boolean', const: false }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} }, required: ['code', 'message'] } }, required: ['ok', 'error'] };
const rpc = { type: 'object', description: 'JSON-RPC 2.0 message or batch (legacy protocol versions only; max 10, at most one tools/call)' };
const text = (d) => ({ description: d, content: { 'text/plain': { schema: { type: 'string' } } } });
const jsonR = (d, schema = { type: 'object' }) => ({ description: d, content: { 'application/json': { schema } } });
const e = (d) => jsonR(d, { $ref: '#/components/schemas/Error' });
const rpcR = (d) => jsonR(d, rpc);
const rapid = { security: [{ rapidApiGateway: [] }] };

/** OpenAPI 3.1. Operations must equal ROUTE_PROBES below (drift test). */
export function openApiSpec(origin) {
  const overlapIn = { ...TOOLS[0].inputSchema, properties: { ...TOOLS[0].inputSchema.properties, zones: { ...TOOLS[0].inputSchema.properties.zones, maxItems: PRO_CAPS.maxZones }, days: { ...TOOLS[0].inputSchema.properties.days, maxItems: PRO_CAPS.maxDays }, limit: { type: 'integer', minimum: 1, maximum: PRO_CAPS.maxOverlapLimit } } };
  return {
    openapi: '3.1.0',
    info: { title: 'MeetZone', version: VERSION, description: `Timezone meeting-overlap API. /mcp, docs and the homepage are public; /v1/* is served through RapidAPI (${RAPIDAPI_URL}) and returns 401 without the RapidAPI gateway.`, contact: { email: SUPPORT_EMAIL } },
    servers: [{ url: origin }],
    paths: {
      '/': { get: { summary: 'Homepage (HTML)', responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } } } },
      '/mcp': {
        post: { summary: 'MCP JSON-RPC (Streamable HTTP, stateless, JSON responses). Free tier, no key.', requestBody: { required: true, content: { 'application/json': { schema: rpc } } },
          responses: { 200: rpcR('JSON-RPC result(s); tool errors are results with isError and _meta["meetzone/error"]'), 202: { description: 'Only notifications / client responses' }, 400: rpcR('Parse error, invalid request, header mismatch (-32020) or unsupported version (-32022)'), 401: rpcR('An API key was sent (the MCP endpoint takes none)'), 403: rpcR('Origin not allowed'), 404: rpcR('Method not found (2026-07-28)'), 413: rpcR('Body over 64 KB'), 429: { ...rpcR('Too many non-tool messages'), headers: { 'Retry-After': { schema: { type: 'integer' } } } }, 500: rpcR('Internal error'), 503: rpcR('Temporarily unavailable') } },
        get: { summary: 'Not supported (no SSE)', responses: { 405: { description: 'Method not allowed', headers: { Allow: { schema: { type: 'string', const: 'POST, OPTIONS' } } } } } },
        delete: { summary: 'Not supported (no sessions)', responses: { 405: { description: 'Method not allowed', headers: { Allow: { schema: { type: 'string', const: 'POST, OPTIONS' } } } } } },
      },
      '/llms.txt': { get: { summary: 'llms.txt', responses: { 200: text('llms.txt') } } },
      '/openapi.json': { get: { summary: 'This document', responses: { 200: jsonR('OpenAPI 3.1') } } },
      '/.well-known/mcp/server-card.json': { get: { summary: 'MCP server card', responses: { 200: jsonR('Server card') } } },
      '/.well-known/mcp-registry-auth': { get: { summary: 'Official MCP Registry HTTP proof (public key)', responses: { 200: text('v=MCPv1 record'), 404: text('Not configured') } } },
      '/v1/privacy': { get: { summary: 'Privacy and acceptable use (HTML)', responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } } } },
      '/v1/health': { get: { ...rapid, summary: 'Health', responses: { 200: jsonR('ok + version', { type: 'object', properties: { ok: { type: 'boolean' }, version: { type: 'string' } } }), 401: e('Missing RapidAPI gateway') } } },
      '/v1/zones/search': { get: { ...rapid, summary: 'Search IANA zones', parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string', maxLength: 64 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: PRO_CAPS.maxZonesSearchLimit } },
        { name: 'date', in: 'query', schema: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', maxLength: 10 } }],
        responses: { 200: { ...jsonR('Matches', TOOLS[1].outputSchema), headers: { 'X-MeetZone-Plan-Clamped': { schema: { type: 'string' }, description: 'Present when BASIC clamped limit' } } }, 400: e('validation_error | plan_limit_exceeded'), 401: e('unauthorized') } } },
      '/v1/overlap': { post: { ...rapid, summary: 'Ranked meeting slots across zones', requestBody: { required: true, content: { 'application/json': { schema: overlapIn } } },
        responses: { 200: { ...jsonR('Slots', TOOLS[0].outputSchema), headers: { 'X-MeetZone-Plan-Clamped': { schema: { type: 'string' }, description: 'Present when BASIC clamped limit' } } }, 400: e('validation_error | plan_limit_exceeded'), 401: e('unauthorized'), 404: e('unknown_zone'), 500: e('internal_error') } } },
    },
    components: {
      schemas: { Error: errSchema },
      securitySchemes: { rapidApiGateway: { type: 'apiKey', in: 'header', name: 'X-RapidAPI-Key', description: `Subscribe on RapidAPI (${RAPIDAPI_URL}) and call the RapidAPI host; the gateway authenticates you.` } },
    },
  };
}

/** [method, path, expected status without the RapidAPI gateway] — used by the drift test. */
export const ROUTE_PROBES = [
  ['get', '/', 200], ['post', '/mcp', 200], ['get', '/mcp', 405], ['delete', '/mcp', 405], ['get', '/llms.txt', 200], ['get', '/openapi.json', 200],
  ['get', '/.well-known/mcp/server-card.json', 200], ['get', '/.well-known/mcp-registry-auth', 404], ['get', '/v1/privacy', 200],
  ['get', '/v1/health', 401], ['get', '/v1/zones/search', 401], ['post', '/v1/overlap', 401],
];

export const serverCard = (origin) => ({
  serverInfo: { name: SERVER_INFO.name, title: SERVER_INFO.title, version: VERSION },
  description: 'Find meeting times that overlap working hours across IANA time zones (DST-aware). Free tier, no key.',
  websiteUrl: `${origin}/`,
  transport: { type: 'streamable-http', url: `${origin}/mcp` },
  protocolVersions: SUPPORTED_VERSIONS,
  authentication: { required: false, schemes: [] },
  capabilities: { tools: { listChanged: false } },
  tools: TOOLS,
  resources: [],
  prompts: [],
});

export const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d4ed8"/><circle cx="32" cy="32" r="20" fill="none" stroke="#fff" stroke-width="5"/><path d="M32 20v13l9 6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>';
export const ROBOTS_TXT = 'User-agent: *\nAllow: /\n';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const NEWTAB = 'target="_blank" rel="noopener noreferrer"';
export function homepageHtml(origin) {
  const cfg = JSON.stringify(mcpClientConfig(origin), null, 2);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MeetZone: meeting times across time zones (API + MCP)</title>
<meta name="description" content="Find meeting times that overlap working hours across IANA time zones, DST-aware. JSON API on RapidAPI and a free remote MCP server.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="service-desc" type="application/json" href="/openapi.json" title="OpenAPI 3.1">
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#111}.wrap{max-width:760px;margin:0 auto;padding:16px}pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow-x:auto}.small{font-size:14px;color:#444}@media (max-width:560px){#mcp-config{white-space:pre-wrap;word-break:break-all}}</style>
</head><body>
<header class="wrap"><h1>MeetZone</h1><p>Find meeting times that fall inside working hours in several IANA time zones at once. DST-aware, ranked slots in UTC with each zone's local time, plus an ICS event.</p></header>
<section id="api" class="wrap"><h2>JSON API</h2><p>The JSON API (<code>POST /v1/overlap</code>, <code>GET /v1/zones/search</code>) is on <a href="${RAPIDAPI_URL}" ${NEWTAB}>RapidAPI</a>: free BASIC plan (${BASIC_CAPS.maxZones} zones, ${BASIC_CAPS.maxDays} days, ${BASIC_CAPS.maxOverlapLimit} slots) and PRO (${esc(PRO_PRICE)}; ${PRO_CAPS.maxZones} zones, ${PRO_CAPS.maxDays} days, ${PRO_CAPS.maxOverlapLimit} slots).</p></section>
<section id="agents" class="wrap"><h2>For AI agents (MCP)</h2>
<p>MeetZone is also a remote <a href="https://modelcontextprotocol.io/" ${NEWTAB}>Model Context Protocol</a> (MCP) server. Most MCP clients accept this config; some use a different format (for example, VS Code uses a <code>servers</code> key). Clients with a settings screen just need the URL <code>${esc(origin)}/mcp</code>.</p>
<pre><code id="mcp-config">${esc(cfg)}</code></pre>
<p>The MCP endpoint is the free tier (no key): up to ${BASIC_CAPS.maxZones} zones, ${BASIC_CAPS.maxDays} days and ${BASIC_CAPS.maxOverlapLimit} slots per call, about ${MCP_CALLS_PER_MIN} tool calls per minute per IP.</p>
<p class="small">Machine-readable docs: <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI 3.1 spec</a></p></section>
<footer class="wrap small"><p><a href="/v1/privacy">Privacy &amp; acceptable use</a> · Contact: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> · v${VERSION}</p></footer>
<script>document.getElementById('mcp-config').textContent = JSON.stringify({ mcpServers: { 'meetzone-api': { type: 'http', url: \`\${location.origin}/mcp\` } } }, null, 2);</script>
</body></html>`;
}
