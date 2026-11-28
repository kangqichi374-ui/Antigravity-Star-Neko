const { app, BrowserWindow, Tray, screen, ipcMain, globalShortcut, powerMonitor, dialog } = require("electron");
const path = require("node:path");
const os = require("node:os");

const { SettingsManager } = require("../domain/settings.cjs");
const { UsageLedger } = require("../domain/ledger.cjs");
const { WidgetStateMachine } = require("../domain/state-machine.cjs");
const { TranscriptAdapter } = require("../adapters/transcript-adapter.cjs");
const { AudioManager } = require("../domain/audio-manager.cjs");
const { HostQuotaAdapter } = require("../adapters/host-quota.cjs");
const { HostWorkingAdapter } = require("../adapters/host-working.cjs");
const {
  ForegroundMonitor,
  hostPlacement,
  characterPlacement,
  snapToEdges,
  contextMenuPlacement,
  hasNativeHelper
} = require("../domain/host-visibility.cjs");
const { sharedHost } = require("../../../shared/host.cjs");

const { createContextMenuController } = require("./context-menu.cjs");
const { createSettingsAndTrayController } = require("./settings-tray.cjs");
const { createSurfaceWatchdog } = require("./watchdog.cjs");
const { createHostLauncher } = require("./host-launcher.cjs");

const dataDir =
  process.argv.find(a => a.startsWith("--data-dir="))?.slice(11) ||
  path.join(os.homedir(), ".antigravity-cat-widget");
app.setPath("userData", path.join(dataDir, "runtime"));
app.setName("Star Neko Widget");
if (process.platform === "win32") app.setAppUserModelId("com.antigravity.starneko.widget");

const earlySettings = new SettingsManager(path.join(dataDir, "settings.json"));
const isCompatRender =
  process.argv.includes("--software-render") ||
  process.argv.includes("--disable-gpu") ||
  (!process.argv.includes("--force-gpu") && earlySettings.get("compatMode") === true);

app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess2");
app.commandLine.appendSwitch("disable-features", "AudioServiceOutOfProcess,SpareRendererForSitePerProcess,BackForwardCache");
app.commandLine.appendSwitch("num-raster-threads", "1");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=64");
if (isCompatRender) {
  app.disableHardwareAcceleration();
} else {
  app.commandLine.appendSwitch("gpu-program-cache-size-kb", "1024");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes("--quit")) {
  app.quit();
} else {
  let quitting = false;
  let win = null;
  let drag = null;
  let hoverInteractive = false;
  let source = { online: false, source: "正在读取本机日志", files: 0 };
  let saveTimer = null;
  let displayScale = null;
  let hostArea = null;
  let hostLayout = null;
  let facing = "right";
  let dockSide = "";
  let artShift = 0;
  let lastSentVisible = null;
  let hostWorkingConnected = false;
  let thinkingTimeout = null;

  const foreground = new ForegroundMonitor();
  const quotaAdapter = new HostQuotaAdapter({ cachePath: path.join(dataDir, "quota-cache.json") });
  const workingAdapter = new HostWorkingAdapter();
  const dialogue = require("../../assets/dialogue/zh-CN.json");
  const running = new Set();
  const settings = earlySettings;
  const ledger = new UsageLedger({ storagePath: path.join(dataDir, "usage-v2.json") });
  const sm = new WidgetStateMachine("offline");
  const adapter = new TranscriptAdapter();
  const audio = new AudioManager();

  const appIconPath = path.join(__dirname, "../../assets/app-icon.ico");
  const preloadPath = path.join(__dirname, "preload.cjs");

  let ctxMenuCtrl = null;
  let settingsTrayCtrl = null;
  let watchdog = null;
  let hostLauncher = null;

  function safeWindowPid(w) {
    if (!w || w.isDestroyed()) return 0;
    try {
      return w.webContents.getOSProcessId() || 0;
    } catch {
      return 0;
    }
  }

  function getProcessBreakdown() {
    const winPid = safeWindowPid(win);
    const panelPid = safeWindowPid(settingsTrayCtrl?.getPanel());
    const ctxPid = safeWindowPid(ctxMenuCtrl?.getWindow());
    const list = [];
    try {
      for (const m of app.getAppMetrics()) {
        let role = "辅助子进程";
        if (m.type === "Browser") role = "主控与额度监听";
        else if (m.type === "GPU") role = isCompatRender ? "CPU 软渲染合成" : "GPU 硬件合成";
        else if (m.pid === winPid) role = "猫娘立绘与气泡";
        else if (m.pid === panelPid) role = "定制设置面板（关窗即释）";
        else if (m.pid === ctxPid) role = "右键快捷菜单（闲置即释）";
        else if (m.type === "Tab") role = "界面渲染子进程";
        else if (m.name || m.serviceName) role = m.name || m.serviceName;
        const kb = m.memory?.workingSetSize || m.memory?.privateBytes || 0;
        list.push({ pid: m.pid, role, mb: kb > 0 ? Math.max(1, Math.round(kb / 1024)) : null });
      }
    } catch {}
    if (foreground.child?.pid) {
      list.push({ pid: foreground.child.pid, role: "窗口贴边跟随 (原生助手)", mb: null });
    }
    return list;
  }

  const snapshot = (includeStatic = true) => {
    ledger.quotaRemainingPercent = settings.get("manualQuota") === true ? settings.get("manualPercent") : null;
    const facingMode = settings.get("facingMode");
    const effectiveFacing = facingMode === "left" || facingMode === "right" ? facingMode : facing;
    const out = {
      artShift,
      dockSide,
      compatRender: isCompatRender,
      quotaWindows: quotaAdapter.snapshot,
      facing: effectiveFacing,
      state: sm.currentState,
      persistentState: sm.persistentState,
      settings: settings.getAll(),
      displayScale: displayScale || settings.get("scale"),
      visibility: {
        supported: process.platform === "win32",
        foreground: foreground.state.kind,
        nativeAttached: foreground.state.attached === true,
        withinHost: !!hostArea
      },
      ledger: ledger.getSnapshot(),
      source
    };
    if (includeStatic) {
      out.dialogue = dialogue.lines;
      out.presets = audio.getPresetList();
      out.eventSounds = audio.getEventSoundList();
      out.processes = getProcessBreakdown();
    }
    return out;
  };

  const send = (channel, data) => {
    const targets = [win, settingsTrayCtrl?.getPanel(), ctxMenuCtrl?.getWindow()];
    for (const w of targets) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  };

  const publish = (includeStatic = false) => {
    const panel = settingsTrayCtrl?.getPanel();
    const ctxWin = ctxMenuCtrl?.getWindow();
    const qDlg = hostLauncher?.getDialogWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("widget:snapshot", snapshot(includeStatic));
    }
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send("widget:snapshot", snapshot(true));
    }
    if (ctxWin && !ctxWin.isDestroyed()) {
      ctxWin.webContents.send("widget:snapshot", snapshot(false));
    }
    if (qDlg && !qDlg.isDestroyed()) {
      qDlg.webContents.send("widget:snapshot", snapshot(false));
    }
  };

  function notifyVisibility(visible) {
    workingAdapter.setHostVisible(visible);
    if (!win || win.isDestroyed()) return;
    if (lastSentVisible === visible) return;
    lastSentVisible = visible;
    try {
      win.webContents.setFrameRate(visible ? 60 : 1);
    } catch {}
    win.webContents.send("widget:visibility", visible);
  }

  function syncQuotaState() {
    if (["idle", "warning"].includes(sm.persistentState)) {
      const vals = settings.get("manualQuota")
        ? [settings.get("manualPercent"), settings.get("manualWeeklyPercent")]
        : [quotaAdapter.snapshot.fiveHour, quotaAdapter.snapshot.weekly];
      sm.setPersistentState(vals.some(v => typeof v === "number" && v <= 20) ? "warning" : "idle");
    }
  }

  function bounds(size = settings.get("scale")) {
    return { width: Math.max(360, size + 80), height: Math.round((size * 1146) / 1372 + 340) };
  }

  function safePosition(x, y, w, h) {
    const area = screen.getDisplayNearestPoint({
      x: Number.isFinite(x) ? x : screen.getPrimaryDisplay().workArea.x,
      y: Number.isFinite(y) ? y : 0
    }).workArea;
    return {
      x: Math.round(
        Number.isFinite(x) ? Math.max(area.x, Math.min(area.x + area.width - w, x)) : area.x + area.width - w - 18
      ),
      y: Math.round(
        Number.isFinite(y) ? Math.max(area.y, Math.min(area.y + area.height - h, y)) : area.y + area.height - h - 18
      )
    };
  }

  function syncVisibility() {
    if (!win || win.isDestroyed()) return;
    if (!settings.get("hostWindowOnly")) {
      hostArea = null;
      hostLayout = null;
      displayScale = settings.get("scale");
      if (!win.isVisible()) win.showInactive();
      notifyVisibility(true);
      return;
    }
    if (drag) return;
    const previousArea = hostArea;
    let state = foreground.state;
    if (state.bounds) state = { ...state, bounds: screen.screenToDipRect(null, state.bounds) };
    const placement = hostPlacement(
      state,
      settings.get("scale"),
      settings.get("hostOffsetX"),
      settings.get("hostOffsetY"),
      settings.get("hostDock")
    );

    if (!placement) {
      hostArea = null;
      hostLayout = null;
      if (win.isVisible()) win.hide();
      notifyVisibility(false);
      return;
    }

    hostArea = state.bounds;
    displayScale = placement.scale;
    artShift = placement.artShift;
    dockSide =
      Math.abs(placement.visualX - hostArea.x) < 2
        ? "left"
        : Math.abs(placement.visualX + displayScale - hostArea.x - hostArea.width) < 2
          ? "right"
          : "";
    facing = placement.visualX + displayScale / 2 < hostArea.x + hostArea.width / 2 ? "left" : "right";
    const nextLayout = JSON.stringify([
      state.hostId,
      state.restoreGeneration,
      displayScale,
      hostArea.width,
      hostArea.height,
      settings.get("hostOffsetX"),
      settings.get("hostOffsetY"),
      settings.get("hostDock")
    ]);
    const nativeTranslation = state.nativeFollowing && previousArea && hostLayout === nextLayout;
    const layoutChanged = hostLayout !== nextLayout;
    hostLayout = nextLayout;
    if (!nativeTranslation) {
      const old = win.getBounds();
      if (Object.keys(placement.bounds).some(key => Math.abs(old[key] - placement.bounds[key]) > 2)) {
        win.setBounds(placement.bounds);
      }
    }

    if (!win.isVisible()) {
      win.showInactive();
      if (layoutChanged) {
        setTimeout(() => {
          if (win && !win.isDestroyed()) win.webContents.invalidate();
        }, 50);
      }
    }
    notifyVisibility(true);
    return !nativeTranslation;
  }

  function show() {
    if (quitting) return;
    if (!win || win.isDestroyed()) createWindow();
    if (settings.get("hostWindowOnly")) foreground.start(win.getNativeWindowHandle());
    if (!settings.get("hostWindowOnly") && !win.isVisible()) win.showInactive();
    syncVisibility();
    win.setIgnoreMouseEvents(settings.get("clickThrough"), { forward: true });
  }

  function apply(partial) {
    const allowed = [
      "scale", "alwaysOnTop", "reducedMotion", "compatMode", "sound", "volume", "soundSet",
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
    const oldScale = settings.get("scale");
    const oldHostOnly = settings.get("hostWindowOnly");
    if (!oldHostOnly && partial?.hostWindowOnly === true && win) {
      const pos = win.getBounds();
      settings.update({ x: pos.x, y: pos.y });
    }
    settings.update(Object.fromEntries(Object.entries(partial || {}).filter(([k]) => allowed.includes(k))));
    if (partial && "compatMode" in partial && settings.get("compatMode") !== isCompatRender) {
      setTimeout(() => hostLauncher.relaunchSelf(), 60);
      return snapshot();
    }
    syncQuotaState();
    if (settings.get("hostWindowOnly")) foreground.start(win?.getNativeWindowHandle());
    else foreground.stop();
    if (win) {
      if (!settings.get("hostWindowOnly") && (settings.get("scale") !== oldScale || oldHostOnly)) {
        const old = win.getBounds();
        const dim = bounds();
        const pos = oldHostOnly
          ? safePosition(settings.get("x"), settings.get("y"), dim.width, dim.height)
          : safePosition(old.x + old.width - dim.width, old.y + old.height - dim.height, dim.width, dim.height);
        win.setBounds({ ...pos, ...dim });
      }
      if (!settings.get("hostWindowOnly")) win.setAlwaysOnTop(settings.get("alwaysOnTop"));
      win.setIgnoreMouseEvents(settings.get("clickThrough"), { forward: true });
      syncVisibility();
    }
    audio.setEnabled(settings.get("sound"));
    audio.setVolume(settings.get("volume"));
    audio.setPreset(settings.get("soundSet"));
    settingsTrayCtrl?.syncThemeColor(settings.get("bubbleTheme"));
    publish();
    settingsTrayCtrl?.updateTrayTooltip();
    return snapshot();
  }

  function reset() {
    if (settings.get("hostWindowOnly")) {
      settings.update({ hostOffsetX: 18, hostOffsetY: 18, hostDock: "" });
      syncVisibility();
      publish();
      return;
    }
    const dim = bounds();
    const pos = safePosition(null, null, dim.width, dim.height);
    win.setBounds({ ...pos, ...dim });
    settings.update(pos);
    show();
  }

  function recall() {
    show();
    if (settings.get("clickThrough") || (settings.get("hostWindowOnly") && !win.isVisible())) {
      settingsTrayCtrl.openSettings();
    }
  }

  function dock(side) {
    if (!win) return;
    if (settings.get("hostWindowOnly")) syncVisibility();
    const size = displayScale || settings.get("scale");
    const b = { ...win.getBounds(), ...bounds(size) };
    const a = hostArea || screen.getDisplayMatching(b).workArea;
    const placement = characterPlacement(a, size, b, side === "left" ? a.x : a.x + a.width - size, a.y + a.height - b.height);
    win.setBounds(placement.bounds);
    artShift = placement.artShift;
    dockSide = side;
    facing = side;
    if (hostArea) settings.update({ hostOffsetX: side === "left" ? a.width - size : 0, hostOffsetY: 0, hostDock: side });
    else settings.update({ x: placement.bounds.x, y: placement.bounds.y });
    publish();
  }

  ctxMenuCtrl = createContextMenuController({
    BrowserWindow,
    screen,
    contextMenuPlacement,
    appIconPath,
    preloadPath,
    menuHtmlPath: path.join(__dirname, "../renderer/menu.html"),
    getMainWin: () => win,
    getPanel: () => settingsTrayCtrl?.getPanel(),
    getSnapshot: snapshot,
    getLayoutMetrics: () => ({ displayScale, scale: settings.get("scale"), artShift, dockSide }),
    onPublish: () => publish()
  });

  hostLauncher = createHostLauncher({
    app,
    BrowserWindow,
    screen,
    ipcMain,
    dialog,
    sharedHost,
    quotaAdapter,
    settings,
    appIconPath,
    preloadPath,
    quotaDialogHtmlPath: path.join(__dirname, "../renderer/quota-dialog.html"),
    getMainWin: () => win,
    getPanel: () => settingsTrayCtrl?.getPanel(),
    closeContextMenu: () => ctxMenuCtrl.closeContextMenu(),
    isQuitting: () => quitting,
    setQuitting: v => {
      quitting = v;
    },
    onApply: apply,
    rootMainDir: __dirname
  });

  settingsTrayCtrl = createSettingsAndTrayController({
    BrowserWindow,
    Tray,
    globalShortcut,
    appIconPath,
    preloadPath,
    settingsHtmlPath: path.join(__dirname, "../renderer/settings.html"),
    settings,
    onApply: apply,
    onOpenContextMenu: opts => ctxMenuCtrl.openContextMenu(opts),
    onRecall: recall
  });

  watchdog = createSurfaceWatchdog({
    app,
    powerMonitor,
    screen,
    dataDir,
    settings,
    foreground,
    getMainWin: () => win,
    isQuitting: () => quitting,
    isDragging: () => Boolean(drag),
    hasHostArea: () => Boolean(hostArea),
    onClearDragAndLayout: () => {
      drag = null;
      hostLayout = null;
    },
    onShow: show,
    onPublish: publish,
    onReset: reset,
    onSyncVisibility: syncVisibility
  });

  function createWindow() {
    lastSentVisible = null;
    const dim = bounds();
    const pos = safePosition(settings.get("x"), settings.get("y"), dim.width, dim.height);
    win = new BrowserWindow({
      ...dim,
      ...pos,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      icon: appIconPath,
      title: "Star Neko Widget",
      alwaysOnTop: !settings.get("hostWindowOnly") && settings.get("alwaysOnTop"),
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true
      }
    });
    try {
      win.webContents.setFrameRate(60);
    } catch {}
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
    win.once("ready-to-show", show);
    win.on("closed", () => {
      foreground.stop();
      win = null;
      lastSentVisible = null;
      if (!quitting) setTimeout(show, 250);
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", e => e.preventDefault());
    win.webContents.on("render-process-gone", () => {
      if (!quitting && win && !win.isDestroyed()) win.destroy();
    });
    win.webContents.on("did-finish-load", () => {
      lastSentVisible = null;
      notifyVisibility(win.isVisible());
      publish(true);
    });
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
        win.hookWindowMessage(0x020b, wParam => dispatchXButton(wParam, true)); // WM_XBUTTONDOWN
        win.hookWindowMessage(0x020d, wParam => dispatchXButton(wParam, true)); // WM_XBUTTONDBLCLK
        win.hookWindowMessage(0x020c, wParam => dispatchXButton(wParam, false)); // WM_XBUTTONUP
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
      const stuck = win;
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = setTimeout(() => {
        if (!quitting && win === stuck && !stuck.isDestroyed()) stuck.destroy();
      }, 10000);
    });
    win.on("responsive", () => clearTimeout(unresponsiveTimer));
    win.on("closed", () => clearTimeout(unresponsiveTimer));
  }

  function trusted(e) {
    return [win, settingsTrayCtrl?.getPanel(), ctxMenuCtrl?.getWindow(), hostLauncher?.getDialogWindow()].some(
      w => w && !w.isDestroyed() && e.sender === w.webContents
    );
  }

  function dragMove(point) {
    if (!drag || !win) return;
    const p = point || drag.last;
    const dx = p.x - drag.point.x;
    const dy = p.y - drag.point.y;
    drag.last = p;
    if (!drag.moved && Math.hypot(dx, dy) <= 8) return;
    if (!drag.moved) {
      drag.moved = true;
      sm.handleDragStart();
    }
    const a = hostArea || screen.getDisplayNearestPoint(p).workArea;
    const size = displayScale || settings.get("scale");
    const placement = characterPlacement(a, size, drag.bounds, drag.visualX + dx, drag.bounds.y + dy);
    const prevShift = artShift;
    const prevDock = dockSide;
    const prevFacing = facing;
    win.setBounds(placement.bounds);
    artShift = placement.artShift;
    dockSide = "";
    facing = placement.visualX + size / 2 < a.x + a.width / 2 ? "left" : "right";
    if (artShift !== prevShift || dockSide !== prevDock || facing !== prevFacing) {
      publish();
    }
  }

  // IPC 路由
  ipcMain.handle("widget:get", e => (trusted(e) ? snapshot() : null));
  ipcMain.handle("widget:settings", (e, v) => (trusted(e) ? apply(v) : null));
  ipcMain.handle("widget:import-audio", async e => {
    if (!trusted(e)) return null;
    const owner = BrowserWindow.fromWebContents(e.sender) || settingsTrayCtrl.getPanel() || win;
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
    if (command === "settings") settingsTrayCtrl.openSettings();
    else if (command === "menu") ctxMenuCtrl.openContextMenu();
    else if (command === "close-menu") ctxMenuCtrl.closeContextMenu();
    else if (command === "enable-live-quota") hostLauncher.enableLiveQuota().catch(() => {});
    else if (command === "relaunch-widget") hostLauncher.relaunchSelf();
    else if (command === "quit") app.quit();
    else if (command === "reset") reset();
    else if (command === "dock-left") dock("left");
    else if (command === "dock-right") dock("right");
    else if (command === "show-bubble") apply({ bubbleOn: true });
    else if (command === "preview-reaction") send("widget:reaction", {});
    else if (command === "pet") {
      if (sm.handlePetting(true)) send("widget:petted", { source: "menu" });
    } else if (command === "quota-refresh") quotaAdapter.openNativeQuota().catch(() => {});
    else if (command === "refresh") {
      adapter.scan();
      quotaAdapter.tick();
      publish();
    }
  });

  ipcMain.on("widget:drag-move", (e, raw) => {
    if (!trusted(e) || !drag || !win) return;
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && Math.abs(raw.x) < 100000 && Math.abs(raw.y) < 100000) {
      dragMove({ x: raw.x, y: raw.y });
    }
  });

  ipcMain.on("widget:menu-drag", (e, raw) => {
    if (!trusted(e)) return;
    ctxMenuCtrl.handleMenuDrag(raw);
  });

  ipcMain.handle("widget:pointer", (e, payload) => {
    const action = typeof payload === "string" ? payload : payload?.action;
    const raw = payload?.point;
    const point =
      raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && Math.abs(raw.x) < 100000 && Math.abs(raw.y) < 100000
        ? { x: raw.x, y: raw.y }
        : null;
    if (!trusted(e) || !win) return { moved: false };
    if (action === "down") {
      win.setIgnoreMouseEvents(false);
      const start = point || screen.getCursorScreenPoint();
      const scale = displayScale || settings.get("scale");
      const dim = bounds(scale);
      const wb = win.getBounds();
      drag = {
        point: start,
        last: start,
        bounds: { ...wb, ...dim },
        visualX: wb.x + (dim.width - scale) / 2 + artShift,
        moved: false
      };
      sm.handlePointerDown();
    } else if (action === "move" && point) {
      dragMove(point);
    } else if (action === "up" || action === "cancel") {
      if (!drag) return { moved: false };
      dragMove();
      const moved = drag.moved;
      drag = null;
      if (moved) {
        const size = displayScale || settings.get("scale");
        const old = { ...win.getBounds(), ...bounds(size) };
        const area = hostArea || screen.getDisplayMatching(old).workArea;
        let visualX = old.x + (old.width - size) / 2 + artShift;
        let y = old.y;
        if (settings.get("snap")) ({ visualX, y } = snapToEdges(area, size, old.height, visualX, y));
        const placement = characterPlacement(area, size, old, visualX, y);
        win.setBounds(placement.bounds);
        artShift = placement.artShift;
        dockSide =
          Math.abs(visualX - area.x) < 2
            ? "left"
            : Math.abs(visualX + size - area.x - area.width) < 2
              ? "right"
              : "";
        facing = visualX + size / 2 < area.x + area.width / 2 ? "left" : "right";
        if (hostArea) {
          settings.update({
            hostDock: dockSide,
            hostOffsetX: Math.max(0, hostArea.x + hostArea.width - placement.visualX - size),
            hostOffsetY: Math.max(0, hostArea.y + hostArea.height - placement.bounds.y - old.height)
          });
        } else {
          settings.update({ x: placement.bounds.x, y: placement.bounds.y });
        }
      }
      sm.handlePointerUp();
      return { moved };
    } else if (action === "pet") {
      if (sm.handlePetting(false)) send("widget:petted", { source: "hover" });
    }
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

  // 宿主适配器与状态机订阅
  quotaAdapter.on("change", () => {
    syncQuotaState();
    publish();
  });
  sm.subscribe(publish);
  foreground.on("change", () => {
    if (syncVisibility() !== false) publish();
  });
  adapter.on("stepDone", step => {
    const recorded = ledger.recordStep(step);
    if (recorded) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => ledger.save(), 1000);
    }
  });

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
    syncQuotaState();
    publish();
  });

  app.on("second-instance", (_event, args) => {
    if (args.includes("--quit")) app.quit();
    else if (quitting) return;
    else if (args.includes("--restart-widget")) hostLauncher.relaunchSelf();
    else if (args.includes("--open-settings")) settingsTrayCtrl.openSettings();
    else if (!args.includes("--background")) recall();
  });

  app.whenReady().then(async () => {
    if (!hasNativeHelper()) {
      quitting = true;
      watchdog.recoveryLog("missing-foreground-host-exe-exit");
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
    createWindow();
    settingsTrayCtrl.initTrayAndShortcuts(process.argv.includes("--no-shortcuts"));
    if (process.argv.includes("--open-settings")) settingsTrayCtrl.openSettings();
    if (settings.get("hostWindowOnly")) foreground.start(win?.getNativeWindowHandle());
    audio.setEnabled(settings.get("sound"));
    audio.setVolume(settings.get("volume"));
    audio.setPreset(settings.get("soundSet"));
    adapter.start();
    quotaAdapter.start();
    workingAdapter.start();
    watchdog.start();
  });

  app.on("before-quit", () => {
    quitting = true;
    settingsTrayCtrl?.destroy();
    ctxMenuCtrl?.destroy();
    hostLauncher?.destroy();
    watchdog?.destroy();
    foreground.stop();
    adapter.stop();
    quotaAdapter.stop();
    workingAdapter.stop();
    sharedHost.drop();
    sm.destroy();
    clearTimeout(saveTimer);
    ledger.save();
  });

  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
}
