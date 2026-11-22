(async () => {
  const api = window.widgetApi, $ = id => document.getElementById(id), mascot = $("mascot");
  let snapshot, selected = "quota", closed = true, temporary = null, timeout, pointer = null, gesture = 0, currentSound = null, petAt = 0, hoverCount = 0, hoverTime = 0, hit = null;
  let personality, talkState, talkLine, eggTimer, autoHide, hideAnimation, readyTimer, bounceTimer, lastBubbleOpen = null, blinkTimer = null, blinkResetTimer = null;
  let earIdleTimer = null, earSeqTimer = null, ahogeIdleTimer = null, earLRaf = 0, earRRaf = 0, ahogeRaf = 0, earLToken = 0, earRToken = 0, ahogeToken = 0;
  let curEarL = 0, curEarR = 0, curAhogeDeg = 0, curAhogeDy = 0, curAhogeScaleY = 1;
  let partPointer = null;
  const sideHeld = { 3: null, 4: null };
  const lastSideEventAt = { 3: 0, 4: 0 };
  const partReleaseTimers = { earL: null, earR: null, ahoge: null };
  const partSeqs = { earL: 0, earR: 0, ahoge: 0 };
  const hasSideButtonHeld = () => Boolean(sideHeld[3] || sideHeld[4]);
  const isPartHeld = part =>
    partPointer?.part === part || sideHeld[3]?.part === part || sideHeld[4]?.part === part;
  let gemIdleTimer = null, gemThinkingTimer = null, gemRaf = 0, gemToken = 0, curGemStep = 0;
  let curBunL = 0, curBunR = 0, curStrand = 0, strandIdleTimer = null, strandRaf = 0, strandToken = 0;
  let blushRaf = 0, blushToken = 0, curBlushOpacity = 0;

  const LAYER_DIR = "../../assets/character-packs/gemini-star-v1/layers/";
  const earLeftEl = $("ear-left"), earRightEl = $("ear-right"), ahogeEl = $("ahoge"), gemEl = $("gem-fx");
  const bunLeftEl = $("bun-left"), bunRightEl = $("bun-right"), strandEl = $("hair-strand"), blushEl = $("blush-fx");
  const earCacheL = [], earCacheR = [], gemCache = [], bunCacheL = [], bunCacheR = [], strandCache = [];
  for (let i = 0; i <= 8; i++) {
    const imgL = new Image();
    imgL.src = `${LAYER_DIR}earL_${i}.png`;
    earCacheL.push(imgL);
    const imgR = new Image();
    imgR.src = `${LAYER_DIR}earR_${i}.png`;
    earCacheR.push(imgR);
  }
  for (let i = 1; i <= 12; i++) {
    const imgG = new Image();
    imgG.src = `${LAYER_DIR}gem_${i}.png`;
    gemCache.push(imgG);
  }
  for (let i = 0; i <= 4; i++) {
    const bL = new Image();
    bL.src = `${LAYER_DIR}bunL_${i}.png`;
    bunCacheL.push(bL);
    const bR = new Image();
    bR.src = `${LAYER_DIR}bunR_${i}.png`;
    bunCacheR.push(bR);
  }
  for (let i = 0; i <= 6; i++) {
    const st = new Image();
    st.src = `${LAYER_DIR}strand_${i}.png`;
    strandCache.push(st);
  }

  function setBunLStep(stepL) {
    const l = Math.max(0, Math.min(4, Math.round(stepL)));
    if (l !== curBunL && bunLeftEl) {
      curBunL = l;
      bunLeftEl.src = bunCacheL[l].src;
    }
  }

  function setBunRStep(stepR) {
    const r = Math.max(0, Math.min(4, Math.round(stepR)));
    if (r !== curBunR && bunRightEl) {
      curBunR = r;
      bunRightEl.src = bunCacheR[r].src;
    }
  }

  function setBunSteps(stepL, stepR) {
    setBunLStep(stepL);
    setBunRStep(stepR);
  }

  function setStrandStep(step) {
    const s = Math.max(0, Math.min(6, Math.round(step)));
    if (s !== curStrand && strandEl) {
      curStrand = s;
      strandEl.src = strandCache[s].src;
    }
  }

  function runStrandSequence(seq, durationMs) {
    cancelAnimationFrame(strandRaf);
    const token = ++strandToken;
    const t0 = performance.now();
    function step(now) {
      if (token !== strandToken) return;
      const p = Math.min(1, (now - t0) / durationMs);
      const idx = Math.min(seq.length - 1, Math.floor(p * seq.length));
      setStrandStep(seq[idx]);
      if (p < 1) {
        strandRaf = requestAnimationFrame(step);
      } else {
        setStrandStep(0);
      }
    }
    strandRaf = requestAnimationFrame(step);
  }

  // 常态发梢微风：右下独立翘发丝与外侧发尖每隔 5~9 秒做一次约 2.8 秒的慢速轻柔呼吸摆动
  function scheduleStrandAction(initial = false) {
    clearTimeout(strandIdleTimer);
    const delay = initial ? 2200 : (5000 + Math.floor(Math.random() * 4000));
    strandIdleTimer = setTimeout(() => {
      const s = snapshot?.settings;
      if (!s?.reducedMotion && !pointer && !document.hidden) {
        runStrandSequence([1, 2, 3, 0, 4, 5, 6, 0], 2800);
      }
      scheduleStrandAction(false);
    }, delay);
  }

  // 脸颊微醺升温：不特别红（峰值 0.85），注意慢慢变红（1.8秒渐显 -> 维持2.0秒 -> 2.4秒缓缓消退）
  function triggerBlushWarmth() {
    if (!blushEl || snapshot?.settings?.reducedMotion || document.hidden) return;
    cancelAnimationFrame(blushRaf);
    const token = ++blushToken;
    const startOp = curBlushOpacity;
    const peakOp = 0.85;
    const riseMs = 1800, holdMs = 2000, fadeMs = 2400;
    const totalMs = riseMs + holdMs + fadeMs;
    const t0 = performance.now();
    let lastBlushDomOp = -1;
    function step(now) {
      if (token !== blushToken) return;
      const elapsed = now - t0;
      if (elapsed >= totalMs) {
        curBlushOpacity = 0;
        blushEl.style.opacity = "0";
        return;
      }
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

  const faceEl = document.querySelector(".agy-face");
  let curGlowLevel = 0, lastGlowDom = -1, glowMode = "off", glowStart = 0, glowFrom = 0;

  function applyWorkGlow(level, frameIdx = 6) {
    const lv = Math.max(0, Math.min(1, level));
    curGlowLevel = lv;
    if (gemEl && frameIdx !== curGemStep && lv > 0.01) {
      curGemStep = frameIdx;
      gemEl.src = gemCache[frameIdx - 1].src;
    }
    if (Math.abs(lv - lastGlowDom) < 0.008 && lv > 0.005 && lv < 0.995) return;
    lastGlowDom = lv;
    if (lv <= 0.005) {
      if (gemEl) gemEl.style.opacity = "0";
      if (faceEl) faceEl.style.filter = "";
      return;
    }
    if (gemEl) gemEl.style.opacity = (0.88 * lv).toFixed(3);
    if (faceEl) {
      // 薄薄一层紧贴轮廓的星晶光边（最大仅 2.5px + 5.5px，不发散）
      const r1 = (1.0 + 1.6 * lv).toFixed(2);
      const a1 = (0.90 * lv).toFixed(3);
      const r2 = (2.0 + 3.5 * lv).toFixed(2);
      const a2 = (0.50 * lv).toFixed(3);
      faceEl.style.filter = `drop-shadow(0 0 ${r1}px rgba(172, 146, 255, ${a1})) drop-shadow(0 0 ${r2}px rgba(210, 178, 255, ${a2}))`;
    }
  }

  // 仅在 AI 工作时发光：1.4秒慢慢亮起 -> 工作期间保持常亮（周围薄薄一层紧贴轮廓光边） -> 结束或暂停后1.6秒慢慢消失
  function syncGemState() {
    if (!gemEl && !faceEl) return;
    const isWorking =
      !snapshot?.settings?.reducedMotion &&
      !document.hidden &&
      (snapshot?.state === "thinking" || snapshot?.persistentState === "thinking");

    if (isWorking && glowMode !== "working") {
      glowMode = "working";
      cancelAnimationFrame(gemRaf);
      const token = ++gemToken;
      glowFrom = curGlowLevel;
      glowStart = performance.now();
      const riseMs = 1400;

      function riseLoop(now) {
        if (token !== gemToken || glowMode !== "working") return;
        const elapsed = now - glowStart;
        if (elapsed < riseMs) {
          const p = elapsed / riseMs;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
          const lv = glowFrom + (1 - glowFrom) * ease;
          const frameIdx = 4 + Math.min(2, Math.floor(p * 3));
          applyWorkGlow(lv, frameIdx);
          gemRaf = requestAnimationFrame(riseLoop);
        } else {
          // 达到满亮度后保持常亮（外圈薄光边与挂饰稳定常亮，不再忽明忽暗或占用高频重绘）
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
      if (glowFrom <= 0.01) {
        glowMode = "off";
        lastGlowDom = -1;
        applyWorkGlow(0, 6);
        return;
      }
      const t0 = performance.now();
      const outMs = 1600;
      function fadeOut(now) {
        if (token !== gemToken || glowMode !== "fading") return;
        const p = Math.min(1, (now - t0) / outMs);
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

  function setEarLStep(stepL) {
    const l = Math.max(0, Math.min(8, Math.round(stepL)));
    if (l !== curEarL && earLeftEl) {
      curEarL = l;
      earLeftEl.src = earCacheL[l].src;
    }
    setBunLStep(l * 0.5);
  }

  function setEarRStep(stepR) {
    const r = Math.max(0, Math.min(8, Math.round(stepR)));
    if (r !== curEarR && earRightEl) {
      curEarR = r;
      earRightEl.src = earCacheR[r].src;
    }
    setBunRStep(r * 0.5);
  }

  function setEarSteps(stepL, stepR) {
    setEarLStep(stepL);
    setEarRStep(stepR);
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

  function runEarLTween(durationMs, evalFn) {
    cancelAnimationFrame(earLRaf);
    const token = ++earLToken;
    const t0 = performance.now();
    function step(now) {
      if (token !== earLToken) return;
      const p = Math.min(1, (now - t0) / durationMs);
      setEarLStep(evalFn(p));
      if (p < 1) {
        earLRaf = requestAnimationFrame(step);
      }
    }
    earLRaf = requestAnimationFrame(step);
  }

  function runEarRTween(durationMs, evalFn) {
    cancelAnimationFrame(earRRaf);
    const token = ++earRToken;
    const t0 = performance.now();
    function step(now) {
      if (token !== earRToken) return;
      const p = Math.min(1, (now - t0) / durationMs);
      setEarRStep(evalFn(p));
      if (p < 1) {
        earRRaf = requestAnimationFrame(step);
      }
    }
    earRRaf = requestAnimationFrame(step);
  }

  function runAhogeTween(durationMs, evalFn) {
    cancelAnimationFrame(ahogeRaf);
    const token = ++ahogeToken;
    const t0 = performance.now();
    function step(now) {
      if (token !== ahogeToken) return;
      const p = Math.min(1, (now - t0) / durationMs);
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
        w = p < 0.45
          ? Math.sin((p / 0.45) * Math.PI)
          : 0.22 * (1 - p) + 0.88 * Math.sin(((p - 0.45) / 0.55) * Math.PI);
      }
      return peak * Math.max(0, Math.min(1, w));
    };
    if (side === "left") runEarLTween(dur, evalCurve);
    else runEarRTween(dur, evalCurve);
  }

  // 常态耳朵动作：平时保持不动（step=0），每隔 7~14 秒随机触发 5 种模式之一：
  // 左耳向下 / 右耳向下 / 双耳同时向下 / 左耳先下右耳紧跟 / 右耳先下左耳紧跟（先后间隔 170~250ms）
  function scheduleEarAction() {
    clearTimeout(earIdleTimer);
    const delay = 7000 + Math.floor(Math.random() * 7000);
    earIdleTimer = setTimeout(() => {
      const s = snapshot?.settings;
      const earBusy =
        pointer ||
        isPartHeld("earL") ||
        isPartHeld("earR") ||
        partReleaseTimers.earL ||
        partReleaseTimers.earR;
      if (!s?.reducedMotion && !earBusy && !document.hidden) {
        const modes = ["left", "right", "both", "left-then-right", "right-then-left"];
        const mode = modes[Math.floor(Math.random() * modes.length)];
        const peak = 6; // 常态下压幅度适中自然，按压时压到底(8)
        clearTimeout(earSeqTimer);
        earSeqTimer = null;
        if (mode === "left-then-right" || mode === "right-then-left") {
          const first = mode === "left-then-right" ? "left" : "right";
          const second = first === "left" ? "right" : "left";
          const secondPart = second === "left" ? "earL" : "earR";
          const stagger = 170 + Math.floor(Math.random() * 80);
          runSingleEarTwitch(first, peak, false);
          earSeqTimer = setTimeout(() => {
            earSeqTimer = null;
            const curS = snapshot?.settings;
            if (
              !curS?.reducedMotion &&
              !pointer &&
              !isPartHeld(secondPart) &&
              !partReleaseTimers[secondPart] &&
              !document.hidden
            ) {
              runSingleEarTwitch(second, peak, false);
            }
          }, stagger);
        } else {
          const doubleTwitch = Math.random() < 0.28;
          if (mode === "left" || mode === "both") runSingleEarTwitch("left", peak, doubleTwitch);
          if (mode === "right" || mode === "both") runSingleEarTwitch("right", peak, doubleTwitch);
        }
      }
      scheduleEarAction();
    }, delay);
  }

  // 常态呆毛动作：每隔 3.5~6.5 秒慢速明显晃动一次（约 2.8 秒慢周期，峰值 ±12° 肉眼清晰可见且节奏舒缓）
  function scheduleAhogeAction(initial = false) {
    clearTimeout(ahogeIdleTimer);
    const delay = initial ? 1000 : (3500 + Math.floor(Math.random() * 3000));
    ahogeIdleTimer = setTimeout(() => {
      const s = snapshot?.settings;
      if (!s?.reducedMotion && !pointer && !isPartHeld("ahoge") && !partReleaseTimers.ahoge && !document.hidden) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        runAhogeTween(2800, p => {
          const envelope = Math.sin(p * Math.PI);
          // sin(2πp) * sin(πp) 最大值为 0.707，乘以 16.5 后实际峰值约 ±11.7°，肉眼清晰可见又不会过快
          const deg = dir * 16.5 * Math.sin(p * Math.PI * 2) * envelope;
          const dy = (deg < 0 ? -deg * 0.08 : 0);
          return [deg, dy, 1];
        });
      }
      scheduleAhogeAction(false);
    }, delay);
  }

  function syncPersonality() {
    if (!snapshot) return;
    const base = snapshot.dialogue || {};
    const s = snapshot.settings || {};
    const custom = String(s.customLines || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const merged = { ...base };
    if (custom.length > 0) {
      merged.idle = s.customLinesMode === "only" ? custom : [...(base.idle || []), ...custom];
    }
    if (!personality) {
      personality = new window.StarPersonality(merged);
    } else {
      personality.lines = merged;
    }
  }

  function pulseContent() {
    const inner = $("bubble-inner"), bubble = $("bubble");
    if (!inner || !bubble || bubble.dataset.ready !== "true" || snapshot?.settings?.reducedMotion) return;
    clearTimeout(bounceTimer);
    inner.dataset.bounce = "true";
    bounceTimer = setTimeout(() => {
      delete inner.dataset.bounce;
    }, 130);
  }

  function armBubble() {
    clearTimeout(autoHide);
    const ms = snapshot?.settings?.bubbleAutoHideMs ?? 6500;
    if (!closed && ms > 0) {
      autoHide = setTimeout(() => {
        closed = true;
        render();
      }, ms);
    }
  }

  function bubbleVisibility(open) {
    const bubble = $("bubble");
    if (lastBubbleOpen === open) return;
    lastBubbleOpen = open;
    clearTimeout(hideAnimation);
    clearTimeout(readyTimer);
    bubble.inert = !open;
    bubble.setAttribute("aria-hidden", String(!open));
    if (open) {
      delete bubble.dataset.ready;
      bubble.hidden = false;
      bubble.dataset.open = "false";
      void bubble.offsetWidth;
      requestAnimationFrame(() => {
        if (lastBubbleOpen) {
          bubble.dataset.open = "true";
          readyTimer = setTimeout(() => {
            if (lastBubbleOpen) bubble.dataset.ready = "true";
          }, 460);
        }
      });
    } else {
      delete bubble.dataset.ready;
      bubble.dataset.open = "false";
      hideAnimation = setTimeout(() => {
        if (!lastBubbleOpen) bubble.hidden = true;
      }, snapshot?.settings.reducedMotion ? 0 : 420);
    }
  }

  function stopReaction() {
    clearTimeout(eggTimer);
    if (mascot.dataset.expression) {
      delete mascot.dataset.expression;
      talkState = null;
    }
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    const delay = 3200 + Math.floor(Math.random() * 3800);
    blinkTimer = setTimeout(() => {
      const s = snapshot?.settings;
      if (
        s?.autoBlink !== false &&
        !s?.reducedMotion &&
        !mascot.dataset.expression &&
        ["idle", "offline"].includes(snapshot?.state)
      ) {
        mascot.dataset.blink = "true";
        clearTimeout(blinkResetTimer);
        blinkResetTimer = setTimeout(() => {
          delete mascot.dataset.blink;
        }, 150);
      }
      scheduleBlink();
    }, delay);
  }

  const format = v => (typeof v === "number" ? v.toLocaleString() : "—");

  function stopSound() {
    gesture++;
    if (currentSound) {
      currentSound.pause();
      currentSound.currentTime = 0;
      currentSound = null;
    }
  }

  async function play(kind) {
    const token = ++gesture;
    if (currentSound) currentSound.pause();
    const isEvent = kind === "turnDone" || kind === "waiting";
    if (!isEvent && (!snapshot?.settings.sound || snapshot.settings.volume === 0)) return;
    const payload = await api.audio(kind);
    if (token !== gesture || !payload) return;
    currentSound = new Audio(payload.url);
    currentSound.volume = payload.effectiveVolume;
    currentSound.play().catch(() => {});
  }

  function nextTalkLine() {
    talkState = snapshot?.persistentState || snapshot?.state || "idle";
    talkLine = personality.say(talkState === "offline" ? "idle" : talkState);
    return talkLine;
  }

  function render() {
    if (!snapshot) return;
    const s = snapshot.settings;
    if (selected !== "quota" && selected !== "talk") selected = "quota";

    mascot.style.setProperty("--agy-width", (snapshot.displayScale || s.scale) + "px");
    mascot.style.setProperty("--agy-shift", (snapshot.artShift || 0) + "px");
    mascot.dataset.state = snapshot.state;
    mascot.dataset.dock = snapshot.dockSide || "";
    mascot.dataset.facing = snapshot.facing || "left";
    mascot.dataset.reducedMotion = String(s.reducedMotion);
    mascot.dataset.theme = s.bubbleTheme || "crystal";
    mascot.dataset.hideTools = String(Boolean(s.hideHoverTools));

    const open = !closed && s.bubbleOn;
    bubbleVisibility(open);
    if (!open) return;

    const showQuota = !temporary && selected === "quota";
    const showValue = Boolean(temporary) || selected !== "quota";
    const showDetail = Boolean(temporary?.detail);
    if ($("quota").hidden !== !showQuota) $("quota").hidden = !showQuota;
    if ($("value").hidden !== !showValue) $("value").hidden = !showValue;
    if ($("detail").hidden !== !showDetail) $("detail").hidden = !showDetail;

    if (temporary) {
      $("title").textContent = temporary.title;
      $("value").classList.remove("agy-phrase");
      $("value").textContent = temporary.body;
      $("detail").textContent = temporary.detail || "";
      $("meta").textContent = temporary.meta || "";
      return;
    }

    if (selected === "quota") {
      $("title").textContent = "Gemini 额度";
      $("meta").textContent = "";
      $("value").classList.remove("agy-phrase");
      for (const [suffix, value] of [
        ["", s.manualQuota ? s.manualPercent : snapshot.quotaWindows?.fiveHour],
        ["-week", s.manualQuota ? s.manualWeeklyPercent : snapshot.quotaWindows?.weekly]
      ]) {
        const known = typeof value === "number";
        $("percent" + suffix).textContent = known ? Math.round(value) + "%" : "—";
        $("fill" + suffix).style.width = known ? value + "%" : "100%";
        $("track" + suffix).dataset.known = String(known);
        $("track" + suffix).dataset.level = !known ? "unknown" : value <= 10 ? "critical" : value <= 30 ? "low" : "normal";
        $("percent" + suffix).dataset.level = $("track" + suffix).dataset.level;
        if (known) $("track" + suffix).setAttribute("aria-valuenow", value);
        else $("track" + suffix).removeAttribute("aria-valuenow");
      }
      $("caption").textContent = s.manualQuota ? "手动记录" : "";
    } else {
      $("title").textContent = "喵言喵语";
      $("value").classList.add("agy-phrase");
      if (!talkLine) nextTalkLine();
      $("value").textContent = talkLine;
      $("meta").textContent = "";
    }
  }

  function message(title, body, detail = "", ms = 5000, meta = "") {
    clearTimeout(timeout);
    clearTimeout(autoHide);
    temporary = { title, body, detail, meta };
    closed = false;
    render();
    pulseContent();
    if (ms > 0) {
      timeout = setTimeout(() => {
        temporary = null;
        closed = true;
        render();
      }, ms);
    }
  }

  // 1. 点击角色：如果气泡未显示，第一次点击弹出对话框（额度页并立即自动刷新最新额度）；如果已显示，保持原有跟随挤压回弹与内部轻弹
  function clickCharacter() {
    if (!snapshot.settings.bubbleOn) {
      api.save({ bubbleOn: true });
    }
    api.command("quota-refresh");
    if (closed) {
      clearTimeout(timeout);
      temporary = null;
      closed = false;
      selected = "quota";
      if (snapshot.settings.bubblePage !== "quota") {
        api.save({ bubblePage: "quota" });
      }
      armBubble();
      render();
    } else {
      if (!temporary) armBubble();
      pulseContent();
    }
  }

  // 2. 点击对话框（气泡）：额度 -> 对话（新台词 + 框内Q弹动效） -> 气泡从大到小依次消失
  function clickBubble() {
    clearTimeout(timeout);
    if (!snapshot.settings.bubbleOn) {
      api.save({ bubbleOn: true });
    }
    if (closed || temporary) {
      temporary = null;
      closed = false;
      selected = "quota";
      if (snapshot.settings.bubblePage !== "quota") {
        api.save({ bubblePage: "quota" });
      }
      armBubble();
      render();
      pulseContent();
    } else if (selected === "quota") {
      selected = "talk";
      nextTalkLine();
      if (snapshot.settings.bubblePage !== "talk") {
        api.save({ bubblePage: "talk" });
      }
      armBubble();
      render();
      pulseContent();
    } else {
      clearTimeout(autoHide);
      closed = true;
      render();
    }
  }

  if ($("toggle")) {
    $("toggle").onclick = () => {
      if (closed) clickCharacter();
      else clickBubble();
    };
  }
  $("settings").onclick = () => api.command("settings");

  window.addEventListener("contextmenu", e => {
    e.preventDefault();
    api.command("menu");
  });

  let bubblePressTimer = null, bubblePressAt = 0;
  function releaseBubblePress() {
    clearTimeout(bubblePressTimer);
    const bubble = $("bubble");
    if (!bubble || bubble.dataset.pressed !== "true") return;
    const wait = Math.max(0, 95 - (performance.now() - bubblePressAt));
    if (wait <= 0) {
      delete bubble.dataset.pressed;
    } else {
      bubblePressTimer = setTimeout(() => {
        delete bubble.dataset.pressed;
      }, wait);
    }
  }
  $("bubble").addEventListener("pointerenter", () => clearTimeout(autoHide));
  $("bubble").addEventListener("pointerleave", () => {
    releaseBubblePress();
    armBubble();
  });
  $("bubble").addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    clearTimeout(bubblePressTimer);
    bubblePressAt = performance.now();
    $("bubble").dataset.pressed = "true";
  });
  $("bubble").addEventListener("pointerup", releaseBubblePress);
  $("bubble").addEventListener("pointercancel", releaseBubblePress);
  $("bubble").addEventListener("click", () => {
    play("press");
    clickBubble();
  });

  window.addEventListener("wheel", e => {
    if (!snapshot) return;
    const mode = snapshot.settings.wheelAction || "page";
    if (mode === "none") return;
    e.preventDefault();
    if (mode === "page") {
      if (closed) clickCharacter();
      else clickBubble();
    } else if (mode === "scale") {
      const cur = snapshot.settings.scale || 220;
      const next = Math.max(140, Math.min(360, cur + (e.deltaY < 0 ? 10 : -10)));
      if (next !== cur) api.save({ scale: next });
    }
  }, { passive: false });

  const motion = $("motion");

  // 137x115 像素级部位命中图（由 earL_0 / earR_0 / ahoge 扣除头部与小发包前景生成，0=本体 1=左耳 2=右耳 3=呆毛）
  const HIT_W = 137, HIT_H = 115;
  const PART_HIT_RLE = "a615d18a117d23a111d27a109d30a105d33a103d35a102d35a101d37a99d38a71b5a23d38a70b11a18d39a68b15a15d12a3d24a68b18a12d9a10d20a68b20a10d7a14d18a67b23a9d5a16d17a67b25a29d16a67b26a29d15a66b29a28d14a66b30a28d13a66b31a27d13a66b32a26d12a67b33a25d12a66b35a24d12a66b36a23d11a67b36a25d8a68b33a32d4a68b30a107b28a109b26a111b24a68c8a37b22a63c23a29b21a60c30a26b19a60c34a24b18a62c33a24b17a64c32a24b15a67c31a24b14a69c30a24b1a2b10a71c29a27b9a72c29a28b7a74c28a28b6a76c27a29b4a77c27a30b2a79c25a31b1a80c25a113c24a113c23a115c22a115c22a115c21a117c20a117c20a117c19a119c18a119c17a120c17a120c16a121c15a123c14a124c12a125c11a125c7a3c2a125c6a131c4a133c2a6459";
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

  function hitTestPart(clientX, clientY) {
    if (!faceEl) return "body";
    const r = faceEl.getBoundingClientRect();
    if (!r.width || !r.height) return "body";
    let u = (clientX - r.left) / r.width;
    const v = (clientY - r.top) / r.height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return "body";
    if (mascot.dataset.facing === "left") u = 1 - u;
    const x = Math.min(HIT_W - 1, Math.floor(u * HIT_W));
    const y = Math.min(HIT_H - 1, Math.floor(v * HIT_H));
    const code = PART_HIT_GRID[y * HIT_W + x];
    return code === 1 ? "earL" : code === 2 ? "earR" : code === 3 ? "ahoge" : "body";
  }

  function pressPart(part, pressed) {
    const reduced = snapshot?.settings?.reducedMotion;
    if (part === "earL") {
      if (pressed) {
        clearTimeout(earSeqTimer);
        earSeqTimer = null;
        if (reduced) { setEarLStep(8); return; }
        triggerBlushWarmth();
        const startL = curEarL;
        runEarLTween(105, p => startL + (8 - startL) * (1 - Math.pow(1 - p, 2.4)));
      } else {
        if (reduced) { setEarLStep(0); return; }
        const startL = curEarL;
        runEarLTween(240, p => startL * Math.pow(1 - p, 2.2));
      }
      return;
    }
    if (part === "earR") {
      if (pressed) {
        clearTimeout(earSeqTimer);
        earSeqTimer = null;
        if (reduced) { setEarRStep(8); return; }
        triggerBlushWarmth();
        const startR = curEarR;
        runEarRTween(105, p => startR + (8 - startR) * (1 - Math.pow(1 - p, 2.4)));
      } else {
        if (reduced) { setEarRStep(0); return; }
        const startR = curEarR;
        runEarRTween(240, p => startR * Math.pow(1 - p, 2.2));
      }
      return;
    }
    if (part === "ahoge") {
      if (pressed) {
        if (reduced) { setAhogePose(-28, 3.0, 0.82); return; }
        triggerBlushWarmth();
        const startDeg = curAhogeDeg, startDy = curAhogeDy, startSy = curAhogeScaleY;
        runAhogeTween(110, p => {
          const ease = 1 - Math.pow(1 - p, 2.4);
          return [
            startDeg + (-28 - startDeg) * ease,
            startDy + (3.0 - startDy) * ease,
            startSy + (0.82 - startSy) * ease
          ];
        });
      } else {
        if (reduced) { setAhogePose(0, 0, 1); return; }
        const startDeg = curAhogeDeg, startDy = curAhogeDy, startSy = curAhogeScaleY;
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

  function animatePress(pressed) {
    motion.dataset.pressed = String(pressed);
    mascot.dataset.pressed = String(pressed);
    if (snapshot?.settings?.reducedMotion) {
      if (pressed || !isPartHeld("earL")) setEarLStep(pressed ? 8 : 0);
      if (pressed || !isPartHeld("earR")) setEarRStep(pressed ? 8 : 0);
      if (pressed || !isPartHeld("ahoge")) setAhogePose(pressed ? -20 : 0, pressed ? 2.2 : 0, 1);
      return;
    }
    if (pressed) {
      clearTimeout(earSeqTimer);
      earSeqTimer = null;
      for (const k of ["earL", "earR", "ahoge"]) {
        clearTimeout(partReleaseTimers[k]);
        partReleaseTimers[k] = null;
        partSeqs[k]++;
      }
      triggerBlushWarmth();
      cancelAnimationFrame(strandRaf);
      strandToken++;
      setStrandStep(2);
      const startL = curEarL, startR = curEarR;
      const startDeg = curAhogeDeg, startDy = curAhogeDy, startSy = curAhogeScaleY;
      runEarLTween(110, p => startL + (8 - startL) * (1 - Math.pow(1 - p, 2.4)));
      runEarRTween(110, p => startR + (8 - startR) * (1 - Math.pow(1 - p, 2.4)));
      runAhogeTween(115, p => {
        const ease = 1 - Math.pow(1 - p, 2.4);
        return [
          startDeg + (-20 - startDeg) * ease,
          startDy + (2.2 - startDy) * ease,
          startSy + (0.92 - startSy) * ease
        ];
      });
    } else {
      const startL = curEarL, startR = curEarR;
      const startDeg = curAhogeDeg, startDy = curAhogeDy, startSy = curAhogeScaleY;
      runStrandSequence([3, 0, 5, 6, 0], 460);
      if (!isPartHeld("earL")) {
        runEarLTween(230, p => startL * Math.pow(1 - p, 2.2));
      }
      if (!isPartHeld("earR")) {
        runEarRTween(230, p => startR * Math.pow(1 - p, 2.2));
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

  let pressSeq = 0, pressStartAt = 0, pressReleaseTimer = null;
  let lastPointerPos = null;

  function recordPointerPos(e) {
    if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      lastPointerPos = { x: e.clientX, y: e.clientY };
    }
  }

  function isPointInteractive(e) {
    recordPointerPos(e);
    if (document.querySelector(".interactive:hover")) return true;
    if (lastPointerPos) {
      const el = document.elementFromPoint(lastPointerPos.x, lastPointerPos.y);
      if (el && el.closest(".interactive")) return true;
    }
    return false;
  }

  function syncHitAfterRelease(e = null) {
    if (partPointer || hasSideButtonHeld() || pointer) return;
    const stillInteractive = isPointInteractive(e);
    if (hit !== stillInteractive) {
      hit = stillInteractive;
      api.hit(stillInteractive);
    }
  }

  function sideButtonTargetEar(btn) {
    const flipped = mascot.dataset.facing === "left";
    if (btn === 4) return flipped ? "earR" : "earL"; // 前侧键 -> 视觉左耳
    if (btn === 3) return flipped ? "earL" : "earR"; // 后侧键 -> 视觉右耳
    return null;
  }

  function pressSideButton(btn) {
    const part = sideButtonTargetEar(btn);
    if (!part || sideHeld[btn]) return;
    lastSideEventAt[btn] = performance.now();
    clearTimeout(partReleaseTimers[part]);
    partReleaseTimers[part] = null;
    partSeqs[part]++;
    sideHeld[btn] = { part, seq: partSeqs[part], startAt: performance.now() };
    if (hit !== true) {
      hit = true;
      api.hit(true);
    }
    pressPart(part, true);
    play("press");
  }

  function releaseSideButton(btn, cancel = false, ev = null) {
    const held = sideHeld[btn];
    if (!held) return;
    lastSideEventAt[btn] = performance.now();
    sideHeld[btn] = null;
    const { part, seq, startAt } = held;
    clearTimeout(partReleaseTimers[part]);
    partReleaseTimers[part] = null;
    if (!isPartHeld(part) && !pointer) {
      const dwell = cancel ? 0 : Math.max(0, 110 - (performance.now() - startAt));
      if (dwell <= 0) {
        pressPart(part, false);
      } else {
        partReleaseTimers[part] = setTimeout(() => {
          partReleaseTimers[part] = null;
          if (partSeqs[part] === seq && !isPartHeld(part) && !pointer) {
            pressPart(part, false);
          }
        }, dwell);
      }
    }
    play("release");
    syncHitAfterRelease(ev);
  }

  function releaseAllSideButtons(cancel = true, ev = null) {
    if (sideHeld[3]) releaseSideButton(3, cancel, ev);
    if (sideHeld[4]) releaseSideButton(4, cancel, ev);
  }

  function syncSideButtonsMask(buttons, allowPress = false, ev = null) {
    if (typeof buttons !== "number") return;
    const down3 = (buttons & 8) !== 0;
    const down4 = (buttons & 16) !== 0;
    if (allowPress) {
      if (down3 && !sideHeld[3]) pressSideButton(3);
      if (down4 && !sideHeld[4]) pressSideButton(4);
    }
    if (sideHeld[3] && !down3) releaseSideButton(3, false, ev);
    if (sideHeld[4] && !down4) releaseSideButton(4, false, ev);
  }

  function releasePart(cancel = false, ev = null) {
    if (!partPointer) return;
    const { part, seq, startAt } = partPointer;
    partPointer = null;
    delete motion.dataset.partPressed;
    clearTimeout(partReleaseTimers[part]);
    partReleaseTimers[part] = null;
    if (!isPartHeld(part) && !pointer) {
      const dwell = cancel ? 0 : Math.max(0, 110 - (performance.now() - startAt));
      if (dwell <= 0) {
        pressPart(part, false);
      } else {
        partReleaseTimers[part] = setTimeout(() => {
          partReleaseTimers[part] = null;
          if (partSeqs[part] === seq && !isPartHeld(part) && !pointer) {
            pressPart(part, false);
          }
        }, dwell);
      }
    }
    play("release");
    syncHitAfterRelease(ev);
  }

  mascot.addEventListener("pointerdown", e => {
    recordPointerPos(e);
    const isSide = e.button === 3 || e.button === 4 || (e.buttons & 24) !== 0;
    if (!isSide) return;
    const hitTarget = e.target.closest(".interactive");
    if (!hasSideButtonHeld() && !hitTarget) return;
    if (!pointer && !partPointer) {
      try { (hitTarget || motion).setPointerCapture(e.pointerId); } catch {}
    }
    if (e.button === 3 || e.button === 4) pressSideButton(e.button);
    syncSideButtonsMask(e.buttons, true, e);
  });
  mascot.addEventListener("pointermove", e => {
    recordPointerPos(e);
    if (hasSideButtonHeld() || (e.buttons & 24) !== 0) {
      syncSideButtonsMask(e.buttons, hasSideButtonHeld() || Boolean(e.target.closest(".interactive")), e);
    }
  });
  mascot.addEventListener("pointerup", e => {
    recordPointerPos(e);
    if (hasSideButtonHeld()) syncSideButtonsMask(e.buttons, false, e);
  });
  mascot.addEventListener("pointercancel", e => releaseAllSideButtons(true, e));
  mascot.addEventListener("lostpointercapture", e => releaseAllSideButtons(true, e));

  window.addEventListener("mousedown", e => {
    recordPointerPos(e);
    if (e.button !== 3 && e.button !== 4) return;
    if (!hasSideButtonHeld() && !e.target.closest(".interactive")) return;
    e.preventDefault();
    pressSideButton(e.button);
  });

  window.addEventListener("mouseup", e => {
    recordPointerPos(e);
    if (e.button !== 3 && e.button !== 4) return;
    if (sideHeld[e.button] || isPointInteractive(e)) {
      e.preventDefault();
    }
    if (!sideHeld[e.button]) return;
    releaseSideButton(e.button, false, e);
  });

  window.addEventListener("auxclick", e => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
    }
  });

  if (typeof api.onSideButton === "function") {
    api.onSideButton(ev => {
      const btn = ev?.button;
      if (btn !== 3 && btn !== 4) return;
      if (ev.tap) {
        if (!sideHeld[btn] && performance.now() - lastSideEventAt[btn] > 300) {
          pressSideButton(btn);
          releaseSideButton(btn, false);
        }
        return;
      }
      if (ev.pressed) pressSideButton(btn);
      else releaseSideButton(btn, false);
    });
  }

  motion.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const hitPart = hitTestPart(e.clientX, e.clientY);
    if (hitPart !== "body") {
      if (partPointer) releasePart(true);
      clearTimeout(partReleaseTimers[hitPart]);
      partReleaseTimers[hitPart] = null;
      partSeqs[hitPart]++;
      partPointer = { id: e.pointerId, part: hitPart, seq: partSeqs[hitPart], startAt: performance.now() };
      motion.dataset.partPressed = hitPart;
      motion.setPointerCapture(e.pointerId);
      pressPart(hitPart, true);
      play("press");
      return;
    }
    clearTimeout(pressReleaseTimer);
    pressSeq++;
    pressStartAt = performance.now();
    pointer = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false, seq: pressSeq };
    motion.setPointerCapture(e.pointerId);
    animatePress(true);
    api.pointer({ action: "down", point: { x: e.screenX, y: e.screenY } });
    play("press");
  });

  motion.addEventListener("pointermove", e => {
    if (partPointer) return;
    if (pointer) {
      if (Math.hypot(e.screenX - pointer.x, e.screenY - pointer.y) > 8) pointer.moved = true;
      api.pointer({ action: "move", point: { x: e.screenX, y: e.screenY } });
      return;
    }
    if (hasSideButtonHeld()) return;
    const hoverPart = hitTestPart(e.clientX, e.clientY);
    if (hoverPart !== "body") motion.dataset.hoverPart = hoverPart;
    else delete motion.dataset.hoverPart;

    const now = Date.now();
    hoverCount = now - hoverTime < 250 ? hoverCount + 1 : 1;
    hoverTime = now;
    if (hoverCount > 16 && now - petAt > 12000) {
      hoverCount = 0;
      petAt = now;
      triggerBlushWarmth();
      api.pointer("pet");
    }
  });

  motion.addEventListener("pointerleave", () => {
    delete motion.dataset.hoverPart;
  });

  async function release(cancel = false) {
    if (!pointer) return;
    const seq = pointer.seq;
    const wasMoved = pointer.moved;
    pointer = null;
    clearTimeout(pressReleaseTimer);
    const dwell = cancel || wasMoved ? 0 : Math.max(0, 110 - (performance.now() - pressStartAt));
    if (dwell <= 0) {
      animatePress(false);
    } else {
      pressReleaseTimer = setTimeout(() => {
        if (seq === pressSeq && !pointer) animatePress(false);
      }, dwell);
    }
    play("release");
    const result = await api.pointer(cancel ? "cancel" : "up");
    if (seq !== pressSeq) return;
    if (!result?.moved && !wasMoved && !cancel) {
      clickCharacter();
      reaction(false, true);
    }
  }

  motion.addEventListener("pointerup", e => { releasePart(false, e); release(); });
  motion.addEventListener("pointercancel", e => { releasePart(true, e); release(true); });
  motion.addEventListener("lostpointercapture", e => { releasePart(true, e); release(true); });
  window.addEventListener("blur", () => { lastPointerPos = null; releaseAllSideButtons(true); releasePart(true); release(true); });

  motion.addEventListener("keydown", e => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      clickCharacter();
      reaction(false, true);
    }
  });

  window.addEventListener("mousemove", e => {
    recordPointerPos(e);
    if (hasSideButtonHeld()) syncSideButtonsMask(e.buttons, false, e);
    const active = Boolean(partPointer) || hasSideButtonHeld() || !!e.target.closest(".interactive");
    if (hit !== active) {
      hit = active;
      api.hit(active);
    }
  });

  window.addEventListener("mouseleave", () => {
    lastPointerPos = null;
    if (partPointer || hasSideButtonHeld()) return;
    hit = false;
    api.hit(false);
  });

  api.subscribe(data => {
    const prevCustom = snapshot?.settings?.customLines;
    const prevMode = snapshot?.settings?.customLinesMode;
    if (
      snapshot &&
      (!data.settings.sound ||
        data.settings.soundSet !== snapshot.settings.soundSet ||
        data.settings.volume !== snapshot.settings.volume)
    ) {
      stopSound();
    }
    snapshot = data;
    syncPersonality();
    if (prevCustom !== data.settings.customLines || prevMode !== data.settings.customLinesMode) {
      nextTalkLine();
    }
    if (!data.settings.easterEggs || !["idle", "offline", "pressed", "release"].includes(data.state)) {
      stopReaction();
    }
    syncGemState();
    render();
  });

  api.onStep(turn => {
    triggerBlushWarmth();
    if (snapshot?.settings.turnDoneSound) {
      play("turnDone");
    }
    if (snapshot?.settings.turnCostOn !== false) {
      const t = turn?.tokens || {};
      const direct = typeof t.direct === "number" ? t.direct : (t.input || 0) + (t.output || 0);
      const cacheText = typeof t.cache === "number" && t.cache > 0 ? "缓存 " + format(t.cache) : "";
      const stepText = turn?.stepCount ? "共 " + turn.stepCount + " 步" : "";
      const meta = [cacheText, stepText].filter(Boolean).join(" · ");
      message(
        "本次对话完成",
        format(direct) + " tok",
        "入 " + format(t.input) + " · 出 " + format(t.output),
        snapshot?.settings.turnCostDurationMs || 6500,
        meta
      );
      if (!snapshot?.settings.turnDoneSound) play("release");
    }
  });

  api.onWaiting(() => {
    if (snapshot?.settings.waitingSound) {
      play("waiting");
    }
    if (snapshot?.settings.waitingAlertOn) {
      message(
        "等待你的确认",
        "AI 正在等你回答",
        "请切回聊天窗口查看提问",
        Math.max(6000, snapshot.settings.turnCostDurationMs || 6000),
        ""
      );
    }
  });

  function reaction(manual = false, clicked = false) {
    if (!snapshot || !personality) return;
    const kind = personality.reaction(
      {
        enabled: snapshot.settings.easterEggs,
        hidden: document.hidden || closed || !snapshot.settings.bubbleOn,
        busy: !!temporary || !!pointer || (clicked && !!mascot.dataset.expression),
        state: clicked ? snapshot.persistentState : snapshot.state
      },
      manual,
      clicked
    );
    if (!kind) return;
    delete mascot.dataset.blink;
    mascot.dataset.expression = kind;
    triggerBlushWarmth();
    clearTimeout(eggTimer);
    eggTimer = setTimeout(() => {
      delete mascot.dataset.expression;
      talkState = null;
      render();
    }, 3200);
  }

  api.onReaction(() => reaction(true));
  const ambient = setInterval(() => reaction(), 30000);

  snapshot = await api.get();
  syncPersonality();
  selected = "quota";
  scheduleBlink();
  scheduleEarAction();
  scheduleAhogeAction(true);
  scheduleStrandAction(true);
  syncGemState();
  render();

  window.addEventListener("beforeunload", () => {
    clearTimeout(timeout);
    clearTimeout(autoHide);
    clearTimeout(hideAnimation);
    clearTimeout(readyTimer);
    clearTimeout(bounceTimer);
    clearTimeout(bubblePressTimer);
    clearTimeout(pressReleaseTimer);
    clearTimeout(partReleaseTimers.earL);
    clearTimeout(partReleaseTimers.earR);
    clearTimeout(partReleaseTimers.ahoge);
    clearTimeout(eggTimer);
    clearTimeout(blinkTimer);
    clearTimeout(blinkResetTimer);
    clearTimeout(earIdleTimer);
    clearTimeout(earSeqTimer);
    clearTimeout(ahogeIdleTimer);
    clearTimeout(strandIdleTimer);
    clearTimeout(gemIdleTimer);
    clearInterval(gemThinkingTimer);
    cancelAnimationFrame(earLRaf);
    cancelAnimationFrame(earRRaf);
    cancelAnimationFrame(ahogeRaf);
    cancelAnimationFrame(strandRaf);
    cancelAnimationFrame(blushRaf);
    cancelAnimationFrame(gemRaf);
    clearInterval(ambient);
    stopSound();
  });
})();
