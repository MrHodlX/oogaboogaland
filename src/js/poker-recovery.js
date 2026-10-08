// Loaded only inside the private poker worker, never in the floor's page bundle.
(() => {
  "use strict";
  const open = async account => {
    if (!/^[1-9][0-9]*$/.test(account) || !self.indexedDB || !self.navigator?.locks) throw new Error("Live recovery needs IndexedDB and Web Locks in this browser");
    let release;
    await new Promise((resolve, reject) => {
      self.navigator.locks.request("ooga-poker:" + account, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("Poker is already connected in another tab. Close that connection before reloading here.");
        await new Promise(done => { release = done; resolve(); });
      }).catch(reject);
    });
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const request = self.indexedDB.open("ooga-poker-recovery", 1);
        let abandoned = false;
        request.onupgradeneeded = () => request.result.createObjectStore("accounts");
        request.onerror = () => reject(request.error);
        request.onblocked = () => { abandoned = true; reject(new Error("Close other poker tabs to open recovery storage")); };
        request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
      });
    } catch (error) { release(); throw error; }
    db.onversionchange = () => db.close();
    const transaction = (mode, operation) => new Promise((resolve, reject) => {
      const tx = db.transaction("accounts", mode), request = operation(tx.objectStore("accounts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Recovery storage failed"));
    });
    const aad = new TextEncoder().encode(self.BL.pokerCrypto.DOMAIN + ":recovery-v1:" + account);
    let key = null;
    return {
      async load() {
        const saved = await transaction("readonly", store => store.get(account));
        if (!saved) return null;
        key = saved.key;
        if (!key || key.extractable || key.algorithm.name !== "AES-GCM") throw new Error("Invalid recovery key");
        const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: saved.iv, additionalData: aad }, key, saved.box);
        return JSON.parse(new TextDecoder().decode(bytes));
      },
      async save(value) {
        if (!key) key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const box = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, new TextEncoder().encode(JSON.stringify(value)));
        // Completion, not merely put.onsuccess, is the boundary before a key or command may leave the device.
        await transaction("readwrite", store => store.put({ key, iv, box }, account));
      },
      async clear() { await transaction("readwrite", store => store.delete(account)); key = null; },
      close() { db.close(); release(); },
    };
  };
  self.BL.pokerRecovery = { open };
})();
