(() => {
  "use strict";
  const BL = window.BL;
  const create = (changed, notice) => {
    let worker = null, identity = "", revision = 0, fairness = null, connected = false, failed = false;
    let selected = 0, account = null;
    let connection = "connecting", deadline = null, nextRequest = 0, pendingRequest = 0, transientNotice = false;
    const lifetime = new AbortController();
    const snapshots = Array.from({ length: 10 }, () => BL.pokerRules.create().snapshot());
    const phases = new Array(10).fill("idle");
    const tables = snapshots.map((_, i) => ({ snapshot: () => snapshots[i], get version() { return revision; }, get playing() { return !["idle", "complete", "aborted"].includes(phases[i]); } }));
    const action = (name, value, expectedVersion) => {
      if (!connected || failed || connection !== "live") throw new Error("Wait for the live table to reconnect");
      if (pendingRequest) throw new Error("Your previous move is still being confirmed");
      pendingRequest = ++nextRequest;
      worker.postMessage({ type: "action", requestId: pendingRequest, name, value, expectedVersion }); changed();
    };
    const connect = async table => {
      if (worker) return;
      if (!/^https?:$/.test(location.protocol)) throw new Error("Live tables are available when this floor is served by the poker service");
      const r = await fetch("/poker/api/health", { cache: "no-store", signal: lifetime.signal });
      const health = await r.json().catch(() => ({}));
      if (!r.ok || !health.experimental) throw new Error(health.error || "Live tables are unavailable at this address");
      account = health.account; selected = table;
      worker = new Worker("/poker/worker.js");
      worker.onerror = () => { failed = true; connection = "failed"; fairness = { ...fairness, phase: "failed" }; changed(); notice("Live connection stopped. Reconnect to recover your seat."); };
      worker.onmessage = event => {
        if (failed) return;
        const m = event.data;
        if (m.type === "connected") { identity = m.identity; selected = m.table; connected = true; changed(); }
        if (m.type === "notice") { transientNotice = false; notice(m.message); }
        if (m.type === "progress") { transientNotice = true; notice(m.message); }
        if (m.type === "connection") { connection = m.status; changed(); }
        if (m.type === "fatal") { failed = true; connection = "failed"; fairness = { ...fairness, phase: "failed" }; changed(); notice(m.message); }
        if (m.type === "state") {
          const p = m.packet; fairness = p.fairness; connection = "live"; deadline = p.deadline;
          if (pendingRequest && p.acknowledged >= pendingRequest) pendingRequest = 0;
          if (transientNotice) { transientNotice = false; notice(""); }
          for (let i = 0; i < 10; i++) { snapshots[i] = { ...p.tables[i].state, fairPhase: p.tables[i].phase }; phases[i] = p.tables[i].phase; }
          revision++; changed();
        }
        if (m.type === "record") {
          const blob = new Blob([JSON.stringify(m.record)], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
          a.href = url; a.download = `banana-poker-table-${m.record.table + 1}-hand-${m.record.initial.epoch + 1}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      };
      worker.postMessage({ type: "connect", table, account });
    };
    return { tables, connect, action, get identity() { return identity; }, get table() { return selected; }, get account() { return account; }, get fairness() { return fairness; }, get connection() { return connection; }, get busy() { return !!pendingRequest; }, get deadline() { return deadline; }, get connected() { return connected && !failed; },
      disconnect(message) { worker?.terminate(); connected = false; failed = true; connection = "failed"; fairness = { ...fairness, phase: "failed" }; changed(); notice(message); },
      dispose() { lifetime.abort(); worker?.terminate(); worker = null; connected = false; } };
  };
  BL.pokerLive = { create };
})();
