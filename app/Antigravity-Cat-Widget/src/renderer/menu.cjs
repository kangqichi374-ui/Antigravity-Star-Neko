(async () => {
  const api = window.widgetApi;
  const $ = id => document.getElementById(id);
  let data = await api.get();

  function render() {
    if (!data || !data.settings) return;
    const s = data.settings;
    const curTheme = s.bubbleTheme || "crystal";
    const curFacing = s.facingMode || "auto";
    const isCompat = Boolean(data.compatRender ?? s.compatMode);
    document.documentElement.dataset.theme = curTheme;

    for (const el of document.querySelectorAll(".swatch")) {
      el.dataset.active = String(el.dataset.theme === curTheme);
    }
    for (const el of document.querySelectorAll(".seg-btn")) {
      el.dataset.active = String(el.dataset.facing === curFacing);
    }

    const checks = {
      bubbleOn: Boolean(s.bubbleOn),
      hideHoverTools: Boolean(s.hideHoverTools),
      compatMode: isCompat,
      clickThrough: Boolean(s.clickThrough)
    };
    for (const [k, v] of Object.entries(checks)) {
      const box = $("chk-" + k);
      if (box) box.dataset.checked = String(v);
    }

    const badge = $("cdp-badge");
    if (badge) {
      const live = data.quotaWindows?.cdpConnected === true;
      const missing = data.quotaWindows?.cdpMissing === true;
      badge.textContent = live ? "已开启" : missing ? "待开启" : "就绪";
      badge.dataset.live = live ? "true" : missing ? "false" : "";
    }
  }

  for (const el of document.querySelectorAll(".swatch")) {
    el.addEventListener("click", async () => {
      const theme = el.dataset.theme;
      if (!theme) return;
      data = await api.save({ bubbleTheme: theme, bubbleOn: true });
      render();
    });
  }

  for (const el of document.querySelectorAll(".seg-btn")) {
    el.addEventListener("click", async () => {
      const f = el.dataset.facing;
      if (!f) return;
      data = await api.save({ facingMode: f });
      render();
    });
  }

  for (const el of document.querySelectorAll("[data-toggle]")) {
    el.addEventListener("click", async () => {
      const key = el.dataset.toggle;
      if (!key || !data?.settings) return;
      const cur = key === "compatMode" ? Boolean(data.compatRender ?? data.settings.compatMode) : Boolean(data.settings[key]);
      const nextVal = !cur;
      if (key === "compatMode" || key === "clickThrough") {
        await api.save({ [key]: nextVal });
        api.command("close-menu");
        return;
      }
      data = await api.save({ [key]: nextVal });
      render();
    });
  }

  for (const el of document.querySelectorAll("[data-cmd]")) {
    el.addEventListener("click", () => {
      const cmd = el.dataset.cmd;
      api.command("close-menu");
      if (cmd) api.command(cmd);
    });
  }

  window.addEventListener("keydown", e => {
    if (e.key === "Escape") api.command("close-menu");
  });

  window.addEventListener("contextmenu", e => e.preventDefault());

  const header = $("ctxHeader");
  let menuDrag = null, menuDragRaf = 0, pendingDragPt = null;
  function flushMenuDrag() {
    if (menuDragRaf) {
      cancelAnimationFrame(menuDragRaf);
      menuDragRaf = 0;
    }
    if (pendingDragPt && menuDrag && typeof api.menuDrag === "function") {
      const pt = pendingDragPt;
      pendingDragPt = null;
      api.menuDrag({ action: "move", point: pt });
    } else {
      pendingDragPt = null;
    }
  }
  function endMenuDrag() {
    if (!menuDrag) return;
    flushMenuDrag();
    menuDrag = null;
    if (header) delete header.dataset.dragging;
    if (typeof api.menuDrag === "function") api.menuDrag({ action: "end" });
  }
  if (header && typeof api.menuDrag === "function") {
    header.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      menuDrag = { id: e.pointerId };
      header.dataset.dragging = "true";
      try { header.setPointerCapture(e.pointerId); } catch {}
      api.menuDrag({ action: "start", point: { x: e.screenX, y: e.screenY } });
    });
    header.addEventListener("pointermove", e => {
      if (!menuDrag || e.pointerId !== menuDrag.id) return;
      pendingDragPt = { x: e.screenX, y: e.screenY };
      if (!menuDragRaf) {
        menuDragRaf = requestAnimationFrame(() => {
          menuDragRaf = 0;
          if (pendingDragPt && menuDrag) {
            const pt = pendingDragPt;
            pendingDragPt = null;
            api.menuDrag({ action: "move", point: pt });
          }
        });
      }
    });
    header.addEventListener("pointerup", endMenuDrag);
    header.addEventListener("pointercancel", endMenuDrag);
    header.addEventListener("lostpointercapture", endMenuDrag);
    window.addEventListener("blur", endMenuDrag);
  }

  api.subscribe(next => {
    data = { ...data, ...next };
    render();
  });

  render();
})();
