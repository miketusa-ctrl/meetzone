/**
 * MeetZone API — Cloudflare Worker entry
 * Day-1: health, zones/search, overlap
 */

import { corsPreflight, errorResponse, json } from "./lib/http.js";
import type { Env } from "./lib/types.js";
import { handleHealth } from "./routes/health.js";
import { handleOverlap } from "./routes/overlap.js";
import { handlePrivacy } from "./routes/privacy.js";
import { handleZonesSearch } from "./routes/zones.js";
import { authenticate, ipBucket, memLimit, runTool } from "./lib/core.js";
// @ts-ignore -- plain JS modules (hand-rolled MCP, adapted from DnsGuard)
import { handleMcp, MCP_CORS } from "./lib/mcp.js";
// @ts-ignore
import { llmsTxt, openApiSpec, serverCard, homepageHtml, FAVICON_SVG, ROBOTS_TXT } from "./lib/agentdocs.js";
// @ts-ignore
import { countVisitor } from "./lib/visitors.js";

const DOC_CORS: Record<string, string> = { "access-control-allow-origin": "*" };
const SECURITY: Record<string, string> = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const REGISTRY_PROOF_RE = /^v=MCPv1; k=(ed25519|ecdsap384); p=[A-Za-z0-9+/=]{20,120}$/;

/** v0.2.0 public agent surface (no RapidAPI proxy secret): homepage, /mcp, llms.txt, OpenAPI, server card, registry proof. */
async function handlePublic(request: Request, env: Env, ctx: ExecutionContext | undefined, url: URL, path: string): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const bucket = ipBucket(ip);
  if (path === "/mcp") {
    if (request.method === "POST") countVisitor(request, env, ctx, bucket);
    return handleMcp(request, env, ctx, {
      authenticate, runTool, ipBucket: bucket, origin: url.origin, memLimit,
      cors: MCP_CORS, security: SECURITY, allowedOrigins: env.MCP_ALLOWED_ORIGINS,
    });
  }
  if (path.startsWith("/.well-known/oauth-protected-resource") || path.startsWith("/.well-known/oauth-authorization-server")) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain", ...SECURITY } });
  }
  const docPaths = ["/llms.txt", "/openapi.json", "/.well-known/mcp/server-card.json", "/.well-known/mcp-registry-auth", "/favicon.svg", "/robots.txt"];
  const isHome = path === "/" && !request.headers.has("X-RapidAPI-Proxy-Secret") && (request.method === "GET" || request.method === "HEAD");
  if (!docPaths.includes(path) && !isHome) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...DOC_CORS, "access-control-allow-methods": "GET, HEAD, OPTIONS" } });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ ok: false, error: { code: "method_not_allowed", message: "Use GET." } }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", allow: "GET, HEAD, OPTIONS", ...DOC_CORS, ...SECURITY } });
  }
  const head = request.method === "HEAD";
  const doc = (body: string, type: string, cache = "public, max-age=3600") =>
    new Response(head ? null : body, { headers: { "content-type": type, "cache-control": cache, ...DOC_CORS, ...SECURITY } });
  if (isHome) {
    if (!head) countVisitor(request, env, ctx, bucket);
    return doc(homepageHtml(url.origin), "text/html; charset=utf-8", "public, max-age=300");
  }
  if (path === "/llms.txt") return doc(llmsTxt(url.origin), "text/plain; charset=utf-8");
  if (path === "/openapi.json") return doc(JSON.stringify(openApiSpec(url.origin), null, 2), "application/json; charset=utf-8");
  if (path === "/.well-known/mcp/server-card.json") return doc(JSON.stringify(serverCard(url.origin), null, 2), "application/json; charset=utf-8");
  if (path === "/favicon.svg") return doc(FAVICON_SVG, "image/svg+xml", "public, max-age=86400");
  if (path === "/robots.txt") return doc(ROBOTS_TXT, "text/plain; charset=utf-8");
  const proof = String(env.MCP_REGISTRY_AUTH || "").trim();
  if (REGISTRY_PROOF_RE.test(proof)) return doc(`${proof}\n`, "text/plain; charset=utf-8", "no-store");
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain", ...SECURITY } });
}

// 2026-10-03: startup warm-up removed (it only existed for the Workers Free 10 ms CPU cap).
// Account is on Workers Paid; per-zone formatter/offset caches still fill lazily per isolate.

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    try {
      {
        const u = new URL(request.url);
        const p = u.pathname === "/" ? "/" : u.pathname.replace(/\/+$/, "") || "/";
        const pub = await handlePublic(request, env, ctx, u, p);
        if (pub) return pub;
      }
      if (request.method === "OPTIONS") {
        return corsPreflight();
      }

      const urlEarly = new URL(request.url);
      const pathEarly = urlEarly.pathname.replace(/\/+$/, "") || "/";
      // Public docs: no proxy secret (Hub privacy link must open without X-RapidAPI-Proxy-Secret)
      if (request.method === "GET" && (pathEarly === "/v1/privacy" || pathEarly === "/privacy")) {
        return handlePrivacy();
      }

      // When RAPIDAPI_PROXY_SECRET is configured, require RapidAPI proxy header
      // (allows Hub proxy traffic; blocks anonymous hits on workers.dev).
      if (env.RAPIDAPI_PROXY_SECRET) {
        const provided = request.headers.get("X-RapidAPI-Proxy-Secret") ?? "";
        if (provided !== env.RAPIDAPI_PROXY_SECRET) {
          return errorResponse(401, "unauthorized", "Missing or invalid RapidAPI proxy secret");
        }
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "GET" && (path === "/v1/health" || path === "/health")) {
        return handleHealth(env);
      }

      if (request.method === "GET" && path === "/v1/zones/search") {
        return handleZonesSearch(url, request);
      }

      // Friendly alias
      if (request.method === "GET" && path === "/v1/zones") {
        return handleZonesSearch(url, request);
      }

      if (request.method === "POST" && path === "/v1/overlap") {
        return handleOverlap(request);
      }

      if (path === "/" || path === "/v1") {
        return json({
          ok: true,
          name: "MeetZone API",
          version: env.VERSION ?? "0.1.0",
          endpoints: [
            "GET /v1/health",
            "GET /v1/zones/search?q=",
            "POST /v1/overlap",
            "GET /v1/privacy",
          ],
        });
      }

      return errorResponse(404, "not_found", `No route for ${request.method} ${path}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Internal error";
      return errorResponse(500, "internal_error", message);
    }
  },
} satisfies ExportedHandler<Env>;
