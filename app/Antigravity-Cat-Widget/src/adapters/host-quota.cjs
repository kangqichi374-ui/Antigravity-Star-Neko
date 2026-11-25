const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { discover, Cdp, sharedHost } = require("../../../shared/host.cjs");
const { readJson, writeJson } = require("../../../shared/storage.cjs");

// Read only quota fields from the native IDE cache or Desktop Models view cache.
function readHostQuota() {
  const result = { fiveHour: null, weekly: null, fetchedAt: null };
  const groups =
    typeof nY !== "undefined" && Array.isArray(nY)
      ? nY
      : typeof pY !== "undefined" && Array.isArray(pY)
      ? pY
      : [];
  let group = groups.find(g => g && g.displayName === "Gemini Models");
  if (!group && typeof document !== "undefined") {
    const seen = new Set();
    for (const el of document.querySelectorAll("[role=dialog] *")) {
      let fiber = el[Object.keys(el).find(k => k.startsWith("__reactFiber$"))];
      for (let i = 0; fiber && i < 40; fiber = fiber.return, i++) {
        if (seen.has(fiber)) break;
        seen.add(fiber);
        for (let state = fiber.memoizedState, j = 0; state && j < 80; state = state.next, j++) {
          if (Array.isArray(state.memoizedState)) {
            group = state.memoizedState.find(g => g && g.displayName === "Gemini Models") || group;
          }
        }
      }
      if (group) break;
    }
  }
  if (!group) return result;
  result.cacheAvailable = true;
  for (const b of group.buckets || []) {
    const key = b.bucketId === "gemini-5h" ? "fiveHour" : b.bucketId === "gemini-weekly" ? "weekly" : null;
    const value = b.remaining?.case === "remainingFraction" ? b.remaining.value : null;
    if (key && !b.disabled && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
      result[key] = value * 100;
    }
  }
  const timestamp =
    typeof nY !== "undefined" && Array.isArray(nY) && typeof mFb === "number"
      ? mFb
      : typeof jFb === "number"
      ? jFb
      : null;
  if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() + 60000) {
    result.fetchedAt = timestamp;
  }
  return result;
}

// Uses cached cloudCodeService reference first to avoid full-DOM Fiber traversal every poll.
async function queryHostQuota(readCache) {
  const parseResponse = response => {
    const group = response?.response?.groups?.find(g => g?.displayName === "Gemini Models");
    if (!group) return null;
    const result = { cacheAvailable: true, fiveHour: null, weekly: null, fetchedAt: Date.now() };
    for (const bucket of group.buckets || []) {
      const key =
        bucket.bucketId === "gemini-5h"
          ? "fiveHour"
          : bucket.bucketId === "gemini-weekly"
          ? "weekly"
          : null;
      const value = bucket.remaining?.case === "remainingFraction" ? bucket.remaining.value : null;
      if (
        key &&
        !bucket.disabled &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
      ) {
        result[key] = value * 100;
      }
    }
    return result;
  };

  if (typeof window !== "undefined" && window.__agyStarQuotaSvc) {
    const cachedSvc = typeof window.__agyStarQuotaSvc.deref === "function"
      ? window.__agyStarQuotaSvc.deref()
      : window.__agyStarQuotaSvc;
    if (typeof cachedSvc?.retrieveUserQuotaSummary === "function") {
      try {
        const parsed = parseResponse(await cachedSvc.retrieveUserQuotaSummary(undefined, false));
        if (parsed) return parsed;
      } catch {}
    }
    window.__agyStarQuotaSvc = null;
  }

  const seen = new Set();
  if (typeof document !== "undefined") {
    for (const el of document.querySelectorAll("body *")) {
      let fiber = el[Object.keys(el).find(k => k.startsWith("__reactFiber$"))];
      for (; fiber && !seen.has(fiber); fiber = fiber.return) {
        seen.add(fiber);
        const service = fiber.memoizedProps?.value?.core?.cloudCodeService;
        if (typeof service?.retrieveUserQuotaSummary !== "function") continue;
        try {
          if (typeof window !== "undefined") {
            window.__agyStarQuotaSvc = typeof WeakRef === "function" ? new WeakRef(service) : service;
          }
          const parsed = parseResponse(await service.retrieveUserQuotaSummary(undefined, false));
          if (parsed) return parsed;
        } catch {}
        break;
      }
    }
  }
  return readCache();
}

const FAST_QUOTA_EXPR = "(" + readHostQuota.toString() + ")()";
const QUERY_QUOTA_EXPR = "(" + queryHostQuota.toString() + ")(" + readHostQuota.toString() + ")";

class HostQuotaAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.useShared = !options.discover && !options.Client;
    this.shared = options.shared || sharedHost;
    this.discover = options.discover || discover;
    this.Client = options.Client || Cdp;
    this.now = options.now || Date.now;
    this.cachePath = options.cachePath || path.join(os.homedir(), ".antigravity-cat-widget/quota-cache.json");
    const saved = readJson(this.cachePath, null);
    const hasSaved =
      saved &&
      (typeof saved.fiveHour === "number" || typeof saved.weekly === "number");
    this.snapshot = {
      status: hasSaved ? "ready" : "waiting-host",
      fiveHour: typeof saved?.fiveHour === "number" ? saved.fiveHour : null,
      weekly: typeof saved?.weekly === "number" ? saved.weekly : null,
      fetchedAt: saved?.fetchedAt || null,
      observedAt: saved?.observedAt || null,
      cached: Boolean(hasSaved),
      stale: false,
      online: Boolean(hasSaved),
      cdpConnected: false,
      cdpMissing: false
    };
    this.sampleAt = saved?.observedAt || null;
    this.active = false;
    this.failures = 0;
    this.generation = 0;
    this.pendingRefresh = false;
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.generation++;
    this.failures = 0;
    this.tick();
  }

  async _evalHost(expr, ownClient) {
    if (this.useShared) return this.shared.evaluate(expr);
    return ownClient.evaluate(expr);
  }

  async tick() {
    if (this.busy || !this.active) {
      if (this.busy && this.active) this.pendingRefresh = true;
      return;
    }
    this.busy = true;
    this.pendingRefresh = false;
    this.clearTimer(this.timer);
    const generation = this.generation;
    let c, ready = false, hostConnected = false;
    const current = () => this.active && generation === this.generation;

    try {
      if (this.useShared) {
        const sharedClient = await this.shared.getClient();
        if (!current()) return;
        if (!sharedClient) {
          this.snapshot = { ...this.snapshot, status: this.snapshot.fiveHour !== null || this.snapshot.weekly !== null ? "ready" : "waiting-host", cdpConnected: false, cdpMissing: true };
          throw new Error("offline");
        }
        hostConnected = true;
        this.hostIdentity = this.shared.wsUrl;
      } else {
        const host = await this.discover();
        if (!current()) return;
        if (!host) {
          this.snapshot = { ...this.snapshot, status: this.snapshot.fiveHour !== null || this.snapshot.weekly !== null ? "ready" : "waiting-host", cdpConnected: false, cdpMissing: true };
          throw new Error("offline");
        }
        hostConnected = true;
        this.hostIdentity = host.target.webSocketDebuggerUrl;
        c = new this.Client(host.target.webSocketDebuggerUrl);
        this.client = c;
      }

      if (this.snapshot.fiveHour === null && this.snapshot.weekly === null) {
        try {
          const fastSample = await this._evalHost(FAST_QUOTA_EXPR, c);
          if (current() && fastSample?.cacheAvailable) {
            const fastReady = [fastSample.fiveHour, fastSample.weekly].some(
              v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100
            );
            if (fastReady) {
              this.sampleAt = this.now();
              this.snapshot = {
                status: "ready",
                fiveHour: typeof fastSample.fiveHour === "number" ? fastSample.fiveHour : this.snapshot.fiveHour,
                weekly: typeof fastSample.weekly === "number" ? fastSample.weekly : this.snapshot.weekly,
                cached: false,
                stale: false,
                observedAt: this.sampleAt,
                fetchedAt: fastSample.fetchedAt || this.sampleAt,
                online: true,
                cdpConnected: true,
                cdpMissing: false
              };
              this.emit("change", this.snapshot);
            }
          }
        } catch {}
      }

      const sample = await this._evalHost(QUERY_QUOTA_EXPR, c);
      if (!current()) return;
      if (!sample?.cacheAvailable) {
        if (this.sampleAt !== null && this.sampleAt !== undefined) {
          this.snapshot = { ...this.snapshot, online: true, cached: false, stale: false, cdpConnected: true, cdpMissing: false };
        } else {
          this.snapshot = { ...this.snapshot, online: true, status: "unsupported-or-initializing", cdpConnected: true, cdpMissing: false };
        }
        return;
      }
      ready = [sample.fiveHour, sample.weekly].some(
        v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100
      );
      if (ready) {
        this.sampleAt = this.now();
        const nextFive =
          typeof sample.fiveHour === "number" && sample.fiveHour >= 0 && sample.fiveHour <= 100
            ? sample.fiveHour
            : this.snapshot.fiveHour;
        const nextWeek =
          typeof sample.weekly === "number" && sample.weekly >= 0 && sample.weekly <= 100
            ? sample.weekly
            : this.snapshot.weekly;
        this.snapshot = {
          status: "ready",
          fiveHour: nextFive,
          weekly: nextWeek,
          cached: false,
          stale: false,
          observedAt: this.sampleAt,
          fetchedAt: typeof sample.fetchedAt === "number" ? sample.fetchedAt : this.sampleAt,
          online: true,
          cdpConnected: true,
          cdpMissing: false
        };
        try {
          writeJson(this.cachePath, {
            fiveHour: nextFive,
            weekly: nextWeek,
            observedAt: this.sampleAt,
            fetchedAt: this.snapshot.fetchedAt
          });
        } catch {}
      }
    } catch {
      if (current()) {
        this.snapshot = {
          ...this.snapshot,
          status: this.snapshot.fiveHour !== null || this.snapshot.weekly !== null ? "ready" : "query-failed",
          cached: Boolean(this.snapshot.fiveHour !== null || this.snapshot.weekly !== null),
          stale: false,
          cdpConnected: hostConnected,
          cdpMissing: !hostConnected
        };
      }
    } finally {
      c?.close();
      this.client = null;
      this.busy = false;
      if (current()) {
        this.failures = ready ? 0 : Math.min(this.failures + 1, 4);
        this.emit("change", this.snapshot);
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.timer = this.setTimer(() => this.tick(), 50);
        } else {
          this.timer = this.setTimer(
            () => this.tick(),
            ready ? 20000 : Math.min(15000, 2000 * 2 ** Math.max(0, this.failures - 1))
          );
        }
      } else if (this.active) {
        this.timer = this.setTimer(() => this.tick(), 0);
      }
    }
  }

  async openNativeQuota() {
    return this.tick();
  }

  stop() {
    this.active = false;
    this.generation++;
    this.clearTimer(this.timer);
    this.client?.close();
  }
}

module.exports = { HostQuotaAdapter, readHostQuota, queryHostQuota };
