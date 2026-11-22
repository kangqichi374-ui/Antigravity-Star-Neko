const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

class AudioManager {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(__dirname, "../..");
    this.audioBaseDir = path.join(this.rootDir, "assets/audio/codex-maid-widget");
    this.manifestPath = path.join(this.audioBaseDir, "manifest.json");
    this.customAudioDir = options.customAudioDir || path.join(os.homedir(), ".antigravity-cat-widget/custom-audio");
    this.manifest = this._loadManifest();

    this.enabled = Boolean(options.enabled ?? this.manifest.defaultEnabled ?? false);
    this.volume = Number(options.volume ?? this.manifest.defaultVolume ?? 0.35);
    this.currentPreset = options.preset || this.manifest.defaultPreset || "bubble-pop";
  }

  _loadManifest() {
    try {
      if (fs.existsSync(this.manifestPath)) {
        return JSON.parse(fs.readFileSync(this.manifestPath, "utf8"));
      }
    } catch (err) {
      console.warn("[AudioManager] Failed to load audio manifest:", err.message);
    }
    return { presets: [], eventSounds: [], defaultPreset: "bubble-pop", defaultEnabled: false };
  }

  _listCustomFiles() {
    try {
      if (!fs.existsSync(this.customAudioDir)) return [];
      return fs.readdirSync(this.customAudioDir)
        .filter(f => /\.(wav|mp3|ogg|m4a)$/i.test(f))
        .map(f => ({
          id: "custom:" + f,
          label: "自定义 · " + f.replace(/\.[^.]+$/, ""),
          filePath: path.join(this.customAudioDir, f),
          gain: 0.85
        }));
    } catch {
      return [];
    }
  }

  getPresetList() {
    const base = (this.manifest.presets || []).map(p => ({
      id: p.id,
      label: p.label,
      gain: p.gain
    }));
    const custom = this._listCustomFiles().map(c => ({
      id: c.id,
      label: c.label,
      gain: c.gain
    }));
    return [...base, ...custom];
  }

  getEventSoundList() {
    const base = (this.manifest.eventSounds || []).map(e => ({
      id: e.id,
      label: e.label,
      gain: e.gain
    }));
    const custom = this._listCustomFiles().map(c => ({
      id: c.id,
      label: c.label,
      gain: c.gain
    }));
    return [...base, ...custom];
  }

  importCustomAudio(sourcePath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const ext = path.extname(sourcePath).toLowerCase();
    if (![".wav", ".mp3", ".ogg", ".m4a"].includes(ext)) return null;
    fs.mkdirSync(this.customAudioDir, { recursive: true });
    const baseName = path.basename(sourcePath).replace(/[^\w.\-\u4e00-\u9fa5 ]/g, "_");
    const destPath = path.join(this.customAudioDir, baseName);
    fs.copyFileSync(sourcePath, destPath);
    return "custom:" + baseName;
  }

  getAudioFile(type = "press", presetId = null, overrideVolume = null, forceEnable = false) {
    if (!forceEnable && !this.enabled && type !== "event") return null;

    const baseVol = typeof overrideVolume === "number" ? overrideVolume : this.volume;
    const targetId = presetId || this.currentPreset;

    if (typeof targetId === "string" && targetId.startsWith("custom:")) {
      const fileName = path.basename(targetId.slice(7));
      const absPath = path.join(this.customAudioDir, fileName);
      if (!fs.existsSync(absPath)) return null;
      return {
        filePath: absPath,
        url: pathToFileURL(absPath).href,
        gain: 0.85,
        effectiveVolume: Math.max(0, Math.min(1, baseVol * 0.85))
      };
    }

    if (type === "event") {
      const ev = (this.manifest.eventSounds || []).find(e => e.id === targetId);
      if (!ev) return null;
      if (ev.file === "@release") {
        return this.getAudioFile("release", this.currentPreset, baseVol, true);
      }
      const absPath = path.join(this.audioBaseDir, ev.file);
      if (!fs.existsSync(absPath)) return null;
      return {
        filePath: absPath,
        url: pathToFileURL(absPath).href,
        gain: ev.gain ?? 0.85,
        effectiveVolume: Math.max(0, Math.min(1, baseVol * (ev.gain ?? 0.85)))
      };
    }

    const preset = (this.manifest.presets || []).find(p => p.id === targetId);
    if (!preset) return null;

    const relFile = type === "release" ? preset.release : preset.press;
    if (!relFile) return null;

    const absPath = path.join(this.audioBaseDir, relFile);
    if (!fs.existsSync(absPath)) return null;

    return {
      filePath: absPath,
      url: pathToFileURL(absPath).href,
      gain: preset.gain ?? 1.0,
      effectiveVolume: Math.max(0, Math.min(1, baseVol * (preset.gain ?? 1.0)))
    };
  }

  setPreset(id) {
    if (typeof id === "string" && id.startsWith("custom:")) {
      this.currentPreset = id;
      return true;
    }
    const exists = (this.manifest.presets || []).some(p => p.id === id);
    if (exists) {
      this.currentPreset = id;
      return true;
    }
    return false;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) || 0));
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }
}

module.exports = { AudioManager };
