import { getState, RANKS, DOM } from "./dataManager.js";
import { cloneTemplate } from "./mobCard.js";
import { filterMobsByRankAndArea } from "./sidebar.js";

const mobIdPartsCache = new Map();

export function getGroupKey(mob) {
  const info = mob.repopInfo || {};
  if (info.isMaintenanceStop || info.isBlockedByMaintenance) return "MAINTENANCE";
  if (info.status === "MaxOver") return "MAX_OVER";
  if (info.status === "PopWindow" || info.status === "ConditionActive" || info.status === "NextCondition") return "WINDOW";
  return "NEXT";
}

export const GROUP_LABELS = {
  MAX_OVER: "🔚 Time Over",
  WINDOW: "⏳ Pop Window",
  NEXT: "🔜 Respawning",
  MAINTENANCE: "🛠️ Maintenance"
};

const groupSectionCache = new Map();

export function getOrCreateGroupSection(groupKey) {
  if (groupSectionCache.has(groupKey)) return groupSectionCache.get(groupKey);

  const section = cloneTemplate('status-group-template');
  if (!section) return { section: document.createElement('section'), cols: [] };

  const labelEl = section.querySelector(".status-group-label");
  if (labelEl) labelEl.textContent = GROUP_LABELS[groupKey];

  const cols = [
    section.querySelector(".col-1"),
    section.querySelector(".col-2"),
    section.querySelector(".col-3")
  ];

  const result = { section, cols };
  groupSectionCache.set(groupKey, result);
  DOM.colContainer.appendChild(section);
  return result;
}

let filterCacheVersion = -1;
let cachedFilteredMobs = null;
let cachedSortedMobs = null;
let sortCacheValid = false;

export function getFilteredMobs() {
  const state = getState();
  const version = state._filterVersion || 0;

  if (filterCacheVersion === version && cachedFilteredMobs) {
    return cachedFilteredMobs;
  }

  filterCacheVersion = version;
  cachedFilteredMobs = filterMobsByRankAndArea(state.mobs);
  sortCacheValid = false;
  return cachedFilteredMobs;
}

export function getSortedFilteredMobs() {
  if (sortCacheValid && cachedSortedMobs) {
    return cachedSortedMobs;
  }
  cachedSortedMobs = getFilteredMobs().slice().sort(allTabComparator);
  sortCacheValid = true;
  return cachedSortedMobs;
}

export function invalidateFilterCache() {
  filterCacheVersion = -1;
  cachedFilteredMobs = null;
  cachedSortedMobs = null;
  sortCacheValid = false;
}

export function invalidateSortCache() {
  sortCacheValid = false;
  cachedSortedMobs = null;
}

export function rankPriority(rank) {
  switch (rank) {
    case RANKS.S: return 0;
    case RANKS.A: return 1;
    case RANKS.F: return 2;
    default: return 99;
  }
}

export function parseMobIdParts(no) {
  if (mobIdPartsCache.has(no)) {
    return mobIdPartsCache.get(no);
  }
  const str = String(no).padStart(5, "0");
  const result = {
    mobNo: parseInt(str.slice(2, 4), 10),
    instance: parseInt(str[4], 10),
  };
  mobIdPartsCache.set(no, result);
  return result;
}

export function allTabComparator(a, b) {
  const aInfo = a.repopInfo || {};
  const bInfo = b.repopInfo || {};
  const aStatus = aInfo.status;
  const bStatus = bInfo.status;

  const aIsAfterMaintenance =
    aInfo.isMaintenanceStop || aInfo.isBlockedByMaintenance;
  const bIsAfterMaintenance =
    bInfo.isMaintenanceStop || bInfo.isBlockedByMaintenance;

  if (aIsAfterMaintenance && !bIsAfterMaintenance) return 1;
  if (!aIsAfterMaintenance && bIsAfterMaintenance) return -1;

  const isAMaxOver = aStatus === "MaxOver";
  const isBMaxOver = bStatus === "MaxOver";

  if (isAMaxOver && !isBMaxOver) return -1;
  if (!isAMaxOver && isBMaxOver) return 1;

  if (isAMaxOver && isBMaxOver) {
    const aActive = aInfo.isInConditionWindow;
    const bActive = bInfo.isInConditionWindow;

    if (a.rank !== RANKS.A && b.rank !== RANKS.A) {
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;

      const at = aInfo.maxRepop || 0;
      const bt = bInfo.maxRepop || 0;
      if (at !== bt) return at - bt;
    }

    const getMaxOverRankPriority = (r) => {
      if (r === RANKS.S) return 0;
      if (r === RANKS.F) return 1;
      if (r === RANKS.A) return 2;
      return 99;
    };

    const rankDiff = getMaxOverRankPriority(a.rank) - getMaxOverRankPriority(b.rank);
    if (rankDiff !== 0) return rankDiff;

    if (a.ExpansionId !== b.ExpansionId) return b.ExpansionId - a.ExpansionId;

    const pa = parseMobIdParts(a.No);
    const pb = parseMobIdParts(b.No);
    if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;

    return pa.instance - pb.instance;
  }

  const isAConditionActive = !!aInfo.isInConditionWindow;
  const isBConditionActive = !!bInfo.isInConditionWindow;

  if (isAConditionActive && !isBConditionActive) return -1;
  if (!isAConditionActive && isBConditionActive) return 1;

  const gKey = getGroupKey(a);
  if ((gKey === "NEXT" || gKey === "MAINTENANCE") && gKey === getGroupKey(b)) {
    const at = aInfo.minRepop || Infinity;
    const bt = bInfo.minRepop || Infinity;
    if (at !== bt) return at - bt;
  }

  if (getGroupKey(a) === "WINDOW" && getGroupKey(b) === "WINDOW") {
    const at = aInfo.minRepop ?? Infinity;
    const bt = bInfo.minRepop ?? Infinity;
    if (aInfo.elapsedPercent !== bInfo.elapsedPercent) return (bInfo.elapsedPercent || 0) - (aInfo.elapsedPercent || 0);

    const rankDiff = rankPriority(a.rank) - rankPriority(b.rank);
    if (rankDiff !== 0) return rankDiff;
    if (a.ExpansionId !== b.ExpansionId) return b.ExpansionId - a.ExpansionId;
    const pa = parseMobIdParts(a.No);
    const pb = parseMobIdParts(b.No);
    if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;
    return pa.instance - pb.instance;
  }

  const aPercent = aInfo.elapsedPercent || 0;
  const bPercent = bInfo.elapsedPercent || 0;

  if (aPercent !== bPercent) {
    return bPercent - aPercent;
  }

  const rankDiff = rankPriority(a.rank) - rankPriority(b.rank);
  if (rankDiff !== 0) return rankDiff;

  if (a.ExpansionId !== b.ExpansionId) return b.ExpansionId - a.ExpansionId;

  const pa = parseMobIdParts(a.No);
  const pb = parseMobIdParts(b.No);
  if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;

  return pa.instance - pb.instance;
}
