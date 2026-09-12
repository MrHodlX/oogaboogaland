// Cave registry for the hub
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  // Ring position by clock, 12 far and 3 right
  const slot = (id, clock, scene = null, status = "dark", name = null) => ({ id, clock, scene, status, name });
  const slots = [
    slot("c11", 11, "lab", "open", "EntropyLab"),
    slot("c9", 9, "race", "open", "Ooga Rally"),
    slot("c730", 7.5, null, "sleeping"),
    slot("c1", 1, null, "mirror", "Ooga Booga Land"),
    slot("c2", 2),
    slot("c3", 3),
    slot("c5", 5, "hodl", "open", "MrHodl's Den")
  ];
  BL.caves = { slots, gate: { name: "The old gate" } };
})();
