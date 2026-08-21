import { Mob, RepopInfo, CullStatus, SpawnCache } from "./types/mob";
import { AppState, FilterState } from "./types/state";
import { calculateRepop } from "./cal";
import { subscribeMobStatusDocs, subscribeMobLocations, subscribeMobMemos, subscribeMaintenance } from "./server";

// ─── 定数 ───────────────────────────────────────────────
export const EXPANSION_MAP: Record<number, string> = { 1: "新生", 2: "蒼天", 3: "紅蓮", 4: "漆黒", 5: "暁月", 6: "黄金" };

export const PROGRESS_CLASSES = {
    HIGHLIGHT_WHITE: "progress-highlight-white"
};

export const RANKS = {
    S: "S",
    A: "A",
    F: "F",
    ALL: "ALL",
    S_RANK: "S rank",
    A_RANK: "A rank",
    FATE: "FATE",
    FATE_FULL: "F.A.T.E."
};

const WORKER_TYPES = {
    CALCULATE: "CALCULATE",
    RESULT: "RESULT",
    ERROR: "ERROR"
};

const MOB_DATA_URL = "./json/mob_data.json";
const MOB_LOCATIONS_URL = "./json/mob_locations.json";
const MAINTENANCE_URL = "./json/maintenance.json";
const MOB_DATA_CACHE_KEY = "mobDataCache";
const MOB_STATUS_CACHE_KEY = "mobStatusCache";
const SPAWN_CACHE_KEY = "spawnConditionCache";
const LOCATIONS_CACHE_KEY = "mobLocationsCache";

// ─── 設定値 ─────────────────────────────────────────────
export const CONFIG = {
    APP_LOAD_TIMEOUT: 6000,
    TIER_B_UPDATE_INTERVAL: 60000,
    TOAST_DURATION: 4000,
    CLICK_THRESHOLD: 1000,
    DEBOUNCE_DELAY: 100,
    BREAKPOINT_PC: 1024,
    REPOP_CALC_DELAY: 2000,
    NOTIFICATION_OFFSET_MS: 120000,
    MAINTENANCE_SHOW_BEFORE_MS: 604800000,
    MAINTENANCE_SHOW_AFTER_MS: 345600000,
    MAP_ZOOM_SCALE: 2.0,
    AUTH_TIMEOUT: 10000,
    REPORT_FUTURE_THRESHOLD: 600000,
    REPORT_EARLY_THRESHOLD: 300000,
    MEMO_MAX_LENGTH: 30,
    IDB_SAVE_DEBOUNCE: 2000,
    FIRESTORE_LOAD_TIMEOUT: 8000
};

export const STATUS_LABELS: Record<string, string | { S: string; others: string }> = {
    Maintenance: "停止",
    MaxOver: "超過",
    ConditionActive: "なう",
    PopWindow: "残り",
    Next: { S: "次回", others: "残り" },
    NextCondition: { S: "次回", others: "残り" },
    Unknown: "未定"
};

export const DOM = {
    colContainer: document.getElementById('column-container'),
    pcLeftList: document.getElementById('moblist-container'),
    pcRightDetail: document.getElementById('mobcard-detail'),
    mobileDetailOverlay: document.getElementById('mobcard-overlay'),
    cardOverlayBackdrop: document.getElementById('mobcard-overlay-backdrop'),
    reportModal: document.getElementById('report-modal'),
    reportForm: document.getElementById('report-form') as HTMLFormElement | null,
    modalMobName: document.getElementById('modal-mob-name'),
    modalStatus: document.getElementById('modal-status'),
    modalTimeInput: document.getElementById('report-datetime') as HTMLInputElement | null,
    modalForceSubmit: document.getElementById('report-force-submit') as HTMLInputElement | null,
    authModal: document.getElementById('auth-modal'),
    authVCode: document.getElementById('auth-v-code'),
    authStatus: document.getElementById('auth-modal-status'),
    authLodestoneId: document.getElementById('auth-lodestone-id') as HTMLInputElement | null,
    loadingOverlay: document.getElementById('loading-overlay'),
    appNav: document.getElementById('appnav'),
    manualModal: document.getElementById('manual-modal'),
    readmeContainer: document.getElementById('readme-container'),
    body: document.body,
    filterAccordion: document.getElementById('sidebar-filter-accordion'),
    appNavPanelItems: document.querySelectorAll(".appnav-panel .js-appnav-panel-item"),
    cardTemplate: document.getElementById('mobcard-card-template') as HTMLTemplateElement | null,
    globalMagnifier: document.getElementById('global-magnifier'),
    authCopyCodeBtn: document.getElementById('auth-copy-code'),
    authVerifyBtn: document.getElementById('auth-verify') as HTMLButtonElement | null,
    readmeAuthSession: document.getElementById('readme-auth-session'),
    closeManualModalBtn: document.getElementById('close-manual-modal'),
    notificationToggle: document.getElementById('appnav-notification-toggle') as HTMLInputElement | null,
    cancelReportBtn: document.getElementById('cancel-report'),
    authCancelBtn: document.getElementById('auth-cancel')
};

export function getStatusLabel(status: string, rank: string): string {
    const mapping = STATUS_LABELS[status] || STATUS_LABELS.Unknown;
    if (typeof mapping === "object") {
        return rank === 'S' ? mapping.S : mapping.others;
    }
    return mapping;
}

export function safeJsonParse(str: string | null, fallback: any = null): any {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

export function extractLodestoneId(input: string | null): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    const idMatch = trimmed.match(/character\/(\d+)/);
    const lodestoneId = idMatch ? idMatch[1] : trimmed.match(/^\d+$/) ? trimmed : null;

    if (!lodestoneId || lodestoneId.length > 20) return null;
    return lodestoneId;
}

export function handleAppError(error: any, context = "エラーが発生しました", notifyUser = true): void {
    const message = error.message || String(error);
    console.error(`[${context}]`, error);

    if (notifyUser) {
        window.dispatchEvent(new CustomEvent('appNotify', {
            detail: { message: `${context}: ${message}`, type: 'error' }
        }));
    }
}

// ─── State ──────────────────────────────────────────────
export const state: AppState = {
    userId: localStorage.getItem("user_uuid") || null,
    lodestoneId: localStorage.getItem("lodestone_id") || null,
    characterName: localStorage.getItem("character_name") || null,
    isVerified: localStorage.getItem("is_verified") === "true",
    baseMobData: [],
    mobs: [],
    maintenance: null,
    initialLoadComplete: false,
    worker: null,

    filter: (() => {
        const val = localStorage.getItem("huntFilterState");
        const parsed = safeJsonParse(val, {});
        if (parsed.clickStep === undefined) parsed.clickStep = 1;

        return {
            rank: parsed.rank || "ALL",
            clickStep: parsed.clickStep,
            areaSets: parsed.areaSets || { S: [], A: [], F: [], ALL: [] },
            allRankSet: parsed.allRankSet || []
        };
    })(),
    openMobCardNo: null,
    notificationEnabled: localStorage.getItem("huntNotificationEnabled") === "true",
    pendingCalculationMobs: new Set<number>(),
    pendingStatusMap: null,
    pendingMaintenanceData: null,
    pendingLocationsMap: null,
    pendingMemoData: null,
    _filterVersion: 0,
    sMobMap: new Map<string, Mob>(),
    mobsMap: new Map<string, Mob>(),
    hasUnreadTelop: false,
    mobLocations: {}
};

if (state.filter.areaSets) {
    for (const k in state.filter.areaSets) {
        const v = (state.filter.areaSets as any)[k];
        (state.filter.areaSets as any)[k] = new Set(v || []);
    }
} else {
    state.filter.areaSets = {
        S: new Set<string>(),
        A: new Set<string>(),
        F: new Set<string>(),
        ALL: new Set<string>()
    };
}

if (Array.isArray(state.filter.allRankSet)) {
    state.filter.allRankSet = new Set(state.filter.allRankSet);
} else if (!(state.filter.allRankSet instanceof Set)) {
    state.filter.allRankSet = new Set<string>();
}

// ─── State Accessors ────────────────────────────────────
export function getState(): AppState {
    return state;
}

export function setUserId(uid: string | null): void {
    state.userId = uid;
    if (uid) {
        localStorage.setItem("user_uuid", uid);
    } else {
        localStorage.removeItem("user_uuid");
    }
}

export function setLodestoneId(id: string | null): void {
    state.lodestoneId = id;
    if (id) {
        localStorage.setItem("lodestone_id", id);
    } else {
        localStorage.removeItem("lodestone_id");
    }
}

export function setCharacterName(name: string | null): void {
    state.characterName = name;
    if (name) {
        localStorage.setItem("character_name", name);
    } else {
        localStorage.removeItem("character_name");
    }
    window.dispatchEvent(new CustomEvent('characterNameSet'));
}

export function setVerified(verified: boolean): void {
    state.isVerified = verified;
    localStorage.setItem("is_verified", verified ? "true" : "false");
}

function setMobs(data: Mob[]): void {
    state.mobs = data;
    state.mobsMap.clear();
    data.forEach(m => state.mobsMap.set(String(m.No), m));
    updateSMobMap();
}

export function updateSMobMap(): void {
    state.sMobMap.clear();
    state.mobs.forEach(m => {
        if (m.rank === "S") {
            const instance = m.No % 10;
            state.sMobMap.set(`${m.area}_${instance}`, m);
        }
    });
}

export function setFilter(partial: Partial<FilterState>): void {
    state.filter = { ...state.filter, ...partial } as FilterState;
    state._filterVersion++;
    const serialized = {
        ...state.filter,
        areaSets: Object.keys(state.filter.areaSets).reduce((acc: Record<string, string[]>, key) => {
            const v = (state.filter.areaSets as any)[key];
            acc[key] = v instanceof Set ? Array.from(v) : v;
            return acc;
        }, {}),
        allRankSet: Array.from(state.filter.allRankSet || [])
    };
    localStorage.setItem("huntFilterState", JSON.stringify(serialized));
    window.dispatchEvent(new CustomEvent('filterChanged'));
}

export function setOpenMobCardNo(no: number | null): void {
    state.openMobCardNo = no;
}

export function setNotificationEnabled(enabled: boolean): void {
    state.notificationEnabled = enabled;
    localStorage.setItem("huntNotificationEnabled", enabled ? "true" : "false");
    window.dispatchEvent(new CustomEvent('notificationSettingChanged', { detail: { enabled } }));
}

const LAST_SEEN_TELOP_KEY = "huntLastSeenTelopMessage";

export function checkTelopUnread(msg: string | null): void {
    const message = msg || "";
    if (message.trim() === "") {
        state.hasUnreadTelop = false;
        return;
    }
    const lastSeen = localStorage.getItem(LAST_SEEN_TELOP_KEY) || "";
    state.hasUnreadTelop = message !== lastSeen;
}

export function setTelopRead(): void {
    const currentMsg = (state.maintenance && state.maintenance.message) ? state.maintenance.message : "";
    localStorage.setItem(LAST_SEEN_TELOP_KEY, currentMsg);
    state.hasUnreadTelop = false;
    window.dispatchEvent(new CustomEvent('maintenanceUpdated', { detail: { maintenance: state.maintenance } }));
}

// ─── IndexedDB Cache ────────────────────────────────────
const idb = {
    db: null as IDBDatabase | null,
    _initPromise: null as Promise<IDBDatabase> | null,
    async init(): Promise<IDBDatabase> {
        if (this.db) return this.db;
        if (this._initPromise) return this._initPromise;
        this._initPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open("HuntDB", 1);
                req.onupgradeneeded = (e: any) => {
                    e.target.result.createObjectStore("cache");
                };
                req.onsuccess = (e: any) => { this.db = e.target.result; resolve(this.db!); };
                req.onerror = () => reject(req.error);
            } catch (err) {
                handleAppError(err, "IndexedDB初期化失敗", false);
                reject(err);
            }
        });
        return this._initPromise;
    },
    async get(key: string): Promise<any> {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction("cache", "readonly");
                const store = tx.objectStore("cache");
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            handleAppError(e, "IDB取得失敗", false);
            return null;
        }
    },
    async set(key: string, val: any): Promise<any> {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction("cache", "readwrite");
                const store = tx.objectStore("cache");
                const req = store.put(val, key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            handleAppError(e, "IDB保存失敗", false);
        }
    }
};

// ─── Worker ─────────────────────────────────────────────
let memorySpawnCache: Record<number, SpawnCache> | null = null;

// mobNoごとの境界タイマーを管理するMap
const repopTimers = new Map<number, any>();

const saveSpawnCacheDebounced = (() => {
    let timeout: any;
    return (cache: Record<number, SpawnCache>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            idb.set(SPAWN_CACHE_KEY, cache);
        }, CONFIG.IDB_SAVE_DEBOUNCE);
    };
})();

/**
 * repopInfoのnextBoundarySecに基づいてタイマーをセットし、
 * 境界到達時にforceRecalc: trueで再計算を投げる。
 */
function scheduleRepopTimer(mobNo: number, repopInfo: RepopInfo) {
    if (repopTimers.has(mobNo)) {
        clearTimeout(repopTimers.get(mobNo));
        repopTimers.delete(mobNo);
    }

    const bSec = repopInfo.nextBoundarySec;
    if (!bSec || bSec === Infinity) return;

    const nowSec = Date.now() / 1000;
    const delayMs = (bSec - nowSec) * 1000;

    if (delayMs <= 0 || delayMs > 7 * 24 * 3600 * 1000) return;

    const timer = setTimeout(() => {
        repopTimers.delete(mobNo);
        const mob = state.mobsMap.get(String(mobNo));
        if (mob) {
            requestWorkerCalculation(mob, state.maintenance, { forceRecalc: true });
        }
    }, delayMs);

    repopTimers.set(mobNo, timer);
}

function initWorker() {
    if (state.worker) return;
    state.worker = new Worker(new URL("./workers/calWorker.ts", import.meta.url), { type: "module" });
    state.worker.onmessage = (e) => {
        const { type, mobNo, repopInfo, spawnCache, error } = e.data;
        if (type === WORKER_TYPES.RESULT) {
            const current = state.mobs;
            const idx = current.findIndex(m => m.No === mobNo);
            state.pendingCalculationMobs.delete(mobNo);
            if (idx !== -1) {
                if (repopInfo.nextMinRepopDate) repopInfo.nextMinRepopDate = new Date(repopInfo.nextMinRepopDate);
                if (repopInfo.nextConditionSpawnDate) repopInfo.nextConditionSpawnDate = new Date(repopInfo.nextConditionSpawnDate);
                if (repopInfo.conditionWindowEnd) repopInfo.conditionWindowEnd = new Date(repopInfo.conditionWindowEnd);

                current[idx].repopInfo = repopInfo;
                if (spawnCache && memorySpawnCache) {
                    current[idx]._spawnCache = spawnCache;
                    memorySpawnCache[mobNo] = spawnCache;
                    saveSpawnCacheDebounced(memorySpawnCache);
                }

                scheduleRepopTimer(mobNo, repopInfo);

                if (!state.initialLoadComplete && state.pendingCalculationMobs.size === 0 && initialCalculationStarted) {
                    checkInitialLoadComplete();
                }

                window.dispatchEvent(new CustomEvent('mobUpdated', { detail: { mobNo, mob: current[idx] } }));
            }
        } else if (type === WORKER_TYPES.ERROR) {
            state.pendingCalculationMobs.delete(mobNo);
            console.error(`時間計算エラー (Mob ${mobNo}):`, error);
        }
    };
}

export function requestWorkerCalculation(mob: Mob, maintenance: any, options: { forceRecalc?: boolean } = {}): void {
    if (state.pendingCalculationMobs.has(mob.No)) return;
    if (!state.worker) initWorker();
    state.pendingCalculationMobs.add(mob.No);
    state.worker!.postMessage({
        type: WORKER_TYPES.CALCULATE,
        mob,
        maintenance,
        options
    });
}

// ─── データ加工 ─────────────────────────────────────────
function processMobData(rawMobData: any, maintenance: any, options: { skipConditionCalc?: boolean } = {}): Mob[] {
    const { skipConditionCalc = false } = options;
    return Object.entries(rawMobData.mobs).map(([no, mobVal]: [string, any]) => {
        const mappedMob: Mob = {
            ...mobVal,
            No: parseInt(no, 10),
            rank: mobVal.r,
            name: mobVal.n,
            area: mobVal.a,
            repopSeconds: mobVal.min,
            maxRepopSeconds: mobVal.max,
            condition: mobVal.cond || "",
            Expansion: EXPANSION_MAP[Math.floor(parseInt(no, 10) / 10000)] || "Unknown",
            ExpansionId: Math.floor(parseInt(no, 10) / 10000),
            mapImage: "",
            locations: [],
            last_kill_time: 0,
            prev_kill_time: 0,
            spawn_cull_status: {},
            memo_text: "",
            memo_updated_at: 0
        };
        delete (mappedMob as any).r;
        delete (mappedMob as any).n;
        delete (mappedMob as any).a;
        delete (mappedMob as any).min;
        delete (mappedMob as any).max;
        delete (mappedMob as any).cond;

        mappedMob.repopInfo = calculateRepop({ ...mappedMob, last_kill_time: 0 }, maintenance, { skipConditionCalc });
        return mappedMob;
    });
}

// ─── データ読込 ─────────────────────────────────────────
async function loadMaintenance(): Promise<any> {
    try {
        const res = await fetch(MAINTENANCE_URL);
        if (!res.ok) throw new Error("Maintenance data failed to load.");
        const data = await res.json();
        state.maintenance = (data && data.maintenance) ? data.maintenance : data;
        checkTelopUnread(state.maintenance?.message);
        return state.maintenance;
    } catch (e) {
        handleAppError(e, "メンテ情報読み込み失敗", false);
        return null;
    }
}

async function loadLocationData(): Promise<void> {
    try {
        const cachedLocsStr = await idb.get(LOCATIONS_CACHE_KEY);
        const cachedLocs = safeJsonParse(cachedLocsStr);
        if (cachedLocs) {
            applyLocationsToState(cachedLocs);
        }

        const res = await fetch(MOB_LOCATIONS_URL);
        if (!res.ok) throw new Error("Location data failed to load.");
        const locationsData = await res.json();
        const freshLocsStr = JSON.stringify(locationsData);

        if (freshLocsStr !== cachedLocsStr) {
            await idb.set(LOCATIONS_CACHE_KEY, freshLocsStr);
            applyLocationsToState(locationsData);
        }
    } catch (e) {
        handleAppError(e, "位置データ読み込み失敗", false);
    }
}

function applyLocationsToState(locationsData: any): void {
    state.baseMobData.forEach(mob => {
        const locInfo = locationsData[mob.area];
        if (locInfo) {
            mob.locations = locInfo.locations || [];
            mob.mapImage = locInfo.mapImage || "";
        }
    });

    state.mobs.forEach(mob => {
        const locInfo = locationsData[mob.area];
        if (locInfo) {
            mob.locations = locInfo.locations || [];
            mob.mapImage = locInfo.mapImage || "";
        }
    });

    window.dispatchEvent(new CustomEvent('locationDataReady'));
}

export async function loadBaseMobData(): Promise<void> {
    const maintenance = null;
    const cachedDataStr = await idb.get(MOB_DATA_CACHE_KEY);
    let cachedData = null;

    memorySpawnCache = await idb.get(SPAWN_CACHE_KEY) || {};

    cachedData = safeJsonParse(cachedDataStr);

    if (cachedData) {
        const processed = processMobData(cachedData, maintenance, { skipConditionCalc: true });
        const cachedStatus = await idb.get(MOB_STATUS_CACHE_KEY);
        if (cachedStatus) {
            processed.forEach(m => {
                const s = cachedStatus[m.No];
                if (s) {
                    m.last_kill_time = s.last_kill_time || 0;
                    m.prev_kill_time = s.prev_kill_time || 0;
                }
            });
        }

        processed.forEach(mob => {
            if (memorySpawnCache && memorySpawnCache[mob.No]) {
                mob._spawnCache = memorySpawnCache[mob.No];
            }
            mob.repopInfo = calculateRepop(mob, maintenance, { skipConditionCalc: true });
        });

        state.baseMobData = processed;
        setMobs([...processed]);
        scheduleConditionCalculation(processed, maintenance);
    }

    try {
        const mobRes = await fetch(MOB_DATA_URL);
        if (!mobRes.ok) throw new Error("Mob data failed to load.");

        const freshData = await mobRes.json();
        const freshDataStr = JSON.stringify(freshData);

        if (freshDataStr !== cachedDataStr) {
            await idb.set(MOB_DATA_CACHE_KEY, freshDataStr);

            const processed = processMobData(freshData, maintenance, { skipConditionCalc: true });
            processed.forEach(mob => {
                if (memorySpawnCache && memorySpawnCache[mob.No]) {
                    mob._spawnCache = memorySpawnCache[mob.No];
                    mob.repopInfo = calculateRepop(mob, maintenance, { skipConditionCalc: true });
                }
            });

            state.baseMobData = processed;
            setMobs([...processed]);
            scheduleConditionCalculation(processed, maintenance);
        }

        await loadLocationData();

        if (state.baseMobData.length > 0) {
            applyPendingRealtimeData();
        }

    } catch (e) {
        handleAppError(e, "基礎データ読み込み失敗");
        if (!cachedData) {
            console.error("データの読み込みに失敗しました。");
            window.dispatchEvent(new CustomEvent('criticalDataLoadError', {
                detail: { message: "基礎データの読み込みに失敗しました。\nアプリをファイルから直接開いている場合は、VS CodeのLive Serverなどを使って開いてください。" }
            }));
        } else {
            await loadLocationData();
            if (state.baseMobData.length > 0) {
                applyPendingRealtimeData();
            }
        }
    }
}

// ─── 初期化 ─────────────────────────────────────────────
const initialLoadState = {
    status: false,
    location: false,
    memo: false,
    maintenance: false
};

let initialCalculationStarted = false;
let initialLoadTimer: any = null;
let unsubscribes: (() => void)[] = [];

function applyPendingRealtimeData(): void {
    const current = state.mobs;

    if (state.pendingMaintenanceData !== undefined) {
        const maintenanceData = state.pendingMaintenanceData;
        if (maintenanceData) {
            state.maintenance = maintenanceData;
        }
        initialLoadState.maintenance = true;
    }

    if (state.pendingStatusMap) {
        const map = new Map<number, { last_kill_time: number; prev_kill_time: number }>();
        Object.values(state.pendingStatusMap).forEach((docData: any) => {
            Object.entries(docData).forEach(([mobId, mobData]: [string, any]) => {
                const mobNo = parseInt(mobId, 10);
                map.set(mobNo, {
                    last_kill_time: mobData.last_kill_time?.seconds || 0,
                    prev_kill_time: mobData.prev_kill_time?.seconds || 0,
                });
            });
        });

        current.forEach(m => {
            const dyn = map.get(m.No);
            if (dyn) {
                m.last_kill_time = dyn.last_kill_time;
                m.prev_kill_time = dyn.prev_kill_time;
            }
        });
        initialLoadState.status = true;
        state.pendingStatusMap = null;
    }

    if (state.pendingLocationsMap) {
        state.mobLocations = state.pendingLocationsMap;
        current.forEach(m => {
            const instance = m.No % 10;
            const key = `${m.area}_${instance}`;
            const dyn = state.pendingLocationsMap[key];
            m.spawn_cull_status = dyn || {};
        });
        initialLoadState.location = true;
        state.pendingLocationsMap = null;
    }

    if (state.pendingMemoData) {
        const memoData = state.pendingMemoData;
        current.forEach(m => {
            const memos = memoData[m.No] || [];
            const latest = memos[0];
            if (latest) {
                m.memo_text = latest.memo_text;
                m.memo_updated_at = latest.created_at?.seconds || 0;
            } else {
                m.memo_text = "";
            }
        });
        initialLoadState.memo = true;
        state.pendingMemoData = null;
    }

    const maintenance = state.maintenance;
    current.forEach(mob => {
        mob.repopInfo = calculateRepop(mob, maintenance, { skipConditionCalc: true });
    });

    setMobs([...current]);

    checkInitialLoadComplete();
}

function scheduleConditionCalculation(mobs: Mob[], maintenance: any): void {
    const conditionMobs = mobs.filter(mob =>
        mob.moonPhase || mob.timeRange || mob.timeRanges ||
        mob.weatherSeedRange || mob.weatherSeedRanges || mob.conditions
    );

    if (conditionMobs.length === 0) return;

    conditionMobs.forEach(mob => {
        requestWorkerCalculation(mob, maintenance);
    });
}

function checkInitialLoadComplete(): void {
    if (state.mobs.length === 0) return;

    if (initialLoadState.status && initialLoadState.maintenance) {
        if (!state.initialLoadComplete) {
            const current = state.mobs;
            const maintenance = state.maintenance;

            if (!initialCalculationStarted) {
                initialCalculationStarted = true;
                scheduleConditionCalculation(current, maintenance);
                if (state.pendingCalculationMobs.size > 0) {
                    return;
                }
            }

            if (state.pendingCalculationMobs.size > 0) {
                return;
            }

            state.initialLoadComplete = true;
            if (initialLoadTimer) {
                clearTimeout(initialLoadTimer);
                initialLoadTimer = null;
            }

            current.forEach(mob => {
                mob.repopInfo = calculateRepop(mob, maintenance);
            });
            setMobs([...current]);

            window.dispatchEvent(new CustomEvent('initialDataLoaded'));
        }
    }
}

// ─── リアルタイム ───────────────────────────────────────
export function startRealtime(): void {
    unsubscribes.forEach(fn => fn && fn());
    unsubscribes = [];

    repopTimers.forEach(timer => clearTimeout(timer));
    repopTimers.clear();

    state.initialLoadComplete = false;
    initialLoadState.status = false;
    initialLoadState.location = false;
    initialLoadState.memo = false;
    initialLoadState.maintenance = false;

    if (initialLoadTimer) clearTimeout(initialLoadTimer);
    initialLoadTimer = setTimeout(() => {
        if (!state.initialLoadComplete) {
            console.warn("Firestore initial load timed out. Forcing completion with available data.");
            if (!initialLoadState.status) initialLoadState.status = true;
            if (!initialLoadState.maintenance) {
                initialLoadState.maintenance = true;
                if (!state.maintenance) {
                    loadMaintenance().then(fallback => {
                        if (fallback) state.maintenance = fallback;
                    });
                }
            }
            checkInitialLoadComplete();
        }
    }, CONFIG.FIRESTORE_LOAD_TIMEOUT);

    const unsubStatus = subscribeMobStatusDocs((mobStatusDataMap: any) => {
        if (state.mobs.length === 0) {
            state.pendingStatusMap = mobStatusDataMap;
            return;
        }

        const current = state.mobsMap;
        let anyChanges = false;
        const updatedMobNos = new Set<number>();

        Object.values(mobStatusDataMap).forEach((docData: any) => {
            Object.entries(docData).forEach(([mobId, mobData]: [string, any]) => {
                const mob = current.get(mobId);
                if (!mob) return;

                const newLastKill = mobData.last_kill_time?.seconds || 0;
                const newPrevKill = mobData.prev_kill_time?.seconds || 0;

                if (mob.last_kill_time !== newLastKill || mob.prev_kill_time !== newPrevKill) {
                    mob.last_kill_time = newLastKill;
                    mob.prev_kill_time = newPrevKill;
                    requestWorkerCalculation(mob, state.maintenance, { forceRecalc: true });
                    anyChanges = true;
                    updatedMobNos.add(parseInt(mobId, 10));
                }
            });
        });

        if (!state.initialLoadComplete) {
            initialLoadState.status = true;
            checkInitialLoadComplete();
        }

        if (anyChanges) {
            if (state.initialLoadComplete) {
                const statusToCache = state.mobs.reduce((acc: Record<number, any>, m) => {
                    acc[m.No] = { last_kill_time: m.last_kill_time, prev_kill_time: m.prev_kill_time };
                    return acc;
                }, {});
                idb.set(MOB_STATUS_CACHE_KEY, statusToCache);

                window.dispatchEvent(new CustomEvent('mobsBatchUpdated', {
                    detail: {
                        mobNos: Array.from(updatedMobNos),
                        updateType: 'status'
                    }
                }));

                window.dispatchEvent(new CustomEvent('mobsUpdated'));
            }
        }
    });
    unsubscribes.push(unsubStatus);

    const unsubLoc = subscribeMobLocations((locationsMap: any) => {
        if (state.mobs.length === 0) {
            state.pendingLocationsMap = locationsMap;
            return;
        }

        state.mobLocations = locationsMap;
        const updatedMobNos: number[] = [];

        const affectedAreas = new Set(Object.keys(locationsMap).map(k => k.split('_')[0]));

        state.mobs.forEach(m => {
            if (affectedAreas.has(m.area)) {
                const instance = m.No % 10;
                const key = `${m.area}_${instance}`;
                const dyn = locationsMap[key];
                if (dyn) {
                    m.spawn_cull_status = dyn;
                    if (state.initialLoadComplete) {
                        updatedMobNos.push(m.No);
                    }
                }
            }
        });

        if (!state.initialLoadComplete) {
            initialLoadState.location = true;
            checkInitialLoadComplete();
        } else {
            if (updatedMobNos.length > 0) {
                window.dispatchEvent(new CustomEvent('mobsBatchUpdated', {
                    detail: {
                        mobNos: updatedMobNos,
                        updateType: 'location'
                    }
                }));
            }
            window.dispatchEvent(new CustomEvent('locationsUpdated', { detail: { locationsMap } }));
        }
    });
    unsubscribes.push(unsubLoc);

    const unsubMemo = subscribeMobMemos((memoData: any) => {
        if (state.mobs.length === 0) {
            state.pendingMemoData = memoData;
            return;
        }

        const memoMobNos = Object.keys(memoData);
        const updatedMobNosList: number[] = [];

        memoMobNos.forEach(mobNoStr => {
            const mob = state.mobsMap.get(mobNoStr);
            if (!mob) return;
            const mobNo = parseInt(mobNoStr, 10);

            const memos = memoData[mobNoStr] || [];
            const latest = memos[0];
            const oldMemo = mob.memo_text;

            if (latest) {
                mob.memo_text = latest.memo_text;
                mob.memo_updated_at = latest.created_at?.seconds || 0;
            } else {
                mob.memo_text = "";
                mob.memo_updated_at = 0;
            }

            if (state.initialLoadComplete && oldMemo !== mob.memo_text) {
                updatedMobNosList.push(mobNo);
            }
        });

        if (!state.initialLoadComplete) {
            initialLoadState.memo = true;
            checkInitialLoadComplete();
        } else {
            if (updatedMobNosList.length > 0) {
                window.dispatchEvent(new CustomEvent('mobsBatchUpdated', {
                    detail: {
                        mobNos: updatedMobNosList,
                        updateType: 'memo'
                    }
                }));
            }
            window.dispatchEvent(new CustomEvent('mobsUpdated'));
        }
    });
    unsubscribes.push(unsubMemo);

    const unsubMaintenance = subscribeMaintenance(async (maintenanceData: any) => {
        const normalized = (maintenanceData && maintenanceData.maintenance) ? maintenanceData.maintenance : maintenanceData;

        if (state.mobs.length === 0) {
            state.pendingMaintenanceData = normalized;
            if (!normalized) {
                const fallback = await loadMaintenance();
                if (fallback) {
                    state.pendingMaintenanceData = fallback;
                }
            }
            return;
        }

        if (!state.initialLoadComplete) {
            if (normalized) {
                state.maintenance = normalized;
                checkTelopUnread(normalized.message);
            } else {
                const fallback = await loadMaintenance();
                if (fallback) {
                    state.maintenance = fallback;
                    checkTelopUnread(fallback.message);
                }
            }
            initialLoadState.maintenance = true;
            checkInitialLoadComplete();
        } else {
            if (!normalized) return;
            state.maintenance = normalized;
            checkTelopUnread(normalized.message);

            const current = state.mobs;
            current.forEach(mob => {
                requestWorkerCalculation(mob, normalized);
            });
            setMobs([...current]);
            window.dispatchEvent(new CustomEvent('filterChanged'));
            window.dispatchEvent(new CustomEvent('mobsUpdated'));
            window.dispatchEvent(new CustomEvent('maintenanceUpdated'));
        }
    });
    unsubscribes.push(unsubMaintenance);
}

// ─── ユーティリティ ─────────────────────────────────────
export function recalculateMob(mobNo: number): Mob | undefined {
    const stateVal = getState();
    const mob = stateVal.mobsMap.get(String(mobNo));
    if (!mob) return;

    requestWorkerCalculation(mob, stateVal.maintenance, { forceRecalc: true });
    return mob;
}

export function updateAllMobCullStatuses(locationsMap: any = state.mobLocations): void {
    const current = state.mobs;
    state.mobLocations = locationsMap;
    current.forEach(m => {
        const instance = m.No % 10;
        const key = `${m.area}_${instance}`;
        const dyn = locationsMap[key];
        m.spawn_cull_status = dyn || {};
    });
}

export function isCulled(pointStatus: CullStatus | undefined, mobNo: number, mob: Mob | null = null): boolean {
    const s = getState();
    if (!mob) {
        mob = s.mobsMap.get(String(mobNo)) || null;
    }
    if (!mob) return false;

    const instance = mob.No % 10;
    const targetSMob = s.sMobMap.get(`${mob.area}_${instance}`);

    const baseLastKillTime = targetSMob ? (targetSMob.last_kill_time || 0) : (mob.last_kill_time || 0);

    const serverUpSec = s.maintenance?.serverUp
        ? new Date(s.maintenance.serverUp).getTime()
        : 0;

    const culledMs = pointStatus?.culled_at && typeof (pointStatus.culled_at as any).toMillis === "function"
        ? (pointStatus.culled_at as any).toMillis()
        : (pointStatus?.culled_at as any)?.seconds ? (pointStatus?.culled_at as any).seconds * 1000 : 0;

    const uncullMs = pointStatus?.uncull_at && typeof (pointStatus.uncull_at as any).toMillis === "function"
        ? (pointStatus.uncull_at as any).toMillis()
        : (pointStatus?.uncull_at as any)?.seconds ? (pointStatus?.uncull_at as any).seconds * 1000 : 0;

    const lastKillMs = typeof baseLastKillTime === "number" ? baseLastKillTime * 1000 : 0;
    const validCulledMs = culledMs > serverUpSec ? culledMs : 0;
    const validUnculledMs = uncullMs > serverUpSec ? uncullMs : 0;

    if (validCulledMs === 0 && validUnculledMs === 0) return false;

    const culledAfterKill = validCulledMs > lastKillMs;
    const unculledAfterKill = validUnculledMs > lastKillMs;

    if (culledAfterKill && (!unculledAfterKill || validCulledMs >= validUnculledMs)) return true;
    if (unculledAfterKill && (!culledAfterKill || validUnculledMs >= validCulledMs)) return false;

    return false;
}
