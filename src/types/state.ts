import { Mob, CullStatus } from "./mob";

export interface FilterState {
  rank: string;
  clickStep: number;
  areaSets: Record<string, Set<string>>;
  allRankSet: Set<string>;
}

export interface AppState {
  userId: string | null;
  lodestoneId: string | null;
  characterName: string | null;
  isVerified: boolean;
  baseMobData: Mob[];
  mobs: Mob[];
  maintenance: any | null; // メンテナンス情報オブジェクト
  initialLoadComplete: boolean;
  worker: Worker | null;
  filter: FilterState;
  openMobCardNo: number | null;
  notificationEnabled: boolean;
  pendingCalculationMobs: Set<number>;
  pendingStatusMap: any | null;
  pendingMaintenanceData: any | null;
  pendingLocationsMap: any | null;
  pendingMemoData: any | null;
  _filterVersion: number;
  sMobMap: Map<string, Mob>;
  mobsMap: Map<string, Mob>;
  hasUnreadTelop: boolean;
  mobLocations?: Record<string, Record<string, CullStatus>>;
}
