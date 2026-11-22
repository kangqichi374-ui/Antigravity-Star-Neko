(async () => {
  const api = window.widgetApi, $ = id => document.getElementById(id);
  let data = await api.get(), active = null, generation = 0;

  function populateSelect(selectEl, items) {
    const prev = selectEl.value;
    selectEl.innerHTML = "";
    for (const item of items || []) {
      const o = document.createElement("option");
      o.value = item.id;
      o.textContent = item.label;
      selectEl.append(o);
    }
    if (prev) selectEl.value = prev;
  }

  function refreshSoundLists() {
    populateSelect($("soundSet"), data.presets);
    populateSelect($("turnDoneSoundId"), data.eventSounds);
    populateSelect($("waitingSoundId"), data.eventSounds);
  }

  refreshSoundLists();

  const keys = [
    "hostWindowOnly", "easterEggs", "scale", "alwaysOnTop", "snap", "reducedMotion", "clickThrough",
    "bubbleTheme", "facingMode", "autoBlink", "hideHoverTools",
    "bubbleOn", "bubbleAutoHideMs",
    "turnCostOn", "turnCostDurationMs", "customLinesMode", "customLines",
    "sound", "soundSet", "volume",
    "turnDoneSound", "turnDoneSoundId", "turnDoneVolume",
    "waitingAlertOn", "waitingSound", "waitingSoundId", "waitingVolume",
    "wheelAction",
    "manualQuota", "manualPercent", "manualWeeklyPercent"
  ];

  const volumeKeys = new Set(["volume", "turnDoneVolume", "waitingVolume"]);
  const numericSelectKeys = new Set(["turnCostDurationMs", "bubbleAutoHideMs"]);

  const original = Object.fromEntries(keys.map(key => [key, data.settings[key]]));
  let pending = Promise.resolve();

  function save(partial, message = "已保存") {
    pending = pending.then(async () => {
      try {
        data = await api.save(partial);
        stop();
        refreshSoundLists();
        render();
        $("saved").textContent = message;
      } catch {
        $("saved").textContent = "保存失败，请重试";
      }
    });
    return pending;
  }

  function render() {
    const q = data.quotaWindows || {};
    const labels = {
      ready: "后台额度已读取",
      querying: "正在后台读取额度",
      "waiting-host": "等待宿主连接，将自动重试",
      "unsupported-or-initializing": "宿主初始化中或接口不兼容，将自动重试",
      "quota-unavailable": "宿主未返回额度",
      "query-failed": "额度查询失败，将自动重试"
    };
    $("quota-status").textContent = (labels[q.status] || "等待后台额度") + (q.stale ? " · 旧值待更新" : "");

    for (const key of keys) {
      const el = $(key);
      if (!el || document.activeElement === el) continue;
      if (el.type === "checkbox") {
        el.checked = Boolean(data.settings[key]);
      } else if (volumeKeys.has(key)) {
        el.value = Math.round((data.settings[key] ?? 0.5) * 100);
      } else {
        el.value = data.settings[key] ?? "";
      }
    }

    $("scale-value").textContent = data.settings.scale + " px";
    $("volume-value").textContent = Math.round((data.settings.volume ?? 0.35) * 100) + "%";
    $("turnDoneVolume-value").textContent = Math.round((data.settings.turnDoneVolume ?? 0.5) * 100) + "%";
    $("waitingVolume-value").textContent = Math.round((data.settings.waitingVolume ?? 0.6) * 100) + "%";
    $("source").textContent = (data.source.online ? "已找到 " + data.source.files + " 份日志" : "未检测到会话日志") + " · 本机只读";
    $("audio-note").textContent = data.settings.sound ? "点击音效已启用" : "点击音效已静音";
  }

  function stop() {
    generation++;
    active?.pause();
    active = null;
  }

  for (const key of keys) {
    const el = $(key);
    if (!el) continue;
    const evt = el.type === "range" ? "input" : "change";
    el.addEventListener(evt, () => {
      let v;
      if (el.type === "checkbox") {
        v = el.checked;
      } else if (el.type === "range" || el.type === "number" || numericSelectKeys.has(key)) {
        v = el.value === "" ? null : Number(el.value);
      } else {
        v = el.value;
      }
      save({ [key]: volumeKeys.has(key) ? v / 100 : v });
    });
  }

  $("preview-reaction").onclick = () => api.command("preview-reaction");
  $("undo").onclick = () => save(original, "已恢复到打开设置时");
  $("dock-left").onclick = () => api.command("dock-left");
  $("dock-right").onclick = () => api.command("dock-right");
  $("reset").onclick = () => api.command("reset");
  $("quota-refresh").onclick = () => api.command("quota-refresh");
  $("refresh").onclick = () => api.command("refresh");

  $("audition").onclick = async () => {
    stop();
    const token = generation;
    const vol = Math.max(0.1, data.settings.volume || 0.35);
    const first = await api.audio({ kind: "press", id: data.settings.soundSet, volume: vol, force: true });
    if (!first || token !== generation) return;
    active = new Audio(first.url);
    active.volume = first.effectiveVolume;
    active.onended = async () => {
      const second = await api.audio({ kind: "release", id: data.settings.soundSet, volume: vol, force: true });
      if (second && token === generation) {
        active = new Audio(second.url);
        active.volume = second.effectiveVolume;
        active.play().catch(() => {});
      }
    };
    active.play().catch(() => {
      $("audio-note").textContent = "播放未成功";
    });
  };

  $("audition-done").onclick = async () => {
    stop();
    const token = generation;
    const vol = Math.max(0.1, data.settings.turnDoneVolume || 0.5);
    const payload = await api.audio({ kind: "event", id: data.settings.turnDoneSoundId, volume: vol, force: true });
    if (!payload || token !== generation) return;
    active = new Audio(payload.url);
    active.volume = payload.effectiveVolume;
    active.play().catch(() => {});
  };

  $("audition-waiting").onclick = async () => {
    stop();
    const token = generation;
    const vol = Math.max(0.1, data.settings.waitingVolume || 0.6);
    const payload = await api.audio({ kind: "event", id: data.settings.waitingSoundId, volume: vol, force: true });
    if (!payload || token !== generation) return;
    active = new Audio(payload.url);
    active.volume = payload.effectiveVolume;
    active.play().catch(() => {});
  };

  $("import-audio").onclick = async () => {
    const res = await api.importAudio();
    if (!res || !res.importedId) return;
    data = res.snapshot;
    refreshSoundLists();
    await save(
      {
        soundSet: res.importedId,
        turnDoneSoundId: res.importedId,
        waitingSoundId: res.importedId
      },
      "已导入并选用自定义音效"
    );
  };

  api.subscribe(next => {
    if (
      next.settings.sound !== data.settings.sound ||
      next.settings.volume !== data.settings.volume ||
      next.settings.soundSet !== data.settings.soundSet
    ) {
      stop();
    }
    data = next;
    refreshSoundLists();
    render();
  });

  window.addEventListener("beforeunload", stop);
  render();
})();
