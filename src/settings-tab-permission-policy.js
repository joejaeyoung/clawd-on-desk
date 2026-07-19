"use strict";

// Permission Policy settings tab: global per-kind grid + directory rules list.
// Reads state.snapshot.toolPolicies; every save sends the WHOLE object
// via window.settingsAPI.update("toolPolicies", next) — the main-side validator
// normalizes it, and the permission chokepoint pulls fresh values per request.
(function initSettingsTabPermissionPolicy(root) {
  const KINDS = ["read", "edit", "exec", "network", "other"];
  const ACTIONS = ["allow", "bubble", "deny"];
  let state = null;
  let helpers = null;
  let ops = null;

  function t(key) {
    return helpers.t(key);
  }

  function snapshotPolicies() {
    const s = state && state.snapshot;
    const p = (s && s.toolPolicies) || {};
    return {
      global: Object.assign(
        { read: "bubble", edit: "bubble", exec: "bubble", network: "bubble", other: "bubble" },
        p.global || {}
      ),
      directories: Array.isArray(p.directories)
        ? p.directories.map((d) => ({ path: d.path, policies: Object.assign({}, d.policies) }))
        : [],
    };
  }

  function save(next) {
    if (!window.settingsAPI || typeof window.settingsAPI.update !== "function") return;
    window.settingsAPI.update("toolPolicies", next).then((result) => {
      if (!result || result.status !== "ok") {
        ops.showToast(t("toastSaveFailed") + ((result && result.message) || "unknown error"), { error: true });
        ops.requestRender({ content: true });
      }
    }).catch((err) => {
      ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      ops.requestRender({ content: true });
    });
  }

  function kindLabel(kind) {
    return t("permissionPolicyKind" + kind[0].toUpperCase() + kind.slice(1));
  }

  function actionSelect(current, includeInherit, onChange) {
    const sel = document.createElement("select");
    const opts = includeInherit ? ["inherit"].concat(ACTIONS) : ACTIONS;
    for (const a of opts) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = t("permissionPolicyAction" + a[0].toUpperCase() + a.slice(1));
      sel.appendChild(o);
    }
    sel.value = current;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  function buildGlobalRow(kind) {
    const row = document.createElement("div");
    row.className = "row";

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = kindLabel(kind);
    text.appendChild(label);
    row.appendChild(text);

    const control = document.createElement("div");
    control.className = "row-control";
    control.appendChild(
      actionSelect(snapshotPolicies().global[kind], false, (v) => {
        const next = snapshotPolicies();
        next.global[kind] = v;
        save(next);
      })
    );
    row.appendChild(control);
    return row;
  }

  function buildDirItem(rule, idx) {
    const item = document.createElement("div");
    item.className = "row";

    const text = document.createElement("div");
    text.className = "row-text";
    const pathLabel = document.createElement("span");
    pathLabel.className = "row-label";
    pathLabel.textContent = rule.path;
    text.appendChild(pathLabel);

    const grid = document.createElement("div");
    grid.className = "row-desc";
    for (const kind of KINDS) {
      const cell = document.createElement("span");
      cell.style.marginRight = "8px";
      cell.style.display = "inline-flex";
      cell.style.alignItems = "center";
      cell.style.gap = "4px";
      const cellLabel = document.createElement("span");
      cellLabel.textContent = kindLabel(kind) + ": ";
      cell.appendChild(cellLabel);
      cell.appendChild(
        actionSelect(rule.policies[kind] || "inherit", true, (v) => {
          const next = snapshotPolicies();
          if (v === "inherit") {
            delete next.directories[idx].policies[kind];
          } else {
            next.directories[idx].policies[kind] = v;
          }
          save(next);
        })
      );
      grid.appendChild(cell);
    }
    text.appendChild(grid);
    item.appendChild(text);

    const control = document.createElement("div");
    control.className = "row-control";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "soft-btn";
    rm.textContent = t("permissionPolicyRemoveRule");
    rm.addEventListener("click", () => {
      const next = snapshotPolicies();
      next.directories.splice(idx, 1);
      save(next);
    });
    control.appendChild(rm);
    item.appendChild(control);
    return item;
  }

  function render(parent) {
    const h1 = document.createElement("h1");
    h1.textContent = t("permissionPolicyTitle");
    parent.appendChild(h1);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("permissionPolicySubtitle");
    parent.appendChild(subtitle);

    // Global policy section
    const globalRows = KINDS.map((kind) => buildGlobalRow(kind));
    parent.appendChild(helpers.buildSection(t("permissionPolicyGlobalSection"), globalRows));

    // Directory rules section
    const pol = snapshotPolicies();
    const dirDesc = document.createElement("div");
    dirDesc.className = "row";
    const dirDescText = document.createElement("div");
    dirDescText.className = "row-text";
    const dirDescSpan = document.createElement("span");
    dirDescSpan.className = "row-desc";
    dirDescSpan.textContent = t("permissionPolicyDirDesc");
    dirDescText.appendChild(dirDescSpan);
    dirDesc.appendChild(dirDescText);

    const dirRows = [dirDesc].concat(pol.directories.map((rule, idx) => buildDirItem(rule, idx)));

    const addRow = document.createElement("div");
    addRow.className = "row";
    const addCtrl = document.createElement("div");
    addCtrl.className = "row-control";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "soft-btn accent";
    addBtn.textContent = t("permissionPolicyAddRule");
    addBtn.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") return;
      window.settingsAPI.command("settings:pick-directory", {}).then((r) => {
        if (!r || r.status !== "ok") return;
        const next = snapshotPolicies();
        next.directories.push({ path: r.path, policies: {} });
        save(next);
      }).catch(() => {});
    });
    addCtrl.appendChild(addBtn);
    addRow.appendChild(addCtrl);
    dirRows.push(addRow);

    parent.appendChild(helpers.buildSection(t("permissionPolicyDirSection"), dirRows));
  }

  function init(core) {
    state = core.state;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs["permission-policy"] = { render };
  }

  root.ClawdSettingsTabPermissionPolicy = { init };
})(globalThis);
