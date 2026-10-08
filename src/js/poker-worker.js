// Served with the shared protocol modules by server/poker/server.mjs.
// All private keys, proof generation, verification and network work stay here.
(() => {
  "use strict";
  const C = self.BL.pokerCrypto, M = self.BL.pokerMatch;
  let identity, handKey, keyHand = "", token = "", table = 0, mirror = null, record = null, lastRecord = null;
  let running = false, fatal = false, controller = null, revision = -1, seq = 0, latest = null;
  let connecting = false, storage = null, instance = "", account = null, display = null, pending = null;
  let activeAction = 0, acknowledged = 0;
  const finishAction = () => { if (!pending && activeAction) { acknowledged = activeAction; activeAction = 0; } };
  const actions = [];
  const post = (type, value) => self.postMessage({ type, ...value });
  const stop = message => { fatal = true; running = false; controller?.abort(); storage?.close(); storage = null; handKey?.dispose(); identity?.dispose(); post("fatal", { message }); };
  const persist = async () => {
    if (!storage) return;
    try {
      await storage.save({ version: 1, instance, identity: identity.checkpoint(), publicKey: identity.publicKey,
        table, seq, hand: handKey?.checkpoint() || null, keyHand, record, lastRecord, pending });
    } catch { const error = new Error("Recovery could not be saved. Live play stopped; free storage and reload before the hand times out."); error.fatal = true; throw error; }
  };
  const jsonFetch = async (path, options = {}) => {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...options,
      headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(instance ? { "X-Poker-Instance": instance } : {}), ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    const data = await response.json();
    if (!response.ok) {
      const e = new Error(data.error || "Room request failed");
      e.fatal = [401, 403, 409].includes(response.status);
      e.rejected = response.status >= 400 && response.status < 500 && response.status !== 429 && !e.fatal;
      throw e;
    }
    return data;
  };
  const transmit = async () => {
    if (!pending) return;
    try {
      const answer = await jsonFetch("/poker/api/command", { method: "POST", body: pending });
      if (answer.accepted !== true) throw new Error("No acceptance receipt for the pending move");
    }
    catch (error) {
      if (error.rejected) { pending = null; await persist(); revision = -1; }
      throw error; // An uncertain response keeps the exact signed bytes for the next attempt/reload.
    }
    seq = JSON.parse(pending).seq; pending = null; revision = -1; await persist();
  };
  const command = async (op, data) => {
    if (pending) throw new Error("Waiting for the previous signed move");
    const context = mirror?.state().context;
    const value = { table, signer: identity.publicKey, seq: seq + 1, op, data: { ...(context && !["join", "leave", "refill", "start"].includes(op) ? { hand: context.nonce, epoch: context.epoch } : {}), ...data } };
    pending = JSON.stringify({ ...value, signature: await identity.sign("command", value) });
    await persist(); await transmit();
  };
  const progress = (label, done, total) => { if (done === total || done % 12 === 0) post("progress", { message: `${label} · ${Math.round(done / total * 100)}%` }); };
  const append = async audit => {
    if (audit.protocol !== C.DOMAIN || audit.table !== table) throw new Error("Unexpected hand protocol or table");
    if (!record || audit.offset === 0) {
      if (record && audit.events[0]?.request.data.nonce === record.events[0]?.request.data.nonce) {
        for (let i = 0; i < record.events.length; i++) if (audit.events[i]?.root !== record.events[i].root) throw new Error("The relay rewrote a hand record");
      }
      mirror = M.create(audit.table, audit.initial); record = { protocol: audit.protocol, table: audit.table, initial: audit.initial, events: [], root: "" };
    }
    if (audit.offset !== record.events.length) throw new Error("Missing hand record events");
    for (const event of audit.events) {
      if (event.request.op === "shuffle") post("progress", { message: "Checking a player's shuffle…" });
      if (event.request.op === "cancel") await mirror.cancel(event.request.reason, event.request.offender);
      else await mirror.submit(event.request);
      if (mirror.state().root !== event.root) throw new Error("Hand record verification failed");
      record.events.push(event); record.root = event.root;
    }
    if (record.root !== audit.root) throw new Error("Hand record root mismatch");
    if (!mirror.active) lastRecord = JSON.parse(JSON.stringify(record));
  };
  const acceptPacket = async packet => {
    if (packet.table !== table) return;
    if (packet.instance !== instance) throw new Error("Poker service restarted; reload to start a new session");
    let canceled = false;
    const incoming = packet.audit?.offset === 0 ? packet.audit.events[0]?.request.data.nonce : mirror?.state().context?.nonce;
    if (mirror?.active && (!packet.audit || incoming !== mirror.state().context.nonce)) {
      const previous = packet.previous;
      if (!previous || previous.events[0]?.request.data.nonce !== mirror.state().context.nonce) throw new Error("The relay replaced an unfinished hand");
      for (let i = 0; i < record.events.length; i++) if (record.events[i].root !== previous.events[i]?.root) throw new Error("The relay rewrote a completed hand");
      await append({ ...previous, offset: record.events.length, events: previous.events.slice(record.events.length) });
      if (mirror.active) throw new Error("Previous hand has no conclusion");
      canceled = mirror.phase === "aborted";
    }
    if (packet.audit) await append(packet.audit);
    else { mirror = null; record = null; }
    seq = packet.seq; revision = packet.revision; latest = packet;
    const s = mirror?.state(identity.publicKey);
    if (mirror && (s.counters.find(([id]) => id === identity.publicKey)?.[1] || 0) !== seq) throw new Error("The relay disagreed with the verified command counter");
    if (s) {
      const own = s.state.seats.find(p => p?.id === identity.publicKey), plan = s.plan.holes.find(h => h?.id === identity.publicKey);
      if (own && plan && handKey && keyHand === s.context.nonce + ":" + s.context.epoch) {
        const published = s.keys.find(([id]) => id === identity.publicKey)?.[1];
        if (published && published !== handKey.publicKey) throw new Error("Recovered hand key does not match the public record");
        const maps = new Map(s.shares.map(([id, entries]) => [id, new Map(entries)]));
        const others = s.context.members.filter(m => m.id !== identity.publicKey);
        if (plan.positions.every(i => others.every(m => maps.get(m.id)?.has(i)))) {
          own.cards = plan.positions.map(i => handKey.open(s.deck[i], others.map(m => maps.get(m.id).get(i))));
          if (new Set(own.cards.concat(s.state.board.filter(Number.isInteger))).size !== own.cards.length + s.state.board.filter(Number.isInteger).length) throw new Error("Duplicate private card");
        }
      }
      packet.tables[table] = { table, phase: s.phase, revision: s.revision, state: s.state };
    }
    if (!mirror?.active) { handKey?.dispose(); handKey = null; keyHand = ""; }
    await persist();
    post("state", { packet: { tables: packet.tables, table, identity: identity.publicKey, deadline: packet.deadline, acknowledged,
      fairness: { phase: s?.phase || "idle", checked: s?.shuffleAt || 0, total: s?.context?.members.length || 0, root: s?.root || "", exportable: !!record || !!lastRecord, complete: s?.phase === "complete", recoverable: !!storage } } });
    if (canceled) post("notice", { message: "Hand canceled. Committed chips were refunded and missing players' seats released." });
  };
  const automatic = async () => {
    if (!mirror?.active) return false;
    const s = mirror.state(identity.publicKey), id = identity.publicKey;
    if (!s.context.members.some(m => m.id === id)) return false;
    const hand = s.context.nonce + ":" + s.context.epoch;
    if (s.phase === "keys" && !s.keys.some(([who]) => who === id)) {
      if (keyHand !== hand) { handKey?.dispose(); handKey = C.player(); keyHand = hand; await persist(); }
      await command("key", { key: handKey.publicKey, proof: await handKey.sign("hand-key", [s.context, id]) }); return true;
    }
    if (!handKey || keyHand !== hand) throw new Error("The private hand key is unavailable; this hand must be canceled");
    if (s.keys.find(([who]) => who === id)?.[1] !== handKey.publicKey) throw new Error("Recovered key does not match this hand");
    if (s.phase === "shuffle" && s.context.members[s.shuffleAt].id === id) {
      post("progress", { message: "Shuffling encrypted cards…" });
      const shuffle = await C.shuffle(s.deck, s.aggregate, await mirror.shuffleContext(id), (n, total) => progress("Shuffling", n, total));
      await command("shuffle", { shuffle }); return true;
    }
    if (s.phase === "ack" && !s.acknowledgments.includes(id)) { await command("ack", { root: s.ackRoot }); return true; }
    const request = s.requested.find(r => r.id === id), ownShares = new Map(s.shares.find(([who]) => who === id)?.[1] || []);
    const need = request?.indices.filter(i => !ownShares.has(i)) || [];
    if (["hole", "board", "showdown"].includes(s.phase) && need.length) {
      // The independently replayed state machine supplies this allow-list.
      // An arbitrary relay key request is never accepted.
      const shares = []; for (const i of need) shares.push([i, await handKey.share(s.deck[i], mirror.shareContext(id, i))]);
      await command("shares", { shares }); return true;
    }
    return false;
  };
  const act = async request => {
    const { name, value, expectedVersion } = request;
    if (name === "forget") {
      if (!storage || !latest || latest.tables.some(t => t.state.seats.some(p => p?.id === identity.publicKey))) throw new Error("Stand between hands before forgetting this device's recovery");
      await storage.clear(); stop("Recovery cleared. Reload to connect again; allow 90 seconds for the old connection to expire."); return;
    }
    if (name === "watch") {
      if (!Number.isInteger(value) || value < 0 || value >= 10) throw new Error("Invalid table");
      if (latest?.tables.some(t => t.table !== value && t.state.seats.some(p => p?.id === identity.publicKey))) throw new Error("Stand before switching tables");
      table = value; mirror = null; record = null; seq = 0; revision = -1; latest = null; await persist(); return;
    }
    if (name === "verify") {
      const audit = value || record || lastRecord; if (!audit) throw new Error("No hand record yet");
      const verified = await M.replay(audit, (n, total) => progress("Verifying hand", n, total));
      post("notice", { message: verified.phase === "complete" ? "Hand record verified. Folded cards remain private." : `Valid record so far · ${verified.phase}. This is not a completed-hand certificate.` }); return;
    }
    if (name === "export") { const audit = record || lastRecord; if (!audit) throw new Error("No hand record yet"); post("record", { record: audit }); return; }
    if (name === "join" || name === "seat") await command("join", { name: display || value?.name || "Ooga", seat: name === "seat" ? value?.seat ?? -1 : -1 });
    else if (name === "stand") await command("leave", {});
    else if (name === "refill") await command("refill", {});
    else if (name === "start") await command("start", { nonce: C.nonce() });
    else if (["fold", "call", "raise"].includes(name)) {
      const s = mirror?.state(identity.publicKey);
      if (!s || s.phase !== "betting" || s.state.version !== expectedVersion) throw new Error("The table changed; choose your action again");
      await command("act", { version: expectedVersion, action: name === "call" && s.state.legal?.check ? "check" : name, amount: name === "raise" ? value : null });
    } else throw new Error("That control is for local practice");
  };
  const loop = async () => {
    while (running && !fatal) {
      try {
        if (pending) {
          try { await transmit(); }
          catch (error) { if (!error.rejected) throw error; post("notice", { message: error.message }); }
          finally { finishAction(); }
        }
        const from = record?.events.length || 0, hand = mirror?.state().context?.nonce || "";
        controller = new AbortController();
        const packet = await jsonFetch(`/poker/api/state?table=${table}&from=${from}&hand=${encodeURIComponent(hand)}&after=${actions.length ? -1 : revision}`, { signal: controller.signal });
        controller = null;
        try { await acceptPacket(packet); } catch (error) { stop("Verification stopped: " + error.message); break; }
        if (actions.length) {
          const request = actions.shift(); activeAction = request.requestId || 0;
          try { await act(request); }
          catch (error) { if (error.fatal || pending) throw error; post("notice", { message: error.message }); }
          finally { finishAction(); }
          revision = -1; continue; // Refresh the verified state before generating a protocol contribution.
        }
        try { if (await automatic()) revision = -1; }
        catch (error) { if (error.fatal || pending) throw error; post("notice", { message: error.message }); }
      } catch (error) {
        controller = null;
        if (error.fatal) { stop(error.message); break; }
        if (error.name === "AbortError") continue;
        post("connection", { status: "reconnecting" });
        post("progress", { message: "Connection interrupted. Reconnecting; secret keys stay on this device." });
        await new Promise(resolve => setTimeout(resolve, 1500)); revision = -1;
      }
    }
  };
  self.onmessage = async event => {
    const request = event.data;
    if (request?.type === "connect" && !running && !connecting && !fatal) {
      connecting = true;
      try {
        C.ready();
        const health = await jsonFetch("/poker/api/health");
        if (health.protocol !== C.DOMAIN || !/^[0-9a-f]{64}$/.test(health.instance)) throw new Error("Unexpected poker service");
        if (request.account !== undefined && health.account !== request.account) throw new Error("Account changed while connecting; reload and try again");
        instance = health.instance; account = health.account; table = request.table || 0;
        let saved = null;
        if (account) { storage = await self.BL.pokerRecovery.open(account); saved = await storage.load(); }
        if (saved && (saved.version !== 1 || !Number.isInteger(saved.table) || saved.table < 0 || saved.table >= 10 || !Number.isSafeInteger(saved.seq) || saved.seq < 0)) throw new Error("Invalid recovery checkpoint");
        identity = C.player(saved?.identity ?? null);
        if (saved && identity.publicKey !== saved.publicKey) throw new Error("Recovered identity does not match");
        if (saved?.instance === instance) {
          table = saved.table; seq = saved.seq; keyHand = saved.keyHand; record = saved.record; lastRecord = saved.lastRecord; pending = saved.pending;
          if (saved.hand) handKey = C.player(saved.hand);
          if (record) { if (record.table !== table) throw new Error("Wrong recovered table"); mirror = await M.replay(record); }
          if (pending) {
            const { signature, ...value } = JSON.parse(pending);
            if (value.signer !== identity.publicKey || value.table !== table || value.seq !== seq + 1 || !await C.signatureValid(identity.publicKey, "command", value, signature)) throw new Error("Invalid saved move");
          }
        } else if (saved) post("notice", { message: "Poker service restarted. Its previous hands and free-chip balances ended; starting a new session." });
        await persist(); // The signing key must survive a reload before it is registered remotely.
        const nonce = C.nonce();
        const answer = await jsonFetch("/poker/api/session", { method: "POST", body: JSON.stringify({ publicKey: identity.publicKey, nonce, signature: await identity.sign("connect", nonce) }) });
        if (answer.instance !== instance || answer.account !== account || answer.publicKey !== identity.publicKey) throw new Error("Poker session changed while connecting; reload");
        token = answer.token; display = answer.display; running = true; post("connected", { identity: identity.publicKey, table }); loop();
        if (storage) post("notice", { message: "Recovery saved on this device. Reload and reconnect before the 90-second hand deadline." });
      } catch (error) { stop(error.message); }
      finally { connecting = false; }
    } else if (request?.type === "action" && running && !fatal) {
      if (actions.length >= 4) { post("notice", { message: "Please wait for your previous action" }); return; }
      actions.push(request); controller?.abort();
    }
  };
})();
