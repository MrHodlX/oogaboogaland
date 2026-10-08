(() => {
  "use strict";
  const BL = window.BL, R = BL.pokerRules;
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const chips = n => number.format(n);
  const streetName = { waiting: "Waiting for players", preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River", reveal: "Opening showdown", showdown: "Hand complete" };
  const fairName = { keys: "Preparing private keys", shuffle: "Shuffling & checking proofs", ack: "Agreeing on the deck", hole: "Dealing private cards", board: "Opening community cards", showdown: "Checking showdown", betting: "Shuffle checked · hand in play", complete: "Completed hand record checked", aborted: "Hand canceled · chips refunded", idle: "Waiting for a shared hand", failed: "Verification stopped · actions disabled" };
  // Pot sizing includes the call before calculating the raise, and returns a
  // street TOTAL. The rules remain the authority for short all-ins and reopening.
  const betAmount = (s, preset) => {
    const l = s.legal; if (!l?.canRaise) return null;
    const floor = Math.min(l.min, l.max);
    let amount = floor;
    if (preset === "all") amount = l.max;
    else if (preset === "half" || preset === "threeQuarter" || preset === "pot") {
      const fraction = preset === "half" ? 0.5 : preset === "threeQuarter" ? 0.75 : 1;
      amount = s.currentBet + Math.round((s.pot + l.call) * fraction);
    }
    return Math.max(floor, Math.min(l.max, amount));
  };
  const position = (seat, own) => (seat - Math.max(0, own) + R.SEATS) % R.SEATS;
  const resultText = s => {
    if (!s.result) return "";
    const lines = [];
    for (let i = 0; i < R.SEATS; i++) {
      if (!s.result.awards[i]) continue;
      const p = s.seats[i], won = s.result.pots.some(pot => !pot.refund && pot.winners.includes(i));
      const rank = won && s.result.revealed && p?.cards.length === 2 && p.cards.every(Number.isInteger) ? R.evaluate(p.cards.concat(s.board)).name : "";
      lines.push(`${s.result.names[i] || `Seat ${i + 1}`} ${won ? "collects" : "receives back"} ${chips(s.result.awards[i])}${rank ? ` · ${rank}` : ""}`);
    }
    return lines.join(" / ");
  };
  const create = (action, select) => {
    const el = document.getElementById("poker"), lobby = document.getElementById("poker-panel"), edge = el.querySelector(".panel-edge");
    const by = name => el.querySelector(`[data-poker="${name}"]`);
    const focus = by("focus"), seatRoot = el.querySelector(".poker-seats"), rows = [], seats = [];
    const board = by("board"), hand = by("hand"), status = by("status"), notice = by("notice"), floorNotice = by("floor-notice");
    const amount = by("amount"), slider = by("slider"), controls = by("controls"), raiseButton = by("raise");
    const presets = Array.from(el.querySelectorAll("[data-poker-size]"));
    const themeSelects = Array.from(el.querySelectorAll("[data-poker-theme-select]")), themeButtons = [];
    const auto = el.querySelector('[data-poker-option="auto"]'), sound = el.querySelector('[data-poker-option="sound"]');
    const history = Array.from({ length: 10 }, () => []), recorded = new Int32Array(10);
    let snapshot = null, lastIndex = -1, lastHand = -1, turnKey = "", focused = false, paused = false, audio = null, lastClock = "", lastHistory = "";
    let live = null;
    let filter = "all", viewBusy = false, lastLog = "", viewerId = null;
    const filterButtons = Array.from(el.querySelectorAll("[data-poker-filter]"));
    const tableSelect = by("table-select"), tableOptions = [];
    const make = (tag, className, parent) => { const n = document.createElement(tag); if (className) n.className = className; if (parent) parent.appendChild(n); return n; };
    for (const theme of BL.pokerThemes.themes) {
      for (const picker of themeSelects) { const option = make("option", "", picker); option.value = theme.id; option.textContent = theme.name; }
      const b = make("button", "poker-theme-choice", by("theme-choices")); b.type = "button"; b.dataset.pokerTheme = theme.id;
      b.setAttribute("aria-label", theme.name + ": " + theme.detail); b.setAttribute("aria-pressed", "false");
      const swatch = make("span", "poker-theme-swatch", b); swatch.dataset.themeSwatch = theme.id; swatch.setAttribute("aria-hidden", "true");
      make("span", "", b).textContent = theme.short; themeButtons.push(b);
    }
    const setTheme = id => {
      const theme = BL.pokerThemes.get(id), p = theme.ui;
      el.dataset.theme = theme.id;
      for (const [key, value] of Object.entries(p)) el.style.setProperty("--pk-" + key, value);
      for (const [key, value] of Object.entries({ felt: theme.felt, line: p.accent + "66", soft: p.accent + "22", glow: p.accent + "55", surfaceSoft: p.surface + "aa", haloSoft: p.halo + "77", haloGlass: p.halo + "f2", deepGlass: p.deep + "f7" })) el.style.setProperty("--pk-" + key, value);
      for (const picker of themeSelects) picker.value = theme.id;
      for (const b of themeButtons) b.setAttribute("aria-pressed", String(b.dataset.pokerTheme === theme.id));
      by("theme-name").textContent = theme.name.toUpperCase();
      by("theme-description").textContent = by("theme-note").textContent = theme.detail;
    };
    for (let i = 0; i < 10; i++) {
      const b = make("button", "poker-table-row", by("tables")); b.type = "button"; b.dataset.watch = i;
      const title = make("strong", "", b), info = make("span", "", b), state = make("small", "", b);
      const dots = make("div", "poker-seat-dots", b); dots.setAttribute("aria-hidden", "true");
      for (let j = 0; j < R.SEATS; j++) make("i", "", dots);
      title.textContent = String(i + 1).padStart(2, "0"); rows.push({ b, info, state, dots, open: true, playing: false });
      const option = make("option", "", tableSelect); option.value = String(i); option.textContent = `Table ${i + 1}`; tableOptions.push(option);
    }
    for (let i = 0; i < R.SEATS; i++) {
      const wrapper = make("div", "poker-seat", seatRoot), b = make("button", "poker-seat-button", wrapper);
      b.type = "button"; b.dataset.seat = i;
      const badge = make("span", "poker-position", b), name = make("strong", "poker-player", b), stack = make("span", "poker-stack", b), last = make("small", "poker-last-action", b);
      const cards = make("div", "poker-seat-cards", wrapper), bet = make("span", "poker-bet", wrapper);
      seats.push({ wrapper, b, badge, name, stack, last, cards, bet });
    }
    const cards = (target, list, placeholders = false, reset = false) => {
      if (reset) target.replaceChildren();
      while (target.children.length > list.length) target.lastElementChild.remove();
      for (let i = 0; i < list.length; i++) {
        const c = list[i], key = c === null ? (placeholders ? "empty" : "back") : String(c);
        const n = target.children[i] || make("span", "poker-card", target);
        if (n.dataset.card === key) continue;
        n.dataset.card = key; n.className = key === "empty" ? "poker-card poker-card-slot" : "poker-card";
        n.setAttribute("role", "img"); n.setAttribute("aria-label", key === "empty" ? "Community card not dealt" : BL.pokerCards.label(c));
        n.replaceChildren(); if (key !== "empty") n.appendChild(BL.pokerCards.svg(c));
      }
    };
    const cue = kind => {
      if (!sound.checked || !audio || audio.state !== "running") return;
      // Short local synthesis: no media downloads or always-running nodes.
      const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      oscillator.type = "sine"; oscillator.frequency.setValueAtTime(kind === "turn" ? 660 : kind === "win" ? 880 : 260, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "win" ? 1174 : 220, now + 0.11);
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.035, now + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now); oscillator.stop(now + 0.15);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    };
    const setAmount = (value, preset = "") => {
      const l = snapshot?.legal; if (!l?.canRaise) return;
      const n = Math.max(Math.min(l.min, l.max), Math.min(l.max, Math.round(Number(value) || 0)));
      amount.value = slider.value = String(n);
      raiseButton.textContent = `${snapshot.currentBet ? "Raise to" : "Bet"} ${chips(n)}${n === l.max ? " · All in" : ""}`;
      const own = snapshot.seats.find(p => p?.id === viewerId), extra = Math.max(0, n - (own?.roundBet || 0));
      by("bet-help").textContent = `Adds ${chips(extra)} chips · ${chips(Math.max(0, (own?.stack || 0) - extra))} left. Press ${snapshot.currentBet ? "Raise" : "Bet"} to send.`;
      slider.setAttribute("aria-valuetext", `${chips(n)} total this round, adds ${chips(extra)} chips`);
      for (const b of presets) b.setAttribute("aria-pressed", String(b.dataset.pokerSize === preset));
    };
    const noticeText = text => { if (notice.textContent !== text) notice.textContent = floorNotice.textContent = text; };
    const filterRows = () => {
      let count = 0;
      for (const row of rows) {
        row.b.hidden = filter === "open" ? !row.open : filter === "playing" ? !row.playing : false;
        if (!row.b.hidden) count++;
      }
      by("empty-list").hidden = count > 0;
      by("lobby-count").textContent = `${count} ${count === 1 ? "table" : "tables"}`;
      for (const b of filterButtons) b.setAttribute("aria-pressed", String(b.dataset.pokerFilter === filter));
    };
    const onClick = e => {
      const b = e.target.closest("button"); if (!b || b.disabled || !el.contains(b)) return;
      if (b.dataset.watch !== undefined) select(Number(b.dataset.watch));
      else if (b.dataset.pokerFilter) { filter = b.dataset.pokerFilter; filterRows(); }
      else if (b.dataset.pokerTheme) action("theme", b.dataset.pokerTheme);
      else if (b.dataset.seat !== undefined) action("seat", Number(b.dataset.seat));
      else if (b.dataset.pokerSize) setAmount(betAmount(snapshot, b.dataset.pokerSize), b.dataset.pokerSize);
      else if (b.dataset.pokerAction) { noticeText(""); action(b.dataset.pokerAction, Number(amount.value), snapshot?.version); }
    };
    const onInput = e => { if (e.target === slider) setAmount(slider.value); };
    const onChange = e => {
      if (e.target === by("audit-file")) {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        if (file.size > 12 * 1024 * 1024) { noticeText("This record is too large."); return; }
        file.text().then(text => action("verify-file", JSON.parse(text))).catch(() => noticeText("That file is not a valid hand record."));
      } else if (e.target === tableSelect) select(Number(tableSelect.value));
      else if (e.target.matches("[data-poker-theme-select]")) action("theme", e.target.value);
      else if (e.target === amount) setAmount(amount.value);
      else if (e.target === auto) action("auto", auto.checked);
      else if (e.target === sound && sound.checked) {
        try {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) throw new Error("Sound is unavailable in this browser");
          if (!audio) audio = new Audio();
          audio.resume().then(() => cue("turn")).catch(() => { sound.checked = false; noticeText("Sound could not start. You can keep playing silently."); });
        } catch (error) { sound.checked = false; noticeText(error.message); }
      }
    };
    el.addEventListener("click", onClick); el.addEventListener("input", onInput); el.addEventListener("change", onChange);
    const setFocused = value => {
      focused = !!value; focus.hidden = !focused; lobby.hidden = edge.hidden = focused;
      el.dataset.tableView = String(focused);
      if (focused) { document.body.dataset.pokerTableView = "true"; by("title").focus({ preventScroll: true }); }
      else { document.body.removeAttribute("data-poker-table-view"); lobby.removeAttribute("data-folded"); if (lastIndex >= 0) rows[lastIndex].b.focus({ preventScroll: true }); }
    };
    const update = (index, snapshots, viewer, pendingStand, isPaused, autoDeal) => {
      const previous = snapshot, switched = index !== lastIndex;
      const s = snapshot = snapshots[index], ownIndex = s.seats.findIndex(p => p?.id === viewer), own = s.seats[ownIndex], legal = s.legal;
      viewerId = viewer;
      by("voice-label").textContent = `Table ${index + 1} voice · spectators welcome`;
      const blocked = viewBusy || !!live && (live.busy || live.connection !== "live");
      paused = isPaused; const idle = (s.phase === "waiting" || s.phase === "showdown") && (!live || ["idle", "complete", "aborted"].includes(s.fairPhase)), fresh = switched || s.hand !== lastHand;
      snapshots.forEach((table, i) => {
        const row = rows[i], occupied = table.seats.filter(Boolean).length;
        row.open = occupied < R.SEATS && ["waiting", "showdown"].includes(table.phase) && (!live || ["idle", "complete", "aborted"].includes(table.fairPhase));
        row.playing = !["waiting", "showdown"].includes(table.phase) || !!live && !["idle", "complete", "aborted"].includes(table.fairPhase);
        row.info.textContent = `${occupied} / ${R.SEATS}`; row.state.textContent = row.open ? occupied ? "Join between hands" : "Start a table" : row.playing ? `${streetName[table.phase] === "Waiting for players" ? "Preparing hand" : streetName[table.phase]} · Watch` : "Table full · Watch";
        row.b.classList.toggle("selected", i === index); row.b.classList.toggle("your-table", !!viewer && i === index); row.b.disabled = blocked || !!viewer && i !== index;
        for (let j = 0; j < R.SEATS; j++) row.dots.children[j].classList.toggle("occupied", !!table.seats[j]);
        tableOptions[i].disabled = !!viewer && i !== index;
        row.b.setAttribute("aria-label", `Table ${i + 1}, ${occupied} of ${R.SEATS} seats, ${row.state.textContent}`);
        if (table.result && table.hand !== recorded[i]) {
          recorded[i] = table.hand;
          history[i].unshift(`Hand #${table.hand} · ${resultText(table)} · Board: ${table.board.map(R.cardName).join(" ") || "no community cards"}`);
          if (history[i].length > 12) history[i].pop();
        }
      });
      filterRows(); tableSelect.value = String(index); tableSelect.disabled = blocked;
      by("title").textContent = `Table ${String(index + 1).padStart(2, "0")}`;
      status.textContent = "No-limit Hold’em · blinds 5 / 10";
      by("hand-number").textContent = s.hand ? `#${s.hand}` : "Not dealt";
      by("seat-count").textContent = `${s.seats.filter(Boolean).length} / ${R.SEATS} seated`;
      by("private-label").textContent = own ? "YOUR HAND" : "WATCHING THE TABLE";
      by("return").hidden = !viewer;
      by("return-label").textContent = `Your seat · Table ${String(index + 1).padStart(2, "0")}`;
      by("floor-turn").textContent = blocked ? live?.connection === "failed" ? "Reconnect to recover your seat" : "Waiting for the table to confirm…" : legal ? "Your turn — return to act" : own?.folded ? "You folded · the hand continues" : own?.stack === 0 && own.inHand ? "All in · waiting for the result" : idle ? "Ready for the next hand" : "Your seat is waiting for you";
      el.dataset.yourTurn = String(!!legal && !paused && !pendingStand && !blocked);
      by("pot-label").textContent = s.result ? "LAST POT" : "TOTAL POT";
      by("pot").textContent = chips(s.result ? s.lastPot : s.pot);
      const community = s.board.slice(); while (community.length < 5) community.push(null);
      cards(board, community, true, fresh); cards(hand, own?.cards.length ? own.cards : [null, null], !own?.cards.length, fresh);
      by("street").textContent = streetName[s.phase];
      by("balance").textContent = own ? `${chips(own.stack)} chips` : "You’re spectating";
      by("hand-name").textContent = own?.cards.length === 2 && own.cards.every(Number.isInteger) && s.board.length >= 3 && s.board.every(Number.isInteger) ? `${own.folded ? "Folded · " : ""}${R.evaluate(own.cards.concat(s.board)).name}` : own ? "Your private cards" : "Take a seat to play";
      for (let i = 0; i < R.SEATS; i++) {
        const p = s.seats[i], node = seats[i], winner = !!p?.inHand && !!s.result?.pots.some(pot => !pot.refund && pot.winners.includes(i));
        node.wrapper.dataset.position = position(i, ownIndex);
        node.wrapper.classList.toggle("turn", !paused && i === s.turn);
        node.wrapper.classList.toggle("yours", i === ownIndex);
        node.wrapper.classList.toggle("folded", !!p?.folded);
        node.wrapper.classList.toggle("winner", winner);
        node.wrapper.classList.toggle("empty", !p);
        node.name.textContent = p ? `${p.name}${p.bot ? " · Bot" : ""}` : `Seat ${i + 1}`;
        node.stack.textContent = p ? chips(p.stack) : idle && !viewer ? "Sit here" : "Open";
        node.last.textContent = !p ? "" : winner ? `+${chips(s.result.awards[i])} collected` : p.folded ? "Folded" : p.inHand && !p.stack ? "All in" : p.lastAction || (i === s.turn ? "Thinking" : "");
        node.badge.textContent = p && s.hand ? [i === s.dealer ? "D" : "", i === s.smallBlind ? "SB" : "", i === s.bigBlind ? "BB" : ""].filter(Boolean).join(" · ") : "";
        node.badge.hidden = !node.badge.textContent;
        node.b.disabled = !!p || !!viewer || !idle || paused || blocked;
        node.b.setAttribute("aria-label", p ? `${p.name}, ${chips(p.stack)} chips${i === s.turn ? ", acting now" : ""}${p.lastAction ? ", " + p.lastAction : ""}` : `Take seat ${i + 1}`);
        cards(node.cards, p?.inHand && !p.folded && i !== ownIndex ? p.cards : [], false, fresh);
        node.bet.textContent = p?.roundBet ? chips(p.roundBet) : ""; node.bet.hidden = !p?.roundBet;
      }
      by("join").hidden = !!viewer; by("join").disabled = !idle || s.seats.every(Boolean) || paused || blocked;
      by("bots").disabled = !idle || s.seats.every(Boolean) || paused || blocked;
      by("start").hidden = !own && !!live;
      by("start").disabled = !idle || s.seats.filter(p => p && p.stack > 0).length < 2 || paused || blocked || !!live && !own;
      by("start").textContent = s.hand ? "Deal next hand" : "Deal hand";
      by("refill").hidden = !own || !idle || own.stack >= R.BUY_IN; by("refill").disabled = paused || blocked;
      by("refill").textContent = own ? `Refill to ${chips(R.BUY_IN)} · free` : "Free refill";
      by("stand").hidden = !viewer; by("stand").disabled = pendingStand || blocked || !!live && !idle;
      by("stand").textContent = pendingStand ? "Leaving after hand" : idle ? "Leave seat" : live ? "Leave between hands" : "Leave after this hand";
      by("setup").hidden = !idle;
      controls.hidden = !legal || pendingStand || paused;
      const key = legal ? `${index}:${s.hand}:${s.phase}:${s.version}` : "";
      if (legal) {
        by("fold").disabled = by("call").disabled = blocked;
        by("call").textContent = legal.check ? "Check" : `Call ${chips(legal.call)}${legal.call === own.stack ? " · All in" : ""}`;
        raiseButton.disabled = amount.disabled = slider.disabled = !legal.canRaise || blocked;
        for (const b of presets) b.disabled = !legal.canRaise || blocked;
        amount.min = slider.min = String(Math.min(legal.min, legal.max)); amount.max = slider.max = String(legal.max);
        by("range").textContent = s.currentBet ? "Raise to" : "Bet";
        if (legal.canRaise && key !== turnKey) setAmount(betAmount(s, "min"), "min");
        if (!legal.canRaise) { raiseButton.textContent = "Raise unavailable"; amount.value = slider.value = String(legal.max); by("bet-help").textContent = "You can call or fold. Raising is not available for this action."; }
      }
      const turnText = paused ? "Demo paused · resume when ready" : pendingStand ? "Walking · your remaining turns check or fold" : legal ? `Your turn · ${legal.check ? "check for free or bet" : chips(legal.call) + " to call"}` : idle ? own?.stack === 0 ? "Out of chips? Your refill is free." : s.result ? "Hand complete" : "Take a seat, add bots, deal a hand" : own?.folded ? "You folded · watching the hand" : own?.inHand && !own.stack ? "You’re all in · waiting for the result" : `${s.seats[s.turn]?.name || "Dealer"} to act`;
      const turnLabel = blocked ? live?.connection === "failed" ? "Connection stopped" : live?.connection === "reconnecting" ? "Reconnecting to your table…" : live?.busy ? "Sending your move…" : "Connecting to live tables…" : live && !["idle", "complete", "betting"].includes(s.fairPhase) ? fairName[s.fairPhase] || "Preparing the hand" : live && idle && !s.result ? own ? "Ready when you are" : "There’s a seat for you" : turnText;
      if (by("turn").textContent !== turnLabel) by("turn").textContent = turnLabel;
      by("turn").classList.toggle("is-yours", !!legal && !paused && !blocked);
      by("turn-help").textContent = blocked ? live?.connection === "failed" ? "Reconnect to recover your seat on this device." : "Your next action unlocks when the table confirms this one." : legal ? legal.check ? "Checking keeps you in the hand for free." : "Call to match the bet, choose a raise, or fold this hand." : pendingStand ? "Your seat releases when this hand ends." : idle ? !own ? "Take any open seat. Everyone starts with 1,000 free chips." : s.seats.filter(p => p && p.stack > 0).length < 2 ? live ? "One more player is needed. Anyone seated can deal." : "Add opponents, then deal when you’re ready." : "Deal when the table is ready. Nobody owns the table." : own?.folded ? "You can watch or walk. Live players must stay connected." : !own ? "Watch this hand. Seats open when it finishes." : "Stay connected. You’ll be told when it’s your turn.";
      by("result").hidden = !s.result; by("result").textContent = resultText(s);
      const log = s.history.slice(-8).join("\n") || "The gorilla is ready. Take a seat to begin.";
      if (log !== lastLog) { by("log").textContent = log; by("log").scrollTop = by("log").scrollHeight; lastLog = log; }
      const historyKey = `${index}:${recorded[index]}`;
      if (historyKey !== lastHistory) {
        by("history").replaceChildren();
        if (!history[index].length) make("li", "", by("history")).textContent = "Completed hands will appear here.";
        for (const item of history[index]) make("li", "", by("history")).textContent = item;
        lastHistory = historyKey;
      }
      auto.checked = autoDeal;
      by("pause").textContent = paused ? "Resume practice" : "Pause practice"; by("pause").setAttribute("aria-pressed", String(paused));
      if (!paused && !switched && previous) {
        if (s.result && !previous.result) cue("win");
        else if (legal && !previous.legal) cue("turn");
        else if (s.hand !== lastHand || s.board.length !== previous.board.length) cue("deal");
      }
      turnKey = key; lastHand = s.hand; lastIndex = index; lastClock = "";
    };
    const countdown = (seconds, enabled) => {
      const text = live ? seconds < 0 ? "" : seconds === 0 ? "Waiting for table update" : `Table timer · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : paused ? "Practice paused" : enabled && snapshot?.result ? `Next hand in ${seconds}s` : "No turn timer";
      if (text !== lastClock) { by("countdown").textContent = text; lastClock = text; }
      by("countdown").classList.toggle("urgent", !!live && seconds >= 0 && seconds <= 15);
    };
    const setLive = value => {
      live = value; by("fairness").hidden = !live;
      const connection = viewBusy ? "connecting" : live?.connection || "practice";
      el.dataset.connection = connection;
      by("mode-badge").textContent = live ? "LIVE TABLE" : "PRACTICE";
      by("connection").textContent = connection === "practice" ? "Practice · on your device" : connection === "failed" ? "Connection stopped" : connection === "reconnecting" ? "Reconnecting · waiting for table" : connection === "connecting" ? "Connecting to live tables…" : ["betting", "complete"].includes(live.phase) ? "Connected · shuffle checked" : "Connected · " + (fairName[live.phase] || "waiting for players");
      by("reconnect").hidden = connection !== "failed";
      by("reconnect-floor").hidden = connection !== "failed";
      by("connect").hidden = !!live; by("practice").hidden = !live;
      by("forget").hidden = !live?.recoverable;
      by("nickname").disabled = !!live?.recoverable;
      by("connect").disabled = viewBusy;
      el.querySelector('[data-poker-action="quick"]').disabled = viewBusy;
      by("practice").disabled = viewBusy || !!live?.busy;
      by("live-label").textContent = viewBusy ? "Connecting to the live floor…" : live?.recoverable ? "Live tables · your Ooga name · recovery saved here" : live ? "Live tables · free chips · human opponents" : "Practice is ready now. Live tables need a connected poker service.";
      by("bots").hidden = by("pause").hidden = !!live; auto.parentElement.hidden = !!live;
      el.querySelector('[data-poker-action="quick"]').hidden = !!live;
      if (live) {
        by("countdown").textContent = "";
        by("fair-status").textContent = `${fairName[live.phase] || "Connecting"}${live.total ? ` · ${live.checked}/${live.total} shuffles checked` : ""}`;
        by("proof-root").textContent = live.root ? "Record fingerprint: " + live.root : "";
        by("verify").disabled = by("export").disabled = !live.exportable || live.busy || connection !== "live";
      }
    };
    return { update, countdown, setFocused, setTheme, setLive, setConnecting(value) { viewBusy = !!value; setLive(live); }, notice: noticeText, get focused() { return focused; }, dispose() {
      el.removeEventListener("click", onClick); el.removeEventListener("input", onInput); el.removeEventListener("change", onChange);
      by("tables").replaceChildren(); seatRoot.replaceChildren(); board.replaceChildren(); hand.replaceChildren(); by("history").replaceChildren();
      by("theme-choices").replaceChildren(); for (const picker of themeSelects) picker.replaceChildren();
      tableSelect.replaceChildren(); el.removeAttribute("data-your-turn"); el.removeAttribute("data-connection");
      sound.checked = false; setFocused(false); if (audio) { audio.close().catch(() => {}); audio = null; }
    } };
  };
  BL.pokerHud = { create, betAmount, position, resultText };
})();
