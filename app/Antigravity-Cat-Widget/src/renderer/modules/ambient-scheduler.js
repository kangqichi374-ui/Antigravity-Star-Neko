(() => {
  function createAmbientScheduler({
    $,
    mascot,
    thinkingFxEl,
    thinkingGlowEl,
    tearFxEl,
    rig,
    getSnapshot,
    isEffectivelyHidden,
    isCompat,
    isPointerActive,
    isEarBusy,
    isPartHeld,
    hasPartReleaseTimer,
    onPeriodicReaction
  }) {
    const timers = new Map();
    let ambientMotionTimer = null;
    let ambientTickMs = 0;
    let periodicReactionTimer = null;

    function setNamedTimeout(name, fn, ms) {
      clearNamedTimeout(name);
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name);
          fn();
        }, ms)
      );
    }

    function clearNamedTimeout(name) {
      const id = timers.get(name);
      if (id !== undefined) {
        clearTimeout(id);
        timers.delete(name);
      }
    }

    function clearAllTimeouts() {
      for (const id of timers.values()) clearTimeout(id);
      timers.clear();
    }

    function stopAmbientLoop(clearTransforms = true) {
      if (ambientMotionTimer) {
        clearInterval(ambientMotionTimer);
        ambientMotionTimer = null;
        ambientTickMs = 0;
      }
      if (clearTransforms) {
        const mEl = $("motion");
        const innerEl = $("bubble-inner");
        if (mEl && mEl.style.transform) mEl.style.transform = "";
        if (innerEl && innerEl.style.transform) innerEl.style.transform = "";
        if (thinkingFxEl && thinkingFxEl.style.transform) thinkingFxEl.style.transform = "";
        if (thinkingGlowEl && thinkingGlowEl.style.transform) thinkingGlowEl.style.transform = "";
        if (tearFxEl) {
          if (tearFxEl.style.transform) tearFxEl.style.transform = "";
          if (tearFxEl.style.opacity) tearFxEl.style.opacity = "";
        }
      }
    }

    function syncAmbientLoop() {
      const snapshot = getSnapshot();
      const st = snapshot?.state;
      const compat = isCompat();
      // In compat (CPU software) mode, skip subpixel 1px idle micro-scale so idle CPU stays ~0% while keeping blink/ears/ahoge/strand/glow!
      const stateNeedsLoop = compat
        ? st === "thinking" || st === "warning" || st === "error"
        : st === "idle" || st === "thinking" || st === "warning" || st === "error";
      const active =
        !isEffectivelyHidden() &&
        !snapshot?.settings?.reducedMotion &&
        !isPointerActive() &&
        mascot.dataset.pressed !== "true" &&
        stateNeedsLoop;

      if (!active) {
        stopAmbientLoop(true);
        return;
      }

      // 全特效保持 30fps (33ms)；兼容软渲染保持 20fps (50ms)
      const targetTickMs = compat ? 50 : 33;
      if (ambientMotionTimer && ambientTickMs === targetTickMs) return;
      stopAmbientLoop(false);
      ambientTickMs = targetTickMs;

      const mEl = $("motion");
      const innerEl = $("bubble-inner");
      if (innerEl && innerEl.style.transform) innerEl.style.transform = "";

      ambientMotionTimer = setInterval(() => {
        const snapNow = getSnapshot();
        const compatNow = isCompat();
        const cur = snapNow?.state;
        const neededNow = compatNow
          ? cur === "thinking" || cur === "warning" || cur === "error"
          : cur === "idle" || cur === "thinking" || cur === "warning" || cur === "error";
        if (
          isEffectivelyHidden() ||
          !snapNow ||
          snapNow.settings?.reducedMotion ||
          isPointerActive() ||
          mascot.dataset.pressed === "true" ||
          !neededNow
        ) {
          stopAmbientLoop(true);
          return;
        }

        const now = performance.now();
        if (cur === "idle") {
          if (compatNow) {
            if (mEl && mEl.style.transform) mEl.style.transform = "";
          } else {
            const w = 0.5 - 0.5 * Math.cos(((now % 4200) / 4200) * Math.PI * 2);
            if (mEl) {
              mEl.style.transform = `translateY(${(-1.0 * w).toFixed(2)}px) scale(${(1 + 0.003 * w).toFixed(4)}, ${(1 + 0.006 * w).toFixed(4)})`;
            }
          }
          if (thinkingFxEl && thinkingFxEl.style.transform) thinkingFxEl.style.transform = "";
          if (thinkingGlowEl && thinkingGlowEl.style.transform) thinkingGlowEl.style.transform = "";
        } else if (cur === "thinking") {
          if (compatNow) {
            if (mEl && mEl.style.transform) mEl.style.transform = "";
          } else {
            const w = 0.5 - 0.5 * Math.cos(((now % 3200) / 3200) * Math.PI * 2);
            const rot = -0.7 + 1.4 * w;
            const ty = -1.0 * w;
            if (mEl) mEl.style.transform = `rotate(${rot.toFixed(3)}deg) translateY(${ty.toFixed(2)}px)`;
          }
          const fw = 0.5 - 0.5 * Math.cos(((now % 2000) / 2000) * Math.PI * 2);
          const fTrans = `translateY(${compatNow ? Math.round(-3.0 * fw) : (-3.0 * fw).toFixed(2)}px)`;
          if (thinkingFxEl) thinkingFxEl.style.transform = fTrans;
          if (thinkingGlowEl) thinkingGlowEl.style.transform = fTrans;
        } else if (cur === "warning" || cur === "error") {
          if (compatNow) {
            if (mEl && mEl.style.transform) mEl.style.transform = "";
          } else {
            const w = 0.5 - 0.5 * Math.cos(((now % 3600) / 3600) * Math.PI * 2);
            if (mEl) {
              mEl.style.transform = `rotate(${(-0.35 + 0.7 * w).toFixed(3)}deg) translateY(${(1.0 * w).toFixed(2)}px)`;
            }
          }
          if (tearFxEl) {
            const tw = 0.5 - 0.5 * Math.cos(((now % 2400) / 2400) * Math.PI * 2);
            tearFxEl.style.transform = `translateY(${(4.0 * tw).toFixed(2)}px)`;
            tearFxEl.style.opacity = (0.75 + 0.25 * tw).toFixed(3);
          }
        } else {
          stopAmbientLoop(true);
        }
      }, targetTickMs);
    }

    function scheduleBlink() {
      clearNamedTimeout("blink");
      if (isEffectivelyHidden()) return;
      const delay = 3200 + Math.floor(Math.random() * 3800);
      setNamedTimeout("blink", () => {
        const snapshot = getSnapshot();
        const s = snapshot?.settings;
        if (
          !isEffectivelyHidden() &&
          s?.autoBlink !== false &&
          !s?.reducedMotion &&
          !mascot.dataset.expression &&
          ["idle", "offline"].includes(snapshot?.state)
        ) {
          mascot.dataset.blink = "true";
          setNamedTimeout("blinkReset", () => {
            delete mascot.dataset.blink;
          }, 150);
        }
        scheduleBlink();
      }, delay);
    }

    // 常态耳朵动作：每隔 7~14s 随机触发 5 种模式之一
    function scheduleEarAction() {
      clearNamedTimeout("earIdle");
      if (isEffectivelyHidden()) return;
      const delay = 7000 + Math.floor(Math.random() * 7000);
      setNamedTimeout("earIdle", () => {
        const s = getSnapshot()?.settings;
        if (!s?.reducedMotion && !isEarBusy() && !isEffectivelyHidden()) {
          const modes = ["left", "right", "both", "left-then-right", "right-then-left"];
          const mode = modes[Math.floor(Math.random() * modes.length)];
          const peak = 6;
          rig.clearEarSequence();
          if (mode === "left-then-right" || mode === "right-then-left") {
            const first = mode === "left-then-right" ? "left" : "right";
            const second = first === "left" ? "right" : "left";
            const secondPart = second === "left" ? "earL" : "earR";
            const stagger = 170 + Math.floor(Math.random() * 80);
            rig.runSingleEarTwitch(first, peak, false);
            rig.setEarSequence(() => {
              const curS = getSnapshot()?.settings;
              if (
                !curS?.reducedMotion &&
                !isPointerActive() &&
                !isPartHeld(secondPart) &&
                !hasPartReleaseTimer(secondPart) &&
                !isEffectivelyHidden()
              ) {
                rig.runSingleEarTwitch(second, peak, false);
              }
            }, stagger);
          } else {
            const doubleTwitch = Math.random() < 0.28;
            if (mode === "left" || mode === "both") rig.runSingleEarTwitch("left", peak, doubleTwitch);
            if (mode === "right" || mode === "both") rig.runSingleEarTwitch("right", peak, doubleTwitch);
          }
        }
        scheduleEarAction();
      }, delay);
    }

    // 常态呆毛动作：每隔 3.5~6.5s 慢晃一次（2.8s 周期，峰值 ±11.7°）
    function scheduleAhogeAction(initial = false) {
      clearNamedTimeout("ahogeIdle");
      if (isEffectivelyHidden()) return;
      const delay = initial ? 1000 : 3500 + Math.floor(Math.random() * 3000);
      setNamedTimeout("ahogeIdle", () => {
        const s = getSnapshot()?.settings;
        if (
          !s?.reducedMotion &&
          !isPointerActive() &&
          !isPartHeld("ahoge") &&
          !hasPartReleaseTimer("ahoge") &&
          !isEffectivelyHidden()
        ) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          rig.runAhogeTween(2800, p => {
            const envelope = Math.sin(p * Math.PI);
            const deg = dir * 16.5 * Math.sin(p * Math.PI * 2) * envelope;
            const dy = deg < 0 ? -deg * 0.08 : 0;
            return [deg, dy, 1];
          });
        }
        scheduleAhogeAction(false);
      }, delay);
    }

    // 常态发梢微风：每隔 5~9s 轻摆 2.8s
    function scheduleStrandAction(initial = false) {
      clearNamedTimeout("strandIdle");
      if (isEffectivelyHidden()) return;
      const delay = initial ? 2200 : 5000 + Math.floor(Math.random() * 4000);
      setNamedTimeout("strandIdle", () => {
        const s = getSnapshot()?.settings;
        if (!s?.reducedMotion && !isPointerActive() && !isEffectivelyHidden()) {
          rig.runStrandSequence([1, 2, 3, 0, 4, 5, 6, 0], 2800);
        }
        scheduleStrandAction(false);
      }, delay);
    }

    function start() {
      scheduleBlink();
      scheduleEarAction();
      scheduleAhogeAction(true);
      scheduleStrandAction(true);
      if (!periodicReactionTimer && typeof onPeriodicReaction === "function") {
        periodicReactionTimer = setInterval(() => {
          if (!isEffectivelyHidden()) onPeriodicReaction();
        }, 30000);
      }
    }

    function pause() {
      stopAmbientLoop(true);
      clearAllTimeouts();
      delete mascot.dataset.blink;
    }

    function resume() {
      scheduleBlink();
      scheduleEarAction();
      scheduleAhogeAction(false);
      scheduleStrandAction(false);
    }

    function destroy() {
      stopAmbientLoop(false);
      clearAllTimeouts();
      if (periodicReactionTimer) {
        clearInterval(periodicReactionTimer);
        periodicReactionTimer = null;
      }
    }

    return {
      syncAmbientLoop,
      stopAmbientLoop,
      start,
      pause,
      resume,
      destroy
    };
  }

  window.StarNeko = window.StarNeko || {};
  window.StarNeko.createAmbientScheduler = createAmbientScheduler;
})();
