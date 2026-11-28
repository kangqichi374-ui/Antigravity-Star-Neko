const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("widgetApi", {
  get: () => ipcRenderer.invoke("widget:get"),
  save: v => ipcRenderer.invoke("widget:settings", v),
  command: v => ipcRenderer.send("widget:command", v),
  pointer: v => ipcRenderer.invoke("widget:pointer", v),
  dragMove: p => ipcRenderer.send("widget:drag-move", p),
  menuDrag: v => ipcRenderer.send("widget:menu-drag", v),
  hit: v => ipcRenderer.send("widget:hit", v),
  audio: v => ipcRenderer.invoke("widget:audio", v),
  importAudio: () => ipcRenderer.invoke("widget:import-audio"),
  quotaDialogChoice: v => ipcRenderer.send("widget:quota-dialog-result", v),
  subscribe: callback => {
    const h = (_e, data) => callback(data);
    ipcRenderer.on("widget:snapshot", h);
    return () => ipcRenderer.removeListener("widget:snapshot", h);
  },
  onStep: callback => {
    const h = (_e, data) => callback(data);
    ipcRenderer.on("widget:step", h);
    return () => ipcRenderer.removeListener("widget:step", h);
  },
  onWaiting: callback => {
    const h = (_e, data) => callback(data);
    ipcRenderer.on("widget:waiting", h);
    return () => ipcRenderer.removeListener("widget:waiting", h);
  },
  onReaction: callback => {
    const h = () => callback();
    ipcRenderer.on("widget:reaction", h);
    return () => ipcRenderer.removeListener("widget:reaction", h);
  },
  onPetted: callback => {
    const h = (_e, data) => callback(data);
    ipcRenderer.on("widget:petted", h);
    return () => ipcRenderer.removeListener("widget:petted", h);
  },
  onSideButton: callback => {
    const h = (_e, data) => callback(data);
    ipcRenderer.on("widget:side-button", h);
    return () => ipcRenderer.removeListener("widget:side-button", h);
  },
  onVisibility: callback => {
    const h = (_e, visible) => callback(visible);
    ipcRenderer.on("widget:visibility", h);
    return () => ipcRenderer.removeListener("widget:visibility", h);
  },
  onOpenQuota: callback => {
    const h = () => callback();
    ipcRenderer.on("widget:open-quota", h);
    return () => ipcRenderer.removeListener("widget:open-quota", h);
  }
});
