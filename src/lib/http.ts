import type { ApiErrorBody } from "./types.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "Content-Type, X-RapidAPI-Key, X-RapidAPI-Host, X-RapidAPI-Proxy-Secret, X-RapidAPI-Subscription",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    ok: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return json(body, status);
}

export function corsPreflight(): Response {
  const headers = new Headers(CORS);
  return new Response(null, { status: 204, headers });
}
