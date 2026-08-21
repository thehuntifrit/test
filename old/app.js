import { getState, updateAllMobCullStatuses, loadBaseMobData, startRealtime, setOpenMobCardNo, setUserId, setLodestoneId, setCharacterName, setVerified, isCulled, STATUS_LABELS, CONFIG, DOM, handleAppError } from "./dataManager.js";
import { calculateRepop, getDurationDHMParts, formatDurationDHM, formatDurationColon, formatMMDDHHmm, debounce, getEorzeaTime, EORZEA_MINUTE_MS } from "./cal.js";
import { createMobCard, updateProgressBar, updateProgressText, updateExpandablePanel, updateMemoIcon, updateMobCount, updateAreaInfo, updateMapOverlay, createSimpleMobItem, updateSimpleMobItem, escapeHtml, initGlobalMagnifier, adjustMemoHeight } from "./mobCard.js";
import { getGroupKey, GROUP_LABELS, getOrCreateGroupSection, getSortedFilteredMobs, getFilteredMobs, invalidateFilterCache, invalidateSortCache, allTabComparator } from "./mobSorter.js";
import { closeReportModal, openAuthModal, openReportModal, initModal, closeAuthModal } from "./modal.js";
import { handleAreaFilterClick, handleRankTabClick, initAppNav, initNotification, togglePanel, closePanel, setActiveNavItem, checkAndNotify, updateErrorPanel } from "./sidebar.js";
import { initializeAuth, getUserData, submitReport, submitMemo, toggleCrushStatus } from "./server.js";
import { openUserManual } from "./readme.js";


// ─── 定数 ──────────────────────────────────────────────
export const cardCache = new Map();

const visibleCards = new Set();
let hasUrgentMob = false;

const CULLED_CLASS_MAP = {
  "color-b1": "color-b1-culled",
  "color-b2": "color-b2-culled",
}

const UNCULLED_CLASS_MAP = {
  "color-b1-culled": "color-b1",
  "color-b2-culled": "color-b2",
}

let isInitialLoading = false;
let isInitialSortingSuppressed = false;
let lastClickTime = 0;
let lastClickLocationId = null;
let locationEventsAttached = false;
let loadingTimeout = null;

// ─── 初期化 ─────────────────────────────────────────────
async function initApp() {
  try {
    initAppEventListeners();
    attachMobCardEvents();
    initGlobalMagnifier();
    loadBaseMobData();

    initializeAuth().then(async (userId) => {
      if (userId) {
        setUserId(userId);
        const userData = await getUserData(userId);
        if (userData && userData.lodestone_id) {
          setLodestoneId(userData.lodestone_id);
          if (userData.character_name) setCharacterName(userData.character_name);
          setVerified(true);
        } else {
          setVerified(false);
          setLodestoneId(null);
          setCharacterName(null);
        }
      } else {
        setVerified(false);
        setUserId(null);
        setLodestoneId(null);
        setCharacterName(null);
      }
    }).catch(err => {
      handleAppError(err, "Auth初期化失敗");
      setVerified(false);
      window.dispatchEvent(new CustomEvent('initialDataLoaded'));
    });

    startRealtime();
    setOpenMobCardNo(null);
    initModal();
    renderMaintenanceStatus();
    updateHeaderTime();
    initAppNav();
    attachLocationEvents();
    attachGlobalEventListeners();
    window.renderMaintenanceStatus = renderMaintenanceStatus;

    loadingTimeout = setTimeout(() => {
      const overlay = DOM.loadingOverlay;
      if (overlay && !overlay.classList.contains("hidden")) {
        console.warn("Loading timeout: Forcing UI display.");
        if (!getState().initialLoadComplete) {
          window.dispatchEvent(new CustomEvent('initialDataLoaded'));
        }
        showColumnContainer();
        overlay.classList.add("hidden");
        showToast("データ同期がタイムアウトしました。既存のデータで表示します。", "info");
      }
    }, CONFIG.APP_LOAD_TIMEOUT);

  } catch (e) {
    handleAppError(e, "アプリ初期化致命的エラー");
    showColumnContainer();
  }
}

export function showColumnContainer() {
  if (!DOM.colContainer) return;

  requestAnimationFrame(() => {
    DOM.colContainer.classList.add("is-ready");

    requestAnimationFrame(() => {
      const overlay = document.getElementById("loading-overlay");
      if (overlay) {
        overlay.classList.add("hidden");
      }
    });
  });
}

// ─── メンテナンス表示 ───────────────────────────────────
async function getMaintenanceStatus() {
  const state = getState();
  const maintenance = state.maintenance;

  if (!maintenance || !maintenance.start || !maintenance.end) {
    return {
      is_active: false,
      scheduled: false,
      message: maintenance ? maintenance.message : ""
    };
  }

  const now = new Date();
  const start = new Date(maintenance.start);
  const end = new Date(maintenance.end);
  const showFrom = new Date(start.getTime() - CONFIG.MAINTENANCE_SHOW_BEFORE_MS);
  const showUntil = new Date(end.getTime() + CONFIG.MAINTENANCE_SHOW_AFTER_MS);

  const isWithinDisplayWindow = now >= showFrom && now <= showUntil;

  let status = {
    is_active: false,
    scheduled: false,
    start_time: maintenance.start,
    end_time: maintenance.end,
    message: maintenance.message || ""
  };

  if (isWithinDisplayWindow) {
    if (now >= start && now <= end) {
      status.is_active = true;
    } else if (now < start) {
      status.scheduled = true;
    }
  }

  return status;
}

export async function renderMaintenanceStatus() {
  const state = getState();
  const maintenance = await getMaintenanceStatus();

  const maintPanels = document.querySelectorAll(".js-maintenance-content");
  const telopPanels = document.querySelectorAll(".js-telop-content");

  let hasMaintenance = false;
  let hasMessage = false;

  if (maintenance && (maintenance.is_active || maintenance.scheduled)) {
    hasMaintenance = true;
  }

  maintPanels.forEach(p => {
    p.innerHTML = "";
    if (!hasMaintenance) {
      p.textContent = "現在予定されているメンテナンスはありません";
      return;
    }
    const isPC = window.innerWidth >= 1024;
    if (isPC) {
      const startLine = document.createElement("div");
      startLine.textContent = `${formatMMDDHHmm(maintenance.start_time)} ～`;
      const endLine = document.createElement("div");
      if (maintenance.end_time) {
        endLine.innerHTML = `&nbsp;&nbsp;&nbsp;&nbsp;${formatMMDDHHmm(maintenance.end_time)}`;
      }
      p.appendChild(startLine);
      p.appendChild(endLine);
    } else {
      const start = formatMMDDHHmm(maintenance.start_time);
      const end = maintenance.end_time ? formatMMDDHHmm(maintenance.end_time) : "";
      p.textContent = end ? `${start} ～ ${end}` : `${start} ～`;
    }
  });

  const telopMsg = (maintenance && maintenance.message && maintenance.message.trim() !== "") ? maintenance.message : "";
  hasMessage = telopMsg !== "";

  const nameToDisplay = (state.isVerified && state.characterName) ? state.characterName : "名無しさん";

  const welcomeArea = document.getElementById("sidebar-welcome-area");
  if (welcomeArea) {
    welcomeArea.textContent = "";
    const welcome = document.createElement("div");
    welcome.className = "sidebar-welcome-msg";

    welcome.appendChild(document.createTextNode("ようこそ "));
    const nameSpan = document.createElement("span");
    nameSpan.className = "sidebar-welcome-name";
    nameSpan.textContent = nameToDisplay;
    welcome.appendChild(nameSpan);

    welcomeArea.appendChild(welcome);
  }

  telopPanels.forEach(p => {
    p.textContent = "";
    const msgSpan = document.createElement("span");
    if (telopMsg) {
      const parts = escapeHtml(telopMsg).split(/\/\/|<br>/i);
      parts.forEach((part, i) => {
        msgSpan.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) {
          msgSpan.appendChild(document.createElement('br'));
        }
      });
    } else {
      msgSpan.textContent = "メッセージはありません。";
    }
    p.appendChild(msgSpan);
  });

  document.querySelectorAll(`.appnav-btn[data-nav-id="maintenance"]`)
    .forEach(btn => btn.classList.toggle("has-alert", hasMaintenance));

  document.querySelectorAll(`.appnav-btn[data-nav-id="telop"]`)
    .forEach(btn => btn.classList.toggle("has-alert", state.hasUnreadTelop));

  const errorLogCount = window.errorLog ? window.errorLog.length : 0;
  const hasError = errorLogCount > 0;
  document.querySelectorAll(`.appnav-btn[data-nav-id="error"]`)
    .forEach(btn => btn.classList.toggle("has-alert", hasError));

  document.querySelectorAll(`.appnav-btn[data-nav-id="rank"]`)
    .forEach(btn => btn.classList.remove("has-alert"));
}

// ─── ヘッダー時刻 ───────────────────────────────────────
let headerClocks = null;
let lastLtStr = "";
let lastEtStr = "";

export function updateHeaderTime() {
  if (document.visibilityState === 'hidden') return;

  const now = new Date();
  const et = getEorzeaTime(now);
  const ltStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const etStr = `${et.hours}:${et.minutes}`;

  if (ltStr === lastLtStr && etStr === lastEtStr) return;

  lastLtStr = ltStr;
  lastEtStr = etStr;

  if (!headerClocks) {
    headerClocks = {
      lt: Array.from(document.querySelectorAll('.js-lt-clock')),
      et: Array.from(document.querySelectorAll('.js-et-clock'))
    };
  }

  headerClocks.lt.forEach(el => { if (el.textContent !== ltStr) el.textContent = ltStr; });
  headerClocks.et.forEach(el => { if (el.textContent !== etStr) el.textContent = etStr; });
}

// ─── ソート＆描画 ───────────────────────────────────────
function getMobMap() {
  return getState().mobsMap;
}

function updateVisibleCardsSet() {
  const container = document.getElementById('moblist-container');
  if (!container) return;

  const vh = window.innerHeight;
  const items = container.querySelectorAll('.moblist-item');
  const mobMap = getMobMap();

  const prevVisible = new Set(visibleCards);
  visibleCards.clear();

  items.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > -100 && rect.top < vh + 100) {
      const mobNo = el.dataset.mobNo;
      visibleCards.add(mobNo);
      cardCache.set(mobNo, el);

      if (!prevVisible.has(mobNo)) {
        const mob = mobMap.get(mobNo);
        if (mob) updateCardFull(el, mob);
      }
    }
  });
}

const handleScroll = debounce(updateVisibleCardsSet, 200);
window.addEventListener('scroll', handleScroll, { passive: true });
window.addEventListener('resize', handleScroll, { passive: true });

export function observeCard(el) {
  if (el) {
    const mobNo = el.dataset.mobNo;
    cardCache.set(mobNo, el);
  }
}

export function unobserveCard(el) {
  if (el) {
    const mobNo = el.dataset.mobNo;
    cardCache.delete(mobNo);
    visibleCards.delete(mobNo);
  }
}

export function updateCardFull(card, mob) {
  const info = mob.repopInfo || {};

  let cullHash = "";
  if (mob.spawn_cull_status) {
    for (const key in mob.spawn_cull_status) {
      const s = mob.spawn_cull_status[key];
      const c = s.culled_at?.seconds || 0;
      const u = s.uncull_at?.seconds || 0;
      cullHash += `${key}:${c},${u};`;
    }
  }

  const memoHash = `${mob.memo_updated_at || 0}:${mob.memo_text || ""}`;
  const stateHash = `${info.status}|${info.timeRemaining}|${info.isInConditionWindow}|${cullHash}|${memoHash}`;

  if (card._lastStateHash === stateHash) return;
  card._lastStateHash = stateHash;

  const isDetail = card.classList.contains('mobcard-card');
  const isListItem = card.classList.contains('moblist-item');

  if (isDetail) {
    updateProgressText(card, mob);
    updateProgressBar(card, mob);
    updateMobCount(card, mob);
    updateMapOverlay(card, mob);
    updateExpandablePanel(card, mob);
    updateMemoIcon(card, mob);
  } else if (isListItem) {
    updateSimpleMobItem(card, mob);
  }
}

export const updateVisibleCards = function () {
  const mobMap = getMobMap();
  for (const mobNoStr of visibleCards) {
    const card = cardCache.get(mobNoStr);
    const mob = mobMap.get(mobNoStr);
    if (card && mob) updateCardFull(card, mob);
  }
  updateVisibleDetailCard(mobMap);
};

export function updateVisibleDetailCard(mobMap) {
  const rightPane = DOM.pcRightDetail || document.getElementById("mobcard-detail");
  if (!rightPane || rightPane.offsetParent === null) return;

  if (rightPane.dataset.renderedMobNo && rightPane.dataset.renderedMobNo !== "none") {
    const detailCard = rightPane.firstElementChild;
    const mob = mobMap.get(rightPane.dataset.renderedMobNo);
    if (detailCard && mob) updateCardFull(detailCard, mob);
  }

  const mobileOverlay = DOM.mobileDetailOverlay || document.getElementById("mobcard-overlay");
  if (mobileOverlay && mobileOverlay.offsetParent !== null && mobileOverlay.dataset.renderedMobNo && mobileOverlay.dataset.renderedMobNo !== "none") {
    const detailCard = mobileOverlay.querySelector('.mobcard-card');
    const mob = mobMap.get(mobileOverlay.dataset.renderedMobNo);
    if (detailCard && mob) {
      updateCardFull(detailCard, mob);
    }
  }
}

const debouncedSortAndRedistribute = debounce(() => {
  sortAndRedistribute({ immediate: true });
}, 200);

export const sortAndRedistribute = (options = {}) => {
  const { immediate = false } = options;
  const run = () => {
    filterAndRender();
    if (isInitialLoading) {
      isInitialLoading = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('initialSortComplete'));
        });
      });
    }
  };

  if (immediate) {
    run();
  } else {
    debouncedSortAndRedistribute();
  }
};

export const syncDomOrder = function () {
  if (!DOM.pcLeftList) return;

  invalidateSortCache();
  const sortedMobs = getSortedFilteredMobs();
  const groups = { MAX_OVER: [], WINDOW: [], NEXT: [], MAINTENANCE: [] };
  sortedMobs.forEach(m => {
    groups[getGroupKey(m)].push(m);
  });

  const idealNodes = [];
  const currentNodes = Array.from(DOM.pcLeftList.children);
  const nodeMap = new Map();
  currentNodes.forEach(node => {
    if (node.dataset.mobNo) nodeMap.set(`mob-${node.dataset.mobNo}`, node);
    else if (node.classList.contains('moblist-group-header')) nodeMap.set(`header-${node.textContent}`, node);
  });

  const groupOrder = ["MAX_OVER", "WINDOW", "NEXT", "MAINTENANCE"];
  groupOrder.forEach(key => {
    const groupMobs = groups[key];
    if (groupMobs.length === 0) return;

    const headerKey = `header-${key}`;
    const headerText = GROUP_LABELS[key];
    let header = nodeMap.get(headerKey);
    if (!header) {
      header = document.createElement("div");
      header.className = "moblist-group-header font-bold text-gray-500 uppercase mt-2 mb-1 border-b border-gray-700/50 pb-1 pl-1";
      header.textContent = headerText;
    }
    idealNodes.push(header);

    groupMobs.forEach(m => {
      const itemKey = `mob-${m.No}`;
      let item = nodeMap.get(itemKey);
      if (!item) {
        item = createSimpleMobItem(m);
      }
      idealNodes.push(item);
    });
  });

  for (let i = 0; i < idealNodes.length; i++) {
    const ideal = idealNodes[i];
    const current = DOM.pcLeftList.children[i];

    if (current !== ideal) {
      DOM.pcLeftList.insertBefore(ideal, current || null);
    }
    if (ideal.dataset.mobNo) observeCard(ideal);
  }

  while (DOM.pcLeftList.children.length > idealNodes.length) {
    DOM.pcLeftList.removeChild(DOM.pcLeftList.lastChild);
  }
};

export function filterAndRender({ isInitialLoad = false } = {}) {
  const state = getState();
  if (!state.initialLoadComplete && !isInitialLoad) {
    return;
  }

  if (isInitialLoad) {
    isInitialLoading = true;
  }

  const activeElement = document.activeElement;
  let focusedMobNo = null;
  let focusedAction = null;
  let selectionStart = null;
  let selectionEnd = null;

  if (activeElement && activeElement.closest('.mobcard-card, .moblist-item')) {
    focusedMobNo = activeElement.closest('.mobcard-card, .moblist-item').dataset.mobNo;
    if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
      focusedAction = activeElement.dataset.action;
      selectionStart = activeElement.selectionStart;
      selectionEnd = activeElement.selectionEnd;
    }
  }

  if (DOM.pcLeftList) {
    syncDomOrder();
  }

  const detailContainer = document.getElementById("mobcard-detail");
  const pane = document.getElementById("mobcard-pane");

  if (detailContainer && pane) {
    const openMobNo = getState().openMobCardNo;
    if (openMobNo) {
      if (detailContainer.dataset.renderedMobNo !== String(openMobNo)) {
        const targetMob = getState().mobs.find(m => m.No === openMobNo);
        if (targetMob) {
          detailContainer.innerHTML = "";
          const newCard = createMobCard(targetMob, true);
          detailContainer.appendChild(newCard);
          observeCard(newCard);
          detailContainer.dataset.renderedMobNo = String(openMobNo);
        }
      }
      pane.classList.add("is-active");
      if (window.innerWidth < 1024) {
        document.body.classList.add('body-lock');
      }
    } else {
      if (detailContainer.dataset.renderedMobNo !== "none") {
        detailContainer.innerHTML = window.innerWidth >= 1024 ? '<div class="text-center text-gray-500 mt-20 text-sm">モブを選択すると詳細が表示されます</div>' : "";
        detailContainer.dataset.renderedMobNo = "none";
      }
      pane.classList.remove("is-active");
      document.body.classList.remove('body-lock');
    }
  }

  if (isInitialLoad) {
    isInitialSortingSuppressed = true;

    setTimeout(() => {
      isInitialSortingSuppressed = false;
      sortAndRedistribute();
    }, 100);

    isInitialLoading = false;
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.classList.add("hidden");
  }

  updateVisibleCardsSet();
  updateVisibleCards();

  if (focusedMobNo) {
    const card = cardCache.get(String(focusedMobNo));
    if (card && focusedAction) {
      const input = card.querySelector(`input[data-action="${focusedAction}"]`);
      if (input) {
        input.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          try { input.setSelectionRange(selectionStart, selectionEnd); } catch (e) { }
        }
      }
    }
  }
}

let lastTierBTime = 0;
let lastTierCTime = 0;

export const updateProgressBarsOptimized = function (force = false) {
  if (document.visibilityState === 'hidden' && !force) return;

  const state = getState();
  const now = Date.now();
  const nowSec = now / 1000;

  const isTierB = force || (now - lastTierBTime >= CONFIG.TIER_B_UPDATE_INTERVAL);
  const isTierC = force || (now - lastTierCTime >= EORZEA_MINUTE_MS);

  if (!isTierB && !isTierC) return;

  // 3秒監視（Tier C）
  if (isTierC && !isTierB && !hasUrgentMob && !force) {
    lastTierCTime = now;
    return;
  }

  const filtered = getFilteredMobs();
  let anyStateChanged = false;
  let foundUrgent = false;

  if (isTierB) {
    filtered.forEach(mob => {
      const info = mob.repopInfo;
      if (!info || info.status === "Maintenance") return;

      if (updateMobState(mob, nowSec, state)) anyStateChanged = true;
      checkAndNotify(mob);

      const boundary = info.nextBoundarySec || info.maxRepop || 0;
      if (boundary && (boundary - nowSec) <= 120) foundUrgent = true;
    });
    lastTierBTime = now;
    lastTierCTime = now;
    hasUrgentMob = foundUrgent;
  } else if (isTierC) {
    filtered.forEach(mob => {
      const info = mob.repopInfo;
      if (!info || info.status === "Maintenance") return;

      const boundary = info.nextBoundarySec || info.maxRepop || 0;
      if (boundary && (boundary - nowSec) <= 60) {
        foundUrgent = true;
        if (updateMobState(mob, nowSec, state)) anyStateChanged = true;
        checkAndNotify(mob);
      }
    });
    lastTierCTime = now;
    hasUrgentMob = foundUrgent;
  }

  if (anyStateChanged) {
    syncDomOrder();
  }

  if (document.visibilityState === 'visible') {
    updateVisibleCards();
  }
};

const updateMobState = function (mob, nowSec, state) {
  const info = mob.repopInfo;
  if (!info) return false;

  let hasSignificantChange = false;
  const oldStatus = info.status;
  let calculationTriggered = false;

  const isBoundaryCrossed = (info.nextBoundarySec && nowSec >= info.nextBoundarySec) ||
    (info.maxRepop && nowSec >= info.maxRepop && info.status !== "MaxOver") ||
    (info.minRepop && nowSec >= info.minRepop && (info.status === "Next" || info.status === "NextCondition"));

  if (isBoundaryCrossed) {
    mob.repopInfo = calculateRepop(mob, state.maintenance);
    calculationTriggered = true;
    hasSignificantChange = true;
  } else {
    if (info.maxRepop && nowSec >= info.maxRepop) {
      info.status = "MaxOver";
      info.elapsedPercent = 100;
      info.timeRemaining = formatDurationColon(nowSec - info.maxRepop);
    } else {
      const targetSec = info.nextBoundarySec || info.maxRepop || 0;
      info.timeRemaining = formatDurationColon(Math.max(0, targetSec - nowSec));

      if (info.minRepop && info.maxRepop) {
        const range = info.maxRepop - info.minRepop;
        info.elapsedPercent = (range <= 0 || nowSec < info.minRepop) ? 0 : Math.min(100, ((nowSec - info.minRepop) / range) * 100);
      }
    }
  }

  if (oldStatus !== mob.repopInfo.status) {
    hasSignificantChange = true;
  }

  return hasSignificantChange;
};

// ─── 報告処理 ───────────────────────────────────────────
export function showToast(message, type = "error") {
  if (type === "error") {
    console.error(message);
  }
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container-wrapper";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  const colorClass = type === "error" ? "toast-error" : "toast-success";
  toast.className = `toast-item-base ${colorClass} opacity-0 translate-x-full`;
  toast.textContent = message;
  toast.classList.add("whitespace-pre-wrap");

  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.remove("translate-x-full", "opacity-0");
    });
  });

  setTimeout(() => {
    toast.classList.add("translate-x-full", "opacity-0");
    toast.addEventListener("transitionend", () => toast.remove());
  }, CONFIG.TOAST_DURATION);
}

export function handleReportResult(result) {
  if (!result.success) {
    if (result.code === "permission-denied" || (result.error && result.error.includes("permission"))) {
      showToast("アクセス権限エラーが発生しました。\n再度認証を行ってください。", "error");
      openAuthModal();
    } else {
      showToast("報告エラー: " + (result.error || "不明なエラー"), "error");
    }
  } else {
    showToast("討伐報告を送信しました", "success");
  }
}

export async function handleInstantReport(mobNo) {
  const result = await submitReport(mobNo, new Date().toISOString());
  handleReportResult(result);
}

async function handleReportSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const mobNo = parseInt(form.dataset.mobNo, 10);
  const timeISO = form.elements["kill-time"].value;
  const result = await submitReport(mobNo, timeISO);
  handleReportResult(result);
  if (result.success) closeReportModal();
}

// ─── スポーン操作 ───────────────────────────────────────
function applyOptimisticDOM(point, nextCulled) {
  point.dataset.isCulled = String(nextCulled);

  if (nextCulled) {
    for (const [from, to] of Object.entries(CULLED_CLASS_MAP)) {
      if (point.classList.contains(from)) {
        point.classList.replace(from, to);
        break;
      }
    }
  } else {
    for (const [from, to] of Object.entries(UNCULLED_CLASS_MAP)) {
      if (point.classList.contains(from)) {
        point.classList.replace(from, to);
        break;
      }
    }
  }
}

function applyOptimisticState(mobNo, area, locationId, nextCulled) {
  const state = getState();
  const instance = mobNo % 10;
  const key = `${area}_${instance}`;
  if (!state.mobLocations[key]) {
    state.mobLocations[key] = {};
  }
  if (!state.mobLocations[key][locationId]) {
    state.mobLocations[key][locationId] = {};
  }

  const now = { toMillis: () => Date.now() };
  if (nextCulled) {
    state.mobLocations[key][locationId].culled_at = now;
  } else {
    state.mobLocations[key][locationId].uncull_at = now;
  }

  state.mobs.forEach(m => {
    if (m.area === area && (m.No % 10) === instance) {
      m.spawn_cull_status = state.mobLocations[key];
    }
  });

  window.dispatchEvent(new CustomEvent("locationsUpdated", {
    detail: { locationsMap: state.mobLocations }
  }));
}

function handleCrushToggle(e) {
  const point = e.target.closest(".spawn-point");
  if (!point) return;

  const state = getState();
  if (!state.isVerified) {
    openAuthModal();
    return;
  }

  if (point.dataset.isInteractive !== "true") return;
  if (point.dataset.isLastone === "true") return;

  const card = e.target.closest(".mobcard-card");
  if (!card) return;

  e.preventDefault();
  e.stopPropagation();

  const mobNo = parseInt(card.dataset.mobNo, 10);
  const mob = state.mobs.find(m => m.No === mobNo);
  if (!mob) return;

  const locationId = point.dataset.locationId;
  const area = mob.area;

  const isTouchDevice = window.matchMedia("(hover: none)").matches;
  if (isTouchDevice) {
    const now = Date.now();
    const timeDiff = now - lastClickTime;

    if (locationId === lastClickLocationId && timeDiff < CONFIG.CLICK_THRESHOLD) {
      lastClickTime = 0;
      lastClickLocationId = null;
    } else {
      lastClickTime = now;
      lastClickLocationId = locationId;
      return;
    }
  }

  const isCurrentlyCulled = point.dataset.isCulled === "true";
  const nextCulled = !isCurrentlyCulled;

  applyOptimisticDOM(point, nextCulled);
  applyOptimisticState(mobNo, area, locationId, nextCulled);

  toggleCrushStatus(mobNo, area, locationId, nextCulled).then(result => {
    if (!result?.success) {
      applyOptimisticDOM(point, !nextCulled);
      applyOptimisticState(mobNo, area, locationId, !nextCulled);
    }
  });
}

export function attachLocationEvents() {
  if (locationEventsAttached) return;

  const moblistContainer = document.getElementById("moblist-container");
  if (moblistContainer) {
    moblistContainer.addEventListener("click", handleCrushToggle);
  }

  const mobcardDetail = document.getElementById("mobcard-detail");

  if (mobcardDetail) {
    mobcardDetail.addEventListener("click", handleCrushToggle);
  }

  const mobcardOverlay = document.getElementById("mobcard-overlay");
  if (mobcardOverlay) {
    mobcardOverlay.addEventListener("click", handleCrushToggle);
  }

  locationEventsAttached = true;
}

// ─── グローバルイベント管理（イベント委譲） ───────────────────────
function attachGlobalEventListeners() {
  let prevWidth = window.innerWidth;
  window.addEventListener("resize", debounce(() => {
    const currentWidth = window.innerWidth;
    if ((prevWidth >= CONFIG.BREAKPOINT_PC) !== (currentWidth >= CONFIG.BREAKPOINT_PC)) {
      prevWidth = currentWidth;
      sortAndRedistribute();
    }
  }, CONFIG.DEBOUNCE_DELAY));

  document.body.addEventListener('click', (e) => {
    const target = e.target;

    const navBtn = target.closest('.appnav-btn[data-nav-id]');
    if (navBtn) {
      const navId = navBtn.dataset.navId;
      if (navId === 'notify') return;
      e.preventDefault();
      e.stopPropagation();
      if (navId === 'home') {
        closePanel();
        const container = document.getElementById("moblist-container");
        if (container) container.scrollTo({ top: 0, behavior: "smooth" });
        setActiveNavItem('home');
      } else {
        togglePanel(navId);
      }
      return;
    }

    const filterBtn = target.closest(".area-filter-btn");
    if (filterBtn) {
      e.stopPropagation();
      handleAreaFilterClick(e);
      return;
    }

    if (target.closest('.appnav-logo')) {
      window.location.reload();
      return;
    }

    if (target === DOM.cardOverlayBackdrop) {
      setOpenMobCardNo(null);
      sortAndRedistribute({ immediate: true });
    }
  });

  if (DOM.reportForm) {
    DOM.reportForm.addEventListener('submit', handleReportSubmit);
  }

  document.body.addEventListener('input', (e) => {
    if (e.target.classList.contains('mobcard-memo-input') || e.target.matches("[data-action='save-memo']")) {
      adjustMemoHeight(e.target);
    }
  });

  document.body.addEventListener('change', async (e) => {
    const input = e.target;
    if (input.classList.contains('mobcard-memo-input') || input.matches("[data-action='save-memo']")) {
      const mobNo = parseInt(input.dataset.mobNo, 10);
      const value = input.value.trim();
      if (!isNaN(mobNo)) {
        if (!getState().isVerified) {
          input.value = '';
          openAuthModal();
          return;
        }
        await submitMemo(mobNo, value);
      }
    }
  });

  let touchStartX = 0;
  document.body.addEventListener('touchstart', (e) => {
    const reportBtn = e.target.closest('.report-side-bar');
    if (reportBtn) touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  document.body.addEventListener('touchend', (e) => {
    const reportBtn = e.target.closest('.report-side-bar');
    if (reportBtn) {
      const touchEndX = e.changedTouches[0].screenX;
      if (touchEndX - touchStartX > 30) {
        const mobNo = parseInt(reportBtn.dataset.mobNo, 10);
        if (reportBtn.dataset.reportType === 'modal') openReportModal(mobNo);
        else reportBtn.click();
      }
    }
  }, { passive: true });
}

// ─── イベント ───────────────────────────────────────────
function initAppEventListeners() {
  window.addEventListener('maintenanceUpdated', () => renderMaintenanceStatus());

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      setOpenMobCardNo(null);
      document.querySelectorAll('.appnav-rank-item.appnav-active').forEach(el => el.classList.remove('appnav-active'));
    }
  });

  window.addEventListener('initialDataLoaded', () => {
    try {
      renderMaintenanceStatus();
      updateErrorPanel();
      updateHeaderTime();
      filterAndRender({ isInitialLoad: true });
      lastTierBTime = 0;
      lastTierCTime = 0;
      updateProgressBarsOptimized();
    } catch (e) {
      console.error("初期ロード処理失敗:", e);
    }
  }, { once: true });

  window.addEventListener('criticalDataLoadError', (e) => {
    if (loadingTimeout) clearTimeout(loadingTimeout);
    const overlay = DOM.loadingOverlay;
    if (overlay) {
      const spinner = overlay.querySelector('.loading-spinner');
      if (spinner) spinner.classList.add('u-hidden');
      const text = overlay.querySelector('.loading-text');
      if (text) {
        text.classList.add('u-pre-wrap', 'u-text-error');
        text.textContent = e.detail.message;
      }
    }
  }, { once: true });

  window.addEventListener('initialSortComplete', () => {
    if (loadingTimeout) clearTimeout(loadingTimeout);
    try {
      renderMaintenanceStatus();
      showColumnContainer();

      const isFirstVisit = !localStorage.getItem("has_visited");
      if (isFirstVisit) {
        localStorage.setItem("has_visited", "true");
        if (window.openUserManual) window.openUserManual();
      }
    } catch (e) {
      console.error("初回描画失敗:", e);
      showColumnContainer();
    }
  }, { once: true });

  window.addEventListener('characterNameSet', () => renderMaintenanceStatus());

  window.addEventListener('mobsBatchUpdated', (e) => {
    const { mobNos } = e.detail;
    const mobMap = getMobMap();
    if (!mobMap) return;
    mobNos.forEach(mobNo => {
      const mob = mobMap.get(String(mobNo));
      if (!mob) return;
      checkAndNotify(mob);
      const card = cardCache.get(String(mobNo));
      if (card) updateCardFull(card, mob);
    });
    updateVisibleDetailCard(mobMap);
    sortAndRedistribute();
  });

  window.addEventListener('mobUpdated', (e) => {
    const { mobNo, mob } = e.detail;
    const mobMap = getMobMap();
    if (!mobMap) return;
    const card = cardCache.get(String(mobNo));
    if (card) updateCardFull(card, mob);
    updateVisibleDetailCard(mobMap);
    sortAndRedistribute();
  });

  window.addEventListener('filterChanged', () => {
    invalidateFilterCache();
    filterAndRender();
  });

  window.addEventListener('mobsUpdated', () => updateProgressBarsOptimized());
  window.addEventListener('locationDataReady', () => updateVisibleCards());
  window.addEventListener('locationsUpdated', () => {
    invalidateFilterCache();
    updateVisibleCards();
  });

  window.addEventListener('appNotify', (e) => {
    const { message, type } = e.detail;
    showToast(message, type);
  });
}

function attachMobCardEvents() {
  const containers = [
    document.getElementById("moblist-container"),
    document.getElementById("mobcard-detail")
  ].filter(Boolean);

  containers.forEach(c => c.addEventListener("click", handleGeneralClick));

  const pane = document.getElementById("mobcard-pane");
  if (pane) {
    pane.addEventListener("click", (e) => {
      if (e.target === pane && window.innerWidth < CONFIG.BREAKPOINT_PC) {
        setOpenMobCardNo(null);
        sortAndRedistribute({ immediate: true });
      }
    });
  }
}

function handleGeneralClick(e) {
  const target = e.target;
  const item = target.closest(".moblist-item, .mobcard-card");
  if (!item) return;

  const mobNo = parseInt(item.dataset.mobNo, 10);
  const mob = getState().mobs.find(m => m.No === mobNo);
  if (!mob) return;

  const reportBtn = target.closest(".moblist-report-btn");
  if (reportBtn) {
    e.preventDefault();
    e.stopPropagation();
    if (!getState().isVerified) {
      openAuthModal();
      return;
    }
    const type = reportBtn.dataset.reportType || (mob.rank === 'A' ? 'instant' : 'modal');
    if (type === "modal") openReportModal(mobNo);
    else handleInstantReport(mobNo, mob.rank);
    return;
  }

  if (target.closest('[data-action="close-card"]')) {
    e.stopPropagation();
    setOpenMobCardNo(null);
    sortAndRedistribute({ immediate: true });
    return;
  }

  if (target.closest(".moblist-item") || target.classList.contains('mobcard-card')) {
    const currentOpen = getState().openMobCardNo;
    setOpenMobCardNo(currentOpen === mobNo ? null : mobNo);
    sortAndRedistribute({ immediate: true });
  }
}

if (window.appInterval) clearInterval(window.appInterval);
window.appInterval = setInterval(() => {
  if (document.visibilityState === 'hidden') return;
  updateProgressBarsOptimized();
  updateHeaderTime();
}, EORZEA_MINUTE_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    updateProgressBarsOptimized(true);
  }
});

document.addEventListener('DOMContentLoaded', initApp);




