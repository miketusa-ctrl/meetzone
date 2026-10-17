import { json } from "../lib/http.js";
import type { Env } from "../lib/types.js";

export function handleHealth(env: Env): Response {
  return json({ ok: true, version: env.VERSION ?? "0.1.0" });
}
