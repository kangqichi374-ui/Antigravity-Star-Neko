const { EventEmitter } = require("node:events");
const { discover, Cdp, sharedHost } = require("../../../shared/host.cjs");

function readHostWorking() {
  const els = document.querySelectorAll(
    '[data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-cancel-tooltip"]'
  );
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && !e.disabled) return true;
  }
  return false;
}

const EVAL_EXPR = "(" + readHostWorking.toString() + ")()";

class HostWorkingAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.useShared = !options.discover && !options.Client;
    this.shared = options.shared || sharedHost;
    this.discover = options.discover || discover;
    this.Client = options.Client || Cdp;
    this.activePollMs = options.pollMs || 500;
    this.backgroundPollMs = options.backgroundPollMs || 1500;
    this.retryMs = options.retryMs || 3000;
    this.hostVisible = true;
    this.active = false;
    this.connected = false;
    this.working = false;
    this.client = null;
    this.timer = null;
    this.busy = false;
  }

  setHostVisible(visible) {
    const next = visible !== false;
    if (this.hostVisible === next) return;
    this.hostVisible = next;
    if (this.active && next && !this.busy) {
      this._schedule(80);
    }
  }

  _currentPollMs() {
    return (this.hostVisible || this.working) ? this.activePollMs : this.backgroundPollMs;
  }

  _update(connected, working) {
    if (this.connected === connected && this.working === working) return;
    this.connected = connected;
    this.working = working;
    this.emit("change", { connected, working });
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._schedule(150);
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.client) {
      try { this.client.close(); } catch {}
      this.client = null;
    }
    this._update(false, false);
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    if (!this.active) return;
    this.timer = setTimeout(() => this._tick(), ms);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  async _tick() {
    if (!this.active || this.busy) return;
    this.busy = true;
    try {
      let isWorking;
      if (this.useShared) {
        isWorking = Boolean(await this.shared.evaluate(EVAL_EXPR));
      } else {
        if (!this.client || this.client.closed) {
          this.client = null;
          const host = await this.discover();
          if (!this.active) return;
          if (!host?.target?.webSocketDebuggerUrl) {
            this._update(false, false);
            this._schedule(this.retryMs);
            return;
          }
          this.client = new this.Client(host.target.webSocketDebuggerUrl, { handshakeTimeout: 2500 });
          await this.client.ready;
          if (!this.active) {
            this.client.close();
            this.client = null;
            return;
          }
        }
        isWorking = Boolean(await this.client.evaluate(EVAL_EXPR));
      }
      if (!this.active) return;
      this._update(true, isWorking);
      this._schedule(this._currentPollMs());
    } catch {
      if (this.client) {
        try { this.client.close(); } catch {}
        this.client = null;
      }
      this._update(false, false);
      this._schedule(this.retryMs);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { HostWorkingAdapter, readHostWorking };
