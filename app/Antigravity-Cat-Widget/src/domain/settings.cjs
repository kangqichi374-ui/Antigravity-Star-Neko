const path = require("node:path");
const os = require("node:os");
const { readJson, writeJson, finite, bool } = require("../../../shared/storage.cjs");

const DEFAULT_SETTINGS = {
  x: null,
  y: null,
  scale: 220,
  alwaysOnTop: true,
  reducedMotion: false,
  sound: false,
  volume: 0.35,
  soundSet: "bubble-pop",
  bubbleOn: true,
  turnCostOn: true,
  turnCostDurationMs: 5000,
  clickThrough: false,
  snap: true,
  hostWindowOnly: true,
  hostOffsetX: 18,
  hostOffsetY: 18,
  hostDock: "",
  easterEggs: true,
  characterPack: "gemini-star-v1",
  currency: "CNY",
  bubblePage: "quota",
  manualQuota: false,
  manualPercent: null,
  manualWeeklyPercent: null,

  // 1. 外观与视觉定制
  bubbleTheme: "crystal",
  facingMode: "auto",
  autoBlink: true,
  hideHoverTools: false,

  // 2. 气泡与台词定制
  bubbleAutoHideMs: 6500,
  pageQuota: true,
  pageTalk: true,
  pageToday: true,
  pageLatest: true,
  customLines: "",
  customLinesMode: "append",

  // 3. 状态联动与事件音效定制
  turnDoneSound: false,
  turnDoneSoundId: "bubble-done",
  turnDoneVolume: 0.5,
  waitingAlertOn: true,
  waitingSound: false,
  waitingSoundId: "chirp-alert",
  waitingVolume: 0.6,

  // 4. 鼠标交互定制
  clickAction: "default",
  doubleClickAction: "pet",
  wheelAction: "page"
};

const ALLOWED_SCALES = [140, 180, 220, 260, 300];
const ALLOWED_SOUND_SETS = ["bubble-pop", "soft-spring", "original", "wood-tap"];
const ALLOWED_EVENT_SOUNDS = ["bubble-done", "soft-chime", "chirp-alert", "wood-notify", "release"];
const ALLOWED_THEMES = ["crystal", "sakura", "ocean", "night"];
const ALLOWED_FACING = ["auto", "left", "right"];
const ALLOWED_CLICK = ["default", "cycle", "talk", "toggle"];
const ALLOWED_DBLCLICK = ["pet", "settings", "talk", "quota", "none"];
const ALLOWED_WHEEL = ["page", "scale", "none"];
const ALLOWED_LINES_MODE = ["append", "only"];

class SettingsManager {
  constructor(file = path.join(os.homedir(), ".antigravity-cat-widget/settings.json")) {
    this.filePath = file;
    this.data = this.sanitize(readJson(file, DEFAULT_SETTINGS));
  }

  sanitize(input) {
    const s = { ...DEFAULT_SETTINGS, ...input };
    const boolKeys = [
      "alwaysOnTop", "reducedMotion", "sound", "bubbleOn", "turnCostOn",
      "clickThrough", "snap", "hostWindowOnly", "easterEggs", "manualQuota",
      "autoBlink", "hideHoverTools", "pageQuota", "pageTalk", "pageToday",
      "pageLatest", "turnDoneSound", "waitingAlertOn", "waitingSound"
    ];
    for (const k of boolKeys) {
      s[k] = bool(s[k], DEFAULT_SETTINGS[k]);
    }
    s.hostWindowOnly = true;
    if (!s.pageQuota && !s.pageTalk && !s.pageToday && !s.pageLatest) {
      s.pageQuota = true;
    }
    for (const k of ["hostOffsetX", "hostOffsetY"]) {
      s[k] = finite(s[k], 18, 0, 100000);
    }
    s.hostDock = ["left", "right", ""].includes(s.hostDock) ? s.hostDock : "";
    s.scale = finite(s.scale, 220, 140, 360);
    s.volume = finite(s.volume, 0.35, 0, 1);
    s.turnDoneVolume = finite(s.turnDoneVolume, 0.5, 0, 1);
    s.waitingVolume = finite(s.waitingVolume, 0.6, 0, 1);
    for (const k of ["x", "y"]) {
      s[k] = typeof s[k] === "number" && Number.isFinite(s[k]) ? Math.round(s[k]) : null;
    }
    s.soundSet = typeof s.soundSet === "string" && (ALLOWED_SOUND_SETS.includes(s.soundSet) || s.soundSet.startsWith("custom:"))
      ? s.soundSet
      : "bubble-pop";
    s.turnDoneSoundId = typeof s.turnDoneSoundId === "string" && (ALLOWED_EVENT_SOUNDS.includes(s.turnDoneSoundId) || s.turnDoneSoundId.startsWith("custom:"))
      ? s.turnDoneSoundId
      : "bubble-done";
    s.waitingSoundId = typeof s.waitingSoundId === "string" && (ALLOWED_EVENT_SOUNDS.includes(s.waitingSoundId) || s.waitingSoundId.startsWith("custom:"))
      ? s.waitingSoundId
      : "chirp-alert";
    s.turnCostDurationMs = finite(s.turnCostDurationMs, 5000, 0, 60000);
    s.bubbleAutoHideMs = finite(s.bubbleAutoHideMs, 6500, 0, 60000);
    s.bubblePage = ["quota", "today", "latest", "talk"].includes(s.bubblePage) ? s.bubblePage : "quota";
    s.bubbleTheme = ALLOWED_THEMES.includes(s.bubbleTheme) ? s.bubbleTheme : "crystal";
    s.facingMode = ALLOWED_FACING.includes(s.facingMode) ? s.facingMode : "auto";
    s.clickAction = ALLOWED_CLICK.includes(s.clickAction) ? s.clickAction : "default";
    s.doubleClickAction = ALLOWED_DBLCLICK.includes(s.doubleClickAction) ? s.doubleClickAction : "pet";
    s.wheelAction = ALLOWED_WHEEL.includes(s.wheelAction) ? s.wheelAction : "page";
    s.customLinesMode = ALLOWED_LINES_MODE.includes(s.customLinesMode) ? s.customLinesMode : "append";
    s.customLines = typeof s.customLines === "string" ? s.customLines.slice(0, 10000) : "";
    s.manualWeeklyPercent = finite(s.manualWeeklyPercent, null, 0, 100);
    s.manualPercent = finite(s.manualPercent, null, 0, 100);
    return s;
  }

  save() {
    writeJson(this.filePath, this.data);
    return true;
  }

  update(partial) {
    this.data = this.sanitize({ ...this.data, ...partial });
    this.save();
    return this.getAll();
  }

  get(k) {
    return this.data[k];
  }

  getAll() {
    return { ...this.data };
  }
}

module.exports = {
  SettingsManager,
  DEFAULT_SETTINGS,
  ALLOWED_SCALES,
  ALLOWED_SOUND_SETS
};
