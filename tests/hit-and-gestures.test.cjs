const assert = require("node:assert/strict");
const path = require("node:path");

const hg = require(path.resolve(__dirname, "../app/Antigravity-Cat-Widget/src/renderer/modules/hit-and-gestures.js"));

// 1. 137x115 RLE 像素热区校验
assert.equal(hg.PART_HIT_GRID.length, 137 * 115);
const counts = [0, 0, 0, 0];
for (const v of hg.PART_HIT_GRID) counts[v]++;
assert.ok(counts[1] > 100 && counts[2] > 100 && counts[3] > 100);

// 2. 发冠抛物线边界校验
assert.equal(hg.isHairUv(0.5, 0.35), true);
assert.equal(hg.isHairUv(0.5, 0.10), false);
assert.equal(hg.isHairUv(0.5, 0.65), false);
assert.equal(hg.isHairUv(0.05, 0.40), false);
assert.equal(hg.isHairUv(0.95, 0.40), false);

// 3. 搓头状态机回归（慢晃/单向/脸颊/三段快搓/12s 冷却/镜像）
let petAt = 0;
const mascot = { dataset: { facing: "right" } };
const faceEl = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 220, height: 184 }) };
const tracker = hg.createHitAndGestureTracker({
  mascot,
  faceEl,
  getPetAt: () => petAt,
  setPetAt: v => { petAt = v; }
});
const feed = pts => pts.some(([x, y, t]) => tracker.trackHairRub({ clientX: x, clientY: y }, t));

assert.equal(feed([[170, 160, 1000], [230, 160, 1300], [170, 160, 1600], [230, 160, 1900]]), false);
tracker.resetHairRub();
assert.equal(feed([[160, 160, 2000], [240, 160, 2080]]), false);
tracker.resetHairRub();
assert.equal(feed([[160, 228, 3000], [230, 228, 3070], [160, 228, 3140], [230, 228, 3210]]), false);
tracker.resetHairRub();
assert.equal(feed([[160, 165, 4000], [230, 165, 4070], [160, 165, 4140], [230, 165, 4210]]), true);
assert.equal(feed([[160, 165, 5000], [230, 165, 5070], [160, 165, 5140], [230, 165, 5210]]), false);
mascot.dataset.facing = "left";
assert.equal(feed([[230, 165, 17000], [160, 165, 17070], [230, 165, 17140], [160, 165, 17210]]), true);
tracker.destroy();

console.log("[PASS] hit-and-gestures.test.cjs passed (grid + crown UV + 6 rub scenarios)");
