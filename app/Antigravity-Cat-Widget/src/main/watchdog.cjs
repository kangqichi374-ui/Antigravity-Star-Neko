const fs = require("node:fs");
const path = require("node:path");

function createSurfaceWatchdog({
  app,
  powerMonitor,
  screen,
  dataDir,
  settings,
  foreground,
  getMainWin,
  isQuitting,
  isDragging,
  hasHostArea,
  onClearDragAndLayout,
  onShow,
  onPublish,
  onReset,
  onSyncVisibility
}) {
  let recoveryTimer = null;
  let resumeCheckTimer = null;

  function recoveryLog(reason) {
    try {
      fs.appendFileSync(path.join(dataDir, "recovery.log"), new Date().toISOString() + " " + reason + "\n");
    } catch {}
  }

  async function verifySurfaceOnce() {
    const win = getMainWin();
    if (
      isDragging() ||
      !win ||
      win.isDestroyed() ||
      !win.isVisible() ||
      (settings.get("hostWindowOnly") && !hasHostArea())
    ) {
      return;
    }
    const checked = win;
    try {
      const frame = await Promise.race([
        checked.webContents.capturePage(),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(Error("capture-timeout-stop-presenting")), 2500);
          timer.unref();
        })
      ]);
      const sz = frame.getSize();
      const pixels = frame.toBitmap();
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 16) if (pixels[i] > 32) opaque++;
      if (opaque < 80 && getMainWin() === checked && !checked.isDestroyed()) {
        recoveryLog("blank-surface-recreate opaque=" + opaque);
        checked.destroy();
        return;
      }
      // Detect alpha-channel loss ("black box" around catgirl: top-left & top-right corners turning solid black)
      if (sz.width > 40 && sz.height > 40) {
        const idxTL = (2 * sz.width + 2) * 4;
        const idxTR = (2 * sz.width + (sz.width - 3)) * 4;
        const blackTL =
          pixels[idxTL + 3] > 240 && pixels[idxTL] + pixels[idxTL + 1] + pixels[idxTL + 2] < 30;
        const blackTR =
          pixels[idxTR + 3] > 240 && pixels[idxTR] + pixels[idxTR + 1] + pixels[idxTR + 2] < 30;
        if (blackTL && blackTR && getMainWin() === checked && !checked.isDestroyed()) {
          recoveryLog("black-box-alpha-loss-recreate");
          checked.destroy();
        }
      }
    } catch (error) {
      if (getMainWin() === checked && !checked.isDestroyed()) {
        recoveryLog("surface-freeze-recreate " + error.message);
        checked.destroy();
      }
    }
  }

  function scheduleSurfaceVerify(delayMs = 1200) {
    clearTimeout(resumeCheckTimer);
    resumeCheckTimer = setTimeout(verifySurfaceOnce, delayMs);
    if (typeof resumeCheckTimer.unref === "function") resumeCheckTimer.unref();
  }

  function start() {
    recoveryTimer = setInterval(() => {
      const win = getMainWin();
      if (!win || win.isDestroyed()) {
        onShow();
        return;
      }
      if (settings.get("hostWindowOnly")) foreground.start(win.getNativeWindowHandle());
    }, 3000);

    scheduleSurfaceVerify(2500);

    const resume = () => {
      onClearDragAndLayout();
      foreground.stop();
      onShow();
      onPublish(true);
      const win = getMainWin();
      if (win && !win.isDestroyed()) {
        win.webContents.invalidate();
      }
      scheduleSurfaceVerify(1200);
    };

    app.on("child-process-gone", (_e, details) => {
      if (details?.type === "GPU" && !isQuitting()) scheduleSurfaceVerify(600);
    });
    powerMonitor.on("resume", resume);
    powerMonitor.on("unlock-screen", resume);
    screen.on("display-added", () => scheduleSurfaceVerify(1200));
    screen.on("display-removed", () => {
      onReset();
      scheduleSurfaceVerify(1200);
    });
    screen.on("display-metrics-changed", () => {
      if (settings.get("hostWindowOnly")) {
        onSyncVisibility();
        onPublish();
      }
      scheduleSurfaceVerify(1200);
    });
  }

  function destroy() {
    clearTimeout(resumeCheckTimer);
    clearInterval(recoveryTimer);
  }

  return {
    recoveryLog,
    verifySurfaceOnce,
    scheduleSurfaceVerify,
    start,
    destroy
  };
}

module.exports = {
  createSurfaceWatchdog
};
