const CTX_W = 264;
const CTX_H = 472;

function createContextMenuController({
  BrowserWindow,
  screen,
  contextMenuPlacement,
  appIconPath,
  preloadPath,
  menuHtmlPath,
  getMainWin,
  getPanel,
  getSnapshot,
  getLayoutMetrics,
  onPublish
}) {
  let ctxWin = null;
  let ctxIdleTimer = null;
  let ctxDrag = null;

  function closeContextMenu() {
    ctxDrag = null;
    if (!ctxWin || ctxWin.isDestroyed()) return;
    if (ctxWin.isVisible()) ctxWin.hide();
    clearTimeout(ctxIdleTimer);
    ctxIdleTimer = setTimeout(() => {
      if (ctxWin && !ctxWin.isDestroyed() && !ctxWin.isVisible()) {
        ctxWin.destroy();
        ctxWin = null;
        const panel = getPanel();
        if (panel && !panel.isDestroyed()) onPublish();
      }
    }, 12000);
    if (typeof ctxIdleTimer.unref === "function") ctxIdleTimer.unref();
  }

  function openContextMenu(opts = {}) {
    clearTimeout(ctxIdleTimer);
    ctxDrag = null;
    const pt = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(pt).workArea;
    const win = getMainWin();
    const { displayScale, scale, artShift, dockSide } = getLayoutMetrics();

    let charRect = null;
    if (!opts.nearCursor && win && !win.isDestroyed() && win.isVisible()) {
      const wb = win.getBounds();
      const size = displayScale || scale;
      const charH = Math.round((size * 1146) / 1372);
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
      ctxWin.webContents.send("widget:snapshot", getSnapshot(false));
      ctxWin.show();
      ctxWin.focus();
      return;
    }

    ctxWin = new BrowserWindow({
      x,
      y,
      width: CTX_W,
      height: CTX_H,
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
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    ctxWin.loadFile(menuHtmlPath);
    ctxWin.once("ready-to-show", () => {
      if (ctxWin && !ctxWin.isDestroyed()) {
        ctxWin.show();
        ctxWin.focus();
        const panel = getPanel();
        if (panel && !panel.isDestroyed()) onPublish();
      }
    });
    ctxWin.on("blur", () => {
      if (ctxDrag) {
        ctxDrag.blurred = true;
        return;
      }
      closeContextMenu();
    });
    ctxWin.on("closed", () => {
      clearTimeout(ctxIdleTimer);
      ctxDrag = null;
      ctxWin = null;
    });
  }

  function handleMenuDrag(raw) {
    if (!ctxWin || ctxWin.isDestroyed()) return;
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
    if (
      !pt ||
      !Number.isFinite(pt.x) ||
      !Number.isFinite(pt.y) ||
      Math.abs(pt.x) >= 100000 ||
      Math.abs(pt.y) >= 100000
    ) {
      return;
    }
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
  }

  function destroy() {
    clearTimeout(ctxIdleTimer);
    ctxDrag = null;
    if (ctxWin && !ctxWin.isDestroyed()) ctxWin.destroy();
    ctxWin = null;
  }

  return {
    openContextMenu,
    closeContextMenu,
    handleMenuDrag,
    getWindow: () => ctxWin,
    destroy
  };
}

module.exports = {
  CTX_W,
  CTX_H,
  createContextMenuController
};
