function themeBgColor(theme) {
  return (
    {
      crystal: "#f7f5fc",
      sakura: "#fdf5f8",
      ocean: "#f3f7fd",
      night: "#171429"
    }[theme] || "#f7f5fc"
  );
}

function createSettingsAndTrayController({
  BrowserWindow,
  Tray,
  globalShortcut,
  appIconPath,
  preloadPath,
  settingsHtmlPath,
  settings,
  onApply,
  onOpenContextMenu,
  onRecall
}) {
  let panel = null;
  let tray = null;

  function openSettings() {
    if (panel && !panel.isDestroyed()) {
      panel.show();
      panel.focus();
      return;
    }
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
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    panel.loadFile(settingsHtmlPath);
    panel.on("closed", () => {
      panel = null;
    });
  }

  function syncThemeColor(theme) {
    if (panel && !panel.isDestroyed()) {
      try {
        panel.setBackgroundColor(themeBgColor(theme));
      } catch {}
    }
  }

  function updateTrayTooltip() {
    if (tray && !tray.isDestroyed()) {
      try {
        tray.setToolTip(
          settings.get("clickThrough")
            ? "星语猫娘 · 鼠标穿透中（左键设置 / 右键菜单）"
            : "星语猫娘 · 左键设置 / 右键菜单"
        );
      } catch {}
    }
  }

  function initTrayAndShortcuts(noShortcuts = false) {
    if (noShortcuts) return;
    try {
      tray = new Tray(appIconPath);
      updateTrayTooltip();
      tray.on("click", () => openSettings());
      tray.on("right-click", () => onOpenContextMenu({ nearCursor: true }));
    } catch {}
    try {
      globalShortcut.register("CommandOrControl+Alt+G", onRecall);
      globalShortcut.register("CommandOrControl+Alt+Shift+G", () => {
        onApply({ clickThrough: false });
        onRecall();
      });
    } catch {}
  }

  function destroy() {
    if (tray && !tray.isDestroyed()) {
      try {
        tray.destroy();
      } catch {}
      tray = null;
    }
    globalShortcut.unregisterAll();
  }

  return {
    openSettings,
    syncThemeColor,
    updateTrayTooltip,
    initTrayAndShortcuts,
    getPanel: () => panel,
    destroy
  };
}

module.exports = {
  themeBgColor,
  createSettingsAndTrayController
};
