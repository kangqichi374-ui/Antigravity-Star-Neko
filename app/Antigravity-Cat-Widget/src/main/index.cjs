const { app, BrowserWindow, screen, Menu, ipcMain, globalShortcut, powerMonitor, dialog } = require("electron");
const path = require("node:path"), os = require("node:os");
const { SettingsManager } = require("../domain/settings.cjs");
const { UsageLedger } = require("../domain/ledger.cjs");
const { WidgetStateMachine } = require("../domain/state-machine.cjs");
const { TranscriptAdapter } = require("../adapters/transcript-adapter.cjs");
const { AudioManager } = require("../domain/audio-manager.cjs");
const { HostQuotaAdapter } = require("../adapters/host-quota.cjs");
const { HostWorkingAdapter } = require("../adapters/host-working.cjs");
const { ForegroundMonitor, hostPlacement, characterPlacement, snapToEdges, hasNativeHelper } = require("../domain/host-visibility.cjs");

const dataDir = process.argv.find(a => a.startsWith("--data-dir="))?.slice(11) || path.join(os.homedir(), ".antigravity-cat-widget");
app.setPath("userData", path.join(dataDir, "runtime"));
app.setName("喵言喵语桌宠");
app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) app.quit();
else if (process.argv.includes("--quit")) app.quit();
else {
  let quitting = false, recoveryTimer, visualTimer, visualChecking = false, blankFrames = 0, visualCheckInterval = 15000, lastVisualCheck = 0, uptimeCheckTimer;
  const recoveryLog = reason => {
    try { require("node:fs").appendFileSync(path.join(dataDir, "recovery.log"), new Date().toISOString() + " " + reason + "\n"); } catch {}
  };
  let win, contextMenu = null, panel, drag = null, hoverInteractive = false, source = { online: false, source: "正在读取本机日志", files: 0 }, saveTimer, displayScale = null, hostArea = null, hostLayout = null, dragTimer = null, facing = "right", dockSide = "", artShift = 0;
  const foreground = new ForegroundMonitor(), quotaAdapter = new HostQuotaAdapter({ cachePath: path.join(dataDir, "quota-cache.json") }), workingAdapter = new HostWorkingAdapter();
  const dialogue = require("../../assets/dialogue/zh-CN.json");
  const running = new Set();
  let hostWorkingConnected = false;
  const settings = new SettingsManager(path.join(dataDir, "settings.json")), ledger = new UsageLedger({ storagePath: path.join(dataDir, "usage-v2.json") }), sm = new WidgetStateMachine("offline"), adapter = new TranscriptAdapter(), audio = new AudioManager();

  const snapshot = () => {
    ledger.quotaRemainingPercent = settings.get("manualQuota") === true ? settings.get("manualPercent") : null;
    const facingMode = settings.get("facingMode");
    const effectiveFacing = facingMode === "left" || facingMode === "right" ? facingMode : facing;
    return {
      artShift,
      dockSide,
      quotaWindows: quotaAdapter.snapshot,
      facing: effectiveFacing,
      state: sm.currentState,
      persistentState: sm.persistentState,
      dialogue: dialogue.lines,
      settings: settings.getAll(),
      displayScale: displayScale || settings.get("scale"),
      visibility: {
        supported: process.platform === "win32",
        foreground: foreground.state.kind,
        nativeAttached: foreground.state.attached === true,
        withinHost: !!hostArea
      },
      ledger: ledger.getSnapshot(),
      source,
      presets: audio.getPresetList(),
      eventSounds: audio.getEventSoundList()
    };
  };

  const send = (channel, data) => {
    for (const w of [win, panel]) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  };
  const publish = () => send("widget:snapshot", snapshot());

  function syncQuotaState() {
    if (["idle", "warning"].includes(sm.persistentState)) {
      sm.setPersistentState((settings.get("manualQuota") ? [settings.get("manualPercent"), settings.get("manualWeeklyPercent")] : [quotaAdapter.snapshot.fiveHour, quotaAdapter.snapshot.weekly]).some(v => typeof v === "number" && v <= 20) ? "warning" : "idle");
    }
  }

  function bounds(size = settings.get("scale")) {
    return { width: Math.max(360, size + 80), height: Math.round(size * 1146 / 1372 + 340) };
  }

  function safePosition(x, y, w, h) {
    const area = screen.getDisplayNearestPoint({ x: Number.isFinite(x) ? x : screen.getPrimaryDisplay().workArea.x, y: Number.isFinite(y) ? y : 0 }).workArea;
    return {
      x: Math.round(Number.isFinite(x) ? Math.max(area.x, Math.min(area.x + area.width - w, x)) : area.x + area.width - w - 18),
      y: Math.round(Number.isFinite(y) ? Math.max(area.y, Math.min(area.y + area.height - h, y)) : area.y + area.height - h - 18)
    };
  }

  function syncVisibility() {
    if (!win || win.isDestroyed()) return;
    if (!settings.get("hostWindowOnly")) {
      hostArea = null; hostLayout = null; displayScale = settings.get("scale");
      if (!win.isVisible()) win.showInactive();
      return;
    }
    if (drag) return;
    const previousArea = hostArea; let state = foreground.state;
    if (state.bounds) state = { ...state, bounds: screen.screenToDipRect(null, state.bounds) };
    const placement = hostPlacement(state, settings.get("scale"), settings.get("hostOffsetX"), settings.get("hostOffsetY"), settings.get("hostDock"));

    if (!placement) {
      hostArea = null; hostLayout = null;
      if (drag) { drag = null; sm.handlePointerUp(); }
      if (win.isVisible()) win.hide();
      return;
    }

    hostArea = state.bounds; displayScale = placement.scale; artShift = placement.artShift;
    dockSide = Math.abs(placement.visualX - hostArea.x) < 2 ? "left" : Math.abs(placement.visualX + displayScale - hostArea.x - hostArea.width) < 2 ? "right" : "";
    facing = placement.visualX + displayScale / 2 < hostArea.x + hostArea.width / 2 ? "left" : "right";
    const nextLayout = JSON.stringify([state.hostId, state.restoreGeneration, displayScale, hostArea.width, hostArea.height, settings.get("hostOffsetX"), settings.get("hostOffsetY"), settings.get("hostDock")]);
    const nativeTranslation = state.nativeFollowing && previousArea && hostLayout === nextLayout;
    const layoutChanged = hostLayout !== nextLayout;
    hostLayout = nextLayout;
    if (!nativeTranslation) {
      const old = win.getBounds();
      if (Object.keys(placement.bounds).some(key => Math.abs(old[key] - placement.bounds[key]) > 2)) win.setBounds(placement.bounds);
    }

    if (!win.isVisible()) {
      win.showInactive();
      if (layoutChanged) setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("widget:preload-frames");
          win.webContents.invalidate();
        }
      }, 50);
    }
    return !nativeTranslation;
  }

  function show() {
    if (!win || win.isDestroyed()) createWindow();
    if (settings.get("hostWindowOnly")) foreground.start(win.getNativeWindowHandle());
    if (!settings.get("hostWindowOnly") && !win.isVisible()) win.showInactive();
    syncVisibility();
    win.setIgnoreMouseEvents(settings.get("clickThrough"), { forward: true });
  }

  function apply(partial) {
    const allowed = [
      "scale", "alwaysOnTop", "reducedMotion", "sound", "volume", "soundSet",
      "bubbleOn", "turnCostOn", "turnCostDurationMs", "clickThrough", "snap",
      "bubblePage", "manualQuota", "manualPercent", "manualWeeklyPercent",
      "hostWindowOnly", "easterEggs",
      "bubbleTheme", "facingMode", "autoBlink", "hideHoverTools",
      "bubbleAutoHideMs", "pageQuota", "pageTalk", "pageToday", "pageLatest",
      "customLines", "customLinesMode",
      "turnDoneSound", "turnDoneSoundId", "turnDoneVolume",
      "waitingAlertOn", "waitingSound", "waitingSoundId", "waitingVolume",
      "clickAction", "doubleClickAction", "wheelAction"
    ];
    const oldScale = settings.get("scale"), oldHostOnly = settings.get("hostWindowOnly");
    if (!oldHostOnly && partial?.hostWindowOnly === true && win) {
      const pos = win.getBounds();
      settings.update({ x: pos.x, y: pos.y });
    }
    settings.update(Object.fromEntries(Object.entries(partial || {}).filter(([k]) => allowed.includes(k))));
    syncQuotaState();
    if (settings.get("hostWindowOnly")) foreground.start(win?.getNativeWindowHandle());
    else foreground.stop();
    if (win) {
      if (!settings.get("hostWindowOnly") && (settings.get("scale") !== oldScale || oldHostOnly)) {
        const old = win.getBounds(), dim = bounds();
        const pos = oldHostOnly ? safePosition(settings.get("x"), settings.get("y"), dim.width, dim.height) : safePosition(old.x + old.width - dim.width, old.y + old.height - dim.height, dim.width, dim.height);
        win.setBounds({ ...pos, ...dim });
      }
      if (!settings.get("hostWindowOnly")) win.setAlwaysOnTop(settings.get("alwaysOnTop"));
      win.setIgnoreMouseEvents(settings.get("clickThrough"), { forward: true });
      syncVisibility();
    }
    audio.setEnabled(settings.get("sound"));
    audio.setVolume(settings.get("volume"));
    audio.setPreset(settings.get("soundSet"));
    publish();
    updateMenu();
    return snapshot();
  }

  function openSettings() {
    if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); return; }
    panel = new BrowserWindow({
      width: 600,
      height: 820,
      minWidth: 500,
      minHeight: 620,
      autoHideMenuBar: true,
      title: "喵言喵语 · 定制与设置",
      backgroundColor: "#f6f4fb",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    panel.loadFile(path.join(__dirname, "../renderer/settings.html"));
    panel.on("closed", () => panel = null);
  }

  function reset() {
    if (settings.get("hostWindowOnly")) {
      settings.update({ hostOffsetX: 18, hostOffsetY: 18, hostDock: "" });
      syncVisibility(); publish(); return;
    }
    const dim = bounds(), pos = safePosition(null, null, dim.width, dim.height);
    win.setBounds({ ...pos, ...dim }); settings.update(pos); show();
  }

  function recall() {
    show();
    if (settings.get("hostWindowOnly") && !win.isVisible()) openSettings();
  }

  function updateMenu() {
    const curTheme = settings.get("bubbleTheme");
    const curFacing = settings.get("facingMode");
    contextMenu = Menu.buildFromTemplate([
      { label: "喵言喵语 · Gemini 桌宠", enabled: false },
      { label: "定制与设置面板…", click: openSettings },
      { label: "摸摸头", click: () => sm.handlePetting() },
      { type: "separator" },
      { label: "显示气泡", type: "checkbox", checked: settings.get("bubbleOn"), click: () => apply({ bubbleOn: !settings.get("bubbleOn") }) },
      {
        label: "气泡主题配色",
        submenu: [
          { label: "星晶蓝紫（默认）", type: "radio", checked: curTheme === "crystal", click: () => apply({ bubbleTheme: "crystal" }) },
          { label: "樱粉浅暖", type: "radio", checked: curTheme === "sakura", click: () => apply({ bubbleTheme: "sakura" }) },
          { label: "深海鲸蓝", type: "radio", checked: curTheme === "ocean", click: () => apply({ bubbleTheme: "ocean" }) },
          { label: "星空暗夜", type: "radio", checked: curTheme === "night", click: () => apply({ bubbleTheme: "night" }) }
        ]
      },
      {
        label: "角色朝向翻转",
        submenu: [
          { label: "随位置自动翻转", type: "radio", checked: curFacing === "auto", click: () => apply({ facingMode: "auto" }) },
          { label: "固定朝左", type: "radio", checked: curFacing === "left", click: () => apply({ facingMode: "left" }) },
          { label: "固定朝右", type: "radio", checked: curFacing === "right", click: () => apply({ facingMode: "right" }) }
        ]
      },
      { label: "隐藏右侧悬浮按钮", type: "checkbox", checked: settings.get("hideHoverTools"), click: () => apply({ hideHoverTools: !settings.get("hideHoverTools") }) },
      { label: "鼠标穿透 · Ctrl+Alt+Shift+G 恢复", type: "checkbox", checked: settings.get("clickThrough"), click: () => apply({ clickThrough: !settings.get("clickThrough") }) },
      { type: "separator" },
      { label: "停靠左下角", click: () => dock("left") },
      { label: "停靠右下角", click: () => dock("right") },
      { label: "重置位置", click: reset },
      { label: "重启挂件", click: () => { app.relaunch(); app.quit(); } },
      { type: "separator" },
      { label: "退出喵言喵语", click: () => app.quit() }
    ]);
  }

  function createWindow() {
    const dim = bounds(), pos = safePosition(settings.get("x"), settings.get("y"), dim.width, dim.height);
    win = new BrowserWindow({
      ...dim, ...pos, frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true,
      alwaysOnTop: !settings.get("hostWindowOnly") && settings.get("alwaysOnTop"), show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
    win.once("ready-to-show", show);
    win.on("closed", () => { foreground.stop(); win = null; if (!quitting) setTimeout(show, 250); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", e => e.preventDefault());
    win.webContents.on("render-process-gone", () => { if (!quitting && win && !win.isDestroyed()) win.destroy(); });
    win.webContents.on("did-finish-load", () => { blankFrames = 0; publish(); });
    if (process.platform === "win32") {
      const dispatchXButton = (wParam, pressed) => {
        if (!win || win.isDestroyed() || !Buffer.isBuffer(wParam) || wParam.length < 4) return;
        const xBtn = wParam.readUInt16LE(2);
        const button = xBtn === 1 ? 3 : xBtn === 2 ? 4 : 0;
        if (!button) return;
        if (pressed && !hoverInteractive) return;
        win.webContents.send("widget:side-button", { button, pressed });
      };
      try {
        win.hookWindowMessage(0x020B, wParam => dispatchXButton(wParam, true));  // WM_XBUTTONDOWN
        win.hookWindowMessage(0x020D, wParam => dispatchXButton(wParam, true));  // WM_XBUTTONDBLCLK
        win.hookWindowMessage(0x020C, wParam => dispatchXButton(wParam, false)); // WM_XBUTTONUP
      } catch {}
    }
    win.on("app-command", (_e, cmd) => {
      if (!win || win.isDestroyed()) return;
      if (cmd === "browser-backward" && hoverInteractive) {
        win.webContents.send("widget:side-button", { button: 3, tap: true });
      } else if (cmd === "browser-forward" && hoverInteractive) {
        win.webContents.send("widget:side-button", { button: 4, tap: true });
      }
    });
    let unresponsiveTimer;
    win.on("unresponsive", () => {
      const stuck = win; clearTimeout(unresponsiveTimer);
      unresponsiveTimer = setTimeout(() => { if (!quitting && win === stuck && !stuck.isDestroyed()) stuck.destroy(); }, 10000);
    });
    win.on("responsive", () => clearTimeout(unresponsiveTimer));
    win.on("closed", () => clearTimeout(unresponsiveTimer));
  }

  function trusted(e) {
    return [win, panel].some(w => w && !w.isDestroyed() && e.sender === w.webContents);
  }

  ipcMain.handle("widget:get", e => trusted(e) ? snapshot() : null);
  ipcMain.handle("widget:settings", (e, v) => trusted(e) ? apply(v) : null);

  ipcMain.handle("widget:import-audio", async e => {
    if (!trusted(e)) return null;
    const owner = BrowserWindow.fromWebContents(e.sender) || panel || win;
    const res = await dialog.showOpenDialog(owner, {
      title: "选择自定义音效文件（.wav / .mp3 / .ogg）",
      properties: ["openFile"],
      filters: [{ name: "Audio Files", extensions: ["wav", "mp3", "ogg", "m4a"] }]
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
    const importedId = audio.importCustomAudio(res.filePaths[0]);
    if (!importedId) return null;
    publish();
    return { importedId, snapshot: snapshot() };
  });

  ipcMain.on("widget:command", (e, command) => {
    if (!trusted(e)) return;
    if (command === "settings") openSettings();
    else if (command === "menu") contextMenu?.popup({ window: win });
    else if (command === "quit") app.quit();
    else if (command === "reset") reset();
    else if (command === "dock-left") dock("left");
    else if (command === "dock-right") dock("right");
    else if (command === "show-bubble") apply({ bubbleOn: true });
    else if (command === "preview-reaction") send("widget:reaction", {});
    else if (command === "pet") sm.handlePetting();
    else if (command === "quota-refresh") quotaAdapter.openNativeQuota().catch(() => {});
    else if (command === "refresh") { adapter.scan(); quotaAdapter.tick(); publish(); }
  });

  function dragMove(point) {
    if (!drag || !win) return;
    const p = point || drag.last, dx = p.x - drag.point.x, dy = p.y - drag.point.y;
    drag.last = p;
    if (!drag.moved && Math.hypot(dx, dy) <= 8) return;
    if (!drag.moved) { drag.moved = true; sm.handleDragStart(); }
    const a = hostArea || screen.getDisplayNearestPoint(p).workArea, size = displayScale || settings.get("scale");
    const placement = characterPlacement(a, size, drag.bounds, drag.visualX + dx, drag.bounds.y + dy);
    win.setBounds(placement.bounds); artShift = placement.artShift; dockSide = "";
    facing = placement.visualX + size / 2 < a.x + a.width / 2 ? "left" : "right";
    publish();
  }

  function dock(side) {
    if (!win) return;
    if (settings.get("hostWindowOnly")) syncVisibility();
    const size = displayScale || settings.get("scale"), b = { ...win.getBounds(), ...bounds(size) }, a = hostArea || screen.getDisplayMatching(b).workArea;
    const placement = characterPlacement(a, size, b, side === "left" ? a.x : a.x + a.width - size, a.y + a.height - b.height);
    win.setBounds(placement.bounds); artShift = placement.artShift; dockSide = side; facing = side;
    if (hostArea) settings.update({ hostOffsetX: side === "left" ? a.width - size : 0, hostOffsetY: 0, hostDock: side });
    else settings.update({ x: placement.bounds.x, y: placement.bounds.y });
    publish();
  }

  ipcMain.handle("widget:pointer", (e, payload) => {
    const action = typeof payload === "string" ? payload : payload?.action, raw = payload?.point, point = raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && Math.abs(raw.x) < 100000 && Math.abs(raw.y) < 100000 ? { x: raw.x, y: raw.y } : null;
    if (!trusted(e) || !win) return { moved: false };
    if (action === "down") {
      clearInterval(dragTimer); win.setIgnoreMouseEvents(false);
      const start = point || screen.getCursorScreenPoint();
      drag = { point: start, last: start, bounds: { ...win.getBounds(), ...bounds(displayScale || settings.get("scale")) }, visualX: win.getBounds().x + (bounds(displayScale || settings.get("scale")).width - (displayScale || settings.get("scale"))) / 2 + artShift, moved: false };
      sm.handlePointerDown();
    } else if (action === "move" && point) dragMove(point);
    else if (action === "up" || action === "cancel") {
      clearInterval(dragTimer); dragTimer = null;
      if (!drag) return { moved: false };
      dragMove();
      const moved = drag.moved; drag = null;
      if (moved) {
        const size = displayScale || settings.get("scale"), old = { ...win.getBounds(), ...bounds(size) }, area = hostArea || screen.getDisplayMatching(old).workArea;
        let visualX = old.x + (old.width - size) / 2 + artShift, y = old.y;
        if (settings.get("snap")) ({ visualX, y } = snapToEdges(area, size, old.height, visualX, y));
        const placement = characterPlacement(area, size, old, visualX, y);
        win.setBounds(placement.bounds); artShift = placement.artShift;
        dockSide = Math.abs(visualX - area.x) < 2 ? "left" : Math.abs(visualX + size - area.x - area.width) < 2 ? "right" : "";
        facing = visualX + size / 2 < area.x + area.width / 2 ? "left" : "right";
        if (hostArea) settings.update({ hostDock: dockSide, hostOffsetX: Math.max(0, hostArea.x + hostArea.width - placement.visualX - size), hostOffsetY: Math.max(0, hostArea.y + hostArea.height - placement.bounds.y - old.height) });
        else settings.update({ x: placement.bounds.x, y: placement.bounds.y });
      }
      sm.handlePointerUp();
      return { moved };
    } else if (action === "pet") sm.handlePetting();
    return { moved: !!drag?.moved };
  });

  ipcMain.on("widget:hit", (e, interactive) => {
    if (trusted(e) && win && !drag) {
      hoverInteractive = interactive === true;
      win.setIgnoreMouseEvents(settings.get("clickThrough") || !hoverInteractive, { forward: true });
    }
  });

  ipcMain.handle("widget:audio", (e, req) => {
    if (!trusted(e)) return null;
    if (typeof req === "string") {
      if (req === "press" || req === "release") return audio.getAudioFile(req);
      if (req === "turnDone") {
        if (!settings.get("turnDoneSound")) return null;
        return audio.getAudioFile("event", settings.get("turnDoneSoundId"), settings.get("turnDoneVolume"), true);
      }
      if (req === "waiting") {
        if (!settings.get("waitingSound")) return null;
        return audio.getAudioFile("event", settings.get("waitingSoundId"), settings.get("waitingVolume"), true);
      }
      return null;
    }
    if (req && typeof req === "object") {
      const kind = req.kind || "press";
      const id = req.id || null;
      const vol = typeof req.volume === "number" ? req.volume : null;
      const force = Boolean(req.force);
      if (["press", "release", "event"].includes(kind)) {
        return audio.getAudioFile(kind, id, vol, force);
      }
    }
    return null;
  });

  quotaAdapter.on("change", () => { syncQuotaState(); publish(); });
  sm.subscribe(publish);
  foreground.on("change", () => { if (syncVisibility() !== false) publish(); });
  adapter.on("stepDone", step => {
    const recorded = ledger.recordStep(step);
    if (recorded) {
      clearTimeout(saveTimer); saveTimer = setTimeout(() => ledger.save(), 1000);
    }
  });
  let thinkingTimeout = null;
  function clearSessionRunning(sessionId) {
    for (const k of [...running]) {
      if (k.startsWith(sessionId + ":")) running.delete(k);
    }
    if (!running.size) {
      clearTimeout(thinkingTimeout);
      thinkingTimeout = null;
    }
  }

  adapter.on("turnComplete", turn => {
    clearSessionRunning(turn.sessionId);
    sm.setPersistentState(running.size ? "thinking" : "idle");
    syncQuotaState();
    sm.handleTurnSuccess();
    quotaAdapter.tick();
    send("widget:step", turn);
    publish();
  });
  adapter.on("turnWaiting", info => {
    clearSessionRunning(info.sessionId);
    if (!running.size && sm.persistentState === "thinking") {
      sm.setPersistentState("idle");
      syncQuotaState();
    }
    send("widget:waiting", info);
  });
  workingAdapter.on("change", ({ connected, working }) => {
    hostWorkingConnected = connected;
    if (!connected) return;
    if (working) {
      sm.setPersistentState("thinking");
    } else {
      running.clear();
      clearTimeout(thinkingTimeout);
      thinkingTimeout = null;
      if (sm.persistentState === "thinking") {
        sm.setPersistentState("idle");
        syncQuotaState();
      }
    }
  });

  adapter.on("turnRunning", s => {
    if (!s.historical && !hostWorkingConnected) {
      running.add(s.sessionId + ":" + s.stepIndex);
      sm.setPersistentState("thinking");
      clearTimeout(thinkingTimeout);
      thinkingTimeout = setTimeout(() => {
        running.clear();
        if (sm.persistentState === "thinking") {
          sm.setPersistentState("idle");
          syncQuotaState();
        }
      }, 30000);
    }
  });
  adapter.on("turnError", s => {
    clearSessionRunning(s.sessionId);
    if (!s.historical) sm.setPersistentState("error");
  });
  adapter.on("status", status => {
    source = status;
    if (!status.online) sm.setPersistentState("offline");
    else if (sm.persistentState === "offline") sm.setPersistentState(running.size ? "thinking" : "idle");
    syncQuotaState(); publish();
  });

  app.on("second-instance", (_event, args) => { if (args.includes("--quit")) app.quit(); else if (!args.includes("--background")) recall(); });
  app.whenReady().then(async () => {
    if (!hasNativeHelper()) {
      quitting = true;
      recoveryLog("missing-foreground-host-exe-exit");
      await dialog.showMessageBox({
        type: "error",
        title: "缺少 ForegroundHost.exe",
        message: "无法跟随 Antigravity 窗口。请先运行仓库根目录的 编译原生助手.ps1（需要 .NET Framework 4.x）。",
        buttons: ["知道了"],
        defaultId: 0,
        noLink: true
      });
      app.quit();
      return;
    }
    createWindow(); updateMenu();
    globalShortcut.register("CommandOrControl+Alt+G", recall);
    globalShortcut.register("CommandOrControl+Alt+Shift+G", () => { apply({ clickThrough: false }); recall(); });
    if (settings.get("hostWindowOnly")) foreground.start(win?.getNativeWindowHandle());
    audio.setEnabled(settings.get("sound"));
    audio.setVolume(settings.get("volume"));
    audio.setPreset(settings.get("soundSet"));
    adapter.start(); quotaAdapter.start(); workingAdapter.start();
    recoveryTimer = setInterval(() => {
      if (!win || win.isDestroyed()) { show(); return; }
      if (settings.get("hostWindowOnly")) foreground.start(win.getNativeWindowHandle());
    }, 2000);
    uptimeCheckTimer = setInterval(() => {
      const uptime = process.uptime();
      if (uptime > 7200) visualCheckInterval = 120000;
      else if (uptime > 3600) visualCheckInterval = 60000;
    }, 300000);
    visualTimer = setInterval(async () => {
      if (visualChecking || drag || !win || win.isDestroyed() || !win.isVisible() || (settings.get("hostWindowOnly") && !hostArea)) return;
      if (Date.now() - lastVisualCheck < visualCheckInterval) return;
      lastVisualCheck = Date.now();
      visualChecking = true; const checked = win;
      try {
        const healthy = await Promise.race([
          checked.webContents.executeJavaScript(`(()=>{const face=document.querySelector('.agy-face');if(!face)return false;const r=face.getBoundingClientRect();if(r.width<20||r.height<20)return false;let node=face;while(node){const s=getComputedStyle(node);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;node=node.parentElement;}return [...face.querySelectorAll('img')].some(img=>img.complete&&img.naturalWidth>0&&Number(getComputedStyle(img).opacity)>0);})()`),
          new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("renderer-check-timeout")), 4000); timer.unref(); })
        ]);
        if (!healthy) { recoveryLog("invalid-character-layout-recreate"); checked.destroy(); return; }
        const frame = await Promise.race([
          checked.webContents.capturePage(),
          new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("capture-timeout")), 4000); timer.unref(); })
        ]);
        const pixels = frame.toBitmap(); let opaque = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 32) opaque++;
        blankFrames = opaque < 500 ? blankFrames + 1 : 0;
        if (blankFrames >= 2 && win === checked && !checked.isDestroyed()) {
          recoveryLog("blank-surface-recreate opaque=" + opaque); checked.destroy();
        }
      } catch (error) {
        if (win === checked && !checked.isDestroyed()) {
          recoveryLog("surface-check-recreate " + error.message); checked.destroy();
        }
      } finally {
        visualChecking = false;
      }
    }, 15000);
    const resume = () => {
      drag = null; hostLayout = null; foreground.stop(); show(); publish();
      if (win && !win.isDestroyed()) {
        win.webContents.send("widget:force-repaint");
        win.webContents.invalidate();
      }
    };
    powerMonitor.on("resume", resume); powerMonitor.on("unlock-screen", resume);
    screen.on("display-removed", reset);
    screen.on("display-metrics-changed", () => { if (settings.get("hostWindowOnly")) { syncVisibility(); publish(); } });
  });
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(visualTimer); clearInterval(uptimeCheckTimer); clearInterval(recoveryTimer); clearInterval(dragTimer);
    foreground.stop(); adapter.stop(); quotaAdapter.stop(); workingAdapter.stop(); sm.destroy();
    clearTimeout(saveTimer); ledger.save(); globalShortcut.unregisterAll();
  });
  app.on("window-all-closed", () => { if (quitting) app.quit(); });
}
