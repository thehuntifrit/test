import { getState, setFilter, EXPANSION_MAP, setNotificationEnabled, safeJsonParse, RANKS, CONFIG, DOM, handleAppError, setTelopRead } from "./dataManager";
import { filterAndRender } from "./app";
import { openUserManual, closeUserManual } from "./readme";
import { cloneTemplate, escapeHtml } from "./mobCard";
import { Mob } from "./types/mob";

// ─── 定数・DOM ──────────────────────────────────────────
const SOUND_FILE = "./sound/01 FFXIV_Linkshell_Transmission.mp3";

let audio: HTMLAudioElement | null = null;
const notifiedCycles = new Set<string>();
let currentPanel: string | null = null;
(window as any).errorLog = (window as any).errorLog || [];
const MAX_ERROR_LOG = 50;

// ─── 通知 ───────────────────────────────────────────────
export function initNotification(): void {
    audio = new Audio(SOUND_FILE);
    audio.load();

    const toggle = DOM.notificationToggle;
    if (!toggle) return;

    const isEnabled = getState().notificationEnabled;
    toggle.checked = isEnabled;

    const label = toggle.closest('.appnav-btn') as HTMLElement | null;
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
        const target = e.target as HTMLInputElement;
        const enabled = target.checked;
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

async function requestNotificationPermission(): Promise<void> {
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            await Notification.requestPermission();
        }
    }
}

export function playNotificationSound(isSilent = false): void {
    if (!audio) return;

    if (isSilent) {
        audio.muted = true;
        audio.play().then(() => {
            audio!.pause();
            audio!.muted = false;
        }).catch(() => { });
        return;
    }

    audio.currentTime = 0;
    audio.play().catch(err => {
        handleAppError(err, "通知音の再生失敗", false);
    });
}

export async function sendBrowserNotification(title: string, body: string): Promise<void> {
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

export function checkAndNotify(mob: Mob): void {
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
function normalizeRank(rank: string): string {
    if (rank === RANKS.S_RANK || rank === RANKS.S) return RANKS.S;
    if (rank === RANKS.A_RANK || rank === RANKS.A) return RANKS.A;
    if (rank === RANKS.FATE || rank === RANKS.FATE_FULL || rank === RANKS.F) return RANKS.F;
    return rank;
}

const getAllAreas = (): string[] => {
    return Array.from(new Set(Object.values(EXPANSION_MAP)));
};

export const renderAreaFilterPanel = (customContainer: HTMLElement | null = null): void => {
    const stateVal = getState();
    const targetRankKey = normalizeRank(stateVal.filter.rank);

    let items: string[] = [];
    let currentSet = new Set<string>();
    let isAllSelected = false;

    if (stateVal.filter.rank === RANKS.ALL) {
        items = [RANKS.S, RANKS.A, RANKS.F];
        currentSet = stateVal.filter.allRankSet instanceof Set ? stateVal.filter.allRankSet : new Set();
        isAllSelected = items.length > 0 && currentSet.size === items.length;
    } else {
        const expansionEntries = Object.entries(EXPANSION_MAP).sort((a, b) => Number(b[0]) - Number(a[0]));
        items = expansionEntries.map(e => e[1]);
        currentSet = (stateVal.filter.areaSets as any)[targetRankKey] instanceof Set ? (stateVal.filter.areaSets as any)[targetRankKey] : new Set();
        isAllSelected = items.length > 0 && currentSet.size === items.length;
    }

    const container = customContainer || document.querySelector("#appnav .appnav-rank-item.appnav-active .area-grid-container") as HTMLElement | null;
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
        btn.textContent = (stateVal.filter.rank === RANKS.FATE && item === RANKS.F) ? 'FATE' : (stateVal.filter.rank === RANKS.ALL ? (item === RANKS.F ? 'FATE' : `${item} rank`) : item);
        btn.dataset.value = item;
        container.appendChild(btn);
    });
};

export const handleRankTabClick = (rank: string): void => {
    if (!rank) return;
    const stateVal = getState();
    const prevRank = stateVal.filter.rank;

    const isSameRank = normalizeRank(rank) === normalizeRank(prevRank);

    if (isSameRank) {
        const nextStep = (stateVal.filter.clickStep === 2) ? 3 : 2;
        setFilter({ clickStep: nextStep });
    } else {
        setFilter({
            rank,
            clickStep: 1,
            areaSets: stateVal.filter.areaSets
        });
    }

    filterAndRender();
};

export function handleAreaFilterClick(e: Event): void {
    const target = e.target as HTMLElement;
    const btn = target.closest(".area-filter-btn") as HTMLElement | null;
    if (!btn) return;
    const customContainer = btn.closest(".area-grid-container") as HTMLElement | null;

    const stateVal = getState();
    const uiRank = stateVal.filter.rank;

    if (uiRank === 'ALL') {
        const currentSet = stateVal.filter.allRankSet instanceof Set ? stateVal.filter.allRankSet : new Set<string>();
        const nextSet = new Set<string>(currentSet);
        const val = btn.dataset.value;

        if (val === "ALL") {
            if (currentSet.size === 3) {
                nextSet.clear();
            } else {
                nextSet.add("S").add("A").add("F");
            }
        } else if (val) {
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
        (stateVal.filter.areaSets as any)[targetRankKey] instanceof Set
            ? (stateVal.filter.areaSets as any)[targetRankKey]
            : new Set<string>();

    const nextAreaSets = { ...stateVal.filter.areaSets };
    const val = btn.dataset.value || btn.dataset.area;

    if (val === "ALL") {
        if (currentSet.size === allAreas.length) {
            nextAreaSets[targetRankKey] = new Set<string>();
        } else {
            nextAreaSets[targetRankKey] = new Set<string>(allAreas);
        }
    } else if (val) {
        const area = val;
        const next = new Set<string>(currentSet);
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

export function filterMobsByRankAndArea(mobs: Mob[]): Mob[] {
    const filter = getState().filter;
    const uiRank = filter.rank;
    const areaSets = filter.areaSets;
    const allRankSet = filter.allRankSet;
    const allExpansions = getAllAreas().length;

    const getMobRankKey = (rankStr: string) => {
        if (rankStr === RANKS.S || rankStr === RANKS.A) return rankStr;
        if (rankStr === RANKS.F) return RANKS.F;
        if (rankStr.startsWith('B')) return RANKS.A;
        return null;
    };

    return mobs.filter(m => {
        const mobRank = m.rank;
        const mobExpansion = m.Expansion;
        const mobRankKey = getMobRankKey(mobRank);

        if (!mobRankKey || !mobExpansion) return false;

        const filterKey = mobRankKey;

        if (uiRank === 'ALL') {
            if (filterKey !== 'S' && filterKey !== 'A' && filterKey !== 'F') return false;

            if (allRankSet && allRankSet.size > 0 && allRankSet.size < 3) {
                if (!allRankSet.has(filterKey)) return false;
            }

            const targetSet =
                areaSets?.[filterKey] instanceof Set ? areaSets[filterKey] : new Set<string>();

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
                areaSets?.[filterKey] instanceof Set ? areaSets[filterKey] : new Set<string>();

            if (targetSet.size === 0) return false;
            if (targetSet.size === allExpansions) return true;

            return targetSet.has(mobExpansion);
        }
    });
}

// ─── アプリナビ ─────────────────────────────────────────
function loadSidebarState(): any {
    return safeJsonParse(localStorage.getItem("sidebarState"), {});
}

function saveState(key: string, value: any): void {
    const s = loadSidebarState();
    s[key] = value;
    localStorage.setItem("sidebarState", JSON.stringify(s));
}

export function initAppNav(): void {
    const nav = DOM.appNav;
    if (!nav) return;

    captureErrors();

    const stored = loadSidebarState();
    if (stored.panel && stored.panel !== "manual") {
        currentPanel = stored.panel;
        nav.classList.add("expanded");
        document.body.classList.add("sidebar-expanded");
        showPanel(currentPanel!);
        setActiveNavItem(currentPanel!);
    } else {
        setActiveNavItem(null);
    }

    initNotification();

    nav.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const header = target.closest('.appnav-rank-header') as HTMLElement | null;
        if (header) {
            e.preventDefault();
            e.stopPropagation();
            handleRankTabClick(header.dataset.rank || "");
        }
    });

    if (currentPanel !== "rank") {
        renderSidebarFilterAccordion();
    }
}

export function setActiveNavItem(id: string | null): void {
    document.querySelectorAll(".appnav-btn[data-nav-id]").forEach(btn => {
        const htmlBtn = btn as HTMLElement;
        htmlBtn.classList.toggle("appnav-active", htmlBtn.dataset.navId === id);
    });
}

export async function togglePanel(panelName: string): Promise<void> {
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

export function closePanel(): void {
    const nav = DOM.appNav;
    if (!nav) return;

    nav.classList.remove("expanded");
    DOM.body.classList.remove("sidebar-expanded");

    const panelArea = nav.querySelector(".appnav-panel") as HTMLElement | null;
    if (panelArea) {
        panelArea.classList.remove("expanded");
    }

    currentPanel = null;
    setActiveNavItem('home');
    saveState("panel", null);

    DOM.appNavPanelItems.forEach(p => p.classList.add("hidden"));
}

function showPanel(panelName: string): void {
    const nav = DOM.appNav;
    if (!nav) return;
    const panelArea = nav.querySelector(".appnav-panel") as HTMLElement | null;
    if (panelArea) panelArea.classList.add("expanded");

    DOM.appNavPanelItems.forEach(p => p.classList.add("hidden"));
    const target = document.getElementById(`sidebar-panel-${panelName}`);
    if (target) {
        target.classList.remove("hidden");
        syncPanelContents(panelName, target);
    }
}

async function syncPanelContents(panelName: string, container: HTMLElement): Promise<void> {
    if (panelName === "rank") renderSidebarFilterAccordion();
    else if (panelName === "error") updateErrorPanel();
    else if (panelName === "telop" || panelName === "maintenance") {
        const m = await import("./app");
        if (typeof m.renderMaintenanceStatus === "function") {
            m.renderMaintenanceStatus();
        }
    }
}

// ─── エラー ─────────────────────────────────────────────
function captureErrors(): void {
    const origError = console.error;
    console.error = (...args) => {
        origError.apply(console, args);
        const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ");
        const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        (window as any).errorLog.unshift({ time, msg });
        if ((window as any).errorLog.length > MAX_ERROR_LOG) (window as any).errorLog.pop();
        updateErrorPanel();
        updateErrorBadge();
    };

    window.addEventListener("error", (e) => {
        const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        (window as any).errorLog.unshift({ time, msg: e.message || "Unknown error" });
        if ((window as any).errorLog.length > MAX_ERROR_LOG) (window as any).errorLog.pop();
        updateErrorPanel();
        updateErrorBadge();
    });

    window.addEventListener("unhandledrejection", (e) => {
        const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        (window as any).errorLog.unshift({ time, msg: String(e.reason) });
        if ((window as any).errorLog.length > MAX_ERROR_LOG) (window as any).errorLog.pop();
        updateErrorPanel();
        updateErrorBadge();
    });
}

export function updateErrorPanel(targetContainer: HTMLElement | null = null): void {
    const panels = document.querySelectorAll(".js-error-content");
    if (panels.length === 0) return;

    const fragment = document.createDocumentFragment();
    if (!(window as any).errorLog || (window as any).errorLog.length === 0) {
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "text-center u-text-sm text-gray-500 mt-10";
        emptyMsg.textContent = "現在エラーはありません";
        fragment.appendChild(emptyMsg);
    } else {
        (window as any).errorLog.forEach((e: any) => {
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

function updateErrorBadge(): void {
    import("./app").then(m => {
        if (typeof m.renderMaintenanceStatus === "function") m.renderMaintenanceStatus();
    });
}

// ─── アコーディオン ─────────────────────────────────────
function renderSidebarFilterAccordion(): void {
    const container = DOM.filterAccordion;
    if (!container) return;

    const ranks = [
        { key: RANKS.ALL, label: "ALL", color: "var(--color-all-rank)" },
        { key: RANKS.S_RANK, label: "S rank", color: "var(--color-rank-s)" },
        { key: RANKS.A_RANK, label: "A rank", color: "var(--color-rank-a)" },
        { key: RANKS.FATE, label: "FATE", color: "var(--color-rank-f)" },
    ];

    const stateVal = getState();
    const activeRank = stateVal.filter.rank || RANKS.ALL;
    const clickStep = stateVal.filter.clickStep || 1;

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
            const root = itemEl.querySelector('.appnav-rank-item') as HTMLElement || itemEl;
            if (isActive) root.classList.add('appnav-active');
            if (isExpanded) root.classList.add('appnav-is-expanded');
            root.dataset.rank = r.key;

            const header = root.querySelector(".appnav-rank-header") as HTMLElement | null;
            if (header) {
                header.dataset.rank = r.key;
                header.textContent = r.label;
            }
            fragment.appendChild(itemEl);
        }
    });

    container.innerHTML = "";
    container.appendChild(fragment);

    const activeExpansion = container.querySelector(".appnav-rank-item.appnav-active .area-grid-container") as HTMLElement | null;
    if (activeExpansion) {
        activeExpansion.className = "area-grid-container appnav-area-grid";
        renderAreaFilterPanel(activeExpansion);
    }
}

// ─── イベントリスナー ───────────────────────────────────
window.addEventListener("filterChanged", () => {
    renderSidebarFilterAccordion();
});
