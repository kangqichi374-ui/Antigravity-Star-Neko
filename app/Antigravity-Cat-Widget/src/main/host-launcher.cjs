const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function createHostLauncher({
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
  quotaDialogHtmlPath,
  getMainWin,
  getPanel,
  closeContextMenu,
  isQuitting,
  setQuitting,
  onApply,
  rootMainDir
}) {
  let quotaDialogWin = null;
  function findHelperExe() {
    const appPath = app.getAppPath();
    let realAppPath = appPath;
    try {
      realAppPath = fs.realpathSync(appPath);
    } catch {}
    const candidates = [
      path.resolve(realAppPath, "../LaunchAntigravityWithWidget.exe"),
      path.resolve(rootMainDir, "../../../../LaunchAntigravityWithWidget.exe"),
      path.resolve(appPath, "../LaunchAntigravityWithWidget.exe"),
      path.join(path.dirname(process.execPath), "LaunchAntigravityWithWidget.exe")
    ];
    return (
      candidates.find(p => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      }) || null
    );
  }

  function relaunchSelf() {
    if (isQuitting()) return;
    setQuitting(true);
    const appPath = app.getAppPath();
    let realAppPath = appPath;
    try {
      realAppPath = fs.realpathSync(appPath);
    } catch {}
    const cleanArgs = process.argv
      .slice(1)
      .filter(
        a =>
          a !== "--software-render" &&
          a !== "--disable-gpu" &&
          a !== "--force-gpu" &&
          a !== "--open-settings" &&
          a !== "--restart-widget"
      );

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
        const argArrayExpr = cleanArgs.length ? "@(" + cleanArgs.map(psQuote).join(",") + ")" : "@()";
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

  function showThemedQuotaDialog(owner, allowBind) {
    if (!BrowserWindow || !ipcMain || !quotaDialogHtmlPath) return null;
    if (quotaDialogWin && !quotaDialogWin.isDestroyed()) {
      quotaDialogWin.show();
      quotaDialogWin.focus();
      return Promise.resolve("cancel");
    }
    return new Promise(resolve => {
      const width = 496;
      const height = allowBind ? 448 : 306;
      let x;
      let y;
      try {
        if (owner && !owner.isDestroyed() && owner.isVisible()) {
          const ob = owner.getBounds();
          x = Math.round(ob.x + (ob.width - width) / 2);
          y = Math.round(ob.y + (ob.height - height) / 2);
        } else if (screen) {
          const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
          x = Math.round(area.x + (area.width - width) / 2);
          y = Math.round(area.y + (area.height - height) / 2);
        }
      } catch {}

      const dlg = new BrowserWindow({
        width,
        height,
        ...(Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { center: true }),
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: false,
        alwaysOnTop: true,
        show: false,
        icon: appIconPath,
        title: "开启实时额度",
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      quotaDialogWin = dlg;

      let settled = false;
      const finish = action => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener("widget:quota-dialog-result", onChoice);
        if (quotaDialogWin === dlg) quotaDialogWin = null;
        if (!dlg.isDestroyed()) dlg.close();
        resolve(action);
      };

      const onChoice = (e, action) => {
        if (dlg.isDestroyed() || e.sender !== dlg.webContents) return;
        if (action === "bind" || action === "once" || action === "cancel") {
          finish(action);
        }
      };

      ipcMain.on("widget:quota-dialog-result", onChoice);
      dlg.on("closed", () => finish("cancel"));
      dlg.once("ready-to-show", () => {
        if (!dlg.isDestroyed()) {
          dlg.show();
          dlg.focus();
        }
      });

      const theme = settings.get("bubbleTheme") || "crystal";
      dlg.loadFile(quotaDialogHtmlPath, {
        query: { theme, allowBind: allowBind ? "1" : "0" }
      }).catch(() => finish("cancel"));
    });
  }

  async function enableLiveQuota() {
    closeContextMenu();
    try {
      const liveClient = await sharedHost.getClient();
      if (liveClient) {
        if (!settings.get("bubbleOn")) onApply({ bubbleOn: true });
        quotaAdapter.openNativeQuota().catch(() => {});
        const win = getMainWin();
        if (win && !win.isDestroyed()) win.webContents.send("widget:open-quota");
        return;
      }
    } catch {}

    const panel = getPanel();
    const owner = panel && !panel.isDestroyed() && panel.isVisible() ? panel : undefined;
    const allowBind = !process.argv.includes("--no-shortcuts");

    let action = "cancel";
    const themedPromise = showThemedQuotaDialog(owner, allowBind);
    if (themedPromise) {
      action = await themedPromise;
    } else {
      const buttons = allowBind ? ["重开并设为默认伴随启动（推荐）", "仅本次重开", "取消"] : ["立即重开", "取消"];
      const cancelId = buttons.length - 1;
      const choice = await dialog.showMessageBox(owner, {
        type: "question",
        title: "开启实时额度",
        message: "需要重新打开 Antigravity 以开启实时额度读取",
        detail: allowBind
          ? "请先确认当前对话已回复完毕并保存文件（绝不强杀进程；若 Antigravity 开启了「后台运行」并缩进右下角托盘，按提示右键托盘退出后将自动重开）。\n\n· 重开并设为默认伴随启动（推荐）：自动更新桌面/开始菜单快捷方式（保留 Antigravity 原图标），以后每次打开都会自动开启实时额度并拉起猫娘。\n· 仅本次重开：只为当前这一次开启端口。"
          : "请先确认当前对话已回复完毕并保存文件（绝不强杀进程；若 Antigravity 开启了「后台运行」并缩进右下角托盘，按提示右键托盘退出后将自动重开）。点击「立即重开」后将自动带额度端口重启并恢复桌宠连接。",
        buttons,
        defaultId: 0,
        cancelId,
        noLink: true
      });
      if (choice.response === cancelId) return;
      action = allowBind && choice.response === 0 ? "bind" : "once";
    }

    if (action !== "bind" && action !== "once") return;
    const bindShortcuts = allowBind && action === "bind";

    let realAppPath = app.getAppPath();
    try {
      realAppPath = fs.realpathSync(realAppPath);
    } catch {}
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

  function destroy() {
    if (quotaDialogWin && !quotaDialogWin.isDestroyed()) {
      quotaDialogWin.destroy();
    }
    quotaDialogWin = null;
  }

  return {
    findHelperExe,
    relaunchSelf,
    enableLiveQuota,
    getDialogWindow: () => quotaDialogWin,
    destroy
  };
}

module.exports = {
  createHostLauncher
};
