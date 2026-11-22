const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");

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
    this.pollMs = options.pollMs || 400;
  }

  files() {
    if (this.filePath) return fs.existsSync(this.filePath) ? [this.filePath] : [];
    const brain = path.join(this.appDataDir, "brain");
    let files = [];
    try {
      for (const d of fs.readdirSync(brain, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const compact = path.join(brain, d.name, ".system_generated/logs/transcript.jsonl");
        const full = path.join(brain, d.name, ".system_generated/logs/transcript_full.jsonl");
        const p = fs.existsSync(compact) ? compact : full;
        try {
          files.push({ p, mtime: fs.statSync(p).mtimeMs });
        } catch {}
      }
    } catch {}
    return files.sort((a, b) => b.mtime - a.mtime).slice(0, 64).map(f => f.p);
  }

  resolveTranscriptPath() {
    return this.files()[0] || null;
  }

  readLines(file, stat, fullScan) {
    const maxTail = fullScan ? stat.size : Math.min(stat.size, 768 * 1024);
    const start = Math.max(0, stat.size - maxTail);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(stat.size - start);
      const n = fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.subarray(0, n).toString("utf8");
      const rawLines = text.split("\n");
      if (start > 0 && rawLines.length > 1) {
        rawLines.shift();
      }
      return rawLines;
    } finally {
      fs.closeSync(fd);
    }
  }

  scan() {
    const isFirstScan = !this.initialized;
    const files = this.files();
    let newest = 0, readable = 0;
    const active = new Set(files);
    for (const file of this.fileStates.keys()) {
      if (!active.has(file)) this.fileStates.delete(file);
    }

    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile()) continue;
        readable++;
        newest = Math.max(newest, stat.mtimeMs);

        let state = this.fileStates.get(file);
        const unchanged = state && state.mtimeMs === stat.mtimeMs && state.size === stat.size;
        if (unchanged) continue;

        const isNewFile = !state;
        if (!state) {
          state = { mtimeMs: stat.mtimeMs, size: stat.size, seen: new Map() };
          this.fileStates.set(file, state);
        } else {
          state.mtimeMs = stat.mtimeMs;
          state.size = stat.size;
        }

        // Only parse full history on initial scan for recent files, or tail for live updates
        if (isFirstScan && idx >= 16) continue;
        const lines = this.readLines(file, stat, isNewFile);
        const sessionId = path.basename(path.resolve(file, "../../.."));

        let currentTurnSteps = new Map();
        let lastPlanner = null;
        let sawUserInput = false;

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
            currentTurnSteps = new Map();
            lastPlanner = null;
            sawUserInput = true;
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

          currentTurnSteps.set(s.step_index, stepData);
          lastPlanner = stepData;

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

        const isRecentFile = (Date.now() - stat.mtimeMs) < 90000;
        if (!lastPlanner && sawUserInput && !isFirstScan && isRecentFile) {
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
            for (const st of currentTurnSteps.values()) {
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
      } catch {}
    }

    this.initialized = true;
    this.emit("status", {
      online: readable > 0,
      source: "本机 Antigravity 日志",
      coverage: "最近 64 份会话 · 模型步骤",
      files: readable,
      lastUpdated: newest ? new Date(newest).toISOString() : null
    });
  }

  start() {
    if (this.timer) return;
    this.scan();
    this.timer = setInterval(() => this.scan(), this.pollMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { TranscriptAdapter };
