(() => {
  "use strict";

  // ⚠️ Remplace cette URL par celle de ton Worker Cloudflare une fois déployé,
  // ex: "https://ice-cream-survival.ton-compte.workers.dev"
  const WORKER_URL = "https://icstracker.refugeemeraudien-direction.workers.dev";
  const API = `${WORKER_URL}/api`;
  const TOKEN_KEY = "ics_token";

  let state = { categories: [] };
  let openSubs = new Set(JSON.parse(localStorage.getItem("ics_open_subs") || "[]"));

  const els = {
    categories: document.getElementById("categories"),
    overallFill: document.getElementById("overallFill"),
    overallCount: document.getElementById("overallCount"),
    overallMarker: document.getElementById("overallMarker"),
    unlockBtn: document.getElementById("unlockBtn"),
    unlockIcon: document.getElementById("unlockIcon"),
    unlockLabel: document.getElementById("unlockLabel"),
    addCategoryRow: document.getElementById("addCategoryRow"),
    addCategoryBtn: document.getElementById("addCategoryBtn"),
    statsFooter: document.getElementById("statsFooter"),
    toast: document.getElementById("toast"),
  };

  const FLAVORS = [
    { key: "blueberry", label: "Myrtille" },
    { key: "cherry", label: "Cerise" },
    { key: "pistachio", label: "Pistache" },
    { key: "lemon", label: "Citron" },
  ];

  // ---------------- Auth helpers ----------------

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }
  function isEditMode() { return !!getToken(); }

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  // ---------------- API ----------------

  async function apiGet() {
    const res = await fetch(`${API}/quests`);
    if (!res.ok) throw new Error("Impossible de charger les quêtes.");
    return res.json();
  }

  async function apiCall(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) {
      clearToken();
      renderUnlockButton();
      throw new Error("Session expirée, entre à nouveau le code.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Une erreur est survenue.");
    return data;
  }

  async function login(code) {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Code invalide.");
    setToken(data.token);
  }

  // ---------------- Toast ----------------

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
  }

  // ---------------- Modal ----------------

  const modal = {
    overlay: document.getElementById("modalOverlay"),
    title: document.getElementById("modalTitle"),
    desc: document.getElementById("modalDesc"),
    body: document.getElementById("modalBody"),
    cancel: document.getElementById("modalCancel"),
    confirm: document.getElementById("modalConfirm"),
    error: document.getElementById("modalError"),
  };

  function closeModal() {
    modal.overlay.hidden = true;
    modal.body.innerHTML = "";
    modal.error.hidden = true;
  }
  modal.cancel.addEventListener("click", closeModal);
  modal.overlay.addEventListener("click", (e) => { if (e.target === modal.overlay) closeModal(); });

  function openTextModal({ title, desc, placeholder = "", value = "", confirmLabel = "Valider", onConfirm }) {
    modal.title.textContent = title;
    if (desc) { modal.desc.textContent = desc; modal.desc.hidden = false; } else { modal.desc.hidden = true; }
    modal.body.innerHTML = `<input type="text" id="modalInput" placeholder="${placeholder}" autocomplete="off" />`;
    modal.confirm.textContent = confirmLabel;
    modal.error.hidden = true;
    modal.overlay.hidden = false;
    const input = document.getElementById("modalInput");
    input.value = value;
    setTimeout(() => input.focus(), 30);

    const submit = async () => {
      const v = input.value.trim();
      if (!v) { showModalError("Ce champ ne peut pas être vide."); return; }
      try {
        modal.confirm.disabled = true;
        await onConfirm(v);
        closeModal();
      } catch (e) {
        showModalError(e.message);
      } finally {
        modal.confirm.disabled = false;
      }
    };
    modal.confirm.onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  function openLoginModal() {
    modal.title.textContent = "Débloquer le mode édition";
    modal.desc.textContent = "Entre le code secret pour ajouter, modifier, supprimer et cocher les objectifs.";
    modal.desc.hidden = false;
    modal.body.innerHTML = `<input type="password" id="modalInput" placeholder="Code secret" autocomplete="off" />`;
    modal.confirm.textContent = "Débloquer";
    modal.error.hidden = true;
    modal.overlay.hidden = false;
    const input = document.getElementById("modalInput");
    setTimeout(() => input.focus(), 30);

    const submit = async () => {
      const v = input.value.trim();
      if (!v) { showModalError("Entre un code."); return; }
      try {
        modal.confirm.disabled = true;
        await login(v);
        closeModal();
        renderUnlockButton();
        toast("Mode édition débloqué 🍨");
        render();
      } catch (e) {
        showModalError(e.message);
      } finally {
        modal.confirm.disabled = false;
      }
    };
    modal.confirm.onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  function openConfirmModal({ title, desc, confirmLabel = "Supprimer", onConfirm }) {
    modal.title.textContent = title;
    modal.desc.textContent = desc || "";
    modal.desc.hidden = !desc;
    modal.body.innerHTML = "";
    modal.confirm.textContent = confirmLabel;
    modal.confirm.className = "btn btn-danger";
    modal.error.hidden = true;
    modal.overlay.hidden = false;

    const submit = async () => {
      try {
        modal.confirm.disabled = true;
        await onConfirm();
        closeModal();
      } catch (e) {
        showModalError(e.message);
      } finally {
        modal.confirm.disabled = false;
        modal.confirm.className = "btn btn-primary";
      }
    };
    modal.confirm.onclick = submit;
  }

  function openCategoryModal({ title, name = "", icon = "🍨", color = "blueberry", onConfirm }) {
    modal.title.textContent = title;
    modal.desc.hidden = true;
    modal.body.innerHTML = `
      <input type="text" id="modalInput" placeholder="Nom de la catégorie" autocomplete="off" />
      <input type="text" id="modalIcon" placeholder="Emoji (ex: 🧭)" autocomplete="off" style="margin-top:8px;" maxlength="4" />
      <div class="modal-flavor-row" id="flavorRow"></div>
    `;
    modal.confirm.textContent = "Valider";
    modal.error.hidden = true;
    modal.overlay.hidden = false;

    const input = document.getElementById("modalInput");
    const iconInput = document.getElementById("modalIcon");
    input.value = name;
    iconInput.value = icon;
    let selectedColor = color;
    const flavorRow = document.getElementById("flavorRow");
    FLAVORS.forEach((f) => {
      const sw = document.createElement("div");
      sw.className = "modal-flavor-swatch" + (f.key === selectedColor ? " selected" : "");
      sw.style.background = `var(--${f.key})`;
      sw.title = f.label;
      sw.addEventListener("click", () => {
        selectedColor = f.key;
        [...flavorRow.children].forEach((c) => c.classList.remove("selected"));
        sw.classList.add("selected");
      });
      flavorRow.appendChild(sw);
    });
    setTimeout(() => input.focus(), 30);

    const submit = async () => {
      const v = input.value.trim();
      if (!v) { showModalError("Le nom est requis."); return; }
      try {
        modal.confirm.disabled = true;
        await onConfirm({ name: v, icon: iconInput.value.trim() || "🍨", color: selectedColor });
        closeModal();
      } catch (e) {
        showModalError(e.message);
      } finally {
        modal.confirm.disabled = false;
      }
    };
    modal.confirm.onclick = submit;
  }

  function showModalError(msg) {
    modal.error.textContent = msg;
    modal.error.hidden = false;
  }

  // ---------------- Rendering ----------------

  function renderUnlockButton() {
    if (isEditMode()) {
      els.unlockIcon.textContent = "🔓";
      els.unlockLabel.textContent = "Mode édition actif";
      els.unlockBtn.classList.add("unlocked");
      els.addCategoryRow.hidden = false;
    } else {
      els.unlockIcon.textContent = "🔒";
      els.unlockLabel.textContent = "Mode édition";
      els.unlockBtn.classList.remove("unlocked");
      els.addCategoryRow.hidden = true;
    }
  }

  function questLeafStats(quest) {
    if (quest.subs.length > 0) {
      const done = quest.subs.filter((s) => s.completed).length;
      return { done, total: quest.subs.length };
    }
    return { done: quest.completed ? 1 : 0, total: 1 };
  }

  function categoryStats(cat) {
    let done = 0, total = 0;
    cat.quests.forEach((q) => {
      const s = questLeafStats(q);
      done += s.done; total += s.total;
    });
    return { done, total };
  }

  function overallStats() {
    let done = 0, total = 0;
    state.categories.forEach((c) => {
      const s = categoryStats(c);
      done += s.done; total += s.total;
    });
    return { done, total };
  }

  function pct(done, total) {
    return total === 0 ? 0 : Math.round((done / total) * 100);
  }

  function render() {
    const { done, total } = overallStats();
    const p = pct(done, total);
    els.overallFill.style.width = `${p}%`;
    els.overallCount.textContent = `${done} / ${total} scoops`;
    els.overallMarker.style.left = `calc(${p}% - 12px)`;
    els.statsFooter.textContent = total > 0 ? `${p}% de l'aventure complétée` : "";

    els.categories.innerHTML = "";
    if (state.categories.length === 0) {
      els.categories.innerHTML = `<p class="empty-note">Aucune catégorie pour l'instant.</p>`;
    }
    state.categories.forEach((cat) => els.categories.appendChild(renderCategory(cat)));
    renderUnlockButton();
  }

  function renderCategory(cat) {
    const wrap = document.createElement("section");
    wrap.className = `category flavor-${cat.color || "blueberry"}`;

    const stats = categoryStats(cat);
    const p = pct(stats.done, stats.total);

    const head = document.createElement("div");
    head.className = "category-head";
    head.innerHTML = `
      <div class="category-icon">${escapeHtml(cat.icon || "🍨")}</div>
      <div class="category-name-row">
        <span class="category-name">${escapeHtml(cat.name)}</span>
      </div>
      <div class="category-progress">
        <div class="scoopbar">
          <div class="scoopbar-track"><div class="scoopbar-fill" style="width:${p}%"></div></div>
        </div>
      </div>
      <div class="category-count">${stats.done}/${stats.total}</div>
      <div class="category-actions"></div>
    `;

    if (isEditMode()) {
      const actions = head.querySelector(".category-actions");
      actions.appendChild(iconButton("✏️", "Renommer la catégorie", () => {
        openCategoryModal({
          title: "Modifier la catégorie",
          name: cat.name, icon: cat.icon, color: cat.color,
          onConfirm: async ({ name, icon, color }) => {
            state = await apiCall(`/categories/${cat.id}`, { method: "PUT", body: JSON.stringify({ name, icon, color }) });
            render();
          },
        });
      }));
      actions.appendChild(iconButton("🗑️", "Supprimer la catégorie", () => {
        openConfirmModal({
          title: `Supprimer "${cat.name}" ?`,
          desc: "Toutes les quêtes de cette catégorie seront supprimées aussi.",
          onConfirm: async () => {
            state = await apiCall(`/categories/${cat.id}`, { method: "DELETE" });
            render();
            toast("Catégorie supprimée.");
          },
        });
      }, true));
    }

    wrap.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "quest-grid";
    cat.quests.forEach((q) => grid.appendChild(renderQuestCard(cat, q)));

    if (isEditMode()) {
      const addBtn = document.createElement("button");
      addBtn.className = "add-quest-card";
      addBtn.textContent = "＋ Nouvelle quête";
      addBtn.addEventListener("click", () => {
        openTextModal({
          title: "Nouvelle quête",
          placeholder: "Nom de la quête",
          confirmLabel: "Ajouter",
          onConfirm: async (name) => {
            state = await apiCall(`/categories/${cat.id}/quests`, { method: "POST", body: JSON.stringify({ name }) });
            render();
          },
        });
      });
      grid.appendChild(addBtn);
    } else if (cat.quests.length === 0) {
      grid.innerHTML = `<p class="empty-note">Aucune quête ici.</p>`;
    }

    wrap.appendChild(grid);
    return wrap;
  }

  function renderQuestCard(cat, quest) {
    const card = document.createElement("article");
    const stats = questLeafStats(quest);
    const complete = quest.subs.length > 0 ? stats.done === stats.total && stats.total > 0 : quest.completed;
    card.className = "quest-card" + (complete ? " is-complete" : "");

    const head = document.createElement("div");
    head.className = "quest-head";

    if (quest.subs.length === 0) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "quest-check";
      cb.checked = quest.completed;
      cb.disabled = !isEditMode();
      cb.title = isEditMode() ? "Cocher / décocher" : "Débloque le mode édition pour cocher";
      cb.addEventListener("change", async () => {
        try {
          state = await apiCall(`/toggle/quest/${quest.id}`, { method: "POST" });
          render();
        } catch (e) { toast(e.message); render(); }
      });
      head.appendChild(cb);
    } else {
      const spacer = document.createElement("div");
      spacer.style.width = "24px";
      head.appendChild(spacer);
    }

    const nameWrap = document.createElement("div");
    nameWrap.className = "quest-name-wrap";
    const nameEl = document.createElement("div");
    nameEl.className = "quest-name";
    nameEl.textContent = quest.name;
    nameWrap.appendChild(nameEl);

    if (quest.subs.length > 0) {
      const p = pct(stats.done, stats.total);
      const isOpen = openSubs.has(quest.id);
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "quest-toggle-subs" + (isOpen ? " open" : "");
      toggleBtn.innerHTML = `<span class="chev">▸</span> ${stats.done}/${stats.total} sous-objectifs`;
      toggleBtn.addEventListener("click", () => {
        if (openSubs.has(quest.id)) openSubs.delete(quest.id); else openSubs.add(quest.id);
        localStorage.setItem("ics_open_subs", JSON.stringify([...openSubs]));
        render();
      });
      nameWrap.appendChild(toggleBtn);

      const progressWrap = document.createElement("div");
      progressWrap.className = "quest-progress";
      progressWrap.innerHTML = `<div class="scoopbar"><div class="scoopbar-track"><div class="scoopbar-fill" style="width:${p}%"></div></div></div>`;
      nameWrap.appendChild(progressWrap);
    }

    head.appendChild(nameWrap);

    if (isEditMode()) {
      const actions = document.createElement("div");
      actions.className = "quest-edit-actions";
      actions.appendChild(iconButton("✏️", "Renommer", () => {
        openTextModal({
          title: "Renommer la quête",
          value: quest.name,
          confirmLabel: "Enregistrer",
          onConfirm: async (name) => {
            state = await apiCall(`/quests/${quest.id}`, { method: "PUT", body: JSON.stringify({ name }) });
            render();
          },
        });
      }));
      actions.appendChild(iconButton("🗑️", "Supprimer", () => {
        openConfirmModal({
          title: `Supprimer "${quest.name}" ?`,
          onConfirm: async () => {
            state = await apiCall(`/quests/${quest.id}`, { method: "DELETE" });
            render();
            toast("Quête supprimée.");
          },
        });
      }, true));
      head.appendChild(actions);
    }

    card.appendChild(head);

    if (quest.subs.length > 0) {
      const list = document.createElement("ul");
      list.className = "sub-list";
      list.hidden = !openSubs.has(quest.id);
      quest.subs.forEach((s) => list.appendChild(renderSubItem(quest, s)));
      card.appendChild(list);

      if (isEditMode() && !list.hidden) {
        const row = document.createElement("div");
        row.className = "add-sub-row";
        const btn = document.createElement("button");
        btn.className = "add-inline-btn";
        btn.textContent = "＋ Sous-objectif";
        btn.addEventListener("click", () => {
          openTextModal({
            title: "Nouveau sous-objectif",
            placeholder: "Nom du sous-objectif",
            confirmLabel: "Ajouter",
            onConfirm: async (name) => {
              state = await apiCall(`/quests/${quest.id}/subs`, { method: "POST", body: JSON.stringify({ name }) });
              openSubs.add(quest.id);
              render();
            },
          });
        });
        row.appendChild(btn);
        card.appendChild(row);
      }
    }

    return card;
  }

  function renderSubItem(quest, sub) {
    const li = document.createElement("li");
    li.className = "sub-item" + (sub.completed ? " is-complete" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "sub-check";
    cb.checked = sub.completed;
    cb.disabled = !isEditMode();
    cb.addEventListener("change", async () => {
      try {
        state = await apiCall(`/toggle/sub/${sub.id}`, { method: "POST" });
        openSubs.add(quest.id);
        render();
      } catch (e) { toast(e.message); render(); }
    });
    li.appendChild(cb);

    const name = document.createElement("span");
    name.className = "sub-name";
    name.textContent = sub.name;
    li.appendChild(name);

    if (isEditMode()) {
      const actions = document.createElement("div");
      actions.className = "sub-edit-actions";
      actions.appendChild(iconButton("✏️", "Renommer", () => {
        openTextModal({
          title: "Renommer le sous-objectif",
          value: sub.name,
          confirmLabel: "Enregistrer",
          onConfirm: async (name) => {
            state = await apiCall(`/subs/${sub.id}`, { method: "PUT", body: JSON.stringify({ name }) });
            openSubs.add(quest.id);
            render();
          },
        });
      }, false, true));
      actions.appendChild(iconButton("🗑️", "Supprimer", () => {
        openConfirmModal({
          title: `Supprimer "${sub.name}" ?`,
          onConfirm: async () => {
            state = await apiCall(`/subs/${sub.id}`, { method: "DELETE" });
            openSubs.add(quest.id);
            render();
            toast("Sous-objectif supprimé.");
          },
        });
      }, true, true));
      li.appendChild(actions);
    }

    return li;
  }

  function iconButton(icon, label, onClick, danger = false, small = false) {
    const btn = document.createElement("button");
    btn.className = "btn-icon" + (danger ? " danger" : "");
    btn.style.fontSize = small ? "12px" : "";
    btn.style.width = small ? "24px" : "";
    btn.style.height = small ? "24px" : "";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.textContent = icon;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------- Wiring ----------------

  els.unlockBtn.addEventListener("click", () => {
    if (isEditMode()) {
      openConfirmModal({
        title: "Verrouiller le mode édition ?",
        desc: "Tu devras entrer le code à nouveau pour modifier les quêtes.",
        confirmLabel: "Verrouiller",
        onConfirm: async () => {
          clearToken();
          renderUnlockButton();
          render();
          toast("Mode édition verrouillé.");
        },
      });
    } else {
      openLoginModal();
    }
  });

  els.addCategoryBtn.addEventListener("click", () => {
    openCategoryModal({
      title: "Nouvelle catégorie",
      onConfirm: async ({ name, icon, color }) => {
        state = await apiCall("/categories", { method: "POST", body: JSON.stringify({ name, icon, color }) });
        render();
      },
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.overlay.hidden) closeModal();
  });

  // ---------------- Init ----------------

  async function init() {
    try {
      state = await apiGet();
      render();
    } catch (e) {
      els.categories.innerHTML = `<p class="empty-note">${escapeHtml(e.message)}</p>`;
    }
  }

  init();
})();
