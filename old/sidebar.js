import { getState, setFilter, EXPANSION_MAP, setNotificationEnabled, safeJsonParse, RANKS, CONFIG, DOM, handleAppError, setTelopRead } from "./dataManager.js";
import { filterAndRender } from "./app.js";
import { openUserManual, closeUserManual } from "./readme.js";
import { cloneTemplate, escapeHtml } from "./mobCard.js";

// ─── 定数・DOM ──────────────────────────────────────────
const SOUND_FILE = "./sound/01 FFXIV_Linkshell_Transmission.mp3";

let audio = null;
const notifiedCycles = new Set();
let currentPanel = null;
window.errorLog = window.errorLog || [];
const MAX_ERROR_LOG = 50;

// ─── 通知 ───────────────────────────────────────────────
export function initNotification() {
    audio = new Audio(SOUND_FILE);
    audio.load();

    const toggle = DOM.notificationToggle;
    if (!toggle) return;

    const isEnabled = getState().notificationEnabled;
    toggle.checked = isEnabled;

    const label = toggle.closest('.appnav-btn');
    if (label) {
        label.classList.toggle('is-disabled', !isEnabled);
    }

    const onFirstUserAction = () => {
        if (getState().notificationEnabled) {
            playNotificationSound(true);
        }
        document.removeEventListener('click', onFirstUserAction);
        document.removeEventListener('touchstart', onFirstUserAction);
    };
    document.addEventListener('click', onFirstUserAction);
    document.addEventListener('touchstart', onFirstUserAction);

    toggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        if (label) {
            label.classList.toggle('is-disabled', !enabled);
        }
        setNotificationEnabled(enabled);

        if (enabled) {
            requestNotificationPermission();
            playNotificationSound(true);
        }
    });
}

async function requestNotificationPermission() {
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            await Notification.requestPermission();
        }
    }
}

export function playNotificationSound(isSilent = false) {
    if (!audio) return;

    if (isSilent) {
        audio.muted = true;
        audio.play().then(() => {
            audio.pause();
            audio.muted = false;
        }).catch(() => { });
        return;
    }

    audio.currentTime = 0;
    audio.play().catch(err => {
        handleAppError(err, "通知音の再生失敗", false);
    });
}

export async function sendBrowserNotification(title, body) {
    if (!getState().notificationEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const options = { body, icon: "./icon/The_Hunt.png" };

    try {
        if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(title, options);
        } else {
            new Notification(title, options);
        }
    } catch (err) {
        handleAppError(err, "システム通知の表示失敗", false);
    }
}

export function checkAndNotify(mob) {
    const state = getState();
    if (!state.notificationEnabled) return;

    const info = mob.repopInfo;
    if (!info || !info.nextConditionSpawnDate || !info.conditionWindowEnd) return;

    const now = Date.now();
    const spawnTime = info.nextConditionSpawnDate.getTime();
    const endTime = info.conditionWindowEnd.getTime();
    const beforeTime = spawnTime - CONFIG.NOTIFICATION_OFFSET_MS;

    const cycleKeyBase = `${mob.No}-${spawnTime}`;
    const beforeKey = `${cycleKeyBase}-before`;
    const atKey = `${cycleKeyBase}-at`;

    if (now >= beforeTime && now < spawnTime && !notifiedCycles.has(beforeKey)) {
        const body = `まもなく（2分前）`;
        if (window.innerWidth >= 1024) {
            sendBrowserNotification(`【POP info】 ${mob.name}`, body);
        } else {
            playNotificationSound();
        }
        notifiedCycles.add(beforeKey);
    }

    if (now >= spawnTime && now <= endTime && !notifiedCycles.has(atKey)) {
        const body = `時間なう！`;
        if (window.innerWidth >= 1024) {
            sendBrowserNotification(`【POP info】 ${mob.name}`, body);
        } else {
            playNotificationSound();
        }
        notifiedCycles.add(atKey);
    }

    if (now > endTime) {
        if (notifiedCycles.has(beforeKey)) notifiedCycles.delete(beforeKey);
        if (notifiedCycles.has(atKey)) notifiedCycles.delete(atKey);
    }
}

// ─── フィルタ ───────────────────────────────────────────
function normalizeRank(rank) {
    if (rank === RANKS.S_RANK || rank === RANKS.S) return RANKS.S;
    if (rank === RANKS.A_RANK || rank === RANKS.A) return RANKS.A;
    if (rank === RANKS.FATE || rank === RANKS.FATE_FULL || rank === RANKS.F) return RANKS.F;
    return rank;
}

const getAllAreas = () => {
    return Array.from(new Set(Object.values(EXPANSION_MAP)));
};

export const renderAreaFilterPanel = (customContainer = null) => {
    const state = getState();
    const targetRankKey = normalizeRank(state.filter.rank);

    let items = [];
    let currentSet = new Set();
    let isAllSelected = false;

    if (state.filter.rank === RANKS.ALL) {
        items = [RANKS.S, RANKS.A, RANKS.F];
        currentSet = state.filter.allRankSet instanceof Set ? state.filter.allRankSet : new Set();
        isAllSelected = items.length > 0 && currentSet.size === items.length;
    } else {
        const expansionEntries = Object.entries(EXPANSION_MAP).sort((a, b) => b[0] - a[0]);
        items = expansionEntries.map(e => e[1]);
        currentSet = state.filter.areaSets[targetRankKey] instanceof Set ? state.filter.areaSets[targetRankKey] : new Set();
        isAllSelected = items.length > 0 && currentSet.size === items.length;
    }

    const container = customContainer || document.querySelector("#appnav .appnav-rank-item.appnav-active .area-grid-container");
    if (!container) return;

    container.innerHTML = "";

    const allBtnWrapper = document.createElement("div");
    allBtnWrapper.className = "area-all-container";
    const allBtn = document.createElement("button");
    allBtn.className = `area-filter-btn area-select-all ${isAllSelected ? 'is-selected' : ''}`;
    allBtn.textContent = isAllSelected ? "全解除" : "全選択";
    allBtn.dataset.value = "ALL";
    allBtnWrapper.appendChild(allBtn);
    container.appendChild(allBtnWrapper);

    items.forEach(item => {
        const isSelected = currentSet.has(item);
        const btn = document.createElement("button");
        btn.className = `area-filter-btn ${isSelected ? 'is-selected' : ''}`;
        btn.textContent = (state.filter.rank === RANKS.FATE && item === RANKS.F) ? 'FATE' : (state.filter.rank === RANKS.ALL ? (item === RANKS.F ? 'FATE' : `${item} rank`) : item);
        btn.dataset.value = item;
        container.appendChild(btn);
    });
};

export const handleRankTabClick = (rank) => {
    if (!rank) return;
    const state = getState();
    const prevRank = state.filter.rank;

    const isSameRank = normalizeRank(rank) === normalizeRank(prevRank);

    if (isSameRank) {
        const nextStep = (state.filter.clickStep === 2) ? 3 : 2;
        setFilter({ clickStep: nextStep });
    } else {
        setFilter({
            rank,
            clickStep: 1,
            areaSets: state.filter.areaSets
        });
    }

    filterAndRender();
};

export function handleAreaFilterClick(e) {
    const btn = e.target.closest(".area-filter-btn");
    if (!btn) return;
    const customContainer = btn.closest(".area-grid-container");

    const state = getState();
    const uiRank = state.filter.rank;

    if (uiRank === 'ALL') {
        const currentSet = state.filter.allRankSet instanceof Set ? state.filter.allRankSet : new Set();
        const nextSet = new Set(currentSet);
        const val = btn.dataset.value;

        if (val === "ALL") {
            if (currentSet.size === 3) {
                nextSet.clear();
            } else {
                nextSet.add("S").add("A").add("F");
            }
        } else {
            if (nextSet.has(val)) nextSet.delete(val);
            else nextSet.add(val);
        }

        setFilter({
            rank: uiRank,
            allRankSet: nextSet
        });

        filterAndRender();
        renderAreaFilterPanel(customContainer);
        return;
    }

    const targetRankKey = normalizeRank(uiRank);
    const allAreas = getAllAreas();

    const currentSet =
        state.filter.areaSets[targetRankKey] instanceof Set
            ? state.filter.areaSets[targetRankKey]
            : new Set();

    const nextAreaSets = { ...state.filter.areaSets };
    const val = btn.dataset.value || btn.dataset.area;

    if (val === "ALL") {
        if (currentSet.size === allAreas.length) {
            nextAreaSets[targetRankKey] = new Set();
        } else {
            nextAreaSets[targetRankKey] = new Set(allAreas);
        }
    } else {
        const area = val;
        const next = new Set(currentSet);
        if (next.has(area)) next.delete(area);
        else next.add(area);
        nextAreaSets[targetRankKey] = next;
    }

    setFilter({
        rank: uiRank,
        areaSets: nextAreaSets
    });

    filterAndRender();
    renderAreaFilterPanel(customContainer);
}

export function filterMobsByRankAndArea(mobs) {
    const filter = getState().filter;
    const uiRank = filter.rank;
    const areaSets = filter.areaSets;
    const allRankSet = filter.allRankSet;
    const allExpansions = getAllAreas().length;

    const getMobRankKey = (rank) => {
        if (rank === RANKS.S || rank === RANKS.A) return rank;
        if (rank === RANKS.F) return RANKS.F;
        if (rank.startsWith('B')) return RANKS.A;
        return null;
    };

    return mobs.filter(m => {
        const mobRank = m.rank;
        const mobExpansion = m.Expansion;
        const mobRankKey = getMobRankKey(mobRank);

        if (!mobRankKey) return false;

        const filterKey = mobRankKey;

        if (uiRank === 'ALL') {
            if (filterKey !== 'S' && filterKey !== 'A' && filterKey !== 'F') return false;

            if (allRankSet && allRankSet.size > 0 && allRankSet.size < 3) {
                if (!allRankSet.has(filterKey)) return false;
            }

            const targetSet =
                areaSets?.[filterKey] instanceof Set ? areaSets[filterKey] : new Set();

            if (targetSet.size === 0) return false;
            if (targetSet.size === allExpansions) return true;

            return targetSet.has(mobExpansion);
        } else {
            const normUiRank = normalizeRank(uiRank);
            const isRankMatch =
                (normUiRank === 'S' && mobRank === 'S') ||
                (normUiRank === 'A' && (mobRank === 'A' || mobRank.startsWith('B'))) ||
                (normUiRank === 'F' && mobRank === 'F');

            if (!isRankMatch) return false;

            const targetSet =
                areaSets?.[filterKey] instanceof Set ? areaSets[filterKey] : new Set();

            if (targetSet.size === 0) return false;
            if (targetSet.size === allExpansions) return true;

            return targetSet.has(mobExpansion);
        }
    });
}

// ─── アプリナビ ─────────────────────────────────────────
function loadSidebarState() {
    return safeJsonParse(localStorage.getItem("sidebarState"), {});
}

function saveState(key, value) {
    const s = loadSidebarState();
    s[key] = value;
    localStorage.setItem("sidebarState", JSON.stringify(s));
}

export function initAppNav() {
    const nav = DOM.appNav;
    if (!nav) return;

    captureErrors();

    const stored = loadSidebarState();
    if (stored.panel && stored.panel !== "manual") {
        currentPanel = stored.panel;
        nav.classList.add("expanded");
        document.body.classList.add("sidebar-expanded");
        showPanel(currentPanel);
        setActiveNavItem(currentPanel);
    } else {
        setActiveNavItem(null);
    }

    initNotification();

    if (nav) {
        nav.addEventListener('click', (e) => {
            const header = e.target.closest('.appnav-rank-header');
            if (header) {
                e.preventDefault();
                e.stopPropagation();
                handleRankTabClick(header.dataset.rank);
            }
        });
    }

    if (currentPanel !== "rank") {
        renderSidebarFilterAccordion();
    }
}

export function setActiveNavItem(id) {
    document.querySelectorAll(".appnav-btn[data-nav-id]").forEach(btn => {
        btn.classList.toggle("appnav-active", btn.dataset.navId === id);
    });
}

export async function togglePanel(panelName) {
    if (panelName === "manual") {
        const modal = DOM.manualModal;
        if (modal && !modal.classList.contains('hidden')) {
            closeUserManual();
        } else {
            if (typeof openUserManual === "function") openUserManual();
        }
        return;
    }

    const nav = DOM.appNav;
    if (!nav) return;

    if (currentPanel === panelName) {
        closePanel();
        return;
    }

    nav.classList.add("expanded");
    document.body.classList.add("sidebar-expanded");
    showPanel(panelName);
    currentPanel = panelName;
    if (panelName === "telop") {
        setTelopRead();
    }
    setActiveNavItem(panelName);
    saveState("panel", panelName);
}

export function closePanel() {
    const nav = DOM.appNav;
    if (!nav) return;

    nav.classList.remove("expanded");
    DOM.body.classList.remove("sidebar-expanded");

    const panelArea = nav.querySelector(".appnav-panel");
    if (panelArea) {
        panelArea.classList.remove("expanded");
    }

    currentPanel = null;
    setActiveNavItem('home');
    saveState("panel", null);

    DOM.appNavPanelItems.forEach(p => p.classList.add("hidden"));
}

function showPanel(panelName) {
    const nav = DOM.appNav;
    const panelArea = nav.querySelector(".appnav-panel");
    if (panelArea) panelArea.classList.add("expanded");

    DOM.appNavPanelItems.forEach(p => p.classList.add("hidden"));
    const target = document.getElementById(`sidebar-panel-${panelName}`);
    if (target) {
        target.classList.remove("hidden");
        syncPanelContents(panelName, target);
    }
}

async function syncPanelContents(panelName, container) {
    if (panelName === "rank") renderSidebarFilterAccordion(container);
    else if (panelName === "error") updateErrorPanel(container);
    else if (panelName === "telop" || panelName === "maintenance") {
        const { renderMaintenanceStatus } = await import("./app.js");
        if (typeof renderMaintenanceStatus === "function") {
            renderMaintenanceStatus();
        }
    }
}

// ─── エラー ─────────────────────────────────────────────
function captureErrors() {
    const origError = console.error;
    console.error = (...args) => {
        origError.apply(console, args);
        const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ");
        const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        window.errorLog.unshift({ time, msg });
        if (window.errorLog.length > MAX_ERROR_LOG) window.errorLog.pop();
        updateErrorPanel();
        updateErrorBadge();
    };

    window.addEventListener("error", (e) => {
        const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        window.errorLog.unshift({ time, msg: e.message || "Unknown error" });
        if (window.errorLog.length > MAX_ERROR_LOG) window.errorLog.pop();
        updateErrorPanel();
        updateErrorBadge();
    });

    window.addEventListener("unhandledrejection", (e) => {
        const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        window.errorLog.unshift({ time, msg: String(e.reason) });
        if (window.errorLog.length > MAX_ERROR_LOG) window.errorLog.pop();
        updateErrorPanel();
        updateErrorBadge();
    });
}

export function updateErrorPanel(targetContainer = null) {
    const panels = document.querySelectorAll(".js-error-content");
    if (panels.length === 0) return;

    const fragment = document.createDocumentFragment();
    if (!window.errorLog || window.errorLog.length === 0) {
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "text-center u-text-sm text-gray-500 mt-10";
        emptyMsg.textContent = "現在エラーはありません";
        fragment.appendChild(emptyMsg);
    } else {
        window.errorLog.forEach(e => {
            const el = cloneTemplate('appnav-error-item-template');
            if (el) {
                const timeEl = el.querySelector(".appnav-error-time");
                const msgEl = el.querySelector(".error-msg");
                if (timeEl) timeEl.textContent = e.time;
                if (msgEl) msgEl.textContent = e.msg;
                fragment.appendChild(el);
            }
        });
    }

    panels.forEach(el => {
        if (!el) return;
        el.innerHTML = "";
        el.appendChild(fragment.cloneNode(true));
    });
}

function updateErrorBadge() {
    import("./app.js").then(m => {
        if (typeof m.renderMaintenanceStatus === "function") m.renderMaintenanceStatus();
    });
}

// ─── アコーディオン ─────────────────────────────────────
function renderSidebarFilterAccordion() {
    const container = DOM.filterAccordion;
    if (!container) return;

    const ranks = [
        { key: RANKS.ALL, label: "ALL", color: "var(--color-all-rank)" },
        { key: RANKS.S_RANK, label: "S rank", color: "var(--color-rank-s)" },
        { key: RANKS.A_RANK, label: "A rank", color: "var(--color-rank-a)" },
        { key: RANKS.FATE, label: "FATE", color: "var(--color-rank-f)" },
    ];

    const state = getState();
    const activeRank = state.filter.rank || RANKS.ALL;
    const clickStep = state.filter.clickStep || 1;

    const fragment = document.createDocumentFragment();

    const titleDiv = document.createElement("div");
    titleDiv.className = "appnav-section-title";
    titleDiv.textContent = "Rank Filter";
    fragment.appendChild(titleDiv);

    ranks.forEach(r => {
        const isActive = r.key === activeRank;
        const isExpanded = isActive && clickStep === 2;

        const itemEl = cloneTemplate('rank-accordion-item-template');
        if (itemEl) {
            const root = itemEl.querySelector('.appnav-rank-item') || itemEl;
            if (isActive) root.classList.add('appnav-active');
            if (isExpanded) root.classList.add('appnav-is-expanded');
            root.dataset.rank = r.key;

            const header = root.querySelector(".appnav-rank-header");
            if (header) {
                header.dataset.rank = r.key;
                header.textContent = r.label;
            }
            fragment.appendChild(itemEl);
        }
    });

    container.innerHTML = "";
    container.appendChild(fragment);

    const activeExpansion = container.querySelector(".appnav-rank-item.appnav-active .area-grid-container");
    if (activeExpansion) {
        activeExpansion.className = "area-grid-container appnav-area-grid";
        renderAreaFilterPanel(activeExpansion);
    }
}

// ─── イベントリスナー ───────────────────────────────────
window.addEventListener("filterChanged", () => {
    renderSidebarFilterAccordion();
});


