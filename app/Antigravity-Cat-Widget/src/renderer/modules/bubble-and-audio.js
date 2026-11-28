(() => {
  const format = v => (typeof v === "number" ? v.toLocaleString() : "—");

  function createBubbleAndAudio({
    api,
    $,
    mascot,
    getSnapshot,
    isPointerActive,
    onRenderNeeded,
    onBlush,
    onClearPettingExpr
  }) {
    let selected = "quota";
    let closed = true;
    let temporary = null;
    let personality = null;
    let talkState = null;
    let talkLine = null;
    let lastBubbleOpen = null;

    let timeout = null;
    let autoHide = null;
    let hideAnimation = null;
    let readyTimer = null;
    let bounceTimer = null;
    let eggTimer = null;
    let bubblePressTimer = null;
    let bubblePressAt = 0;

    let gesture = 0;
    const activeSounds = new Set();
    const audioPayloadCache = new Map();

    function invalidateAudioCache() {
      audioPayloadCache.clear();
    }

    function stopSound() {
      gesture++;
      for (const snd of activeSounds) {
        try {
          snd.pause();
          snd.currentTime = 0;
        } catch {}
      }
      activeSounds.clear();
    }

    async function resolveAudioPayload(kind) {
      const snapshot = getSnapshot();
      const isEvent = kind === "turnDone" || kind === "waiting";
      if (!isEvent && (!snapshot?.settings.sound || snapshot.settings.volume === 0)) return null;
      if (audioPayloadCache.has(kind)) return audioPayloadCache.get(kind);
      const payload = await api.audio(kind);
      if (payload) audioPayloadCache.set(kind, payload);
      return payload;
    }

    async function play(kind) {
      const stopGen = gesture;
      const payload = await resolveAudioPayload(kind);
      if (stopGen !== gesture || !payload) return;
      while (activeSounds.size >= 6) {
        const oldest = activeSounds.values().next().value;
        activeSounds.delete(oldest);
        try {
          oldest.pause();
        } catch {}
      }
      const snd = new Audio(payload.url);
      snd.volume = payload.effectiveVolume;
      const cleanup = () => activeSounds.delete(snd);
      snd.addEventListener("ended", cleanup, { once: true });
      snd.addEventListener("error", cleanup, { once: true });
      activeSounds.add(snd);
      snd.play().catch(cleanup);
    }

    function syncPersonality() {
      const snapshot = getSnapshot();
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

    function nextTalkLine() {
      const snapshot = getSnapshot();
      talkState = snapshot?.persistentState || snapshot?.state || "idle";
      talkLine = personality.say(talkState === "offline" ? "idle" : talkState);
      return talkLine;
    }

    function resetTalkState() {
      talkState = null;
    }

    function pulseContent() {
      const inner = $("bubble-inner");
      const bubble = $("bubble");
      if (!inner || !bubble || bubble.dataset.ready !== "true" || getSnapshot()?.settings?.reducedMotion) return;
      clearTimeout(bounceTimer);
      inner.dataset.bounce = "true";
      bounceTimer = setTimeout(() => {
        delete inner.dataset.bounce;
      }, 130);
    }

    function armBubble() {
      clearTimeout(autoHide);
      const ms = getSnapshot()?.settings?.bubbleAutoHideMs ?? 6500;
      if (!closed && ms > 0) {
        autoHide = setTimeout(() => {
          closed = true;
          onRenderNeeded();
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
        }, getSnapshot()?.settings.reducedMotion ? 0 : 420);
      }
    }

    function stopReaction() {
      clearTimeout(eggTimer);
      if (mascot.dataset.expression) {
        delete mascot.dataset.expression;
        talkState = null;
      }
    }

    function clearEggTimer() {
      clearTimeout(eggTimer);
    }

    function reaction(manual = false, clicked = false) {
      const snapshot = getSnapshot();
      if (!snapshot || !personality) return;
      const kind = personality.reaction(
        {
          enabled: snapshot.settings.easterEggs,
          hidden: document.hidden || closed || !snapshot.settings.bubbleOn,
          busy: !!temporary || isPointerActive() || (clicked && !!mascot.dataset.expression),
          state: clicked ? snapshot.persistentState : snapshot.state
        },
        manual,
        clicked
      );
      if (!kind) return;
      if (onClearPettingExpr) onClearPettingExpr();
      delete mascot.dataset.blink;
      mascot.dataset.expression = kind;
      if (onBlush) onBlush();
      clearTimeout(eggTimer);
      eggTimer = setTimeout(() => {
        delete mascot.dataset.expression;
        talkState = null;
        onRenderNeeded();
      }, 3200);
    }

    function renderBubble() {
      const snapshot = getSnapshot();
      if (!snapshot) return;
      const s = snapshot.settings;
      if (selected !== "quota" && selected !== "talk") selected = "quota";

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
          $("track" + suffix).dataset.level = !known
            ? "unknown"
            : value <= 10
              ? "critical"
              : value <= 30
                ? "low"
                : "normal";
          $("percent" + suffix).dataset.level = $("track" + suffix).dataset.level;
          if (known) $("track" + suffix).setAttribute("aria-valuenow", value);
          else $("track" + suffix).removeAttribute("aria-valuenow");
        }
        const portMissing = !s.manualQuota && snapshot.quotaWindows?.cdpMissing === true;
        $("caption").textContent = s.manualQuota ? "手动记录" : portMissing ? "未开启额度端口" : "";
      } else {
        $("title").textContent = "星语猫娘";
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
      onRenderNeeded();
      pulseContent();
      if (ms > 0) {
        timeout = setTimeout(() => {
          temporary = null;
          closed = true;
          onRenderNeeded();
        }, ms);
      }
    }

    // 1. 点击角色：未显示时弹出额度页并即时刷新；已显示时重置计时并轻弹内容
    function clickCharacter() {
      const snapshot = getSnapshot();
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
        onRenderNeeded();
      } else {
        if (!temporary) armBubble();
        pulseContent();
      }
    }

    // 2. 点击气泡：额度 -> 随机台词 -> 逐级收起
    function clickBubble() {
      const snapshot = getSnapshot();
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
        onRenderNeeded();
        pulseContent();
      } else if (selected === "quota") {
        selected = "talk";
        nextTalkLine();
        if (snapshot.settings.bubblePage !== "talk") {
          api.save({ bubblePage: "talk" });
        }
        armBubble();
        onRenderNeeded();
        pulseContent();
      } else {
        clearTimeout(autoHide);
        closed = true;
        onRenderNeeded();
      }
    }

    function openQuota() {
      clearTimeout(timeout);
      temporary = null;
      closed = false;
      selected = "quota";
      armBubble();
      onRenderNeeded();
      pulseContent();
    }

    function showTurnDone(turn) {
      const snapshot = getSnapshot();
      if (onBlush) onBlush();
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
          snapshot?.settings.turnCostDurationMs ?? 5000,
          meta
        );
        if (!snapshot?.settings.turnDoneSound) play("release");
      }
    }

    function showWaiting() {
      const snapshot = getSnapshot();
      if (snapshot?.settings.waitingSound) {
        play("waiting");
      }
      if (snapshot?.settings.waitingAlertOn) {
        const waitMs =
          snapshot.settings.turnCostDurationMs === 0
            ? 0
            : Math.max(6000, snapshot.settings.turnCostDurationMs ?? 6000);
        message("等待你的确认", "AI 正在等你回答", "请切回聊天窗口查看提问", waitMs, "");
      }
    }

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

    function bindEvents() {
      const bubbleEl = $("bubble");
      bubbleEl.addEventListener("pointerenter", () => clearTimeout(autoHide));
      bubbleEl.addEventListener("pointerleave", () => {
        releaseBubblePress();
        armBubble();
      });
      bubbleEl.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        clearTimeout(bubblePressTimer);
        bubblePressAt = performance.now();
        bubbleEl.dataset.pressed = "true";
      });
      bubbleEl.addEventListener("pointerup", releaseBubblePress);
      bubbleEl.addEventListener("pointercancel", releaseBubblePress);
      bubbleEl.addEventListener("click", () => {
        play("press");
        clickBubble();
      });
    }

    function destroy() {
      clearTimeout(timeout);
      clearTimeout(autoHide);
      clearTimeout(hideAnimation);
      clearTimeout(readyTimer);
      clearTimeout(bounceTimer);
      clearTimeout(bubblePressTimer);
      clearTimeout(eggTimer);
      stopSound();
    }

    return {
      isClosed: () => closed,
      hasPersonality: () => Boolean(personality),
      invalidateAudioCache,
      stopSound,
      play,
      syncPersonality,
      nextTalkLine,
      resetTalkState,
      stopReaction,
      clearEggTimer,
      reaction,
      renderBubble,
      message,
      clickCharacter,
      clickBubble,
      openQuota,
      showTurnDone,
      showWaiting,
      bindEvents,
      destroy
    };
  }

  window.StarNeko = window.StarNeko || {};
  window.StarNeko.createBubbleAndAudio = createBubbleAndAudio;
})();
