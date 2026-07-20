"use strict";

// Permission Policy settings tab: global per-kind grid + directory rules list.
// Reads state.snapshot.toolPolicies; every save sends the WHOLE object
// via window.settingsAPI.update("toolPolicies", next) — the main-side validator
// normalizes it, and the permission chokepoint pulls fresh values per request.
//
// Roundtrip note: the raw picker path is stored as-is, but on app restart the
// prefs load normalizes each path via realpath, so the displayed string may
// differ from what was picked. Decision semantics are identical either way.
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

  // Segmented button group matching the Codex permission-mode control in
  // settings-tab-agents.js: reuses the shared .segmented / .active styles so the
  // tab stays visually consistent with the rest of Settings (no native <select>).
  function actionSegmented(current, includeInherit, onChange) {
    const seg = document.createElement("div");
    seg.className = "segmented";
    seg.setAttribute("role", "tablist");
    const opts = includeInherit ? ["inherit"].concat(ACTIONS) : ACTIONS;
    for (const a of opts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.dataset.action = a;
      btn.textContent = t("permissionPolicyAction" + a[0].toUpperCase() + a.slice(1));
      const isActive = current === a;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.addEventListener("click", () => {
        if (btn.classList.contains("active")) return;
        onChange(a);
      });
      seg.appendChild(btn);
    }
    return seg;
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
      actionSegmented(snapshotPolicies().global[kind], false, (v) => {
        const next = snapshotPolicies();
        next.global[kind] = v;
        save(next);
      })
    );
    row.appendChild(control);
    return row;
  }

  // One directory rule renders as a header row (path + Remove) followed by one
  // sub-row per kind (kind label + segmented), mirroring the row/row-sub layout
  // agents.js uses. Returns an array of rows for the section to flatten.
  function buildDirItem(rule, idx) {
    const header = document.createElement("div");
    header.className = "row";

    const headerText = document.createElement("div");
    headerText.className = "row-text";
    const pathLabel = document.createElement("span");
    pathLabel.className = "row-label";
    pathLabel.textContent = rule.path;
    headerText.appendChild(pathLabel);
    header.appendChild(headerText);

    const headerControl = document.createElement("div");
    headerControl.className = "row-control";
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "soft-btn";
    rm.textContent = t("permissionPolicyRemoveRule");
    rm.addEventListener("click", () => {
      const next = snapshotPolicies();
      next.directories.splice(idx, 1);
      save(next);
    });
    headerControl.appendChild(rm);
    header.appendChild(headerControl);

    const kindRows = KINDS.map((kind) => {
      const sub = document.createElement("div");
      sub.className = "row row-sub";

      const text = document.createElement("div");
      text.className = "row-text";
      const label = document.createElement("span");
      label.className = "row-label";
      label.textContent = kindLabel(kind);
      text.appendChild(label);
      sub.appendChild(text);

      const control = document.createElement("div");
      control.className = "row-control";
      control.appendChild(
        actionSegmented(rule.policies[kind] || "inherit", true, (v) => {
          const next = snapshotPolicies();
          if (v === "inherit") {
            delete next.directories[idx].policies[kind];
          } else {
            next.directories[idx].policies[kind] = v;
          }
          save(next);
        })
      );
      sub.appendChild(control);
      return sub;
    });

    return [header].concat(kindRows);
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

    const dirRows = [dirDesc].concat(
      pol.directories.reduce((rows, rule, idx) => rows.concat(buildDirItem(rule, idx)), [])
    );

    const addRow = document.createElement("div");
    addRow.className = "row";
    const addCtrl = document.createElement("div");
    addCtrl.className = "row-control";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "soft-btn accent";
    addBtn.textContent = t("permissionPolicyAddRule");
    addBtn.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.pickDirectory !== "function") return;
      window.settingsAPI.pickDirectory().then((r) => {
        if (!r || r.status === "cancel") return;
        if (r.status === "error") {
          ops.showToast(t("toastSaveFailed") + (r.message || "unknown error"), { error: true });
          return;
        }
        if (r.status !== "ok") return;
        const next = snapshotPolicies();
        // FX3: silently skip duplicate directory paths
        if (next.directories.some((d) => d.path === r.path)) return;
        next.directories.push({ path: r.path, policies: {} });
        save(next);
      }).catch((err) => {
        ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      });
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
