const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");

const TAIL_WINDOW_BYTES = 768 * 1024;
const DIR_RESCAN_MS = 15000;

class TranscriptAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.appDataDir = options.appDataDir || path.join(os.homedir(), ".gemini/antigravity");
    this.filePath = options.filePath || null;
    this.fileStates = new Map();
    this.notifiedWaiting = new Set();
    this.notifiedTurns = new Set();
    this.initialized = false;
    this.timer = null;
    this.dirWatcher = null;
    this.dirDirty = true;
    this.lastDirScanAt = 0;
    this.cachedFiles = [];
    this.lastStatusSig = "";
    this.pollMs = options.pollMs || 400;
  }

  _startDirWatch() {
    if (this.filePath || this.dirWatcher) return;
    const brain = path.join(this.appDataDir, "brain");
    try {
      if (fs.existsSync(brain)) {
        this.dirWatcher = fs.watch(brain, { persistent: false }, () => {
          this.dirDirty = true;
        });
        this.dirWatcher.on("error", () => {
          try { this.dirWatcher?.close(); } catch {}
          this.dirWatcher = null;
        });
      }
    } catch {}
  }

  files(forceFullDirScan = false) {
    if (this.filePath) return fs.existsSync(this.filePath) ? [this.filePath] : [];
    const now = Date.now();
    if (!forceFullDirScan && !this.dirDirty && this.cachedFiles.length > 0 && now - this.lastDirScanAt < DIR_RESCAN_MS) {
      return this.cachedFiles;
    }
    const brain = path.join(this.appDataDir, "brain");
    const found = [];
    try {
      for (const d of fs.readdirSync(brain, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const compact = path.join(brain, d.name, ".system_generated/logs/transcript.jsonl");
        const full = path.join(brain, d.name, ".system_generated/logs/transcript_full.jsonl");
        let p = compact;
        let st = null;
        try {
          st = fs.statSync(compact);
        } catch {
          p = full;
          try { st = fs.statSync(full); } catch {}
        }
        if (st && st.isFile()) {
          found.push({ p, mtime: st.mtimeMs });
        }
      }
    } catch {}
    this.cachedFiles = found.sort((a, b) => b.mtime - a.mtime).slice(0, 64).map(f => f.p);
    this.dirDirty = false;
    this.lastDirScanAt = now;
    return this.cachedFiles;
  }

  resolveTranscriptPath() {
    return this.files()[0] || null;
  }

  readChunk(file, startOffset, endOffset, dropPartialLeading) {
    const len = endOffset - startOffset;
    if (len <= 0) return { lines: [], nextOffset: endOffset };
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.allocUnsafe(len);
      const n = fs.readSync(fd, buf, 0, len, startOffset);
      if (n <= 0) return { lines: [], nextOffset: startOffset };
      // Only consume up to the last complete newline if reading live incremental tail so partial writes wait for next tick
      const lastNl = buf.subarray(0, n).lastIndexOf(10); // '\n'
      let usable = n;
      let nextOffset = startOffset + n;
      if (lastNl >= 0 && lastNl < n - 1) {
        // Check whether trailing bytes are already valid JSON (final line without trailing newline)
        const trailing = buf.subarray(lastNl + 1, n).toString("utf8").trim();
        let trailingValid = false;
        if (trailing.endsWith("}")) {
          try { JSON.parse(trailing); trailingValid = true; } catch {}
        }
        if (!trailingValid) {
          usable = lastNl + 1;
          nextOffset = startOffset + usable;
        }
      }
      const text = buf.subarray(0, usable).toString("utf8");
      const rawLines = text.split("\n");
      if (dropPartialLeading && startOffset > 0 && rawLines.length > 1) {
        rawLines.shift();
      }
      return { lines: rawLines, nextOffset };
    } finally {
      fs.closeSync(fd);
    }
  }

  scan() {
    const isFirstScan = !this.initialized;
    const didFullDirScan = isFirstScan || this.dirDirty || (Date.now() - this.lastDirScanAt >= DIR_RESCAN_MS);
    const files = this.files(didFullDirScan);
    let newest = 0, readable = files.length;

    if (didFullDirScan) {
      const active = new Set(files);
      for (const file of this.fileStates.keys()) {
        if (!active.has(file)) this.fileStates.delete(file);
      }
    }

    // On normal 400ms fast ticks, only stat the top 3 hottest conversation files instead of all 64
    const checkLimit = didFullDirScan ? files.length : Math.min(files.length, 3);

    for (let idx = 0; idx < checkLimit; idx++) {
      const file = files[idx];
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile()) continue;
        newest = Math.max(newest, stat.mtimeMs);

        let state = this.fileStates.get(file);
        const unchanged = state && state.mtimeMs === stat.mtimeMs && state.size === stat.size;
        if (unchanged) continue;

        const isNewFile = !state;
        if (!state) {
          state = {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            offset: 0,
            turnSteps: new Map(),
            lastPlanner: null,
            sawUserInput: false,
            seen: new Map()
          };
          this.fileStates.set(file, state);
        } else {
          state.mtimeMs = stat.mtimeMs;
          state.size = stat.size;
        }

        if (isFirstScan && idx >= 16) {
          state.offset = stat.size;
          continue;
        }

        // Incremental read when file strictly grew within reasonable delta; fallback to tail rescan on rewrite/shrink
        const canReadDelta =
          !isNewFile &&
          state.offset > 0 &&
          stat.size > state.offset &&
          (stat.size - state.offset) <= TAIL_WINDOW_BYTES;

        let lines;
        if (canReadDelta) {
          const chunk = this.readChunk(file, state.offset, stat.size, false);
          lines = chunk.lines;
          state.offset = chunk.nextOffset;
        } else {
          const maxTail = isNewFile ? stat.size : Math.min(stat.size, TAIL_WINDOW_BYTES);
          const start = Math.max(0, stat.size - maxTail);
          state.turnSteps = new Map();
          state.lastPlanner = null;
          state.sawUserInput = false;
          const chunk = this.readChunk(file, start, stat.size, start > 0);
          lines = chunk.lines;
          state.offset = chunk.nextOffset;
        }

        const sessionId = path.basename(path.resolve(file, "../../.."));

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed || trimmed.length > 4194304) continue;
          let s;
          try {
            s = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (!Number.isSafeInteger(s.step_index)) continue;

          if (s.type === "USER_INPUT") {
            state.turnSteps = new Map();
            state.lastPlanner = null;
            state.sawUserInput = true;
            continue;
          }

          if (s.source !== "MODEL" || s.type !== "PLANNER_RESPONSE") continue;

          const toolCalls = Array.isArray(s.tool_calls) ? s.tool_calls : [];
          const hasTools = toolCalls.length > 0;
          const hasAskQuestion = toolCalls.some(tc => {
            const name = tc?.name || tc?.function?.name || "";
            return /ask_question/i.test(String(name));
          });

          const stepData = {
            sessionId,
            step_index: s.step_index,
            created_at: s.created_at,
            status: s.status,
            source: s.source,
            type: s.type,
            input_tokens: s.input_tokens ?? null,
            cache_read_tokens: s.cache_read_tokens ?? null,
            output_tokens: s.output_tokens ?? null,
            hasTools,
            hasAskQuestion,
            historical: isFirstScan
          };

          state.turnSteps.set(s.step_index, stepData);
          state.lastPlanner = stepData;

          const signature = [s.status, s.input_tokens, s.cache_read_tokens, s.output_tokens, toolCalls.length].join("|");
          if (state.seen.get(s.step_index) === signature) continue;
          state.seen.set(s.step_index, signature);
          if (state.seen.size > 10000) state.seen.delete(state.seen.keys().next().value);

          if (!isFirstScan && hasAskQuestion) {
            const waitKey = sessionId + ":" + s.step_index;
            if (!this.notifiedWaiting.has(waitKey)) {
              this.notifiedWaiting.add(waitKey);
              this.emit("turnWaiting", { sessionId, stepIndex: s.step_index, kind: "question" });
            }
          }

          this.emit("step", stepData);
          if (s.status === "DONE") {
            this.emit("stepDone", stepData);
          } else if (s.status === "ERROR") {
            this.emit("turnError", { sessionId, stepIndex: s.step_index, historical: isFirstScan });
          } else if (s.status === "RUNNING" && !hasAskQuestion) {
            this.emit("turnRunning", { sessionId, stepIndex: s.step_index, historical: isFirstScan });
          }
        }

        const lastPlanner = state.lastPlanner;
        const isRecentFile = (Date.now() - stat.mtimeMs) < 90000;
        if (!lastPlanner && state.sawUserInput && !isFirstScan && isRecentFile) {
          this.emit("turnRunning", { sessionId, stepIndex: 0, historical: false });
        }

        if (lastPlanner) {
          const turnKey = sessionId + ":" + lastPlanner.step_index;
          const isTurnFinished =
            lastPlanner.status === "DONE" &&
            !lastPlanner.hasTools &&
            (typeof lastPlanner.input_tokens === "number" || typeof lastPlanner.output_tokens === "number");

          if (isFirstScan) {
            if (isTurnFinished) this.notifiedTurns.add(turnKey);
          } else if (isTurnFinished && !this.notifiedTurns.has(turnKey)) {
            this.notifiedTurns.add(turnKey);
            let sumIn = 0, sumOut = 0, maxCache = 0, sumCache = 0, count = 0;
            for (const st of state.turnSteps.values()) {
              if (typeof st.input_tokens === "number") sumIn += st.input_tokens;
              if (typeof st.output_tokens === "number") sumOut += st.output_tokens;
              if (typeof st.cache_read_tokens === "number") {
                sumCache += st.cache_read_tokens;
                if (st.cache_read_tokens > maxCache) maxCache = st.cache_read_tokens;
              }
              count++;
            }
            this.emit("turnComplete", {
              sessionId,
              stepIndex: lastPlanner.step_index,
              stepCount: Math.max(1, count),
              tokens: {
                input: sumIn,
                output: sumOut,
                cache: maxCache,
                cacheSum: sumCache,
                direct: sumIn + sumOut,
                total: sumIn + sumOut + maxCache
              }
            });
          } else if (!isTurnFinished && !lastPlanner.hasAskQuestion && isRecentFile && (lastPlanner.status === "RUNNING" || lastPlanner.hasTools)) {
            this.emit("turnRunning", { sessionId, stepIndex: lastPlanner.step_index, historical: false });
          }
        }

        // Keep hottest modified file at index 0 of cachedFiles so fast 3-file ticks always track active session
        if (idx > 0 && this.cachedFiles[idx] === file) {
          this.cachedFiles.splice(idx, 1);
          this.cachedFiles.unshift(file);
        }
      } catch {}
    }

    this.initialized = true;
    const online = readable > 0;
    const statusSig = `${online}|${readable}|${newest}`;
    if (statusSig !== this.lastStatusSig) {
      this.lastStatusSig = statusSig;
      this.emit("status", {
        online,
        source: "本机 Antigravity 日志",
        coverage: "最近 64 份会话 · 模型步骤",
        files: readable,
        lastUpdated: newest ? new Date(newest).toISOString() : null
      });
    }
  }

  start() {
    if (this.timer) return;
    this._startDirWatch();
    this.scan();
    this.timer = setInterval(() => this.scan(), this.pollMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.dirWatcher) {
      try { this.dirWatcher.close(); } catch {}
      this.dirWatcher = null;
    }
  }
}

module.exports = { TranscriptAdapter };
