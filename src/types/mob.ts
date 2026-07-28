/** モブ番号: 5桁数値 (EEMMN = 拡張版2桁 + モブID2桁 + インスタンス1桁) */
export type MobNo = number;

export type MobRank = "S" | "A" | "F" | "B1" | "B2";

export type RepopStatus =
  | "Maintenance"
  | "MaxOver"
  | "ConditionActive"
  | "PopWindow"
  | "Next"
  | "NextCondition"
  | "Unknown";

export interface CullStatus {
  culled_at?: { seconds: number } | { toMillis(): number };
  uncull_at?: { seconds: number } | { toMillis(): number };
  reporter_id?: string;
}

export interface SpawnPoint {
  id: string;
  x: number;
  y: number;
  mob_ranks: string[];
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface ConditionNight {
  timeRange: TimeRange;
}

export interface MobConditions {
  firstNight?: ConditionNight;
  otherNights?: ConditionNight;
}

export interface WeatherDuration {
  minutes: number;
}

export interface SpawnCache {
  appliedFactor: number;
  start: number;
  end: number;
}

export interface RepopInfo {
  status: RepopStatus;
  minRepop: number | null;
  maxRepop: number | null;
  timeRemaining: string;
  elapsedPercent: number;
  nextBoundarySec: number | null;
  isInConditionWindow: boolean;
  isMaintenanceStop: boolean;
  isBlockedByMaintenance: boolean;
  nextMinRepopDate?: Date | null;
  nextConditionSpawnDate?: Date | null;
  conditionWindowEnd?: Date | null;
  conditionRemaining?: number | null;
  maintStart?: number;
  maintEnd?: number;
}

export interface Mob {
  No: MobNo;
  rank: MobRank;
  name: string;
  area: string;
  condition: string;
  repopSeconds: number;
  maxRepopSeconds: number;
  Expansion?: string;
  ExpansionId?: number;
  mapImage?: string;
  locations?: SpawnPoint[];
  last_kill_time?: number;
  prev_kill_time?: number;
  spawn_cull_status?: Record<string, CullStatus>;
  memo_text?: string;
  memo_updated_at?: number;
  repopInfo?: RepopInfo;
  _spawnCache?: SpawnCache | null;

  // JSON からの読み込み用短縮キーの互換用定義
  r?: string;
  n?: string;
  a?: string;
  min?: number;
  max?: number;
  cond?: string;

  // 特殊出現条件 (Sランク等)
  moonPhase?: string;
  timeRange?: TimeRange;
  timeRanges?: TimeRange[];
  weatherSeedRange?: [number, number];
  weatherSeedRanges?: [number, number][];
  weatherDuration?: WeatherDuration;
  conditions?: MobConditions;
}
