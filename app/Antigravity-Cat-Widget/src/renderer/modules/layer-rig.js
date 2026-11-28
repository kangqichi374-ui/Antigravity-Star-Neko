(() => {
  const LAYER_DIR = "../../assets/character-packs/gemini-star-v1/layers/";

  function preloadImg(src) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    return img;
  }

  function createLayerRig({
    $,
    mascot,
    motion,
    faceEl,
    thinkingGlowEl,
    getSnapshot,
    isEffectivelyHidden,
    isCompat,
    onBodyPressChanged
  }) {
    const earLeftEl = $("ear-left");
    const earRightEl = $("ear-right");
    const ahogeEl = $("ahoge");
    const gemEl = $("gem-fx");
    const bunLeftEl = $("bun-left");
    const bunRightEl = $("bun-right");
    const strandEl = $("hair-strand");
    const blushEl = $("blush-fx");

    const earCache = { left: [], right: [] };
    const bunCache = { left: [], right: [] };
    const gemCache = {};
    const strandCache = [];

    for (let i = 0; i <= 8; i++) {
      earCache.left.push(preloadImg(`${LAYER_DIR}earL_${i}.png`));
      earCache.right.push(preloadImg(`${LAYER_DIR}earR_${i}.png`));
    }
    for (const i of [4, 5, 6]) {
      gemCache[i] = preloadImg(`${LAYER_DIR}gem_${i}.png`);
    }
    for (let i = 0; i <= 4; i++) {
      bunCache.left.push(preloadImg(`${LAYER_DIR}bunL_${i}.png`));
      bunCache.right.push(preloadImg(`${LAYER_DIR}bunR_${i}.png`));
    }
    for (let i = 0; i <= 6; i++) {
      strandCache.push(preloadImg(`${LAYER_DIR}strand_${i}.png`));
    }

    const earState = {
      left: { cur: 0, bunCur: 0, raf: 0, token: 0, el: earLeftEl, bunEl: bunLeftEl },
      right: { cur: 0, bunCur: 0, raf: 0, token: 0, el: earRightEl, bunEl: bunRightEl }
    };

    let curAhogeDeg = 0;
    let curAhogeDy = 0;
    let curAhogeScaleY = 1;
    let ahogeRaf = 0;
    let ahogeToken = 0;

    let curStrand = 0;
    let strandStepTimer = null;
    let strandToken = 0;

    let blushRaf = 0;
    let blushToken = 0;
    let curBlushOpacity = 0;

    let gemRaf = 0;
    let gemToken = 0;
    let curGemStep = 6;
    let curGlowLevel = 0;
    let lastGlowDom = -1;
    let glowMode = "off";
    let glowStart = 0;
    let glowFrom = 0;

    let earSeqTimer = null;

    // 保留全特效帧率节流：GPU 60fps (~15.5ms) / 兼容软渲染 30fps (~31ms)
    const getFrameInterval = () => (isCompat() ? 31 : 15.5);

    function clearEarSequence() {
      clearTimeout(earSeqTimer);
      earSeqTimer = null;
    }

    function setEarSequence(fn, delayMs) {
      clearEarSequence();
      earSeqTimer = setTimeout(() => {
        earSeqTimer = null;
        fn();
      }, delayMs);
    }

    function setBunStep(side, step) {
      const st = earState[side];
      if (!st) return;
      const clamped = Math.max(0, Math.min(4, Math.round(step)));
      if (clamped !== st.bunCur && st.bunEl) {
        st.bunCur = clamped;
        st.bunEl.src = bunCache[side][clamped].src;
      }
    }

    function setEarStep(side, step) {
      const st = earState[side];
      if (!st) return;
      const clamped = Math.max(0, Math.min(8, Math.round(step)));
      if (clamped !== st.cur && st.el) {
        st.cur = clamped;
        st.el.src = earCache[side][clamped].src;
      }
      setBunStep(side, clamped * 0.5);
    }

    function setEarSteps(stepL, stepR) {
      setEarStep("left", stepL);
      setEarStep("right", stepR);
    }

    function setStrandStep(step) {
      const clamped = Math.max(0, Math.min(6, Math.round(step)));
      if (clamped !== curStrand && strandEl) {
        curStrand = clamped;
        strandEl.src = strandCache[clamped].src;
      }
    }

    function stopStrandSequence(resetStep = null) {
      clearTimeout(strandStepTimer);
      strandStepTimer = null;
      strandToken++;
      if (typeof resetStep === "number") setStrandStep(resetStep);
    }

    function runStrandSequence(seq, durationMs) {
      clearTimeout(strandStepTimer);
      strandStepTimer = null;
      const token = ++strandToken;
      if (!seq.length || isEffectivelyHidden()) {
        setStrandStep(0);
        return;
      }
      const stepMs = Math.max(16, Math.round(durationMs / seq.length));
      let idx = 0;
      function tick() {
        if (token !== strandToken) return;
        if (idx < seq.length) {
          setStrandStep(seq[idx++]);
          strandStepTimer = setTimeout(tick, stepMs);
        } else {
          strandStepTimer = null;
          setStrandStep(0);
        }
      }
      tick();
    }

    function setAhogePose(deg, dyPct = 0, scaleY = 1) {
      curAhogeDeg = deg;
      curAhogeDy = dyPct;
      curAhogeScaleY = scaleY;
      if (!ahogeEl) return;
      if (Math.abs(deg) < 0.05 && Math.abs(dyPct) < 0.02 && Math.abs(scaleY - 1) < 0.002) {
        ahogeEl.style.transform = "";
      } else {
        ahogeEl.style.transform = `translateY(${dyPct.toFixed(2)}%) rotate(${deg.toFixed(2)}deg) scaleY(${scaleY.toFixed(3)})`;
      }
    }

    function runEarTween(side, durationMs, evalFn) {
      const st = earState[side];
      if (!st) return;
      cancelAnimationFrame(st.raf);
      const token = ++st.token;
      const t0 = performance.now();
      let lastTick = 0;
      function step(now) {
        if (token !== st.token) return;
        const p = Math.min(1, (now - t0) / durationMs);
        if (p < 1 && lastTick && now - lastTick < getFrameInterval()) {
          st.raf = requestAnimationFrame(step);
          return;
        }
        lastTick = now;
        setEarStep(side, evalFn(p));
        if (p < 1) {
          st.raf = requestAnimationFrame(step);
        }
      }
      st.raf = requestAnimationFrame(step);
    }

    function runAhogeTween(durationMs, evalFn) {
      cancelAnimationFrame(ahogeRaf);
      const token = ++ahogeToken;
      const t0 = performance.now();
      let lastTick = 0;
      function step(now) {
        if (token !== ahogeToken) return;
        const p = Math.min(1, (now - t0) / durationMs);
        if (p < 1 && lastTick && now - lastTick < getFrameInterval()) {
          ahogeRaf = requestAnimationFrame(step);
          return;
        }
        lastTick = now;
        const [deg, dy, sy = 1] = evalFn(p);
        setAhogePose(deg, dy, sy);
        if (p < 1) {
          ahogeRaf = requestAnimationFrame(step);
        }
      }
      ahogeRaf = requestAnimationFrame(step);
    }

    function runSingleEarTwitch(side, peak = 6, doubleTwitch = false) {
      const dur = doubleTwitch ? 720 : 460;
      const evalCurve = p => {
        let w = 0;
        if (!doubleTwitch) {
          w = Math.sin(p * Math.PI);
        } else {
          w =
            p < 0.45
              ? Math.sin((p / 0.45) * Math.PI)
              : 0.22 * (1 - p) + 0.88 * Math.sin(((p - 0.45) / 0.55) * Math.PI);
        }
        return peak * Math.max(0, Math.min(1, w));
      };
      runEarTween(side, dur, evalCurve);
    }

    // 脸颊微醺升温：峰值 0.85，1.8s 渐显 -> 2.0s 维持 -> 2.4s 缓缓消退
    function triggerBlushWarmth() {
      const snapshot = getSnapshot();
      if (!blushEl || snapshot?.settings?.reducedMotion || isEffectivelyHidden()) return;
      cancelAnimationFrame(blushRaf);
      const token = ++blushToken;
      const startOp = curBlushOpacity;
      const peakOp = 0.85;
      const riseMs = 1800;
      const holdMs = 2000;
      const fadeMs = 2400;
      const totalMs = riseMs + holdMs + fadeMs;
      const t0 = performance.now();
      let lastBlushDomOp = -1;
      let lastTick = 0;
      function step(now) {
        if (token !== blushToken) return;
        const elapsed = now - t0;
        if (elapsed >= totalMs) {
          curBlushOpacity = 0;
          blushEl.style.opacity = "0";
          return;
        }
        if (lastTick && now - lastTick < getFrameInterval()) {
          blushRaf = requestAnimationFrame(step);
          return;
        }
        lastTick = now;
        let op = 0;
        if (elapsed < riseMs) {
          const p = elapsed / riseMs;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
          op = startOp + (peakOp - startOp) * ease;
        } else if (elapsed < riseMs + holdMs) {
          op = peakOp;
        } else {
          const p = (elapsed - riseMs - holdMs) / fadeMs;
          const ease = 0.5 + 0.5 * Math.cos(p * Math.PI);
          op = peakOp * ease;
        }
        curBlushOpacity = op;
        if (Math.abs(op - lastBlushDomOp) >= 0.008) {
          lastBlushDomOp = op;
          blushEl.style.opacity = op.toFixed(3);
        }
        blushRaf = requestAnimationFrame(step);
      }
      blushRaf = requestAnimationFrame(step);
    }

    function applyWorkGlow(level, frameIdx = 6) {
      const lv = Math.max(0, Math.min(1, level));
      curGlowLevel = lv;
      const safeIdx = gemCache[frameIdx] ? frameIdx : 6;
      if (gemEl && safeIdx !== curGemStep && lv > 0.01) {
        curGemStep = safeIdx;
        gemEl.src = gemCache[safeIdx].src;
      }
      if (Math.abs(lv - lastGlowDom) < 0.008 && lv > 0.005 && lv < 0.995) return;
      lastGlowDom = lv;
      if (lv <= 0.005) {
        if (gemEl) gemEl.style.opacity = "0";
        if (faceEl) faceEl.style.filter = "";
        if (thinkingGlowEl) thinkingGlowEl.style.filter = "";
        return;
      }
      if (gemEl) gemEl.style.opacity = (0.88 * lv).toFixed(3);
      // 薄薄一层紧贴轮廓的星晶光边（最大仅 2.5px + 5.5px，不发散）
      const r1 = (1.0 + 1.6 * lv).toFixed(2);
      const a1 = (0.90 * lv).toFixed(3);
      const r2 = (2.0 + 3.5 * lv).toFixed(2);
      const a2 = (0.50 * lv).toFixed(3);
      const filterCss = `drop-shadow(0 0 ${r1}px rgba(172, 146, 255, ${a1})) drop-shadow(0 0 ${r2}px rgba(210, 178, 255, ${a2}))`;
      if (faceEl) faceEl.style.filter = filterCss;
      if (thinkingGlowEl) thinkingGlowEl.style.filter = filterCss;
    }

    // 仅在 AI 工作时发光：1.4s 缓亮 -> 工作期间常亮 -> 结束后 1.6s 缓灭
    function syncGemState() {
      if (!gemEl && !faceEl) return;
      const snapshot = getSnapshot();
      const isWorking =
        !snapshot?.settings?.reducedMotion &&
        !isEffectivelyHidden() &&
        (snapshot?.state === "thinking" || snapshot?.persistentState === "thinking");

      if (isWorking && glowMode !== "working") {
        glowMode = "working";
        cancelAnimationFrame(gemRaf);
        const token = ++gemToken;
        glowFrom = curGlowLevel;
        glowStart = performance.now();
        const riseMs = 1400;
        let lastTick = 0;

        function riseLoop(now) {
          if (token !== gemToken || glowMode !== "working") return;
          const elapsed = now - glowStart;
          if (elapsed < riseMs) {
            if (lastTick && now - lastTick < getFrameInterval()) {
              gemRaf = requestAnimationFrame(riseLoop);
              return;
            }
            lastTick = now;
            const p = elapsed / riseMs;
            const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
            const lv = glowFrom + (1 - glowFrom) * ease;
            const frameIdx = 4 + Math.min(2, Math.floor(p * 3));
            applyWorkGlow(lv, frameIdx);
            gemRaf = requestAnimationFrame(riseLoop);
          } else {
            lastGlowDom = -1;
            applyWorkGlow(1, 6);
          }
        }
        gemRaf = requestAnimationFrame(riseLoop);
      } else if (!isWorking && glowMode === "working") {
        glowMode = "fading";
        cancelAnimationFrame(gemRaf);
        const token = ++gemToken;
        glowFrom = curGlowLevel;
        if (glowFrom <= 0.01 || isEffectivelyHidden()) {
          glowMode = "off";
          lastGlowDom = -1;
          applyWorkGlow(0, 6);
          return;
        }
        const t0 = performance.now();
        const outMs = 1600;
        let lastTick = 0;
        function fadeOut(now) {
          if (token !== gemToken || glowMode !== "fading") return;
          const p = Math.min(1, (now - t0) / outMs);
          if (p < 1 && lastTick && now - lastTick < getFrameInterval()) {
            gemRaf = requestAnimationFrame(fadeOut);
            return;
          }
          lastTick = now;
          const ease = 0.5 + 0.5 * Math.cos(p * Math.PI);
          applyWorkGlow(glowFrom * ease, 6);
          if (p < 1) {
            gemRaf = requestAnimationFrame(fadeOut);
          } else {
            glowMode = "off";
            lastGlowDom = -1;
            applyWorkGlow(0, 6);
          }
        }
        gemRaf = requestAnimationFrame(fadeOut);
      }
    }

    function pressPart(part, pressed) {
      const reduced = getSnapshot()?.settings?.reducedMotion;
      if (part === "earL" || part === "earR") {
        const side = part === "earL" ? "left" : "right";
        const start = earState[side].cur;
        if (pressed) {
          clearEarSequence();
          if (reduced) {
            setEarStep(side, 8);
            return;
          }
          triggerBlushWarmth();
          runEarTween(side, 105, p => start + (8 - start) * (1 - Math.pow(1 - p, 2.4)));
        } else {
          if (reduced) {
            setEarStep(side, 0);
            return;
          }
          runEarTween(side, 240, p => start * Math.pow(1 - p, 2.2));
        }
        return;
      }
      if (part === "ahoge") {
        if (pressed) {
          if (reduced) {
            setAhogePose(-28, 3.0, 0.82);
            return;
          }
          triggerBlushWarmth();
          const startDeg = curAhogeDeg;
          const startDy = curAhogeDy;
          const startSy = curAhogeScaleY;
          runAhogeTween(110, p => {
            const ease = 1 - Math.pow(1 - p, 2.4);
            return [
              startDeg + (-28 - startDeg) * ease,
              startDy + (3.0 - startDy) * ease,
              startSy + (0.82 - startSy) * ease
            ];
          });
        } else {
          if (reduced) {
            setAhogePose(0, 0, 1);
            return;
          }
          const startDeg = curAhogeDeg;
          const startDy = curAhogeDy;
          const startSy = curAhogeScaleY;
          runAhogeTween(540, p => {
            const decay = Math.pow(1 - p, 1.85);
            const osc = Math.cos(p * Math.PI * 2.5) * decay;
            return [
              startDeg * osc,
              startDy * (1 - Math.min(1, p * 2.2)),
              1 + (startSy - 1) * osc
            ];
          });
        }
      }
    }

    function animateBodyPress(pressed, { isPartHeld, clearPartReleaseTimers }) {
      motion.dataset.pressed = String(pressed);
      mascot.dataset.pressed = String(pressed);
      if (onBodyPressChanged) onBodyPressChanged(pressed);

      if (getSnapshot()?.settings?.reducedMotion) {
        if (pressed || !isPartHeld("earL")) setEarStep("left", pressed ? 8 : 0);
        if (pressed || !isPartHeld("earR")) setEarStep("right", pressed ? 8 : 0);
        if (pressed || !isPartHeld("ahoge")) setAhogePose(pressed ? -20 : 0, pressed ? 2.2 : 0, 1);
        return;
      }

      const startL = earState.left.cur;
      const startR = earState.right.cur;
      const startDeg = curAhogeDeg;
      const startDy = curAhogeDy;
      const startSy = curAhogeScaleY;

      if (pressed) {
        clearEarSequence();
        clearPartReleaseTimers();
        triggerBlushWarmth();
        stopStrandSequence(2);
        runEarTween("left", 110, p => startL + (8 - startL) * (1 - Math.pow(1 - p, 2.4)));
        runEarTween("right", 110, p => startR + (8 - startR) * (1 - Math.pow(1 - p, 2.4)));
        runAhogeTween(115, p => {
          const ease = 1 - Math.pow(1 - p, 2.4);
          return [
            startDeg + (-20 - startDeg) * ease,
            startDy + (2.2 - startDy) * ease,
            startSy + (0.92 - startSy) * ease
          ];
        });
      } else {
        runStrandSequence([3, 0, 5, 6, 0], 460);
        if (!isPartHeld("earL")) {
          runEarTween("left", 230, p => startL * Math.pow(1 - p, 2.2));
        }
        if (!isPartHeld("earR")) {
          runEarTween("right", 230, p => startR * Math.pow(1 - p, 2.2));
        }
        if (!isPartHeld("ahoge")) {
          runAhogeTween(520, p => {
            const decay = Math.pow(1 - p, 1.85);
            const osc = Math.cos(p * Math.PI * 2.5) * decay;
            return [
              startDeg * osc,
              startDy * (1 - Math.min(1, p * 2.2)),
              1 + (startSy - 1) * osc
            ];
          });
        }
      }
    }

    function playPettingCombo(canTwitchRightEar) {
      if (getSnapshot()?.settings?.reducedMotion || isEffectivelyHidden()) return;
      clearEarSequence();
      runSingleEarTwitch("left", 7, true);
      setEarSequence(() => {
        if (!getSnapshot()?.settings?.reducedMotion && !isEffectivelyHidden() && canTwitchRightEar()) {
          runSingleEarTwitch("right", 7, true);
        }
      }, 150);
      runAhogeTween(680, p => {
        const decay = Math.pow(1 - p, 1.5);
        const deg = 18 * Math.sin(p * Math.PI * 3) * decay;
        return [deg, 0, 1];
      });
      runStrandSequence([1, 2, 0, 4, 5, 0], 680);
    }

    function pauseAndReset() {
      clearEarSequence();
      stopStrandSequence(0);
      cancelAnimationFrame(earState.left.raf);
      cancelAnimationFrame(earState.right.raf);
      cancelAnimationFrame(ahogeRaf);
      cancelAnimationFrame(blushRaf);
      cancelAnimationFrame(gemRaf);
      earState.left.token++;
      earState.right.token++;
      ahogeToken++;
      blushToken++;
      gemToken++;
      setEarSteps(0, 0);
      setAhogePose(0, 0, 1);
      curBlushOpacity = 0;
      if (blushEl) blushEl.style.opacity = "0";
      glowMode = "off";
      lastGlowDom = -1;
      applyWorkGlow(0, 6);
    }

    function destroy() {
      clearEarSequence();
      clearTimeout(strandStepTimer);
      strandStepTimer = null;
      cancelAnimationFrame(earState.left.raf);
      cancelAnimationFrame(earState.right.raf);
      cancelAnimationFrame(ahogeRaf);
      cancelAnimationFrame(blushRaf);
      cancelAnimationFrame(gemRaf);
    }

    return {
      setEarStep,
      setEarSteps,
      setStrandStep,
      runStrandSequence,
      stopStrandSequence,
      setAhogePose,
      runEarTween,
      runAhogeTween,
      runSingleEarTwitch,
      clearEarSequence,
      setEarSequence,
      triggerBlushWarmth,
      applyWorkGlow,
      syncGemState,
      pressPart,
      animateBodyPress,
      playPettingCombo,
      pauseAndReset,
      destroy
    };
  }

  window.StarNeko = window.StarNeko || {};
  window.StarNeko.createLayerRig = createLayerRig;
})();
