const { app, BrowserWindow, Tray, screen, Menu, ipcMain, globalShortcut, powerMonitor, dialog } = require("electron");
const path = require("node:path"), os = require("node:os");
const { SettingsManager } = require("../domain/settings.cjs");
const { UsageLedger } = require("../domain/ledger.cjs");
const { WidgetStateMachine } = require("../domain/state-machine.cjs");
const { TranscriptAdapter } = require("../adapters/transcript-adapter.cjs");
const { AudioManager } = require("../domain/audio-manager.cjs");
const { HostQuotaAdapter } = require("../adapters/host-quota.cjs");
const { HostWorkingAdapter } = require("../adapters/host-working.cjs");
const { ForegroundMonitor, hostPlacement, characterPlacement, snapToEdges, contextMenuPlacement, hasNativeHelper } = require("../domain/host-visibility.cjs");
const { sharedHost } = require("../../../shared/host.cjs");

const dataDir = process.argv.find(a => a.startsWith("--data-dir="))?.slice(11) || path.join(os.homedir(), ".antigravity-cat-widget");
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

if (!app.requestSingleInstanceLock()) app.quit();
else if (process.argv.includes("--quit")) app.quit();
else {
  let quitting = false, recoveryTimer, resumeCheckTimer;
  const recoveryLog = reason => {
    try { require("node:fs").appendFileSync(path.join(dataDir, "recovery.log"), new Date().toISOString() + " " + reason + "\n"); } catch {}
  };
  let win, tray = null, contextMenu = null, ctxWin = null, ctxIdleTimer = null, ctxDrag = null, panel, drag = null, hoverInteractive = false, source = { online: false, source: "正在读取本机日志", files: 0 }, saveTimer, displayScale = null, hostArea = null, hostLayout = null, dragTimer = null, facing = "right", dockSide = "", artShift = 0, lastSentVisible = null;
  const foreground = new ForegroundMonitor(), quotaAdapter = new HostQuotaAdapter({ cachePath: path.join(dataDir, "quota-cache.json") }), workingAdapter = new HostWorkingAdapter();
  const dialogue = require("../../assets/dialogue/zh-CN.json");
  const running = new Set();
  let hostWorkingConnected = false;
  const settings = earlySettings, ledger = new UsageLedger({ storagePath: path.join(dataDir, "usage-v2.json") }), sm = new WidgetStateMachine("offline"), adapter = new TranscriptAdapter(), audio = new AudioManager();

  function themeBgColor(theme) {
    return ({ crystal: "#f7f5fc", sakura: "#fdf5f8", ocean: "#f3f7fd", night: "#171429" })[theme] || "#f7f5fc";
  }

  function safeWindowPid(w) {
    if (!w || w.isDestroyed()) return 0;
    try { return w.webContents.getOSProcessId() || 0; } catch { return 0; }
  }

  function getProcessBreakdown() {
    const winPid = safeWindowPid(win);
    const panelPid = safeWindowPid(panel);
    const ctxPid = safeWindowPid(ctxWin);
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
    for (const w of [win, panel, ctxWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  };
  const publish = (includeStatic = false) => {
    const hasPanel = Boolean(panel && !panel.isDestroyed());
    const hasCtx = Boolean(ctxWin && !ctxWin.isDestroyed());
    if (win && !win.isDestroyed()) {
      win.webContents.send("widget:snapshot", snapshot(includeStatic));
    }
    if (hasPanel) {
      panel.webContents.send("widget:snapshot", snapshot(true));
    }
    if (hasCtx) {
      ctxWin.webContents.send("widget:snapshot", snapshot(false));
    }
  };

  function notifyVisibility(visible) {
    workingAdapter.setHostVisible(visible);
    if (!win || win.isDestroyed()) return;
    if (lastSentVisible === visible) return;
    lastSentVisible = visible;
    try { win.webContents.setFrameRate(visible ? 60 : 1); } catch {}
    win.webContents.send("widget:visibility", visible);
  }

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
      notifyVisibility(true);
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
      notifyVisibility(false);
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
          win.webContents.invalidate();
        }
      }, 50);
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

  function findHelperExe() {
    const fs = require("node:fs");
    const appPath = app.getAppPath();
    let realAppPath = appPath;
    try { realAppPath = fs.realpathSync(appPath); } catch {}
    const candidates = [
      path.resolve(realAppPath, "../LaunchAntigravityWithWidget.exe"),
      path.resolve(__dirname, "../../../../LaunchAntigravityWithWidget.exe"),
      path.resolve(appPath, "../LaunchAntigravityWithWidget.exe"),
      path.join(path.dirname(process.execPath), "LaunchAntigravityWithWidget.exe")
    ];
    return candidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    }) || null;
  }

  function relaunchSelf() {
    if (quitting) return;
    quitting = true;
    const { spawn } = require("node:child_process");
    const appPath = app.getAppPath();
    let realAppPath = appPath;
    try { realAppPath = require("node:fs").realpathSync(appPath); } catch {}
    const cleanArgs = process.argv
      .slice(1)
      .filter(a => a !== "--software-render" && a !== "--disable-gpu" && a !== "--force-gpu" && a !== "--open-settings" && a !== "--restart-widget");

    const helperExe = findHelperExe();
    let spawned = false;
    if (helperExe) {
      try {
        const hArgs = [
          "--attach",
          "--wait-pid=" + process.pid,
          "--widget-exe=" + process.execPath,
          "--widget-app=" + realAppPath
        ];
        const customDataArg = process.argv.find(a => a.startsWith("--data-dir="));
        if (customDataArg) hArgs.push(customDataArg);
        if (process.argv.includes("--no-shortcuts")) hArgs.push("--no-shortcuts");
        const child = spawn(helperExe, hArgs, {
          detached: true,
          windowsHide: true,
          stdio: "ignore",
          cwd: path.dirname(helperExe)
        });
        child.unref();
        spawned = true;
      } catch {}
    }

    if (!spawned) {
      try {
        const psQuote = s => "'" + String(s).replace(/'/g, "''") + "'";
        const argArrayExpr = cleanArgs.length ? ("@(" + cleanArgs.map(psQuote).join(",") + ")") : "@()";
        const psScript = [
          `try { Wait-Process -Id ${process.pid} -Timeout 5 -ErrorAction SilentlyContinue } catch {}`,
          "Start-Sleep -Milliseconds 120",
          cleanArgs.length
            ? `Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${argArrayExpr} -WorkingDirectory ${psQuote(process.cwd())}`
            : `Start-Process -FilePath ${psQuote(process.execPath)} -WorkingDirectory ${psQuote(process.cwd())}`
        ].join("; ");
        const encoded = Buffer.from(psScript, "utf16le").toString("base64");
        const sysRoot = process.env.SystemRoot || "C:\\Windows";
        const psExe = path.join(sysRoot, "System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        const w = spawn(psExe, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
          detached: true,
          windowsHide: true,
          stdio: "ignore"
        });
        w.unref();
      } catch {
        app.relaunch({ args: cleanArgs });
      }
    }

    app.quit();
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
    const oldScale = settings.get("scale"), oldHostOnly = settings.get("hostWindowOnly");
    if (!oldHostOnly && partial?.hostWindowOnly === true && win) {
      const pos = win.getBounds();
      settings.update({ x: pos.x, y: pos.y });
    }
    settings.update(Object.fromEntries(Object.entries(partial || {}).filter(([k]) => allowed.includes(k))));
    if (partial && "compatMode" in partial && settings.get("compatMode") !== isCompatRender) {
      setTimeout(() => relaunchSelf(), 60);
      return snapshot();
    }
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
    if (panel && !panel.isDestroyed()) {
      try { panel.setBackgroundColor(themeBgColor(settings.get("bubbleTheme"))); } catch {}
    }
    publish();
    updateMenu();
    return snapshot();
  }

  const appIconPath = path.join(__dirname, "../../assets/app-icon.ico");

  function openSettings() {
    if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); return; }
    panel = new BrowserWindow({
      width: 600,
      height: 820,
      minWidth: 500,
      minHeight: 620,
      autoHideMenuBar: true,
      icon: appIconPath,
      title: "星语猫娘 · 定制与设置",
      backgroundColor: themeBgColor(settings.get("bubbleTheme")),
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

  const CTX_W = 264, CTX_H = 472;

  function closeContextMenu() {
    ctxDrag = null;
    if (!ctxWin || ctxWin.isDestroyed()) return;
    if (ctxWin.isVisible()) ctxWin.hide();
    clearTimeout(ctxIdleTimer);
    ctxIdleTimer = setTimeout(() => {
      if (ctxWin && !ctxWin.isDestroyed() && !ctxWin.isVisible()) {
        ctxWin.destroy();
        ctxWin = null;
        if (panel && !panel.isDestroyed()) publish();
      }
    }, 12000);
    if (typeof ctxIdleTimer.unref === "function") ctxIdleTimer.unref();
  }

  function openContextMenu(opts = {}) {
    clearTimeout(ctxIdleTimer);
    ctxDrag = null;
    const pt = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(pt).workArea;
    let charRect = null;
    if (!opts.nearCursor && win && !win.isDestroyed() && win.isVisible()) {
      const wb = win.getBounds();
      const size = displayScale || settings.get("scale");
      const charH = Math.round(size * 1146 / 1372);
      charRect = {
        x: Math.round(wb.x + (wb.width - size) / 2 + artShift),
        y: Math.round(wb.y + wb.height - charH),
        width: size,
        height: charH
      };
    }
    const { x, y } = contextMenuPlacement(
      area,
      { width: CTX_W, height: CTX_H, pad: 12 },
      charRect,
      pt,
      { nearCursor: Boolean(opts.nearCursor), preferSide: dockSide }
    );

    if (ctxWin && !ctxWin.isDestroyed()) {
      ctxWin.setBounds({ x, y, width: CTX_W, height: CTX_H });
      ctxWin.webContents.send("widget:snapshot", snapshot(false));
      ctxWin.show();
      ctxWin.focus();
      return;
    }

    ctxWin = new BrowserWindow({
      x, y, width: CTX_W, height: CTX_H,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      icon: appIconPath,
      title: "星语猫娘菜单",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    ctxWin.loadFile(path.join(__dirname, "../renderer/menu.html"));
    ctxWin.once("ready-to-show", () => {
      if (ctxWin && !ctxWin.isDestroyed()) {
        ctxWin.show();
        ctxWin.focus();
        if (panel && !panel.isDestroyed()) publish();
      }
    });
    ctxWin.on("blur", () => {
      if (ctxDrag) {
        ctxDrag.blurred = true;
        return;
      }
      closeContextMenu();
    });
    ctxWin.on("closed", () => { clearTimeout(ctxIdleTimer); ctxDrag = null; ctxWin = null; });
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
    if (settings.get("clickThrough") || (settings.get("hostWindowOnly") && !win.isVisible())) openSettings();
  }

  async function enableLiveQuota() {
    closeContextMenu();
    try {
      const liveClient = await sharedHost.getClient();
      if (liveClient) {
        if (!settings.get("bubbleOn")) apply({ bubbleOn: true });
        quotaAdapter.openNativeQuota().catch(() => {});
        if (win && !win.isDestroyed()) win.webContents.send("widget:open-quota");
        return;
      }
    } catch {}

    const owner = (panel && !panel.isDestroyed() && panel.isVisible()) ? panel : undefined;
    const allowBind = !process.argv.includes("--no-shortcuts");
    const buttons = allowBind
      ? ["重开并设为默认伴随启动（推荐）", "仅本次重开", "取消"]
      : ["立即重开", "取消"];
    const cancelId = buttons.length - 1;
    const choice = await dialog.showMessageBox(owner, {
      type: "question",
      title: "开启实时额度",
      message: "需要重新打开 Antigravity 以开启实时额度读取",
      detail: allowBind
        ? "请先确认当前对话已回复完毕。\n\n· 重开并设为默认伴随启动（推荐）：自动更新桌面/开始菜单快捷方式（保留 Antigravity 原图标），以后每次打开都会自动开启实时额度并拉起猫娘。\n· 仅本次重开：只为当前这一次开启端口。"
        : "请先确认当前对话已回复完毕。点击「立即重开」后将自动带额度端口重启并恢复桌宠连接。",
      buttons,
      defaultId: 0,
      cancelId,
      noLink: true
    });
    if (choice.response === cancelId) return;
    const bindShortcuts = allowBind && choice.response === 0;

    const { spawn } = require("node:child_process");
    let realAppPath = app.getAppPath();
    try { realAppPath = require("node:fs").realpathSync(realAppPath); } catch {}
    const helperExe = findHelperExe();

    if (helperExe) {
      const helperArgs = [
        "--relaunch-host",
        "--widget-exe=" + process.execPath,
        "--widget-app=" + realAppPath
      ];
      if (bindShortcuts) helperArgs.push("--bind-shortcuts");
      const customDataArg = process.argv.find(a => a.startsWith("--data-dir="));
      if (customDataArg) helperArgs.push(customDataArg);
      if (process.argv.includes("--no-shortcuts")) helperArgs.push("--no-shortcuts");
      const child = spawn(helperExe, helperArgs, {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        cwd: path.dirname(helperExe)
      });
      child.unref();
    }
  }

  function updateMenu() {
    const curTheme = settings.get("bubbleTheme");
    const curFacing = settings.get("facingMode");
    contextMenu = Menu.buildFromTemplate([
      { label: "星语猫娘 · 桌宠", enabled: false },
      { label: "定制与设置面板…", click: openSettings },
      { label: "开启实时额度", click: () => { enableLiveQuota().catch(() => {}); } },
      { label: "摸摸头", click: () => { if (sm.handlePetting(true)) send("widget:petted", { source: "menu" }); } },
      { type: "separator" },
      { label: "显示气泡", type: "checkbox", checked: settings.get("bubbleOn"), click: () => apply({ bubbleOn: !settings.get("bubbleOn") }) },
      {
        label: "气泡主题配色",
        submenu: [
          { label: "星晶蓝紫（默认）", type: "radio", checked: curTheme === "crystal", click: () => apply({ bubbleTheme: "crystal" }) },
          { label: "樱粉浅暖", type: "radio", checked: curTheme === "sakura", click: () => apply({ bubbleTheme: "sakura" }) },
          { label: "经典蓝白", type: "radio", checked: curTheme === "ocean", click: () => apply({ bubbleTheme: "ocean" }) },
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
      { label: "兼容模式（防小飞机叠加）", type: "checkbox", checked: isCompatRender, click: () => apply({ compatMode: !isCompatRender }) },
      { label: "鼠标穿透 · Ctrl+Alt+Shift+G 恢复", type: "checkbox", checked: settings.get("clickThrough"), click: () => apply({ clickThrough: !settings.get("clickThrough") }) },
      { type: "separator" },
      { label: "停靠左下角", click: () => dock("left") },
      { label: "停靠右下角", click: () => dock("right") },
      { label: "重置位置", click: reset },
      { label: "重启挂件", click: () => relaunchSelf() },
      { type: "separator" },
      { label: "退出星语猫娘", click: () => app.quit() }
    ]);
    if (tray && !tray.isDestroyed()) {
      try {
        tray.setToolTip(settings.get("clickThrough") ? "星语猫娘 · 鼠标穿透中（左键设置 / 右键菜单）" : "星语猫娘 · 左键设置 / 右键菜单");
      } catch {}
    }
  }

  function createWindow() {
    lastSentVisible = null;
    const dim = bounds(), pos = safePosition(settings.get("x"), settings.get("y"), dim.width, dim.height);
    win = new BrowserWindow({
      ...dim, ...pos, frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true,
      icon: appIconPath, title: "Star Neko Widget",
      alwaysOnTop: !settings.get("hostWindowOnly") && settings.get("alwaysOnTop"), show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true
      }
    });
    try { win.webContents.setFrameRate(60); } catch {}
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
    win.once("ready-to-show", show);
    win.on("closed", () => { foreground.stop(); win = null; lastSentVisible = null; if (!quitting) setTimeout(show, 250); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", e => e.preventDefault());
    win.webContents.on("render-process-gone", () => { if (!quitting && win && !win.isDestroyed()) win.destroy(); });
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
    return [win, panel, ctxWin].some(w => w && !w.isDestroyed() && e.sender === w.webContents);
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
    else if (command === "menu") openContextMenu();
    else if (command === "close-menu") closeContextMenu();
    else if (command === "enable-live-quota") enableLiveQuota().catch(() => {});
    else if (command === "relaunch-widget") relaunchSelf();
    else if (command === "quit") app.quit();
    else if (command === "reset") reset();
    else if (command === "dock-left") dock("left");
    else if (command === "dock-right") dock("right");
    else if (command === "show-bubble") apply({ bubbleOn: true });
    else if (command === "preview-reaction") send("widget:reaction", {});
    else if (command === "pet") {
      if (sm.handlePetting(true)) send("widget:petted", { source: "menu" });
    }
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
    const prevShift = artShift, prevDock = dockSide, prevFacing = facing;
    win.setBounds(placement.bounds); artShift = placement.artShift; dockSide = "";
    facing = placement.visualX + size / 2 < a.x + a.width / 2 ? "left" : "right";
    if (artShift !== prevShift || dockSide !== prevDock || facing !== prevFacing) {
      publish();
    }
  }

  ipcMain.on("widget:drag-move", (e, raw) => {
    if (!trusted(e) || !drag || !win) return;
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && Math.abs(raw.x) < 100000 && Math.abs(raw.y) < 100000) {
      dragMove({ x: raw.x, y: raw.y });
    }
  });

  ipcMain.on("widget:menu-drag", (e, raw) => {
    if (!trusted(e) || !ctxWin || ctxWin.isDestroyed()) return;
    const action = raw?.action;
    if (action === "end") {
      const wasBlurred = Boolean(ctxDrag?.blurred);
      ctxDrag = null;
      if (wasBlurred && ctxWin && !ctxWin.isDestroyed() && !ctxWin.isFocused()) {
        closeContextMenu();
      }
      return;
    }
    const pt = raw?.point;
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || Math.abs(pt.x) >= 100000 || Math.abs(pt.y) >= 100000) return;
    if (action === "start") {
      ctxDrag = { mouse: { x: pt.x, y: pt.y }, bounds: ctxWin.getBounds() };
      return;
    }
    if (action === "move" && ctxDrag) {
      const area = screen.getDisplayNearestPoint(pt).workArea;
      const nx = ctxDrag.bounds.x + (pt.x - ctxDrag.mouse.x);
      const ny = ctxDrag.bounds.y + (pt.y - ctxDrag.mouse.y);
      const x = Math.round(Math.max(area.x - 8, Math.min(area.x + area.width - CTX_W + 8, nx)));
      const y = Math.round(Math.max(area.y - 6, Math.min(area.y + area.height - CTX_H + 6, ny)));
      ctxWin.setBounds({ x, y, width: CTX_W, height: CTX_H });
    }
  });

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

  app.on("second-instance", (_event, args) => {
    if (args.includes("--quit")) app.quit();
    else if (quitting) return;
    else if (args.includes("--restart-widget")) relaunchSelf();
    else if (args.includes("--open-settings")) openSettings();
    else if (!args.includes("--background")) recall();
  });
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
    if (!process.argv.includes("--no-shortcuts")) {
      try {
        tray = new Tray(appIconPath);
        tray.setToolTip(settings.get("clickThrough") ? "星语猫娘 · 鼠标穿透中（左键设置 / 右键菜单）" : "星语猫娘 · 左键设置 / 右键菜单");
        tray.on("click", () => openSettings());
        tray.on("right-click", () => openContextMenu({ nearCursor: true }));
      } catch {}
      try {
        globalShortcut.register("CommandOrControl+Alt+G", recall);
        globalShortcut.register("CommandOrControl+Alt+Shift+G", () => { apply({ clickThrough: false }); recall(); });
      } catch {}
    }
    if (process.argv.includes("--open-settings")) openSettings();
    if (settings.get("hostWindowOnly")) foreground.start(win?.getNativeWindowHandle());
    audio.setEnabled(settings.get("sound"));
    audio.setVolume(settings.get("volume"));
    audio.setPreset(settings.get("soundSet"));
    adapter.start(); quotaAdapter.start(); workingAdapter.start();
    recoveryTimer = setInterval(() => {
      if (!win || win.isDestroyed()) { show(); return; }
      if (settings.get("hostWindowOnly")) foreground.start(win.getNativeWindowHandle());
    }, 3000);
    const verifySurfaceOnce = async () => {
      if (drag || !win || win.isDestroyed() || !win.isVisible() || (settings.get("hostWindowOnly") && !hostArea)) return;
      const checked = win;
      try {
        const frame = await Promise.race([
          checked.webContents.capturePage(),
          new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("capture-timeout-stop-presenting")), 2500); timer.unref(); })
        ]);
        const sz = frame.getSize();
        const pixels = frame.toBitmap();
        let opaque = 0;
        for (let i = 3; i < pixels.length; i += 16) if (pixels[i] > 32) opaque++;
        if (opaque < 80 && win === checked && !checked.isDestroyed()) {
          recoveryLog("blank-surface-recreate opaque=" + opaque);
          checked.destroy();
          return;
        }
        // Detect alpha-channel loss ("black box" around catgirl: top-left & top-right corners turning solid black)
        if (sz.width > 40 && sz.height > 40) {
          const idxTL = (2 * sz.width + 2) * 4;
          const idxTR = (2 * sz.width + (sz.width - 3)) * 4;
          const blackTL = pixels[idxTL + 3] > 240 && (pixels[idxTL] + pixels[idxTL + 1] + pixels[idxTL + 2]) < 30;
          const blackTR = pixels[idxTR + 3] > 240 && (pixels[idxTR] + pixels[idxTR + 1] + pixels[idxTR + 2]) < 30;
          if (blackTL && blackTR && win === checked && !checked.isDestroyed()) {
            recoveryLog("black-box-alpha-loss-recreate");
            checked.destroy();
          }
        }
      } catch (error) {
        if (win === checked && !checked.isDestroyed()) {
          recoveryLog("surface-freeze-recreate " + error.message);
          checked.destroy();
        }
      }
    };
    const scheduleSurfaceVerify = (delayMs = 1200) => {
      clearTimeout(resumeCheckTimer);
      resumeCheckTimer = setTimeout(verifySurfaceOnce, delayMs);
      if (typeof resumeCheckTimer.unref === "function") resumeCheckTimer.unref();
    };
    scheduleSurfaceVerify(2500);
    const resume = () => {
      drag = null; hostLayout = null; foreground.stop(); show(); publish(true);
      if (win && !win.isDestroyed()) {
        win.webContents.invalidate();
      }
      scheduleSurfaceVerify(1200);
    };
    app.on("child-process-gone", (_e, details) => {
      if (details?.type === "GPU" && !quitting) scheduleSurfaceVerify(600);
    });
    powerMonitor.on("resume", resume); powerMonitor.on("unlock-screen", resume);
    screen.on("display-added", () => scheduleSurfaceVerify(1200));
    screen.on("display-removed", () => { reset(); scheduleSurfaceVerify(1200); });
    screen.on("display-metrics-changed", () => {
      if (settings.get("hostWindowOnly")) { syncVisibility(); publish(); }
      scheduleSurfaceVerify(1200);
    });
  });
  app.on("before-quit", () => {
    quitting = true;
    if (tray && !tray.isDestroyed()) { try { tray.destroy(); } catch {} tray = null; }
    clearTimeout(ctxIdleTimer); if (ctxWin && !ctxWin.isDestroyed()) ctxWin.destroy();
    clearTimeout(resumeCheckTimer); clearInterval(recoveryTimer); clearInterval(dragTimer);
    foreground.stop(); adapter.stop(); quotaAdapter.stop(); workingAdapter.stop(); sharedHost.drop(); sm.destroy();
    clearTimeout(saveTimer); ledger.save(); globalShortcut.unregisterAll();
  });
  app.on("window-all-closed", () => { if (quitting) app.quit(); });
}
