(() => {
  // 137x115 像素级部位命中图（由 earL_0 / earR_0 / ahoge 扣除头部与小发包前景生成，0=本体 1=左耳 2=右耳 3=呆毛）
  const HIT_W = 137;
  const HIT_H = 115;
  const PART_HIT_RLE =
    "a615d18a117d23a111d27a109d30a105d33a103d35a102d35a101d37a99d38a71b5a23d38a70b11a18d39a68b15a15d12a3d24a68b18a12d9a10d20a68b20a10d7a14d18a67b23a9d5a16d17a67b25a29d16a67b26a29d15a66b29a28d14a66b30a28d13a66b31a27d13a66b32a26d12a67b33a25d12a66b35a24d12a66b36a23d11a67b36a25d8a68b33a32d4a68b30a107b28a109b26a111b24a68c8a37b22a63c23a29b21a60c30a26b19a60c34a24b18a62c33a24b17a64c32a24b15a67c31a24b14a69c30a24b1a2b10a71c29a27b9a72c29a28b7a74c28a28b6a76c27a29b4a77c27a30b2a79c25a31b1a80c25a113c24a113c23a115c22a115c22a115c21a117c20a117c20a117c19a119c18a119c17a120c17a120c16a121c15a123c14a124c12a125c11a125c7a3c2a125c6a131c4a133c2a6459";

  const PART_HIT_GRID = (() => {
    const grid = new Uint8Array(HIT_W * HIT_H);
    let pos = 0;
    const re = /([abcd])(\d+)/g;
    let m;
    while ((m = re.exec(PART_HIT_RLE))) {
      const val = m[1].charCodeAt(0) - 97;
      const count = Number(m[2]);
      if (val > 0) grid.fill(val, pos, pos + count);
      pos += count;
    }
    return grid;
  })();

  const HAIR_RUB_COOLDOWN_MS = 12000;
  const HAIR_RUB_MAX_GAP_MS = 180;
  const HAIR_RUB_WINDOW_MS = 900;
  const HAIR_RUB_TURN_HYSTERESIS_PX = 6;
  const HAIR_RUB_REQUIRED_FAST_LEGS = 3; // 至少两折三段（右→左→右 或 左→右→左）快速揉搓

  function isHairUv(u, v) {
    if (u < 0.14 || u > 0.86 || v > 0.57) return false;
    // 顶部边界贴合猫娘发冠弧线（覆盖发顶、呆毛根部与刘海，排除眼睛/脸颊与上方透明留白）
    const crownTop = 0.17 + 0.21 * Math.pow((u - 0.50) / 0.36, 2);
    return v >= crownTop;
  }

  function createHairRubState() {
    return {
      active: false,
      startAt: 0,
      lastX: 0,
      lastY: 0,
      lastAt: 0,
      dir: 0,
      legStartAt: 0,
      legDx: 0,
      legDy: 0,
      peakAt: 0,
      revDx: 0,
      revDy: 0,
      fastLegs: 0
    };
  }

  function isFastHorizontalLeg(dx, dy, dtMs, faceWidth) {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const minLegPx = Math.max(16, faceWidth * 0.08);
    if (absDx < minLegPx || absDx < absDy * 1.35) return false;
    // 正常单向滑过/轻晃约 100~420 px/s；默认 220px 宽下需 >= 550 px/s（随缩放限幅 500~820 px/s）
    const minSpeedPxPerSec = Math.max(500, Math.min(820, faceWidth * 2.5));
    const speedPxPerSec = (absDx * 1000) / Math.max(8, dtMs);
    return speedPxPerSec >= minSpeedPxPerSec;
  }

  function hitTestUv(u, v) {
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return "body";
    const x = Math.min(HIT_W - 1, Math.floor(u * HIT_W));
    const y = Math.min(HIT_H - 1, Math.floor(v * HIT_H));
    const code = PART_HIT_GRID[y * HIT_W + x];
    return code === 1 ? "earL" : code === 2 ? "earR" : code === 3 ? "ahoge" : "body";
  }

  function createHitAndGestureTracker({ mascot, faceEl, getPetAt, setPetAt }) {
    let cachedFaceRect = null;
    let cachedFaceRectAt = 0;
    const hairRub = createHairRubState();

    function invalidateFaceRect() {
      cachedFaceRect = null;
      cachedFaceRectAt = 0;
    }

    function getFaceRect() {
      if (!faceEl) return null;
      const now = performance.now();
      if (!cachedFaceRect || now - cachedFaceRectAt > 120) {
        cachedFaceRect = faceEl.getBoundingClientRect();
        cachedFaceRectAt = now;
      }
      return cachedFaceRect;
    }

    function getFaceUv(clientX, clientY) {
      const r = getFaceRect();
      if (!r || !r.width || !r.height) return null;
      let u = (clientX - r.left) / r.width;
      const v = (clientY - r.top) / r.height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
      if (mascot.dataset.facing === "left") u = 1 - u;
      return { u, v, rect: r };
    }

    function hitTestPart(clientX, clientY) {
      const uv = getFaceUv(clientX, clientY);
      if (!uv) return "body";
      return hitTestUv(uv.u, uv.v);
    }

    function resetHairRub() {
      Object.assign(hairRub, createHairRubState());
    }

    /** 检测头顶头发区域的快速左右往返滑动，替代早前的慢速悬停计数触发。 */
    function trackHairRub(e, now) {
      const uv = getFaceUv(e.clientX, e.clientY);
      if (!uv || !isHairUv(uv.u, uv.v)) {
        resetHairRub();
        return false;
      }
      const petAt = getPetAt();
      if (petAt > 0 && now - petAt <= HAIR_RUB_COOLDOWN_MS) {
        resetHairRub();
        return false;
      }

      const faceWidth = uv.rect.width;
      const x = e.clientX;
      const y = e.clientY;
      if (!hairRub.active || now - hairRub.lastAt > HAIR_RUB_MAX_GAP_MS) {
        Object.assign(hairRub, createHairRubState(), {
          active: true,
          startAt: now,
          lastX: x,
          lastY: y,
          lastAt: now,
          legStartAt: now,
          peakAt: now
        });
        return false;
      }

      const stepDx = x - hairRub.lastX;
      const stepDy = y - hairRub.lastY;
      const prevAt = hairRub.lastAt;
      hairRub.lastX = x;
      hairRub.lastY = y;
      hairRub.lastAt = now;

      if (Math.hypot(stepDx, stepDy) < 2) return false;
      const stepDir = stepDx > 0 ? 1 : stepDx < 0 ? -1 : 0;

      if (hairRub.dir === 0) {
        if (stepDir === 0) return false;
        hairRub.dir = stepDir;
        hairRub.legStartAt = prevAt;
        hairRub.legDx = stepDx;
        hairRub.legDy = stepDy;
        hairRub.peakAt = now;
        hairRub.revDx = 0;
        hairRub.revDy = 0;
        return false;
      }

      if (stepDir === 0) {
        if (hairRub.revDx !== 0) {
          hairRub.revDy += stepDy;
        } else {
          hairRub.legDy += stepDy;
          hairRub.peakAt = now;
        }
      } else if (stepDir === hairRub.dir) {
        hairRub.legDx += stepDx;
        hairRub.legDy += stepDy;
        hairRub.peakAt = now;
        hairRub.revDx = 0;
        hairRub.revDy = 0;
      } else {
        hairRub.revDx += stepDx;
        hairRub.revDy += stepDy;
        if (Math.abs(hairRub.revDx) >= HAIR_RUB_TURN_HYSTERESIS_PX) {
          const legDt = Math.max(8, hairRub.peakAt - hairRub.legStartAt);
          if (
            isFastHorizontalLeg(hairRub.legDx, hairRub.legDy, legDt, faceWidth) &&
            now - hairRub.startAt <= HAIR_RUB_WINDOW_MS
          ) {
            hairRub.fastLegs += 1;
          } else {
            // 前一段过慢或超时：从本次折返重新起算第 1 段，无需移出头发重来
            hairRub.fastLegs = 0;
            hairRub.startAt = hairRub.peakAt;
          }
          hairRub.dir = stepDir;
          hairRub.legStartAt = hairRub.peakAt;
          hairRub.legDx = hairRub.revDx;
          hairRub.legDy = hairRub.revDy;
          hairRub.peakAt = now;
          hairRub.revDx = 0;
          hairRub.revDy = 0;
        }
      }

      if (hairRub.fastLegs >= HAIR_RUB_REQUIRED_FAST_LEGS - 1) {
        if (now - hairRub.startAt > HAIR_RUB_WINDOW_MS) {
          hairRub.fastLegs = 0;
          hairRub.startAt = hairRub.legStartAt;
          return false;
        }
        const curDt = Math.max(8, now - hairRub.legStartAt);
        if (isFastHorizontalLeg(hairRub.legDx, hairRub.legDy, curDt, faceWidth)) {
          setPetAt(now);
          resetHairRub();
          return true;
        }
      }
      return false;
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", invalidateFaceRect);
    }

    return {
      invalidateFaceRect,
      getFaceRect,
      getFaceUv,
      hitTestPart,
      resetHairRub,
      trackHairRub,
      destroy() {
        if (typeof window !== "undefined") {
          window.removeEventListener("resize", invalidateFaceRect);
        }
      }
    };
  }

  const exportsObj = {
    HIT_W,
    HIT_H,
    PART_HIT_RLE,
    PART_HIT_GRID,
    HAIR_RUB_COOLDOWN_MS,
    HAIR_RUB_MAX_GAP_MS,
    HAIR_RUB_WINDOW_MS,
    HAIR_RUB_TURN_HYSTERESIS_PX,
    HAIR_RUB_REQUIRED_FAST_LEGS,
    isHairUv,
    createHairRubState,
    isFastHorizontalLeg,
    hitTestUv,
    createHitAndGestureTracker
  };

  if (typeof window !== "undefined") {
    window.StarNeko = window.StarNeko || {};
    window.StarNeko.hitAndGestures = exportsObj;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
})();
