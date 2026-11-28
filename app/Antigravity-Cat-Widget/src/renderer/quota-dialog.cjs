(() => {
  const api = window.widgetApi;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const initTheme = params.get("theme") || "crystal";
  const allowBind = params.get("allowBind") !== "0";

  document.documentElement.dataset.theme = initTheme;
  if (!allowBind) {
    $("bind-options").hidden = true;
    $("actions-bind").hidden = true;
    $("actions-simple").hidden = false;
  }

  let done = false;
  function choose(action) {
    if (done) return;
    done = true;
    if (api && typeof api.quotaDialogChoice === "function") {
      api.quotaDialogChoice(action);
    } else {
      window.close();
    }
  }

  $("btn-close").addEventListener("click", () => choose("cancel"));
  $("btn-bind").addEventListener("click", () => choose("bind"));
  $("btn-once").addEventListener("click", () => choose("once"));
  $("btn-cancel-bind").addEventListener("click", () => choose("cancel"));
  $("btn-relaunch-only").addEventListener("click", () => choose("once"));
  $("btn-cancel-simple").addEventListener("click", () => choose("cancel"));

  window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.preventDefault();
      choose("cancel");
    } else if (e.key === "Enter" && document.activeElement?.tagName !== "BUTTON") {
      e.preventDefault();
      choose(allowBind ? "bind" : "once");
    }
  });
  window.addEventListener("contextmenu", e => e.preventDefault());

  if (api && typeof api.subscribe === "function") {
    api.subscribe(snap => {
      const theme = snap?.settings?.bubbleTheme;
      if (theme) document.documentElement.dataset.theme = theme;
    });
  }
  if (api && typeof api.get === "function") {
    api.get().then(snap => {
      const theme = snap?.settings?.bubbleTheme;
      if (theme) document.documentElement.dataset.theme = theme;
    }).catch(() => {});
  }
})();
