// Same-origin gateway to the optional play-chip service. Only this Worker vouches for identity.
import { allowed, fromSite, getSessionFromRequest, json } from "./http.js";

const ROUTES = new Map([
  ["/poker/worker.js", "GET"], ["/poker/api/health", "GET"],
  ["/poker/api/session", "POST"], ["/poker/api/state", "GET"], ["/poker/api/command", "POST"],
]);

const bounded = async (stream, limit) => {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
};

// Dependency injection keeps gateway boundary checks independent of D1 and the network.
export const createPokerGateway = (sessionFor = getSessionFromRequest, forward = fetch) => async (request, env) => {
  const url = new URL(request.url), method = ROUTES.get(url.pathname);
  if (!method) return json({ error: "Unknown poker route" }, 404);
  if (request.method !== method) return json({ error: "Method not allowed" }, 405);
  if (!env.POKER_SERVICE_URL || !env.POKER_SERVICE_TOKEN) return json({ error: "Live poker is not configured yet" }, 503);
  if (url.origin !== env.SITE_ORIGIN || !fromSite(request, env.SITE_ORIGIN)) return json({ error: "Forbidden" }, 403);
  const found = await sessionFor(request, env);
  if (!found) return json({ error: "Sign in to Ooga to join live poker" }, 401);
  if (!(await allowed(env.POKER_LIMITER, String(found.player.id)))) return json({ error: "Too many poker requests" }, 429);
  let target;
  try {
    target = new URL(env.POKER_SERVICE_URL);
    if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash || target.origin === url.origin) throw new Error();
  } catch { return json({ error: "Poker service configuration is invalid" }, 503); }
  target.pathname = url.pathname;
  if (url.pathname === "/poker/api/state") {
    for (const [key, value] of url.searchParams) {
      if (!["table", "from", "hand", "after"].includes(key) || value.length > 128 || target.searchParams.has(key)) return json({ error: "Invalid poker cursor" }, 400);
      target.searchParams.set(key, value);
    }
  } else if (url.search) return json({ error: "Unexpected poker query" }, 400);
  // Never relay cookies, browser-provided identity, service secrets, or upstream response cookies.
  const headers = new Headers({
    origin: env.SITE_ORIGIN, "x-poker-service-token": env.POKER_SERVICE_TOKEN,
    "x-player-id": String(found.player.id), "x-player-login": found.player.login,
    "x-player-display": encodeURIComponent(found.player.display || found.player.login),
  });
  for (const name of ["authorization", "x-poker-instance"]) {
    const value = request.headers.get(name);
    if (value) { if (value.length > 160) return json({ error: "Invalid poker session" }, 400); headers.set(name, value); }
  }
  let body;
  if (method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "Expected JSON" }, 415);
    headers.set("content-type", "application/json");
    try { body = await bounded(request.body, 1024 * 1024); }
    catch { return json({ error: "Poker request too large or interrupted" }, 413); }
  }
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, method === "POST" ? 55000 : 25000);
  try {
    const response = await forward(target, { method, headers, body, redirect: "error", signal: controller.signal });
    const script = url.pathname === "/poker/worker.js" && response.ok;
    const type = script ? "text/javascript" : "application/json";
    if (!response.headers.get("content-type")?.startsWith(type) || response.status < 200 || response.status >= 500) throw new Error("Invalid service response");
    const bytes = await bounded(response.body, 16 * 1024 * 1024);
    return new Response(bytes, { status: response.status, headers: {
      "content-type": type + "; charset=utf-8", "cache-control": "no-store",
      "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'",
    } });
  } catch { return json({ error: "Poker service did not answer; reconnecting is safe" }, 502); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
};

export const handlePoker = createPokerGateway();
