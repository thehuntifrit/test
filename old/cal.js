const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;
const MAX_SEARCH_ITERATIONS = 5000;
const LIMIT_DAYS = 20;
export const EORZEA_MINUTE_MS = 2917;
export const MAINT_FACTOR = 0.6;

function parseDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === "object" && typeof input.toDate === "function") return input.toDate();
  if (typeof input === "object" && input.seconds !== undefined) return new Date(input.seconds * 1000);
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDurationDHM(seconds) {
  if (seconds < 0) seconds = 0;
  const { h, m } = getDurationDHMParts(seconds);
  const parts = [];
  if (parseInt(h) > 0) parts.push(`${h.trim()}h`);
  parts.push(`${m.trim()}m`);
  return parts.join("/");
}

export function getDurationDHMParts(seconds) {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const toString = (v) => v.toString();
  return { d: "0", h: toString(h), m: toString(m), rawD: 0, rawH: h, rawM: m, rawS: seconds };
}

export function formatDurationColon(seconds) {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(3, '\u00A0')}:${String(m).padStart(2, "0")}`;
}

export function debounce(func, wait) {
  let timeout;
  return function executed(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function getEorzeaTime(date = new Date()) {
  const unixMs = date.getTime();
  const REAL_MS_PER_ET_HOUR = ET_HOUR_SEC * 1000;
  const ET_HOURS_PER_DAY = 24;

  const eorzeaTotalHours = Math.floor(unixMs / REAL_MS_PER_ET_HOUR);
  const hours = eorzeaTotalHours % ET_HOURS_PER_DAY;

  const remainingMs = unixMs % REAL_MS_PER_ET_HOUR;
  const REAL_MS_PER_ET_MINUTE = REAL_MS_PER_ET_HOUR / 60;
  const minutes = Math.floor(remainingMs / REAL_MS_PER_ET_MINUTE);

  return {
    hours: hours.toString().padStart(2, "0"),
    minutes: minutes.toString().padStart(2, "0")
  };
}

function getEtHourFromRealSec(realSec) {
  const ticks = Math.floor(realSec / ET_HOUR_SEC);
  return ticks % 24;
}

function alignToEtHour(realSec) {
  return Math.floor(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}

function alignToWeatherCycle(realSec) {
  return Math.floor(realSec / WEATHER_CYCLE_SEC) * WEATHER_CYCLE_SEC;
}

function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  const phase = (eorzeaTotalDays % 32) + 1;

  let label = null;
  if (phase >= 32.5 || phase < 4.5) label = "新月";
  else if (phase >= 16.5 && phase < 20.5) label = "満月";

  return { phase, label };
}

function getEorzeaWeatherSeed(date = new Date()) {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const eorzeanHours = Math.floor(unixSeconds / ET_HOUR_SEC);
  const eorzeanDays = Math.floor(eorzeanHours / 24);

  let timeChunk = (eorzeanHours % 24) - (eorzeanHours % 8);
  timeChunk = (timeChunk + 8) % 24;

  const seed = eorzeanDays * 100 + timeChunk;
  const step1 = (seed << 11) ^ seed;
  const step2 = ((step1 >>> 8) ^ step1) >>> 0;
  return step2 % 100;
}

function checkWeatherInRange(mob, seed) {
  if (mob.weatherSeedRange) {
    const [min, max] = mob.weatherSeedRange;
    return seed >= min && seed <= max;
  }
  if (mob.weatherSeedRanges) {
    return mob.weatherSeedRanges.some(([min, max]) => seed >= min && seed <= max);
  }
  return false;
}

function checkTimeRange(timeRange, realSec) {
  const etHour = getEtHourFromRealSec(realSec);
  const { start, end } = timeRange;

  if (start < end) return etHour >= start && etHour < end;
  return etHour >= start || etHour < end;
}

function checkEtCondition(mob, realSec) {
  const { phase } = getEorzeaMoonInfo(new Date(realSec * 1000));

  if (mob.conditions) {
    const { firstNight, otherNights } = mob.conditions;
    if (firstNight?.timeRange && isFirstNightPhase(phase)) {
      return checkTimeRange(firstNight.timeRange, realSec);
    }
    if (otherNights?.timeRange && isOtherNightsPhase(phase)) {
      return checkTimeRange(otherNights.timeRange, realSec);
    }
    return false;
  }

  if (mob.timeRange) return checkTimeRange(mob.timeRange, realSec);
  if (mob.timeRanges) return mob.timeRanges.some(tr => checkTimeRange(tr, realSec));

  return true;
}

function isFirstNightPhase(phase) {
  return phase >= 32.5 || phase < 1.5;
}

function isOtherNightsPhase(phase) {
  return phase >= 1.5 && phase < 4.5;
}

function calculateNextMoonStart(startSec, targetPhase) {
  const startPhase = getEorzeaMoonInfo(new Date(startSec * 1000)).phase;
  let phaseDiff = targetPhase - startPhase;
  if (phaseDiff < 0) phaseDiff += 32;

  let nextStartSec = startSec + phaseDiff * ET_DAY_SEC;

  if (nextStartSec < startSec) {
    nextStartSec += MOON_CYCLE_SEC;
  }
  return nextStartSec;
}

function* getValidWeatherIntervals(mob, windowStart, windowEnd) {
  // 天候継続の必要秒数は時限モブ自体の出現条件であり、
  // メンテナンス直後の0.6倍(appliedFactor)はここには適用しない。
  // appliedFactor は minRepop / maxRepop の算出にのみ使用する。
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes * 60;
  const isContinuous = requiredSec > WEATHER_CYCLE_SEC;

  if (!mob.weatherSeedRange && !mob.weatherSeedRanges) {
    yield [windowStart, windowEnd];
    return;
  }

  let currentCursor = alignToWeatherCycle(windowStart);
  let loopSafety = 0;

  if (checkWeatherInRange(mob, getEorzeaWeatherSeed(new Date(currentCursor * 1000)))) {
    let chainStart = currentCursor;
    let chainEnd = 0;

    if (isContinuous) {
      const searchBackLimit = windowStart - LIMIT_DAYS * 24 * 3600;
      while (true) {
        const prevTime = chainStart - WEATHER_CYCLE_SEC;
        if (prevTime < searchBackLimit) break;

        const seed = getEorzeaWeatherSeed(new Date(prevTime * 1000));
        if (checkWeatherInRange(mob, seed)) {
          chainStart = prevTime;
        } else {
          break;
        }
      }

      let tempCursor = currentCursor;
      while (true) {
        if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

        const nextTime = tempCursor + WEATHER_CYCLE_SEC;
        const seed = getEorzeaWeatherSeed(new Date(nextTime * 1000));

        if (checkWeatherInRange(mob, seed)) {
          tempCursor = nextTime;
        } else {
          chainEnd = nextTime;
          break;
        }
      }

      const duration = chainEnd - chainStart;

      if (duration >= requiredSec) {
        const validPopStart = chainStart + requiredSec;
        const intersectStart = validPopStart;
        const intersectEnd = Math.min(chainEnd, windowEnd);

        if (intersectStart < intersectEnd) {
          yield [intersectStart, intersectEnd];
        }
      }

      currentCursor = chainEnd;

    } else {
      chainStart = currentCursor;
      let tempCursor = currentCursor;
      while (true) {
        if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

        const nextTime = tempCursor + WEATHER_CYCLE_SEC;
        const seed = getEorzeaWeatherSeed(new Date(nextTime * 1000));

        if (checkWeatherInRange(mob, seed)) {
          tempCursor = nextTime;
        } else {
          chainEnd = nextTime;
          break;
        }
      }

      const intersectStart = windowStart;
      const intersectEnd = Math.min(chainEnd, windowEnd);

      if (intersectStart < intersectEnd) {
        yield [intersectStart, intersectEnd];
      }

      currentCursor = chainEnd;
    }

  } else {
    currentCursor += WEATHER_CYCLE_SEC;
  }

  let cursor = currentCursor;

  while (cursor < windowEnd) {
    if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

    let activeStart = null;
    while (cursor < windowEnd + WEATHER_CYCLE_SEC) {
      if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;
      const seed = getEorzeaWeatherSeed(new Date(cursor * 1000));
      if (checkWeatherInRange(mob, seed)) {
        activeStart = cursor;
        break;
      }
      cursor += WEATHER_CYCLE_SEC;
      if (cursor - windowStart > LIMIT_DAYS * 24 * 3600) break;
    }

    if (activeStart === null) break;

    let activeEnd = activeStart;
    let tempCursor = activeStart;
    while (true) {
      if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

      const nextTime = tempCursor + WEATHER_CYCLE_SEC;
      const seed = getEorzeaWeatherSeed(new Date(nextTime * 1000));

      if (checkWeatherInRange(mob, seed)) {
        tempCursor = nextTime;
      } else {
        activeEnd = nextTime;
        break;
      }
    }
    const duration = activeEnd - activeStart;
    if (duration >= requiredSec) {
      const validPopStart = isContinuous ? activeStart + requiredSec : activeStart;

      const intersectStart = validPopStart;
      const intersectEnd = Math.min(activeEnd, windowEnd);

      if (intersectStart < intersectEnd) {
        yield [intersectStart, intersectEnd];
      }
    }

    cursor = activeEnd;
  }
}

function* getValidEtIntervals(mob, windowStart, windowEnd) {
  if (!mob.timeRange && !mob.timeRanges && !mob.conditions) {
    yield [windowStart, windowEnd];
    return;
  }
  let cursor = alignToEtHour(windowStart);
  let loopSafety = 0;

  while (cursor < windowEnd) {
    if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

    if (checkEtCondition(mob, cursor)) {
      const start = cursor;
      let end = cursor + ET_HOUR_SEC;
      let tempCursor = end;
      while (tempCursor < windowEnd + ET_HOUR_SEC) {
        if (checkEtCondition(mob, tempCursor)) {
          end += ET_HOUR_SEC;
          tempCursor += ET_HOUR_SEC;
        } else {
          break;
        }
      }
      const intersectStart = start;
      const intersectEnd = Math.min(end, windowEnd);

      if (intersectStart < intersectEnd) {
        yield [intersectStart, intersectEnd];
      }

      cursor = end;
    } else {
      cursor += ET_HOUR_SEC;
    }
  }
}

function findNextSpawn(mob, pointSec, searchLimit, nowSec = 0) {
  let moonPhases = [];
  if (!mob.moonPhase) {
    moonPhases.push([pointSec, searchLimit]);
  } else {
    let targetPhase = mob.moonPhase === "新月" ? 32.5 : 16.5;
    const startPhase = getEorzeaMoonInfo(new Date(pointSec * 1000)).phase;

    if (
      (mob.moonPhase === "新月" && (startPhase >= 32.5 || startPhase < 4.5)) ||
      (mob.moonPhase === "満月" && (startPhase >= 16.5 && startPhase < 20.5))
    ) {
      let currentPhaseStart = pointSec - (startPhase - targetPhase) * ET_DAY_SEC;
      while (currentPhaseStart > pointSec) currentPhaseStart -= MOON_CYCLE_SEC;

      const currentPhaseEnd = currentPhaseStart + MOON_PHASE_DURATION_SEC;

      if (currentPhaseEnd > pointSec) {
        moonPhases.push([pointSec, currentPhaseEnd]);
      }
    }

    let moonStart = calculateNextMoonStart(pointSec, targetPhase);
    while (moonStart < searchLimit) {
      moonPhases.push([moonStart, moonStart + MOON_PHASE_DURATION_SEC]);
      moonStart += MOON_CYCLE_SEC;
    }
  }
  for (const [mStart, mEnd] of moonPhases) {
    const weatherIterator = getValidWeatherIntervals(mob, mStart, mEnd);

    for (const [wStart, wEnd] of weatherIterator) {
      const etIterator = getValidEtIntervals(mob, wStart, wEnd);

      for (const [eStart, eEnd] of etIterator) {
        const finalStart = Math.max(eStart, pointSec);
        const finalEnd = eEnd;

        if (finalStart < finalEnd) {
          if (nowSec > 0 && finalEnd <= nowSec) {
            continue;
          }
          return { start: finalStart, end: finalEnd };
        }
      }
    }
  }
  return null;
}

export function calculateRepop(mob, maintenance, options = {}) {
  const { skipConditionCalc = false, forceRecalc = false } = options;
  const now = Date.now() / 1000;
  const lastKill = mob.last_kill_time || 0;
  const repopSec = mob.repopSeconds;
  const maxSec = mob.maxRepopSeconds;

  const maint = (maintenance && maintenance.maintenance) ? maintenance.maintenance : maintenance;
  if (!maint || !maint.start) return baseResult("Unknown");

  const maintenanceStartDate = parseDate(maint.start);
  if (!maintenanceStartDate) return baseResult("Unknown");

  const { minRepop, maxRepop, appliedFactor } = getMaintenanceRepop(mob, lastKill, maint, now);

  const serverUpDate = parseDate(maint.serverUp || maint.end);
  const serverUp = serverUpDate ? serverUpDate.getTime() / 1000 : 0;
  const maintenanceStart = maintenanceStartDate.getTime() / 1000;

  const pointSec = Math.max(minRepop, now);

  const nextMinRepopDate = new Date(minRepop * 1000);
  const searchLimit = pointSec + LIMIT_DAYS * 24 * 3600;

  let status = "Unknown";
  let timeRemaining = "";
  let conditionRemaining = null;
  let nextConditionSpawnDate = null;
  let conditionWindowEnd = null;
  let isInConditionWindow = false;

  const hasCondition = !!(
    mob.moonPhase ||
    mob.timeRange ||
    mob.timeRanges ||
    mob.weatherSeedRange ||
    mob.weatherSeedRanges ||
    mob.conditions
  );

  if (!options.forceRecalc && mob.repopInfo && mob.repopInfo.nextBoundarySec && now < mob.repopInfo.nextBoundarySec) {
    if (now >= minRepop && maxRepop > minRepop) {
      mob.repopInfo.elapsedPercent = Math.min(100, Math.floor(((now - minRepop) / (maxRepop - minRepop)) * 100));
    } else {
      mob.repopInfo.elapsedPercent = 0;
    }

    const tSec = mob.repopInfo.nextBoundarySec;
    mob.repopInfo.timeRemaining = formatDurationColon(Math.max(0, tSec - now));
    return mob.repopInfo;
  }

  if (hasCondition && !skipConditionCalc) {
    let needRecalc = forceRecalc;

    if (mob._spawnCache) {
      if (mob._spawnCache.appliedFactor !== appliedFactor) {
        needRecalc = true;
      } else if (now >= mob._spawnCache.end) {
        needRecalc = true;
      }
    } else {
      needRecalc = true;
    }

    if (needRecalc) {
      const baseSec = Math.max(minRepop, now);
      const searchAnchor = baseSec - 18000;
      const searchLimit = baseSec + LIMIT_DAYS * 24 * 3600;

      const result = findNextSpawn(mob, searchAnchor, searchLimit, baseSec);

      if (result) {
        mob._spawnCache = {
          appliedFactor,
          start: result.start,
          end: result.end
        };
      } else {
        mob._spawnCache = null;
      }
    }

    if (mob._spawnCache) {
      const start = Math.max(mob._spawnCache.start, minRepop);
      const end = mob._spawnCache.end;

      if (start < end) {
        nextConditionSpawnDate = new Date(start * 1000);
        conditionWindowEnd = new Date(end * 1000);
        isInConditionWindow = (now >= start && now < end && now >= minRepop);
      }
    }
  }

  let elapsedPercent = 0;

  if (now >= maxRepop) {
    status = "MaxOver";
    elapsedPercent = 100;
    timeRemaining = formatDurationColon(now - maxRepop);
  } else if (now < minRepop) {
    status = "Next";
    const nextConditionSec = nextConditionSpawnDate ? nextConditionSpawnDate.getTime() / 1000 : 0;
    const target = (hasCondition && nextConditionSec > minRepop) ? nextConditionSec : minRepop;
    timeRemaining = formatDurationColon(target - now);
  } else {
    status = "PopWindow";
    elapsedPercent = (now < minRepop || maxRepop <= minRepop) ? 0 : Math.min(100, Math.floor(((now - minRepop) / (maxRepop - minRepop)) * 100));
    timeRemaining = formatDurationColon(maxRepop - now);

    if (hasCondition && nextConditionSpawnDate) {
      const nextConditionSec = nextConditionSpawnDate.getTime() / 1000;
      if (nextConditionSec > now) {
        status = "NextCondition";
        timeRemaining = formatDurationColon(nextConditionSec - now);
      }
    }
  }

  if (isInConditionWindow && now >= minRepop) {
    if (status !== "MaxOver") {
      status = "ConditionActive";
    }
  }

  const isMaintenanceStop = !!(maintenanceStartDate && now >= (maintenanceStart + 1800) && !(serverUp > maintenanceStart && now >= serverUp));

  let isBlockedByMaintenance = false;
  if (maintenanceStart && now < (maintenanceStart + 1800)) {
    if (minRepop >= maintenanceStart) {
      isBlockedByMaintenance = true;
    } else if (nextConditionSpawnDate && nextConditionSpawnDate.getTime() / 1000 >= maintenanceStart) {
      isBlockedByMaintenance = true;
    }
  }

  if (isMaintenanceStop || isBlockedByMaintenance) {
    status = "Maintenance";
  }

  return {
    minRepop,
    maxRepop,
    elapsedPercent,
    timeRemaining,
    conditionRemaining,
    status,
    nextMinRepopDate,
    nextConditionSpawnDate,
    conditionWindowEnd,
    isInConditionWindow,
    isMaintenanceStop,
    isBlockedByMaintenance,
    maintStart: maintenanceStart,
    maintEnd: serverUp || (parseDate(maint.end)?.getTime() / 1000 || 0),
    nextBoundarySec: (() => {
      let bSec = [
        minRepop,
        maxRepop,
        nextConditionSpawnDate ? nextConditionSpawnDate.getTime() / 1000 : null,
        conditionWindowEnd ? conditionWindowEnd.getTime() / 1000 : null
      ].filter(t => t !== null && t > now).reduce((min, t) => Math.min(min, t), Infinity);

      if (hasCondition && !nextConditionSpawnDate && skipConditionCalc) {
        bSec = 0;
      }
      return bSec;
    })()
  };
}

export function formatMMDDHHmm(input) {
  if (!input) return "--/-- --:--";
  let date;
  if (input instanceof Date) date = input;
  else if (typeof input === "string") date = new Date(input);
  else date = new Date(input * 1000);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${m}/${d} ${hh}:${mm}`;
}

function baseResult(status) {
  return {
    minRepop: null,
    maxRepop: null,
    elapsedPercent: 0,
    timeRemaining: "",
    status: status || "Unknown",
    nextMinRepopDate: null,
    nextConditionSpawnDate: null,
    conditionWindowEnd: null,
    conditionRemaining: null,
    isInConditionWindow: false,
    isMaintenanceStop: false,
    isBlockedByMaintenance: false
  };
}

export function getMaintenanceRepop(mob, lastKill, maintenance, nowSec) {
  const maint = (maintenance && maintenance.maintenance) ? maintenance.maintenance : maintenance;
  const repopSec = mob.repopSeconds;
  const maxSec = mob.maxRepopSeconds;

  if (!maint || !maint.start) {
    return { minRepop: lastKill + repopSec, maxRepop: lastKill + maxSec, appliedFactor: 1 };
  }

  const maintenanceStart = parseDate(maint.start)?.getTime() / 1000 || 0;

  if (nowSec && nowSec >= maintenanceStart && nowSec < (maintenanceStart + 1800)) {
    return { minRepop: lastKill + repopSec, maxRepop: lastKill + maxSec, appliedFactor: 1 };
  }

  const isRankF = mob.rank === "F";
  let serverUp = parseDate(maint.serverUp || maint.end)?.getTime() / 1000 || 0;
  if (nowSec >= maintenanceStart && serverUp <= maintenanceStart) {
    serverUp = maintenanceStart;
  }

  if (lastKill === 0 || lastKill <= serverUp) {
    const factor = isRankF ? 1 : MAINT_FACTOR;
    return {
      minRepop: serverUp + (repopSec * factor),
      maxRepop: serverUp + (maxSec * factor),
      appliedFactor: factor
    };
  }

  return { minRepop: lastKill + repopSec, maxRepop: lastKill + maxSec, appliedFactor: 1 };
}