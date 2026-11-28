(async () => {
  const api = window.widgetApi;
  const $ = id => document.getElementById(id);
  const mascot = $("mascot");
  const motion = $("motion");
  const faceEl = document.querySelector(".agy-face");
  const thinkingFxEl = $("thinking-fx");
  const thinkingGlowEl = $("thinking-glow");
  const tearFxEl = document.querySelector(".agy-effect--tear");

  const {
    hitAndGestures,
    createLayerRig,
    createAmbientScheduler,
    createBubbleAndAudio,
    createInputController
  } = window.StarNeko;

  let snapshot = null;
  let petAt = 0;
  let windowVisible = true;
  let pettingExprTimer = null;

  const getSnapshot = () => snapshot;
  const isEffectivelyHidden = () => !windowVisible || document.hidden;
  const isCompat = () => Boolean(snapshot?.compatRender);

  let scheduler = null;
  let input = null;

  const gestures = hitAndGestures.createHitAndGestureTracker({
    mascot,
    faceEl,
    getPetAt: () => petAt,
    setPetAt: v => {
      petAt = v;
    }
  });

  const rig = createLayerRig({
    $,
    mascot,
    motion,
    faceEl,
    thinkingGlowEl,
    getSnapshot,
    isEffectivelyHidden,
    isCompat,
    onBodyPressChanged: () => {
      if (scheduler) scheduler.syncAmbientLoop();
    }
  });

  const bubbleAudio = createBubbleAndAudio({
    api,
    $,
    mascot,
    getSnapshot,
    isPointerActive: () => (input ? input.isPointerActive() : false),
    onRenderNeeded: render,
    onBlush: () => rig.triggerBlushWarmth(),
    onClearPettingExpr: () => {
      clearTimeout(pettingExprTimer);
      pettingExprTimer = null;
    }
  });

  input = createInputController({
    api,
    $,
    mascot,
    motion,
    rig,
    gestures,
    bubbleAudio,
    getSnapshot
  });

  scheduler = createAmbientScheduler({
    $,
    mascot,
    thinkingFxEl,
    thinkingGlowEl,
    tearFxEl,
    rig,
    getSnapshot,
    isEffectivelyHidden,
    isCompat,
    isPointerActive: () => input.isPointerActive(),
    isEarBusy: () => input.isEarBusy(),
    isPartHeld: part => input.isPartHeld(part),
    hasPartReleaseTimer: part => input.hasPartReleaseTimer(part),
    onPeriodicReaction: () => bubbleAudio.reaction()
  });

  function render() {
    if (!snapshot) return;
    const s = snapshot.settings;
    mascot.style.setProperty("--agy-width", (snapshot.displayScale || s.scale) + "px");
    mascot.style.setProperty("--agy-shift", (snapshot.artShift || 0) + "px");
    mascot.dataset.state = snapshot.state;
    mascot.dataset.dock = snapshot.dockSide || "";
    mascot.dataset.facing = snapshot.facing || "left";
    mascot.dataset.reducedMotion = String(s.reducedMotion);
    mascot.dataset.theme = s.bubbleTheme || "crystal";
    mascot.dataset.hideTools = String(Boolean(s.hideHoverTools));
    bubbleAudio.renderBubble();
    scheduler.syncAmbientLoop();
  }

  function triggerPettingEffect(info = {}) {
    petAt = performance.now();
    gestures.resetHairRub();
    rig.triggerBlushWarmth();
    if (motion) {
      motion.style.animation = "none";
      void motion.offsetWidth;
      motion.style.animation = "";
    }
    const heartEl = document.querySelector(".agy-effect--heart");
    if (heartEl) {
      heartEl.style.animation = "none";
      void heartEl.offsetWidth;
      heartEl.style.animation = "";
    }
    delete mascot.dataset.blink;
    mascot.dataset.expression = "proud";
    bubbleAudio.clearEggTimer();
    clearTimeout(pettingExprTimer);
    pettingExprTimer = setTimeout(() => {
      pettingExprTimer = null;
      if (mascot.dataset.expression === "proud") {
        delete mascot.dataset.expression;
        bubbleAudio.resetTalkState();
        render();
      }
    }, 1800);

    rig.playPettingCombo(() => !input.isPointerActive() && !input.isPartHeld("earR"));

    if (info?.source !== "hover" && snapshot?.settings?.sound) {
      bubbleAudio.play("release");
    }
  }

  function syncHibernation() {
    if (isEffectivelyHidden()) {
      mascot.dataset.paused = "true";
      gestures.resetHairRub();
      scheduler.pause();
      clearTimeout(pettingExprTimer);
      pettingExprTimer = null;
      rig.pauseAndReset();
    } else {
      delete mascot.dataset.paused;
      gestures.invalidateFaceRect();
      scheduler.resume();
      rig.syncGemState();
      render();
    }
  }

  bubbleAudio.bindEvents();
  input.bindEvents();

  if (typeof api.onVisibility === "function") {
    api.onVisibility(visible => {
      const next = visible !== false;
      if (windowVisible !== next) {
        windowVisible = next;
        syncHibernation();
      }
    });
  }
  document.addEventListener("visibilitychange", syncHibernation);

  api.subscribe(data => {
    const prevCustom = snapshot?.settings?.customLines;
    const prevMode = snapshot?.settings?.customLinesMode;
    const prevScale = snapshot?.displayScale || snapshot?.settings?.scale;
    const prevFacing = snapshot?.facing;
    bubbleAudio.invalidateAudioCache();
    if (
      snapshot &&
      (!data.settings.sound ||
        data.settings.soundSet !== snapshot.settings.soundSet ||
        data.settings.volume !== snapshot.settings.volume)
    ) {
      bubbleAudio.stopSound();
    }
    snapshot = {
      ...data,
      dialogue: data.dialogue || snapshot?.dialogue,
      presets: data.presets || snapshot?.presets,
      eventSounds: data.eventSounds || snapshot?.eventSounds
    };
    if ((snapshot.displayScale || snapshot.settings?.scale) !== prevScale || snapshot.facing !== prevFacing) {
      gestures.invalidateFaceRect();
    }
    if (
      data.dialogue ||
      prevCustom !== data.settings.customLines ||
      prevMode !== data.settings.customLinesMode ||
      !bubbleAudio.hasPersonality()
    ) {
      bubbleAudio.syncPersonality();
    }
    if (prevCustom !== data.settings.customLines || prevMode !== data.settings.customLinesMode) {
      bubbleAudio.nextTalkLine();
    }
    if (
      !pettingExprTimer &&
      (!data.settings.easterEggs || !["idle", "offline", "pressed", "release", "petting"].includes(data.state))
    ) {
      bubbleAudio.stopReaction();
    }
    rig.syncGemState();
    render();
  });

  api.onStep(turn => bubbleAudio.showTurnDone(turn));
  api.onWaiting(() => bubbleAudio.showWaiting());
  api.onReaction(() => bubbleAudio.reaction(true));
  if (typeof api.onPetted === "function") {
    api.onPetted(info => triggerPettingEffect(info));
  }
  if (typeof api.onOpenQuota === "function") {
    api.onOpenQuota(() => bubbleAudio.openQuota());
  }

  snapshot = await api.get();
  bubbleAudio.syncPersonality();
  scheduler.start();
  rig.syncGemState();
  render();

  window.addEventListener("beforeunload", () => {
    clearTimeout(pettingExprTimer);
    scheduler.destroy();
    rig.destroy();
    input.destroy();
    bubbleAudio.destroy();
    gestures.destroy();
  });
})();
