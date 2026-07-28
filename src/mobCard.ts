import { getDurationDHMParts, formatDurationDHM, formatMMDDHHmm, DHMParts } from "./cal";
import { getState, setOpenMobCardNo, isCulled, getStatusLabel, RANKS, DOM, CONFIG } from "./dataManager";
import { toggleCrushStatus } from "./server";
import { openAuthModal, openReportModal } from "./modal";
import { Mob, SpawnPoint, CullStatus, RepopInfo } from "./types/mob";

// ─── 汎用ユーティリティ ─────────────────────────────────
function updateEl(parent: HTMLElement, selector: string, props: any = {}, dataset: Record<string, string> = {}): void {
  const el = parent.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  Object.assign(el, props);
  for (const [key, val] of Object.entries(dataset)) {
    el.dataset[key] = val;
  }
}

export function cloneTemplate(id: string): HTMLElement | null {
  const template = document.getElementById(id) as HTMLTemplateElement | null;
  if (!template) return null;
  return (template.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement | null;
}

// ─── ユーティリティ ─────────────────────────────────────
export const formatOrPlaceholder = (val: any): string => val ? formatMMDDHHmm(val) : "--/-- --:--";

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(str: string): string {
  if (typeof str !== "string") return str;
  return str.replace(/[&<>"']/g, function (m) {
    return ESCAPE_MAP[m];
  });
}

export function processText(text: string): string {
  return escapeHtml(text).replace(/\/\//g, "<br>");
}

export function renderNameWithInstance(container: HTMLElement, name: string): void {
  if (!container) return;
  const match = name.match(/^([1-9])_(.+)/);
  container.innerHTML = "";
  if (match) {
    const instance = match[1];
    const realName = match[2];
    const badge = document.createElement("span");
    badge.className = "instance-badge";
    badge.textContent = instance;
    container.appendChild(badge);
    container.appendChild(document.createTextNode(realName));
  } else {
    container.textContent = name;
  }
}

// ─── 拡大鏡 ─────────────────────────────────────────────
export function initGlobalMagnifier(): void {
  if ((window as any).magnifierInitialized) return;
  (window as any).magnifierInitialized = true;

  const magnifier = DOM.globalMagnifier as HTMLElement | null;
  const wrapper = magnifier?.querySelector('.magnifier-content-wrapper') as HTMLElement | null;
  if (!magnifier || !wrapper) return;

  let activeMapImg: HTMLImageElement | null = null;
  let activeMapContainer: HTMLElement | null = null;
  let activeMapContainerRect: DOMRect | null = null;
  let magnifierRect: DOMRect | null = null;

  const closeMagnifier = () => {
    magnifier.classList.add('hidden');
    DOM.body.classList.remove('magnifier-active');
    activeMapImg = null;
    activeMapContainer = null;
    activeMapContainerRect = null;
    wrapper.innerHTML = '';
    window.removeEventListener('mousemove', onMagnifierMouseMove);
  };

  const updateMagnifier = (e: { clientX: number; clientY: number }) => {
    if (!activeMapImg || !activeMapContainer || !activeMapContainerRect) return;

    const x = e.clientX - activeMapContainerRect.left;
    const y = e.clientY - activeMapContainerRect.top;

    if (x < 0 || y < 0 || x > activeMapContainerRect.width || y > activeMapContainerRect.height) {
      closeMagnifier();
      return;
    }

    magnifier.style.setProperty('--mag-x', `${e.clientX}px`);
    magnifier.style.setProperty('--mag-y', `${e.clientY}px`);

    if (!magnifierRect) {
      magnifierRect = magnifier.getBoundingClientRect();
    }
    const centerX = magnifierRect.width / 2;
    const centerY = magnifierRect.height / 2;

    const translateX = centerX - (x * CONFIG.MAP_ZOOM_SCALE);
    const translateY = centerY - (y * CONFIG.MAP_ZOOM_SCALE);

    wrapper.style.setProperty('--mag-zoom-x', `${translateX}px`);
    wrapper.style.setProperty('--mag-zoom-y', `${translateY}px`);
    wrapper.style.setProperty('--mag-scale', String(CONFIG.MAP_ZOOM_SCALE));
  };

  let magnifierRafId: number | null = null;
  const onMagnifierMouseMove = (e: MouseEvent) => {
    if (magnifierRafId) cancelAnimationFrame(magnifierRafId);
    const x = e.clientX;
    const y = e.clientY;
    magnifierRafId = requestAnimationFrame(() => {
      updateMagnifier({ clientX: x, clientY: y });
    });
  };

  document.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 2) return;

    const targetEl = e.target as HTMLElement;
    const mapContainer = targetEl.closest('.map-container') as HTMLElement | null;
    if (!mapContainer) return;

    const mapImg = mapContainer.querySelector('.mob-map-img') as HTMLImageElement | null;
    if (!mapImg) return;

    e.preventDefault();
    activeMapContainer = mapContainer;
    activeMapImg = mapImg;
    activeMapContainerRect = activeMapContainer.getBoundingClientRect();

    wrapper.innerHTML = '';
    const clone = mapContainer.cloneNode(true) as HTMLElement;

    clone.classList.remove('w-full', 'u-w-full', 'pc-map-box', 'cursor-crosshair', '!cursor-crosshair');
    clone.classList.add('magnifier-clone');

    clone.style.setProperty('--map-w', `${mapContainer.offsetWidth}px`);
    clone.style.setProperty('--map-h', `${mapContainer.offsetHeight}px`);

    wrapper.appendChild(clone);
    magnifier.classList.remove('hidden');
    DOM.body.classList.add('magnifier-active');

    magnifierRect = magnifier.getBoundingClientRect();

    window.addEventListener('mousemove', onMagnifierMouseMove);
    updateMagnifier(e);
  }, { capture: true });

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (e.button === 2 && activeMapImg) {
      closeMagnifier();
    }
  });

  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest('.map-container')) {
      e.preventDefault();
    }
  });
}

// ─── タイマー表示 ────────────────────────────────────────
export function shouldDisplayMemo(mob: Mob): boolean {
  const hasMemo = mob.memo_text?.trim();
  const isMemoNewer = (mob.memo_updated_at || 0) >= (mob.last_kill_time || 0);
  return !!(hasMemo && (isMemoNewer || !mob.last_kill_time));
}

export interface TimeLabelResult {
  label: string;
  labelStatus?: string;
  timeValue: string;
  isSpecialCondition: boolean;
  isTimeOver: boolean;
  isTimedMob: boolean;
  dhm: DHMParts | null;
  isInWindow: boolean;
}

export function computeTimeLabel(mob: Mob): TimeLabelResult {
  const info = mob.repopInfo || {} as RepopInfo;
  const now = Date.now() / 1000;

  if (!info.status) {
    return { label: "", timeValue: "--/-- --:--", isSpecialCondition: false, isTimeOver: false, isTimedMob: false, dhm: null, isInWindow: false };
  }

  const isMaint = !!(info.status === "Maintenance" || info.isMaintenanceStop || info.isBlockedByMaintenance);
  const isTimeOverRaw = (info.status === "MaxOver");
  const isInWindow = !!info.isInConditionWindow;
  const isNextWindow = !isInWindow && !!info.nextConditionSpawnDate && (now < info.nextConditionSpawnDate.getTime() / 1000);
  const isTimedMob = !!(info.isInConditionWindow || info.nextConditionSpawnDate);
  const isSpecialCondition = isTimedMob && (mob.rank === RANKS.S) && (info.status !== "PopWindow");

  let labelStatus = info.status;
  if (isInWindow && (info.status === "MaxOver" || info.status === "PopWindow")) {
    labelStatus = "ConditionActive";
  } else if (isNextWindow && (info.status === "MaxOver" || info.status === "PopWindow")) {
    labelStatus = "NextCondition";
  }

  const label = getStatusLabel(labelStatus, mob.rank);

  let targetSec = info.nextBoundarySec || info.maxRepop || 0;

  if (info.nextConditionSpawnDate && (info.status === "Next" || info.status === "NextCondition" || info.status === "Maintenance")) {
    targetSec = info.nextConditionSpawnDate.getTime() / 1000;
  }

  const showAsOverdue = isTimeOverRaw && !isInWindow && !isNextWindow;

  if (showAsOverdue && info.maxRepop) {
    targetSec = info.maxRepop;
  }

  const secondsRemaining = Math.max(0, showAsOverdue ? (now - targetSec) : (targetSec - now));
  const dhm = getDurationDHMParts(secondsRemaining);
  const timeValue = formatDurationDHM(secondsRemaining);

  return { label, labelStatus, timeValue, isSpecialCondition, isTimeOver: showAsOverdue, isTimedMob, dhm, isInWindow };
}

function updateTimerRichHTML(el: HTMLElement, dhm: DHMParts | null, isSpecialCondition: boolean, isTimeOver: boolean) {
  if (!dhm) {
    el.innerHTML = "--/-- --:--";
    el.className = 'mobcard-timer';
    return;
  }

  if (el.innerHTML.includes("--/-- --:--") || el.innerHTML === "") {
    const templateNode = cloneTemplate('timer-rich-template');
    if (templateNode) {
      el.innerHTML = templateNode.innerHTML;
    }
  }

  el.className = 'mobcard-timer';
  if (isSpecialCondition) el.classList.add('label-next');
  if (isTimeOver) el.classList.add('time-over');

  const { h, m } = dhm;

  const format = (elPart: HTMLElement | null, num: string, unit: string) => {
    if (!elPart) return;
    const numEl = elPart.querySelector('.mobcard-timer-num');
    const isHidden = unit === 'h' && (Number(num) === 0 || !num);
    elPart.classList.toggle('hidden', isHidden);
    if (!isHidden && numEl) {
      const paddedLine = String(num || 0).padStart(2, '0').replace(/^0/, '&nbsp;');
      if (numEl.innerHTML !== paddedLine) {
        numEl.innerHTML = paddedLine;
      }
    }
  };

  format(el.querySelector('.h-part') as HTMLElement | null, h, 'h');
  format(el.querySelector('.m-part') as HTMLElement | null, m, 'm');
}

// ─── スポーンポイント ───────────────────────────────────
export interface SpawnCountInfoResult {
  countInfo: { type: string; value: number; unit: string } | null;
  remainingCount: number;
  spawnCullStatus: Record<string, CullStatus>;
  validSpawnPoints: SpawnPoint[];
}

export function getSpawnCountInfo(mob: Mob): SpawnCountInfoResult {
  const stateVal = getState();
  const instance = mob.No % 10;
  const key = `${mob.area}_${instance}`;
  const mobLocationsData = stateVal.mobLocations?.[key];
  const spawnCullStatus = mobLocationsData || mob.spawn_cull_status || {};
  const validSpawnPoints = getValidSpawnPoints(mob, spawnCullStatus);
  const remainingCount = validSpawnPoints.length;
  let countInfo = null;

  if (remainingCount === 1) {
    const pointNumber = parseInt(validSpawnPoints[0]?.id?.slice(-2) || "0", 10);
    countInfo = { type: 'single', value: pointNumber, unit: '番' };
  } else if (remainingCount > 1) {
    countInfo = { type: 'multiple', value: remainingCount, unit: '' };
  }
  return { countInfo, remainingCount, spawnCullStatus, validSpawnPoints };
}

export function getValidSpawnPoints(mob: Mob, spawnCullStatus: Record<string, CullStatus>): SpawnPoint[] {
  return (mob.locations ?? []).filter(point => {
    const isTargetRank = point.mob_ranks.some(r => r === RANKS.S || r === RANKS.A);
    if (!isTargetRank) return false;
    const pointStatus = spawnCullStatus?.[point.id];
    return !isCulled(pointStatus, mob.No, mob);
  });
}

export function drawSpawnPoint(point: SpawnPoint, spawnCullStatus: Record<string, CullStatus>, mobNo: number, rank: string, isLastOne: boolean, isS_LastOne: boolean): HTMLElement | null {
  const el = cloneTemplate('spawn-point-template');
  if (!el) return null;

  const pointStatus = spawnCullStatus?.[point.id];
  const isCulledFlag = isCulled(pointStatus, mobNo);
  const isS_A_Cullable = point.mob_ranks.some(r => r === RANKS.S || r === RANKS.A);
  const isB_Only = point.mob_ranks.every(r => r.startsWith("B"));

  let colorClass = "";
  let dataIsInteractive = "false";

  if (isLastOne) {
    colorClass = "color-lastone";
    dataIsInteractive = "false";
  } else if (isS_A_Cullable) {
    const rankB = point.mob_ranks.find(r => r.startsWith("B"));
    if (isCulledFlag) {
      colorClass = rankB === "B1" ? "color-b1-culled" : "color-b2-culled";
    } else {
      colorClass = rankB === "B1" ? "color-b1" : "color-b2";
    }
    dataIsInteractive = "true";
  } else if (isB_Only) {
    const rankB = point.mob_ranks[0];
    colorClass = rankB === "B1" ? "color-b1-only" : "color-b2-only";
    dataIsInteractive = "false";
  }

  el.className = `spawn-point ${colorClass}`;
  el.style.setProperty('--point-x', `${point.x}%`);
  el.style.setProperty('--point-y', `${point.y}%`);

  const pointNumber = parseInt(point.id.slice(-2), 10);
  const stateText = isLastOne ? "(確)" : isCulledFlag ? "(済)" : "";
  el.title = rank === "F" ? stateText : `${pointNumber} ${stateText}`;

  Object.assign(el.dataset, {
    locationId: point.id,
    mobNo: String(mobNo),
    rank: rank,
    isCulled: String(isCulledFlag),
    isLastone: isLastOne ? "true" : "false",
    isInteractive: dataIsInteractive
  });

  return el;
}

// ─── カード作成 ─────────────────────────────────────────
export function createMobCard(mob: Mob, isDetailView = false): HTMLElement {
  if (isDetailView) return renderMobCard(mob);
  return createSimpleMobItem(mob);
}

export function renderMobCard(mob: Mob): HTMLElement {
  const template = DOM.cardTemplate;
  if (!template) return document.createElement('div');
  const clone = template.content.cloneNode(true) as HTMLElement;
  const card = clone.querySelector('.mobcard-card') as HTMLElement;

  const rank = mob.rank;
  const { nextConditionSpawnDate, minRepop, maxRepop } = mob.repopInfo || {};

  card.dataset.mobNo = String(mob.No);
  card.dataset.rank = rank;

  const nameEl = card.querySelector('.mobcard-name') as HTMLElement | null;
  if (nameEl) {
    renderNameWithInstance(nameEl, mob.name);
    nameEl.dataset.rank = rank;
  }

  updateEl(card, '.mobcard-rank', { textContent: rank }, { rank });

  updateEl(card, '[data-min-repop]', { textContent: formatOrPlaceholder(minRepop) });
  updateEl(card, '[data-max-repop]', { textContent: formatOrPlaceholder(maxRepop) });
  updateEl(card, '[data-next-possible]', { textContent: nextConditionSpawnDate ? formatOrPlaceholder(nextConditionSpawnDate) : "--/-- --:--" });
  updateEl(card, '[data-last-kill]', { textContent: formatOrPlaceholder(mob.last_kill_time) });

  updateEl(card, '.condition-text', { innerHTML: processText(mob.condition || "特別な出現条件はありません。") });

  const memoEl = card.querySelector('.mobcard-memo-input') as HTMLTextAreaElement | null;
  if (memoEl) {
    if (document.activeElement !== memoEl) {
      memoEl.value = mob.memo_text || '';
    }
    memoEl.dataset.mobNo = String(mob.No);
    setTimeout(() => adjustMemoHeight(memoEl), 0);
  }

  const mapSection = card.querySelector('.map-section') as HTMLElement | null;
  if (mapSection) {
    if (mob.mapImage) {
      mapSection.classList.remove('hidden');
      updateMapOverlay(card, mob);
    } else {
      mapSection.classList.add('hidden');
    }
  }

  card.querySelectorAll('.moblist-report-btn').forEach(btn => {
    const htmlBtn = btn as HTMLElement;
    htmlBtn.dataset.reportType = rank === RANKS.A ? 'instant' : 'modal';
    htmlBtn.dataset.mobNo = String(mob.No);
  });

  updateAreaInfo(card, mob);
  updateDetailCardRealtime(card, mob);

  return card;
}

export function createSimpleMobItem(mob: Mob): HTMLElement {
  const item = cloneTemplate('moblist-item-template');
  if (!item) return document.createElement('div');

  item.classList.add(`rank-${mob.rank.toLowerCase()}`);
  item.dataset.mobNo = String(mob.No);
  item.dataset.rank = mob.rank;

  const reportBtn = item.querySelector('.moblist-report-btn') as HTMLElement | null;
  if (reportBtn) {
    reportBtn.dataset.mobNo = String(mob.No);
    reportBtn.dataset.rank = mob.rank;
  }

  const nameEl = item.querySelector('.moblist-name') as HTMLElement | null;
  if (nameEl) {
    renderNameWithInstance(nameEl, mob.name);
    nameEl.dataset.rank = mob.rank;
  }

  updateSimpleMobItem(item, mob);
  return item;
}

// ─── リアルタイム更新用 ─────────────────────────
export function updateDetailCardRealtime(card: HTMLElement, mob: Mob): void {
  const timeLabelObj = computeTimeLabel(mob);
  updateProgressBar(card, mob, timeLabelObj);
  updateProgressText(card, mob, timeLabelObj);
  updateExpandablePanel(card, mob);
  updateMobCount(card, mob);
}

export function updateProgressBar(element: HTMLElement, mob: Mob, timeLabelObj: TimeLabelResult | null = null): void {
  const { labelStatus } = timeLabelObj || computeTimeLabel(mob);
  const { elapsedPercent } = mob.repopInfo || {};

  const status = labelStatus;
  const bar = element.querySelector('.mobcard-progress-bar, .moblist-bg-bar') as HTMLElement | null;
  const wrapper = element.querySelector('.mobcard-progress-container, .moblist-bg-gauge') as HTMLElement | null;
  if (!bar) return;

  const isDetail = element.classList.contains('mobcard-card');
  const flooredPct = Math.max(0, Math.min(100, Math.floor(elapsedPercent || 0)));
  const lastPct = parseFloat(bar.dataset.lastPct || "NaN");

  const isReset = isNaN(lastPct) || flooredPct === 0 || flooredPct < (lastPct || 0);
  const noTransition = !isDetail || isReset || status === "Next" || status === "Maintenance";

  bar.classList.toggle('u-no-transition', noTransition);
  bar.style.setProperty('--prog-percent', String(flooredPct / 100));
  bar.dataset.lastPct = String(flooredPct);

  if (bar.dataset.lastStatus !== status) {
    bar.classList.remove('status-max-over', 'status-condition-active', 'status-pop-window', 'status-next');
    if (status === "MaxOver") bar.classList.add("status-max-over");
    else if (status === "ConditionActive") bar.classList.add("status-condition-active");
    else if (status === "PopWindow") bar.classList.add("status-pop-window");
    else if (status === "Next" || status === "NextCondition") bar.classList.add("status-next");
    bar.dataset.lastStatus = status;

    if (status === "Next" || status === "Maintenance") {
      bar.style.setProperty('--prog-percent', '0');
    }
  }

  if (wrapper && mob.repopInfo) {
    const isInCondition = !!mob.repopInfo.isInConditionWindow && !mob.repopInfo.isMaintenanceStop && !mob.repopInfo.isBlockedByMaintenance;
    const currentBlink = element.classList.contains('moblist-highlight-white');
    if (element.classList.contains('moblist-item') && currentBlink !== isInCondition) {
      element.classList.toggle('moblist-highlight-white', isInCondition);
    }
  }
}

export function updateProgressText(element: HTMLElement, mob: Mob, timeLabelObj: TimeLabelResult | null = null): void {
  const { status } = mob.repopInfo || {};
  const timeLabel = timeLabelObj || computeTimeLabel(mob);
  const { label, dhm, isSpecialCondition, isTimeOver } = timeLabel;
  const isMaint = !!(mob.repopInfo?.isBlockedByMaintenance || mob.repopInfo?.isMaintenanceStop || mob.repopInfo?.status === "Maintenance");

  const timeContainer = element.querySelector('.moblist-time') as HTMLElement | null;
  const percentEl = element.querySelector('.percent, .moblist-percent') as HTMLElement | null;

  if (timeContainer && element.classList.contains('moblist-item')) {
    let inner = timeContainer.querySelector('.timer-inner-grid') as HTMLElement | null;
    if (!inner) {
      timeContainer.innerHTML = "";
      inner = document.createElement("div");
      inner.className = "timer-inner-grid";
      const timerNode = document.createElement('span');
      timerNode.className = 'mobcard-timer';
      const labelSpan = document.createElement("span");
      labelSpan.className = "timer-label timer-label-base";
      inner.appendChild(timerNode);
      inner.appendChild(labelSpan);
      timeContainer.appendChild(inner);
    }

    updateTimerRichHTML(inner.querySelector('.mobcard-timer') as HTMLElement, dhm, isSpecialCondition, isTimeOver);
    const labelSpan = inner.querySelector('.timer-label-base') as HTMLElement;
    const newClass = `timer-label timer-label-base ${status ? 'status-' + status.toLowerCase() : ''} ${isSpecialCondition ? 'is-special' : ''}`;
    if (labelSpan.className !== newClass) labelSpan.className = newClass;
    if (labelSpan.textContent !== label) labelSpan.textContent = label;
  }

  if (percentEl) {
    const { elapsedPercent } = mob.repopInfo || {};
    const raw = Math.max(0, Math.min(100, elapsedPercent || 0));
    const percentValue = status === "MaxOver" ? "100" : element.classList.contains('mobcard-card') ? raw.toFixed(1) : String(Math.floor(raw));

    let numNode = percentEl.firstChild as Text | null;
    if (!numNode || numNode.nodeType !== Node.TEXT_NODE) {
      percentEl.innerHTML = "";
      numNode = document.createTextNode(percentValue);
      percentEl.appendChild(numNode);
      const unit = document.createElement('span');
      unit.className = 'percent-unit';
      unit.textContent = '%';
      percentEl.appendChild(unit);
    } else {
      if (numNode.nodeValue !== percentValue) {
        numNode.nodeValue = percentValue;
      }
      if (!percentEl.querySelector('.percent-unit')) {
        const unit = document.createElement('span');
        unit.className = 'percent-unit';
        unit.textContent = '%';
        percentEl.appendChild(unit);
      }
    }
    percentEl.classList.toggle("max-over", status === "MaxOver");
  }

  element.classList.toggle("is-pre-repop", status === "Next" || status === "Maintenance");
  element.classList.toggle("maintenance-gray-out", isMaint);
}

function getEl(parent: any, selector: string, key: string): HTMLElement | null {
  if (!parent._cache) parent._cache = {};
  if (parent._cache[key]) return parent._cache[key];
  const el = parent.querySelector(selector) as HTMLElement | null;
  if (el) parent._cache[key] = el;
  return el;
}

export function updateExpandablePanel(card: HTMLElement, mob: Mob): void {
  const { minRepop, maxRepop } = mob.repopInfo || {};

  const elMin = getEl(card, "[data-min-repop]", "minRepop");
  const elMax = getEl(card, "[data-max-repop]", "maxRepop");
  const elNext = getEl(card, "[data-next-possible]", "nextPossible");
  const elLast = getEl(card, "[data-last-kill]", "lastKill");

  if (elMin) elMin.textContent = formatOrPlaceholder(minRepop);
  if (elMax) elMax.textContent = formatOrPlaceholder(maxRepop);

  if (elNext && mob.repopInfo) {
    if (mob.repopInfo.nextConditionSpawnDate) {
      const val = formatMMDDHHmm(mob.repopInfo.nextConditionSpawnDate);
      if (elNext.textContent !== val) elNext.textContent = val;
      elNext.classList.add('text-yellow');
      elNext.classList.remove('text-secondary');
    } else {
      if (elNext.textContent !== "--/-- --:--") elNext.textContent = "--/-- --:--";
      elNext.classList.remove('text-yellow');
      elNext.classList.add('text-secondary');
    }
  }

  if (elLast) {
    const val = formatOrPlaceholder(mob.last_kill_time);
    if (elLast.textContent !== val) elLast.textContent = val;
  }

  const elMemoInput = getEl(card, ".mobcard-memo-input", "memoInput") as HTMLTextAreaElement | null;
  if (elMemoInput) {
    if (elMemoInput.dataset.mobNo !== String(mob.No)) elMemoInput.dataset.mobNo = String(mob.No);
    if (document.activeElement !== elMemoInput) {
      const newValue = mob.memo_text || "";
      if (elMemoInput.value !== newValue) {
        elMemoInput.value = newValue;
        adjustMemoHeight(elMemoInput);
      }
    }
  }

  const elCondition = getEl(card, ".condition-text", "conditionText");
  if (elCondition) {
    const conditionText = mob.condition ? processText(mob.condition) : "特別な出現条件はありません。";
    if (elCondition.innerHTML !== conditionText) elCondition.innerHTML = conditionText;

    const isPCDetail = card.classList.contains('mobcard-card');
    const sections = [
      elCondition.closest('.mobcard-section'),
      getEl(card, '.memo-section', 'memoSection'),
      getEl(card, '.map-section', 'mapSection')
    ].filter(Boolean) as HTMLElement[];

    sections.forEach(section => {
      if (isPCDetail && mob.condition) {
        section.classList.add('condition-section-neon');
      } else {
        section.classList.remove('condition-section-neon');
      }
    });
  }
}

export function updateMemoIcon(card: HTMLElement, mob: Mob): void {
  const memoIconContainer = getEl(card, '.memo-icon-container', 'memoIconContainer');
  if (!memoIconContainer) return;
  const shouldShowMemo = shouldDisplayMemo(mob);

  if ((memoIconContainer as any)._lastShow === shouldShowMemo) return;
  (memoIconContainer as any)._lastShow = shouldShowMemo;

  memoIconContainer.innerHTML = '';
  if (shouldShowMemo) {
    memoIconContainer.classList.remove('hidden');
    const el = cloneTemplate('memo-icon-template');
    if (el) memoIconContainer.appendChild(el);
  } else {
    memoIconContainer.classList.add('hidden');
  }
}

export function updateMobCount(card: HTMLElement, mob: Mob): void {
  const countContainer = getEl(card, '.moblist-count', 'mobCount');
  if (!countContainer) return;

  const { countInfo } = getSpawnCountInfo(mob);
  if (!countInfo || mob.rank === 'F') {
    if (countContainer.innerHTML !== "") countContainer.innerHTML = "";
    return;
  }

  const cacheKey = `${countInfo.type}-${countInfo.value}`;
  if ((countContainer as any)._lastCacheKey === cacheKey) return;
  (countContainer as any)._lastCacheKey = cacheKey;

  const el = cloneTemplate('spawn-count-template');
  if (el) {
    if (countInfo.type === 'single') el.classList.add('text-cyan', 'font-bold');
    else el.classList.add('font-bold');

    const numEl = el.querySelector('.count-num') as HTMLElement | null;
    const unitEl = el.querySelector('.count-unit') as HTMLElement | null;

    if (numEl) numEl.textContent = countInfo.type === 'single' ? String(countInfo.value) : `@${countInfo.value}`;
    if (unitEl) {
      unitEl.textContent = countInfo.unit;
      unitEl.className = 'u-ml-1';
    }

    countContainer.innerHTML = "";
    countContainer.appendChild(el);
  }
}

export function updateAreaInfo(card: HTMLElement, mob: Mob): void {
  const areaName = mob.area || "--";
  const expName = mob.Expansion || "--";
  const rank = mob.rank || RANKS.A;

  card.querySelectorAll('.mob-rank-badge, .mobcard-rank').forEach(badge => {
    badge.textContent = rank;
    (badge as HTMLElement).dataset.rank = rank;
  });

  card.querySelectorAll('.detail-area').forEach(el => el.textContent = areaName);
  card.querySelectorAll('.detail-expansion').forEach(el => el.textContent = `| ${expName}`);
}

export function adjustMemoHeight(el: HTMLElement | null): void {
  if (!el || el.tagName !== 'TEXTAREA') return;
  const textArea = el as HTMLTextAreaElement;
  textArea.style.setProperty('--memo-h', textArea.scrollHeight + 'px');
}

export function updateMapOverlay(card: HTMLElement, mob: Mob): void {
  const isDetail = card.classList.contains('mobcard-card');
  const mapContainer = card.querySelector('.map-container') as HTMLElement | null;
  if (!mapContainer) return;

  if (mob.rank === 'F' && !mob.mapImage) {
    mapContainer.classList.add('hidden');
    const mapSection = mapContainer.closest('.map-section') as HTMLElement | null;
    if (mapSection) mapSection.classList.add('hidden');
    return;
  }

  const mapImg = mapContainer.querySelector('.mob-map-img') as HTMLImageElement | null;
  const mapOverlay = mapContainer.querySelector('.map-overlay') as HTMLElement | null;
  if (!mapOverlay) return;

  if (!isDetail) {
    if (mapOverlay.innerHTML !== "") {
      mapOverlay.innerHTML = "";
      delete (mapOverlay as any)._lastPointsHash;
    }
    return;
  }

  if (mapImg && mob.mapImage && mapImg.dataset.mobMap !== mob.mapImage) {
    if (mapImg.decoding !== "sync") mapImg.decoding = "sync";
    mapImg.loading = "eager";
    mapImg.src = `./maps/${mob.mapImage}`;
    mapImg.alt = `${mob.area} Map`;
    mapImg.dataset.mobMap = mob.mapImage;
    mapContainer.classList.remove('hidden');
    delete mapContainer.dataset.locationLoading;
  }
  if (mapContainer.classList.contains('hidden')) return;

  if (mob.mapImage && mob.locations) {
    const { spawnCullStatus, validSpawnPoints } = getSpawnCountInfo(mob);
    const isOneLeft = (validSpawnPoints?.length || 0) === 1;

    const timeEl = card.querySelector('.map-update-time') as HTMLElement | null;
    if (timeEl) {
      let latest = 0;
      if (spawnCullStatus) {
        Object.values(spawnCullStatus).forEach(p => {
          if (p.culled_at && (p.culled_at as any).seconds) latest = Math.max(latest, (p.culled_at as any).seconds);
          if (p.uncull_at && (p.uncull_at as any).seconds) latest = Math.max(latest, (p.uncull_at as any).seconds);
        });
      }
      timeEl.textContent = latest > 0 ? `更新: ${formatMMDDHHmm(latest)}` : "更新: --/-- --:--";
    }

    const currentPointsHash = (mob.locations ?? []).map(p => `${p.id}-${isCulled(spawnCullStatus?.[p.id], mob.No)}`).join("|") + `|${isOneLeft}`;
    if ((mapOverlay as any)._lastPointsHash !== currentPointsHash) {
      mapOverlay.innerHTML = "";
      const fragment = document.createDocumentFragment();
      (mob.locations ?? []).forEach(point => {
        const isThisPointTheLastOne = isOneLeft && point.id === validSpawnPoints[0]?.id;
        const pointEl = drawSpawnPoint(point, spawnCullStatus, mob.No, point.mob_ranks.includes("B2") ? "B2" : point.mob_ranks.includes("B1") ? "B1" : point.mob_ranks[0], isThisPointTheLastOne, isOneLeft);
        if (pointEl) fragment.appendChild(pointEl);
      });
      mapOverlay.appendChild(fragment);
      (mapOverlay as any)._lastPointsHash = currentPointsHash;
    }
  }
}

export function updateSimpleMobItem(item: HTMLElement, mob: Mob): void {
  const timeLabelObj = computeTimeLabel(mob);
  updateProgressBar(item, mob, timeLabelObj);
  updateProgressText(item, mob, timeLabelObj);
  updateMobCount(item, mob);
  updateMemoIcon(item, mob);
}
