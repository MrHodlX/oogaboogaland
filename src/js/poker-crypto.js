// Experimental mental poker. See docs/poker-protocol.md before changing this file.
// P-256 ElGamal; Chaum-Pedersen AND/OR proofs; a rearrangeable switch network.
// This BigInt implementation is NOT constant time or independently audited.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const DOMAIN = "ooga-poker-switch-v1";
  const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
  const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
  const O = Object.freeze([0n, 1n, 0n]);
  const G = Object.freeze([0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
    0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n, 1n]);
  const mod = (x, p = P) => { const r = x % p; return r < 0n ? r + p : r; };
  const inv = x => {
    let a = mod(x), b = P, u = 1n, v = 0n;
    if (!a) throw new Error("Cannot invert zero");
    while (b) { const q = a / b; [a, b] = [b, a - q * b]; [u, v] = [v, u - q * v]; }
    return mod(u);
  };
  const dbl = p => {
    const [x, y, z] = p; if (!z || !y) return O;
    const d = mod(z * z), g = mod(y * y), b = mod(x * g), a = mod(3n * (x - d) * (x + d));
    const xx = mod(a * a - 8n * b);
    return [xx, mod(a * (4n * b - xx) - 8n * g * g), mod((y + z) * (y + z) - g - d)];
  };
  const add = (p, q) => {
    if (!p[2]) return q; if (!q[2]) return p;
    const z1 = mod(p[2] * p[2]), z2 = mod(q[2] * q[2]);
    const u1 = mod(p[0] * z2), u2 = mod(q[0] * z1), s1 = mod(p[1] * q[2] * z2), s2 = mod(q[1] * p[2] * z1);
    if (u1 === u2) return s1 === s2 ? dbl(p) : O;
    const h = mod(u2 - u1), i = mod(4n * h * h), j = mod(h * i), r = mod(2n * (s2 - s1)), v = mod(u1 * i);
    const x = mod(r * r - j - 2n * v);
    return [x, mod(r * (v - x) - 2n * s1 * j), mod(((p[2] + q[2]) ** 2n - z1 - z2) * h)];
  };
  const neg = p => p[2] ? [p[0], mod(-p[1]), p[2]] : O;
  const sub = (p, q) => add(p, neg(q));
  const same = (p, q) => {
    if (!p[2] || !q[2]) return !p[2] && !q[2];
    const z1 = mod(p[2] * p[2]), z2 = mod(q[2] * q[2]);
    return mod(p[0] * z2) === mod(q[0] * z1) && mod(p[1] * z2 * q[2]) === mod(q[1] * z1 * p[2]);
  };
  const small = p => { const t = [O, p]; for (let i = 2; i < 16; i++) t.push(add(t[i - 1], p)); return t; };
  const mul = (p, k) => {
    k = mod(k, N); if (!k || !p[2]) return O;
    const t = small(p), digits = k.toString(16); let r = O;
    for (const d of digits) { r = dbl(dbl(dbl(dbl(r)))); r = add(r, t[parseInt(d, 16)]); }
    return r;
  };
  const fixed = p => {
    const rows = []; let at = p;
    for (let i = 0; i < 64; i++) { rows.push(small(at)); at = dbl(dbl(dbl(dbl(at)))); }
    return k => { const s = mod(k, N).toString(16); let r = O; for (let i = 0; i < s.length; i++) r = add(r, rows[i][parseInt(s[s.length - 1 - i], 16)]); return r; };
  };
  let fixedG;
  const gmul = k => (fixedG || (fixedG = fixed(G)))(k);
  const hex = x => x.toString(16).padStart(64, "0");
  const encode = p => {
    if (!p[2]) return "00";
    const z = p[2] === 1n ? 1n : inv(p[2]), zz = mod(z * z);
    return "04" + hex(mod(p[0] * zz)) + hex(mod(p[1] * zz * z));
  };
  const decode = (s, nonzero = false) => {
    if (s === "00" && !nonzero) return O;
    if (typeof s !== "string" || !/^04[0-9a-f]{128}$/.test(s)) throw new Error("Invalid point encoding");
    const x = BigInt("0x" + s.slice(2, 66)), y = BigInt("0x" + s.slice(66));
    if (x >= P || y >= P || mod(y * y) !== mod(x * x * x - 3n * x + B)) throw new Error("Point is not on P-256");
    return [x, y, 1n]; // P-256 has cofactor one.
  };
  const scalar = s => {
    if (typeof s !== "string" || !/^[0-9a-f]{64}$/.test(s)) throw new Error("Invalid scalar encoding");
    const n = BigInt("0x" + s); if (n >= N) throw new Error("Scalar out of range"); return n;
  };
  const ready = () => { if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) throw new Error("Secure browser cryptography is unavailable"); };
  const random = () => {
    ready(); const b = new Uint8Array(32); let n;
    do { globalThis.crypto.getRandomValues(b); n = BigInt("0x" + Array.from(b, x => x.toString(16).padStart(2, "0")).join("")); } while (!n || n >= N);
    b.fill(0); return n;
  };
  const nonce = () => hex(random());
  const canonical = value => {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    throw new Error("Non-canonical protocol value");
  };
  const digest = async (value, algorithm = "SHA-256") => {
    ready(); const out = await globalThis.crypto.subtle.digest(algorithm, new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(out), x => x.toString(16).padStart(2, "0")).join("");
  };
  const challenge = async (...values) => BigInt("0x" + await digest([DOMAIN, ...values], "SHA-512")) % N;
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const cipher = c => { if (!Array.isArray(c) || c.length !== 2) throw new Error("Invalid ciphertext"); return c.map(x => decode(x)); };
  const wire = c => c.map(encode);
  const pub = key => decode(key, true);
  const signatureValid = async (key, purpose, value, sig) => {
    try {
      if (!Array.isArray(sig) || sig.length !== 2) return false;
      const x = pub(key), r = decode(sig[0], true), z = scalar(sig[1]);
      const c = await challenge("signature", purpose, key, value, sig[0]);
      return same(gmul(z), add(r, mul(x, c)));
    } catch { return false; }
  };
  const shareValid = async (key, card, context, share) => {
    try {
      if (!Array.isArray(share) || share.length !== 3) return false;
      const x = pub(key), a = decode(card[0], true), d = decode(share[0], true), c = scalar(share[1]), z = scalar(share[2]);
      const t1 = encode(sub(gmul(z), mul(x, c))), t2 = encode(sub(mul(a, z), mul(d, c)));
      return c === await challenge("share", context, key, card, share[0], t1, t2);
    } catch { return false; }
  };
  const player = (saved = null) => {
    let secret = saved === null ? random() : scalar(saved);
    if (!secret) throw new Error("Invalid private key");
    const publicKey = encode(gmul(secret));
    const live = () => { if (!secret) throw new Error("Private key has been discarded"); };
    return Object.freeze({ publicKey,
      // Only the private worker uses this, immediately sealing it in its account-scoped checkpoint.
      checkpoint() { live(); return hex(secret); },
      async sign(purpose, value) { live(); const r = random(), t = encode(gmul(r)); const c = await challenge("signature", purpose, publicKey, value, t); return [t, hex(mod(r + c * secret, N))]; },
      async share(card, context) { live(); const a = decode(card[0], true), d = mul(a, secret), r = random(), dWire = encode(d);
        const c = await challenge("share", context, publicKey, card, dWire, encode(gmul(r)), encode(mul(a, r)));
        return [dWire, hex(c), hex(mod(r + c * secret, N))]; },
      open(card, otherShares) { live(); const [a, b] = cipher(card); let d = mul(a, secret); for (const s of otherShares) d = add(d, decode(s[0], true)); return cardNumber(sub(b, d)); },
      dispose() { secret = 0n; } // BigInt/GC cannot guarantee erasure of earlier copies.
    });
  };
  let cardPoints, cardLookup;
  const cards = () => {
    if (!cardPoints) { cardPoints = []; cardLookup = new Map(); let p = G; for (let i = 0; i < 52; i++) { cardPoints.push(p); cardLookup.set(encode(p), i); p = add(p, G); } }
    return cardPoints;
  };
  const cardNumber = p => { cards(); const n = cardLookup.get(encode(p)); if (n === undefined) throw new Error("Decryption did not yield a card"); return n; };
  const aggregate = keys => {
    if (!Array.isArray(keys) || keys.length < 2 || keys.length > 9 || new Set(keys).size !== keys.length) throw new Error("Invalid key roster");
    let p = O; for (const key of keys) p = add(p, pub(key)); if (!p[2]) throw new Error("Aggregate key is zero"); return encode(p);
  };
  const initialDeck = key => { const y = pub(key); return cards().map(p => wire([G, add(p, y)])); };
  const openPublic = (card, shares) => { let p = decode(card[1]); for (const s of shares) p = sub(p, decode(s[0], true)); return cardNumber(p); };
  // Uniform permutation first, then deterministic routing. Random switch bits alone
  // do NOT give a uniform shuffle in this network.
  const permutation = n => {
    const p = Array.from({ length: n }, (_, i) => i), w = new Uint32Array(1);
    for (let i = n - 1; i > 0; i--) { const bound = i + 1, limit = 0x100000000 - 0x100000000 % bound; do { globalThis.crypto.getRandomValues(w); } while (w[0] >= limit); const j = w[0] % bound; [p[i], p[j]] = [p[j], p[i]]; }
    return p;
  };
  const route = dest => {
    const n = dest.length;
    if (n < 1 || n > 52 || new Set(dest).size !== n || dest.some(x => !Number.isInteger(x) || x < 0 || x >= n)) throw new Error("Not a permutation");
    if (n < 3) return { swap: n === 2 && dest[0] === 1 };
    const inverse = new Array(n); dest.forEach((x, i) => { inverse[x] = i; });
    const color = new Array(n).fill(-1);
    const paint = start => {
      const queue = [start]; if (color[start] < 0) color[start] = 0;
      for (let at = 0; at < queue.length; at++) { const x = queue[at], peers = [];
        if ((x ^ 1) < n) peers.push(x ^ 1);
        if ((dest[x] ^ 1) < n) peers.push(inverse[dest[x] ^ 1]);
        for (const y of peers) { const c = 1 - color[x]; if (color[y] < 0) { color[y] = c; queue.push(y); } else if (color[y] !== c) throw new Error("Unroutable switch network"); }
      }
    };
    if (n % 2) { paint(n - 1); if (color[inverse[n - 1]] > 0) throw new Error("Odd routing mismatch"); paint(inverse[n - 1]); }
    for (let i = 0; i < n; i++) if (color[i] < 0) paint(i);
    const top = new Array(Math.ceil(n / 2)), bottom = new Array(Math.floor(n / 2)), first = [], last = [];
    for (let i = 0; i < n; i++) (color[i] ? bottom : top)[Math.floor(i / 2)] = Math.floor(dest[i] / 2);
    for (let i = 0; i < Math.floor(n / 2); i++) { first.push(!!color[2 * i]); last.push(!!color[inverse[2 * i]]); }
    return { first, last, top: route(top), bottom: route(bottom) };
  };
  const gateCount = n => n < 2 ? 0 : n === 2 ? 1 : 2 * Math.floor(n / 2) + gateCount(Math.ceil(n / 2)) + gateCount(Math.floor(n / 2));
  const walkNetwork = async (input, routing, gate) => {
    const n = input.length; if (n === 1) return input;
    if (n === 2) return gate(input, routing?.swap);
    let top = [], bottom = [];
    for (let i = 0; i < Math.floor(n / 2); i++) { const pair = await gate(input.slice(2 * i, 2 * i + 2), routing?.first[i]); top.push(pair[0]); bottom.push(pair[1]); }
    if (n % 2) top.push(input[n - 1]);
    top = await walkNetwork(top, routing?.top, gate); bottom = await walkNetwork(bottom, routing?.bottom, gate);
    const out = [];
    for (let i = 0; i < Math.floor(n / 2); i++) out.push(...await gate([top[i], bottom[i]], routing?.last[i]));
    if (n % 2) out.push(top[top.length - 1]); return out;
  };
  const gateCommitments = (input, output, c, z, yMul) => {
    const commitments = [];
    for (let branch = 0; branch < 2; branch++) for (let j = 0; j < 2; j++) {
      const source = input[j ^ branch], a = sub(output[j][0], source[0]), b = sub(output[j][1], source[1]);
      commitments.push(encode(sub(gmul(z[branch][j]), mul(a, c[branch]))), encode(sub(yMul(z[branch][j]), mul(b, c[branch]))));
    }
    return commitments;
  };
  const shuffle = async (deck, key, context, progress = () => {}) => {
    ready(); if (!Array.isArray(deck) || deck.length !== 52) throw new Error("Expected a 52-card deck");
    const y = pub(key), yMul = fixed(y), routing = route(permutation(52)), gates = [];
    const result = await walkNetwork(deck.map(cipher), routing, async (input, swap) => {
      const branch = swap ? 1 : 0, fake = 1 - branch, r = [random(), random()];
      const output = r.map((k, j) => [add(input[j ^ branch][0], gmul(k)), add(input[j ^ branch][1], yMul(k))]);
      const c = [0n, 0n], z = [[0n, 0n], [0n, 0n]], t = [random(), random()];
      c[fake] = random(); z[fake] = [random(), random()];
      const commitments = gateCommitments(input, output, c, z, yMul);
      for (let j = 0; j < 2; j++) { commitments[branch * 4 + j * 2] = encode(gmul(t[j])); commitments[branch * 4 + j * 2 + 1] = encode(yMul(t[j])); }
      const outputWire = output.map(wire);
      const h = await challenge("switch", context, gates.length, key, input.map(wire), outputWire, commitments);
      c[branch] = mod(h - c[fake], N); for (let j = 0; j < 2; j++) z[branch][j] = mod(t[j] + c[branch] * r[j], N);
      gates.push({ out: outputWire, proof: [c[0], ...z[0], c[1], ...z[1]].map(hex) });
      progress(gates.length, gateCount(52)); await pause(); return output;
    });
    if (result.some(c => !c[0][2])) throw new Error("Degenerate deck; cancel this hand");
    return { gates };
  };
  const verifyShuffle = async (deck, key, context, transcript, progress = () => {}) => {
    if (!Array.isArray(deck) || deck.length !== 52 || !Array.isArray(transcript?.gates) || transcript.gates.length !== gateCount(52)) throw new Error("Invalid shuffle size");
    const yMul = fixed(pub(key)); let at = 0;
    const result = await walkNetwork(deck.map(cipher), null, async input => {
      const gate = transcript.gates[at];
      if (!Array.isArray(gate.out) || gate.out.length !== 2 || !Array.isArray(gate.proof) || gate.proof.length !== 6) throw new Error("Invalid switch");
      const output = gate.out.map(cipher), p = gate.proof.map(scalar), c = [p[0], p[3]], z = [[p[1], p[2]], [p[4], p[5]]];
      const h = await challenge("switch", context, at, key, input.map(wire), gate.out, gateCommitments(input, output, c, z, yMul));
      if (mod(c[0] + c[1], N) !== h) throw new Error("Shuffle proof failed at switch " + at);
      progress(++at, gateCount(52)); await pause(); return output;
    });
    if (result.some(c => !c[0][2])) throw new Error("Degenerate deck");
    return result.map(wire);
  };
  BL.pokerCrypto = Object.freeze({ DOMAIN, ready, canonical, digest, nonce, player, signatureValid, shareValid, aggregate, initialDeck, openPublic, shuffle, verifyShuffle,
    // Public math and routing, also used by interoperability/known-answer checks.
    math: Object.freeze({ P, N, G, O, add, sub, mul, same, encode, decode, route, walkNetwork, gateCount }) });
})();
