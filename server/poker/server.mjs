// Disposable play chips; optional account gateway. No wallets, balances in money, or rake.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadProtocol, root, source } from "./load.mjs";

export function createPokerServer(options = {}) {
  const BL = loadProtocol(), C = BL.pokerCrypto;
  const tables = Array.from({ length: 10 }, (_, i) => BL.pokerMatch.create(i));
  const sessions = new Map(), publicKeys = new Map(), queues = tables.map(() => Promise.resolve()), waiters = new Map();
  const accounts = new Map(), instance = randomBytes(32).toString("hex"), serviceToken = options.serviceToken || "";
  if (serviceToken && !/^[0-9a-f]{64}$/.test(serviceToken)) throw new Error("POKER_SERVICE_TOKEN must be 32 random bytes encoded as lowercase hex");
  const origins = options.origins instanceof Set ? options.origins : new Set(options.origins || ["http://127.0.0.1:8787", "http://localhost:8787"]);
  const clock = options.clock || Date.now, timeout = options.timeout || 90000;
  const changedAt = tables.map(() => clock()), cooldowns = new Map();
  const archives = tables.map(() => []);
  let revision = 0;
  const page = options.page || (() => readFileSync(root + "oogaboogaland.html"));
  const worker = "self.window = self;\n" + source + "\n" + readFileSync(root + "src/js/poker-recovery.js", "utf8") + "\n" + readFileSync(root + "src/js/poker-worker.js", "utf8");
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };
  const send = (res, status, value) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); };
  const publicState = (session, table, from, hand) => {
    const match = tables[table], offset = hand === match.handNonce && from <= match.eventCount ? from : 0;
    const record = match.export(offset), view = match.summary();
    let audit = null;
    if (record) {
      audit = { protocol: record.protocol, table, initial: record.initial, root: record.root, offset, events: record.events };
    }
    return { instance, revision, table, tables: tables.map(t => t.summary()), phase: view.phase, audit, previous: hand && (hand !== match.handNonce || !record) ? archives[table].find(r => r.events[0].request.data.nonce === hand) || null : null, seq: match.state().counters.find(([id]) => id === session.publicKey)?.[1] || 0,
      deadline: match.active ? changedAt[table] + timeout : null };
  };
  const wake = () => { revision++; for (const finish of [...waiters.values()]) finish(); };
  const archive = i => { const record = tables[i].export(); if (record && !archives[i].some(r => r.root === record.root)) { archives[i].push(record); if (archives[i].length > 3) archives[i].shift(); } };
  const queue = (table, fn) => { const promise = queues[table].then(fn); queues[table] = promise.catch(() => {}); return promise; };
  const readJSON = async req => {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new Error("Expected JSON");
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 1024 * 1024) throw new Error("Request too large"); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const sweep = async () => {
    for (let i = 0; i < tables.length; i++) if (tables[i].active && !tables[i].busy && clock() - changedAt[i] >= timeout) {
      await queue(i, async () => {
        const t = tables[i]; if (!t.active || clock() - changedAt[i] < timeout) return;
        const s = t.state(), expected = s.phase === "shuffle" ? [s.context.members[s.shuffleAt].id]
          : s.phase === "betting" ? [s.state.seats[s.state.turn]?.id]
          : s.phase === "keys" ? s.context.members.filter(m => !s.keys.some(([id]) => id === m.id)).map(m => m.id)
          : s.phase === "ack" ? s.context.members.filter(m => !s.acknowledgments.includes(m.id)).map(m => m.id)
          : s.requested.filter(r => r.indices.some(index => !s.shares.find(([id]) => id === r.id)?.[1].some(([j]) => j === index))).map(r => r.id);
        const offender = expected.find(Boolean) || null;
        await t.cancel("timeout", offender); archive(i);
        for (const id of expected.filter(Boolean)) { cooldowns.set(id, clock() + 60000); t.evictIdle(id); }
        wake();
      });
    }
    for (const [token, session] of sessions) if (clock() - session.lastSeen > timeout) {
      for (let i = 0; i < tables.length; i++) if (!tables[i].active && tables[i].summary().state.seats.some(s => s?.id === session.publicKey)) {
        await queue(i, async () => { if (!tables[i].active) { archive(i); tables[i].evictIdle(session.publicKey); wake(); } });
      }
      if (clock() - session.lastSeen > 30 * 60 * 1000 && !tables.some(t => t.active && t.state().context?.members.some(m => m.id === session.publicKey))) { sessions.delete(token); publicKeys.delete(session.publicKey); accounts.delete(session.account); cooldowns.delete(session.publicKey); }
    }
  };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      let account = null;
      if (serviceToken) {
        const supplied = req.headers["x-poker-service-token"];
        if (typeof supplied !== "string" || !/^[0-9a-f]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(serviceToken))) { send(res, 403, { error: "Gateway authentication required" }); return; }
        const id = Number(req.headers["x-player-id"]), login = req.headers["x-player-login"];
        if (!Number.isSafeInteger(id) || id <= 0 || typeof login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(login)) { send(res, 403, { error: "Account required" }); return; }
        account = { id: String(id), login, display: decodeURIComponent(req.headers["x-player-display"] || login).slice(0, 32) };
      }
      if ((!serviceToken && ![...origins].some(origin => new URL(origin).host === host)) || (serviceToken || req.headers.origin) && !origins.has(req.headers.origin)) { send(res, 403, { error: "Origin not allowed" }); return; }
      const url = new URL(req.url, [...origins][0]);
      if (!serviceToken && req.method === "GET" && url.pathname === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" }); res.end(page()); return; }
      if (req.method === "GET" && url.pathname === "/poker/worker.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript; charset=utf-8", "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'" }); res.end(worker); return; }
      if (req.method === "GET" && url.pathname === "/poker/api/health") { send(res, 200, { protocol: C.DOMAIN, instance, account: account?.id || null, tables: 10, seats: 9, experimental: true, payments: false }); return; }
      if (req.method === "POST" && !origins.has(req.headers.origin)) { send(res, 403, { error: "Origin required" }); return; }
      if (req.method === "POST" && url.pathname === "/poker/api/session") {
        const body = await readJSON(req);
        if (typeof body.publicKey !== "string" || typeof body.nonce !== "string" || !/^[0-9a-f]{64}$/.test(body.nonce) || !await C.signatureValid(body.publicKey, "connect", body.nonce, body.signature)) throw new Error("Invalid identity proof");
        const existingToken = publicKeys.get(body.publicKey), existing = sessions.get(existingToken);
        if (existing) {
          if (!account || existing.account !== account.id) throw new Error("Session already exists for another connection");
          existing.lastSeen = clock();
          send(res, 200, { token: existingToken, publicKey: body.publicKey, instance, account: account.id, display: existing.display }); return;
        }
        if (account && accounts.has(account.id)) {
          const oldToken = accounts.get(account.id), old = sessions.get(oldToken);
          // A second browser cannot acquire a second seat or replace a live hand's key.
          if (clock() - old.lastSeen < timeout || tables.some(t => t.summary().state.seats.some(s => s?.id === old.publicKey) || t.active && t.state().context?.members.some(m => m.id === old.publicKey))) throw new Error("This account is connected in another browser; stand and disconnect there first, then wait 90 seconds");
          publicKeys.delete(old.publicKey); sessions.delete(oldToken);
        }
        if (sessions.size >= 256) throw new Error("Room is full");
        const token = randomBytes(32).toString("hex"), session = { publicKey: body.publicKey, account: account?.id || null, display: account?.display || null, lastSeen: clock(), tokens: 30, refreshed: clock(), commands: Promise.resolve() };
        sessions.set(token, session); publicKeys.set(body.publicKey, token); if (account) accounts.set(account.id, token);
        send(res, 201, { token, publicKey: body.publicKey, instance, account: session.account, display: session.display }); return;
      }
      const token = String(req.headers.authorization || "").replace(/^Bearer /, ""), session = sessions.get(token);
      if (!session || account && session.account !== account.id) { send(res, 401, { error: "Connect to the room first" }); return; }
      if (serviceToken && req.headers["x-poker-instance"] !== instance) { send(res, 409, { error: "Poker service restarted; reload to start a new session" }); return; }
      session.lastSeen = clock();
      session.tokens = Math.min(30, session.tokens + Math.max(0, clock() - session.refreshed) / 1000 * 5); session.refreshed = clock();
      if (session.tokens < 1) { send(res, 429, { error: "Please slow down" }); return; } session.tokens--;
      if (req.method === "GET" && url.pathname === "/poker/api/state") {
        const table = Number(url.searchParams.get("table")), from = Number(url.searchParams.get("from") || 0), after = Number(url.searchParams.get("after") || -1), hand = url.searchParams.get("hand") || "";
        if (!Number.isInteger(table) || table < 0 || table >= 10 || !Number.isInteger(from) || from < 0 || from > 513) throw new Error("Invalid table cursor");
        // A proof check awaits hashes while mutating the match. Read behind that table's queue,
        // so the record and counters always describe the same fully accepted command.
        const answer = () => queue(table, () => send(res, 200, publicState(session, table, from, hand)));
        if (after !== revision) { await answer(); return; }
        if (waiters.has(token)) waiters.get(token)();
        let timer;
        const finish = () => { clearTimeout(timer); waiters.delete(token); answer().catch(() => send(res, 503, { error: "Table state unavailable" })); };
        waiters.set(token, finish); timer = setTimeout(finish, 20000);
        res.on("close", () => { clearTimeout(timer); if (waiters.get(token) === finish) waiters.delete(token); }); return;
      }
      if (req.method === "POST" && url.pathname === "/poker/api/command") {
        const body = await readJSON(req), i = body?.table;
        if (!Number.isInteger(i) || i < 0 || i >= 10 || body.signer !== session.publicKey) throw new Error("Unauthorized command");
        const submitted = session.commands.then(() => queue(i, async () => {
          if (sessions.get(token) !== session) throw new Error("Session expired before the command could run");
          if ((cooldowns.get(session.publicKey) || 0) > clock() && ["start", "join"].includes(body.op)) throw new Error("Wait a minute after an interrupted hand");
          if (body.op === "join" && account && body.data?.name !== session.display) throw new Error("Use your signed-in display name");
          if (body.op === "join" && tables.some((t, j) => j !== i && t.summary().state.seats.some(s => s?.id === session.publicKey))) throw new Error("You already have a seat at another table");
          const t = tables[i], before = t.revision;
          if (["start", "join", "leave", "refill"].includes(body.op) && !t.active) {
            archive(i);
          }
          await t.submit(body); if (t.revision !== before) { changedAt[i] = clock(); wake(); }
        }));
        session.commands = submitted.catch(() => {}); await submitted;
        send(res, 200, { accepted: true }); return;
      }
      send(res, 404, { error: "Not found" });
    } catch (error) { send(res, 400, { error: error.message || "Request rejected" }); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxConnections = 512;
  const timer = setInterval(() => { sweep().catch(() => {}); }, 1000); timer.unref();
  server.on("close", () => { clearInterval(timer); for (const finish of [...waiters.values()]) finish(); sessions.clear(); publicKeys.clear(); accounts.clear(); });
  return { server, tables, sweep };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.POKER_PORT || 8787), host = process.env.POKER_HOST || "127.0.0.1";
  const origins = process.env.POKER_ORIGIN ? [new URL(process.env.POKER_ORIGIN).origin] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (host !== "127.0.0.1" && host !== "::1" && !process.env.POKER_ORIGIN) throw new Error("Set POKER_ORIGIN for a non-loopback deployment");
  if (host !== "127.0.0.1" && host !== "::1" && !process.env.POKER_SERVICE_TOKEN) throw new Error("Set POKER_SERVICE_TOKEN for a non-loopback deployment");
  const { server } = createPokerServer({ origins, serviceToken: process.env.POKER_SERVICE_TOKEN });
  server.listen(port, host, () => process.stdout.write(`Banana Poker: ${origins[0]}/?scene=poker&pokerLive=1\nExperimental encrypted-deck protocol. Free play chips only.\n`));
}
