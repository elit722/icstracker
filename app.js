(() => {
  "use strict";

  // ⚠️ Remplace cette URL par celle de ton Worker Cloudflare une fois déployé,
  // ex: "https://ice-cream-survival.ton-compte.workers.dev"
  const WORKER_URL = "https://icstracker.refugeemeraudien-direction.workers.dev";
  const API = `${WORKER_URL}/api`;
  const TOKEN_KEY = "ics_token";

  // ⚠️ Domaine(s) sur lesquels le site est servi — requis par les iframes Twitch
  // (paramètre "parent" obligatoire). Ajoute chaque domaine que tu utilises.
  const EMBED_PARENTS = ["elit722.github.io", "localhost"];

  let state = { categories: [], twitch: { hostChannel: "" }, mapDownloadUrl: "", participants: [] };
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
    burgerBtn: document.getElementById("burgerBtn"),
    burgerMenu: document.getElementById("burgerMenu"),
    mapDownloadLink: document.getElementById("mapDownloadLink"),
    mapEditBtn: document.getElementById("mapEditBtn"),
    twitchBody: document.getElementById("twitchBody"),
    twitchEditActions: document.getElementById("twitchEditActions"),
    participantsGrid: document.getElementById("participantsGrid"),
    participantsEditActions: document.getElementById("participantsEditActions"),
    statsTableWrap: document.getElementById("statsTableWrap"),
  };

  const FLAVORS = [
    { key: "blueberry", label: "Myrtille" },
    { key: "cherry", label: "Cerise" },
    { key: "pistachio", label: "Pistache" },
    { key: "lemon", label: "Citron" },
    { key: "mint", label: "Menthe" },
    { key: "chocolate", label: "Chocolat" },
    { key: "strawberry", label: "Fraise" },
    { key: "caramel", label: "Caramel" },
    { key: "grape", label: "Raisin" },
    { key: "coconut", label: "Coco" },
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
    el: document.querySelector(".modal"),
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
    modal.el.classList.remove("modal-wide");
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

  // Construit une rangée de pastilles de couleur dans `container`.
  // Si allowAuto est vrai, une pastille "auto" (arc-en-ciel) est ajoutée en premier
  // pour représenter "pas de couleur propre -> hérite de la catégorie" (color = null).
  // Retourne une fonction getSelected() qui renvoie la clé de couleur choisie (ou null pour auto).
  function buildFlavorRow(container, selected, { allowAuto = false } = {}) {
    let selectedColor = selected || (allowAuto ? null : FLAVORS[0].key);
    const swatches = [];

    if (allowAuto) {
      const auto = document.createElement("div");
      auto.className = "modal-flavor-swatch swatch-auto" + (selectedColor === null ? " selected" : "");
      auto.title = "Automatique (couleur de la catégorie)";
      auto.textContent = "🍨";
      auto.addEventListener("click", () => {
        selectedColor = null;
        swatches.forEach((s) => s.el.classList.remove("selected"));
        auto.classList.add("selected");
      });
      container.appendChild(auto);
      swatches.push({ key: null, el: auto });
    }

    FLAVORS.forEach((f) => {
      const sw = document.createElement("div");
      sw.className = "modal-flavor-swatch" + (f.key === selectedColor ? " selected" : "");
      sw.style.background = `var(--${f.key})`;
      sw.title = f.label;
      sw.addEventListener("click", () => {
        selectedColor = f.key;
        swatches.forEach((s) => s.el.classList.remove("selected"));
        sw.classList.add("selected");
      });
      container.appendChild(sw);
      swatches.push({ key: f.key, el: sw });
    });

    return () => selectedColor;
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
    const flavorRow = document.getElementById("flavorRow");
    const getSelected = buildFlavorRow(flavorRow, color, { allowAuto: false });
    setTimeout(() => input.focus(), 30);

    const submit = async () => {
      const v = input.value.trim();
      if (!v) { showModalError("Le nom est requis."); return; }
      try {
        modal.confirm.disabled = true;
        await onConfirm({ name: v, icon: iconInput.value.trim() || "🍨", color: getSelected() });
        closeModal();
      } catch (e) {
        showModalError(e.message);
      } finally {
        modal.confirm.disabled = false;
      }
    };
    modal.confirm.onclick = submit;
  }

  function openQuestModal({ title, name = "", color = null, confirmLabel = "Valider", onConfirm }) {
    modal.title.textContent = title;
    modal.desc.hidden = true;
    modal.body.innerHTML = `
      <input type="text" id="modalInput" placeholder="Nom de la quête" autocomplete="off" />
      <div class="modal-flavor-row" id="flavorRow"></div>
    `;
    modal.confirm.textContent = confirmLabel;
    modal.error.hidden = true;
    modal.overlay.hidden = false;

    const input = document.getElementById("modalInput");
    input.value = name;
    const flavorRow = document.getElementById("flavorRow");
    const getSelected = buildFlavorRow(flavorRow, color, { allowAuto: true });
    setTimeout(() => input.focus(), 30);

    const submit = async () => {
      const v = input.value.trim();
      if (!v) { showModalError("Le nom est requis."); return; }
      try {
        modal.confirm.disabled = true;
        await onConfirm({ name: v, color: getSelected() });
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

  function showModalError(msg) {
    modal.error.textContent = msg;
    modal.error.hidden = false;
  }

  function openParticipantModal({ title, participant = null, onConfirm }) {
    modal.title.textContent = title;
    modal.desc.hidden = true;
    modal.el.classList.add("modal-wide");
    const p = participant || { name: "", avatar: "", twitchChannel: "", links: [], stats: {} };
    const links = p.links && p.links.length ? p.links : [{ label: "", url: "" }];

    modal.body.innerHTML = `
      <input type="text" id="pName" placeholder="Nom du participant" autocomplete="off" />
      <input type="text" id="pAvatar" placeholder="URL de la photo de profil" autocomplete="off" style="margin-top:8px;" />
      <input type="text" id="pTwitch" placeholder="Chaîne Twitch (optionnel, sans URL)" autocomplete="off" style="margin-top:8px;" />
      <p class="modal-subhead">Liens (Discord, réseaux, etc.)</p>
      <div id="pLinksRows"></div>
      <button type="button" class="add-inline-btn" id="pAddLink">＋ Ajouter un lien</button>
      <p class="modal-subhead">Statistiques</p>
      <div class="modal-stats-grid">
        <label>Blocs posés <input type="number" id="pBlocksPlaced" min="0" /></label>
        <label>Kills <input type="number" id="pKills" min="0" /></label>
        <label>Blocs parcourus <input type="number" id="pBlocksWalked" min="0" /></label>
        <label>Blocs cassés <input type="number" id="pBlocksBroken" min="0" /></label>
      </div>
    `;
    modal.confirm.textContent = "Enregistrer";
    modal.error.hidden = true;
    modal.overlay.hidden = false;

    const nameInput = document.getElementById("pName");
    const avatarInput = document.getElementById("pAvatar");
    const twitchInput = document.getElementById("pTwitch");
    nameInput.value = p.name || "";
    avatarInput.value = p.avatar || "";
    twitchInput.value = p.twitchChannel || "";

    const stats = p.stats || {};
    document.getElementById("pBlocksPlaced").value = stats.blocksPlaced || 0;
    document.getElementById("pKills").value = stats.kills || 0;
    document.getElementById("pBlocksWalked").value = stats.blocksWalked || 0;
    document.getElementById("pBlocksBroken").value = stats.blocksBroken || 0;

    const linksRows = document.getElementById("pLinksRows");
    function addLinkRow(link) {
      const row = document.createElement("div");
      row.className = "modal-link-row";
      row.innerHTML = `
        <input type="text" class="pLinkLabel" placeholder="Label (ex: Discord)" />
        <input type="text" class="pLinkUrl" placeholder="https://..." />
        <button type="button" class="btn-icon danger" title="Retirer">✕</button>
      `;
      row.querySelector(".pLinkLabel").value = (link && link.label) || "";
      row.querySelector(".pLinkUrl").value = (link && link.url) || "";
      row.querySelector(".btn-icon").addEventListener("click", () => row.remove());
      linksRows.appendChild(row);
    }
    links.forEach((l) => addLinkRow(l));
    document.getElementById("pAddLink").addEventListener("click", () => addLinkRow());

    setTimeout(() => nameInput.focus(), 30);

    const submit = async () => {
      const name = nameInput.value.trim();
      if (!name) { showModalError("Le nom est requis."); return; }
      const collectedLinks = [...linksRows.querySelectorAll(".modal-link-row")]
        .map((row) => ({
          label: row.querySelector(".pLinkLabel").value.trim(),
          url: row.querySelector(".pLinkUrl").value.trim(),
        }))
        .filter((l) => l.url);
      const data = {
        name,
        avatar: avatarInput.value.trim(),
        twitchChannel: twitchInput.value.trim(),
        links: collectedLinks,
        stats: {
          blocksPlaced: Number(document.getElementById("pBlocksPlaced").value) || 0,
          kills: Number(document.getElementById("pKills").value) || 0,
          blocksWalked: Number(document.getElementById("pBlocksWalked").value) || 0,
          blocksBroken: Number(document.getElementById("pBlocksBroken").value) || 0,
        },
      };
      try {
        modal.confirm.disabled = true;
        await onConfirm(data);
        closeModal();
      } catch (e) {
        showModalError(e.message);
      } finally {
        modal.confirm.disabled = false;
      }
    };
    modal.confirm.onclick = submit;
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
    els.overallFill.style.setProperty("--reveal", `${100 - p}%`);
    els.overallCount.textContent = `${done} / ${total} scoops`;
    els.overallMarker.style.left = `calc(${p}% - 12px)`;
    els.statsFooter.textContent = total > 0 ? `${p}% de l'aventure complétée` : "";

    els.categories.innerHTML = "";
    if (state.categories.length === 0) {
      els.categories.innerHTML = `<p class="empty-note">Aucune catégorie pour l'instant.</p>`;
    }
    state.categories.forEach((cat) => els.categories.appendChild(renderCategory(cat)));
    renderTwitchSection();
    renderParticipantsSection();
    renderStatsSection();
    renderBurgerMenu();
    renderUnlockButton();
  }

  // ---------------- Twitch ----------------

  function twitchEmbedUrl(channel) {
    const parentParams = EMBED_PARENTS.map((p) => `parent=${encodeURIComponent(p)}`).join("&");
    return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&${parentParams}&muted=true&autoplay=false`;
  }

  function renderTwitchSection() {
    const channel = (state.twitch && state.twitch.hostChannel) || "";
    els.twitchEditActions.innerHTML = "";
    if (isEditMode()) {
      els.twitchEditActions.appendChild(iconButton("✏️", "Modifier la chaîne Twitch", () => {
        openTextModal({
          title: "Chaîne Twitch de l'hôte",
          desc: "Le nom d'utilisateur Twitch (ex: rexi), sans l'URL complète.",
          value: channel,
          placeholder: "nom_de_la_chaine",
          confirmLabel: "Enregistrer",
          onConfirm: async (v) => {
            state = await apiCall("/settings", { method: "PUT", body: JSON.stringify({ twitchHostChannel: v }) });
            render();
            toast("Chaîne Twitch mise à jour.");
          },
        });
      }));
    }

    if (!channel) {
      els.twitchBody.innerHTML = `<p class="empty-note">${isEditMode() ? "Ajoute la chaîne Twitch de l'hôte avec le crayon ci-dessus." : "Le stream n'est pas encore configuré."}</p>`;
      return;
    }

    els.twitchBody.innerHTML = `
      <div class="twitch-embed-wrap">
        <iframe src="${twitchEmbedUrl(channel)}" allowfullscreen scrolling="no"></iframe>
      </div>
      <a class="btn btn-primary twitch-visit-btn" href="https://www.twitch.tv/${encodeURIComponent(channel)}" target="_blank" rel="noopener">▶️ Voir sur Twitch</a>
    `;
  }

  // ---------------- Participants ----------------

  function renderParticipantsSection() {
    els.participantsEditActions.innerHTML = "";
    if (isEditMode()) {
      const addBtn = document.createElement("button");
      addBtn.className = "btn btn-dashed";
      addBtn.textContent = "＋ Nouveau participant";
      addBtn.addEventListener("click", () => {
        openParticipantModal({
          title: "Nouveau participant",
          onConfirm: async (data) => {
            state = await apiCall("/participants", { method: "POST", body: JSON.stringify(data) });
            render();
            toast("Participant ajouté.");
          },
        });
      });
      els.participantsEditActions.appendChild(addBtn);
    }

    els.participantsGrid.innerHTML = "";
    const list = state.participants || [];
    if (list.length === 0) {
      els.participantsGrid.innerHTML = `<p class="empty-note">Aucun participant pour l'instant.</p>`;
      return;
    }
    list.forEach((p) => els.participantsGrid.appendChild(renderParticipantCard(p)));
  }

  function renderParticipantCard(p) {
    const card = document.createElement("article");
    card.className = "participant-card";

    const head = document.createElement("div");
    head.className = "participant-head";
    head.innerHTML = `
      ${p.avatar ? `<img class="participant-avatar" src="${escapeHtml(p.avatar)}" alt="" onerror="this.style.visibility='hidden'" />` : ""}
      <div class="participant-name">${escapeHtml(p.name)}</div>
    `;
    card.appendChild(head);

    if (p.links && p.links.length > 0) {
      const linksRow = document.createElement("div");
      linksRow.className = "participant-links";
      p.links.forEach((l) => {
        const a = document.createElement("a");
        a.href = l.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.className = "participant-link-btn";
        a.textContent = l.label || "Lien";
        linksRow.appendChild(a);
      });
      card.appendChild(linksRow);
    }

    if (p.twitchChannel) {
      const embedWrap = document.createElement("div");
      embedWrap.className = "twitch-embed-wrap twitch-embed-wrap-sm";
      embedWrap.innerHTML = `<iframe src="${twitchEmbedUrl(p.twitchChannel)}" allowfullscreen scrolling="no"></iframe>`;
      card.appendChild(embedWrap);

      const visit = document.createElement("a");
      visit.href = `https://www.twitch.tv/${encodeURIComponent(p.twitchChannel)}`;
      visit.target = "_blank";
      visit.rel = "noopener";
      visit.className = "btn btn-ghost twitch-visit-btn-sm";
      visit.textContent = "▶️ Voir sur Twitch";
      card.appendChild(visit);
    }

    if (isEditMode()) {
      const actions = document.createElement("div");
      actions.className = "participant-edit-actions";
      actions.appendChild(iconButton("✏️", "Modifier", () => {
        openParticipantModal({
          title: "Modifier le participant",
          participant: p,
          onConfirm: async (data) => {
            state = await apiCall(`/participants/${p.id}`, { method: "PUT", body: JSON.stringify(data) });
            render();
          },
        });
      }));
      actions.appendChild(iconButton("🗑️", "Supprimer", () => {
        openConfirmModal({
          title: `Supprimer "${p.name}" ?`,
          onConfirm: async () => {
            state = await apiCall(`/participants/${p.id}`, { method: "DELETE" });
            render();
            toast("Participant supprimé.");
          },
        });
      }, true));
      card.appendChild(actions);
    }

    return card;
  }

  // ---------------- Statistiques ----------------

  function renderStatsSection() {
    const list = state.participants || [];
    if (list.length === 0) {
      els.statsTableWrap.innerHTML = `<p class="empty-note">Pas encore de statistiques.</p>`;
      return;
    }
    const rows = list.map((p) => {
      const s = p.stats || {};
      return `
        <tr>
          <td class="stats-name-cell">
            ${p.avatar ? `<img class="stats-avatar" src="${escapeHtml(p.avatar)}" alt="" onerror="this.style.visibility='hidden'" />` : ""}
            ${escapeHtml(p.name)}
          </td>
          <td>${s.blocksPlaced || 0}</td>
          <td>${s.kills || 0}</td>
          <td>${s.blocksWalked || 0}</td>
          <td>${s.blocksBroken || 0}</td>
        </tr>
      `;
    }).join("");
    els.statsTableWrap.innerHTML = `
      <table class="stats-table">
        <thead>
          <tr><th>Joueur</th><th>Blocs posés</th><th>Kills</th><th>Blocs parcourus</th><th>Blocs cassés</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ---------------- Menu burger ----------------

  function renderBurgerMenu() {
    const url = state.mapDownloadUrl || "";
    if (url) {
      els.mapDownloadLink.href = url;
      els.mapDownloadLink.classList.remove("burger-item-disabled");
    } else {
      els.mapDownloadLink.href = "#";
      els.mapDownloadLink.classList.add("burger-item-disabled");
    }
    els.mapEditBtn.hidden = !isEditMode();
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
        openQuestModal({
          title: "Nouvelle quête",
          confirmLabel: "Ajouter",
          onConfirm: async ({ name, color }) => {
            state = await apiCall(`/categories/${cat.id}/quests`, { method: "POST", body: JSON.stringify({ name, color }) });
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
    if (quest.color) {
      card.style.setProperty("--flavor", `var(--${quest.color})`);
      card.style.setProperty("--flavor-dark", `var(--${quest.color}-dark)`);
      card.style.setProperty("--flavor-tint", `var(--${quest.color}-tint)`);
    }

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
        openQuestModal({
          title: "Modifier la quête",
          name: quest.name,
          color: quest.color || null,
          confirmLabel: "Enregistrer",
          onConfirm: async ({ name, color }) => {
            state = await apiCall(`/quests/${quest.id}`, { method: "PUT", body: JSON.stringify({ name, color }) });
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

  els.burgerBtn.addEventListener("click", () => {
    const willOpen = els.burgerMenu.hidden;
    els.burgerMenu.hidden = !willOpen;
    els.burgerBtn.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("click", (e) => {
    if (els.burgerMenu.hidden) return;
    if (els.burgerMenu.contains(e.target) || els.burgerBtn.contains(e.target)) return;
    els.burgerMenu.hidden = true;
    els.burgerBtn.setAttribute("aria-expanded", "false");
  });

  els.burgerMenu.querySelectorAll('a.burger-item[href^="#"]').forEach((a) => {
    a.addEventListener("click", () => {
      els.burgerMenu.hidden = true;
      els.burgerBtn.setAttribute("aria-expanded", "false");
    });
  });

  els.mapDownloadLink.addEventListener("click", (e) => {
    if (!state.mapDownloadUrl) {
      e.preventDefault();
      toast(isEditMode() ? "Ajoute d'abord un lien avec le crayon ✏️" : "Le lien de téléchargement n'est pas encore disponible.");
    } else {
      els.burgerMenu.hidden = true;
    }
  });

  els.mapEditBtn.addEventListener("click", () => {
    openTextModal({
      title: "Lien de téléchargement de la map",
      placeholder: "https://...",
      value: state.mapDownloadUrl || "",
      confirmLabel: "Enregistrer",
      onConfirm: async (url) => {
        state = await apiCall("/settings", { method: "PUT", body: JSON.stringify({ mapDownloadUrl: url }) });
        render();
        toast("Lien mis à jour.");
      },
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.overlay.hidden) closeModal();
    if (e.key === "Escape" && !els.burgerMenu.hidden) {
      els.burgerMenu.hidden = true;
      els.burgerBtn.setAttribute("aria-expanded", "false");
    }
  });

  // ---------------- Init ----------------

  async function init() {
    try {
      state = await apiGet();
      state.twitch = state.twitch || { hostChannel: "" };
      state.participants = state.participants || [];
      state.mapDownloadUrl = state.mapDownloadUrl || "";
      render();
    } catch (e) {
      els.categories.innerHTML = `<p class="empty-note">${escapeHtml(e.message)}</p>`;
    }
  }

  init();
})();
