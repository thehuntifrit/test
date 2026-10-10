# The Hunt — AI向けプロジェクト仕様書

> **目的**: AIが本プロジェクトの仕様を素早く正確に理解し、誤った実装を防ぐための包括的ドキュメント。
> 最終更新: 2026-10-04

---

## 1. プロジェクト概要

FFXIV (ファイナルファンタジー14) **Ifritサーバー**のモブハント情報を、ユーザー間でリアルタイム共有するWebアプリケーション。
討伐時刻の報告・出現タイミングの計算・スポーン地点の座標埋め・メモ共有を主要機能とする。

---

## 2. 技術スタック

| カテゴリ | 技術 | 備考 |
| --- | --- | --- |
| フロントエンド | TypeScript + Vite | SPA（フレームワーク不使用） |
| スタイリング | Vanilla CSS (8ファイル) | CSS変数によるテーマ管理 |
| バックエンド | Firebase (Firestore, Auth, App Check) | SDK v12 ESM CDN直接インポート |
| 認証 | Firebase Anonymous Auth + Lodestone認証 | Cloudflare Worker経由のスクレイピング |
| 外部連携 | Faloop WebSocket → Firestore (Python) | サーバーサイドブリッジ |
| ホスティング | Firebase Hosting / GitHub Pages | `.github/workflows/` でCI/CD |
| PWA | Service Worker | 静的アセットのオフラインキャッシュ |

### ビルドコマンド

```bash
npm run dev      # Vite開発サーバー (port 3000)
npm run build    # tsc + vite build → dist/
npm run preview  # ビルド結果プレビュー
npm run check    # TypeScript型チェック (noEmit)
```

---

## 3. ディレクトリ構成

```
The-Hunt/
├── index.html                 # SPAエントリ（HTML テンプレート多数）
├── vite.config.js             # Vite設定
├── tsconfig.json              # TypeScript設定 (ES2022, strict)
├── package.json               # the-hunt v1.0.0
├── sw.js                      # Service Worker (開発用)
├── SPECIFICATION.md           # 本ドキュメント
│
├── src/                       # メインソースコード
│   ├── app.ts                 # (1,151行) アプリ初期化・UIレンダリング・更新サイクル
│   ├── dataManager.ts         # (1,028行) 状態管理・データロード・Firestore同期
│   ├── server.ts              # (393行) Firebase Auth/Firestore CRUD
│   ├── cal.ts                 # (644行) エオルゼア時間・天候・月齢・リポップ計算
│   ├── mobCard.ts             # (786行) モブカード描画・マップ・スポーン地点
│   ├── mobSorter.ts           # (216行) ソート・フィルタ・グループ化
│   ├── sidebar.ts             # (604行) ナビ・通知・ランクフィルター
│   ├── modal.ts               # (156行) 討伐報告モーダル・認証モーダル
│   ├── readme.ts              # (171行) ユーザーマニュアル表示
│   ├── types/
│   │   ├── mob.ts             # Mob, RepopInfo, CullStatus 等の型定義
│   │   └── state.ts           # AppState, FilterState の型定義
│   └── workers/
│       └── calWorker.ts       # Web Worker（リポップ計算のオフロード）
│
├── css/                       # スタイルシート
│   ├── root.css               # CSS変数・テーマ・リセット・ユーティリティ
│   ├── layout.css             # メインレイアウト
│   ├── loading.css            # ローディングオーバーレイ
│   ├── appnav.css             # サイドナビゲーション
│   ├── moblist.css            # モブリスト一覧
│   ├── mobcard.css            # モブカード詳細パネル
│   ├── modal.css              # モーダルダイアログ
│   └── manual.css             # ユーザーマニュアル
│
├── public/                    # 静的アセット (Viteのpublic)
│   ├── json/
│   │   ├── mob_data.json      # 全モブ定義（拡張1〜6のS/A/Fモブ）
│   │   ├── mob_locations.json # 全エリアのスポーン地点座標
│   │   └── maintenance.json   # メンテナンス予定
│   ├── maps/                  # マップ画像 (13エリア, WebP)
│   ├── icon/                  # ファビコン
│   ├── sound/                 # 通知音（リンクシェル音）
│   ├── js/lib/                # 外部ライブラリ (marked, DOMPurify)
│   └── sw.js                  # Service Worker (本番用)
│
├── server/                    # サーバーサイドコンポーネント
│   ├── cloudflare-worker.js   # Lodestone認証プロキシ
│   ├── faloop.py              # Faloop WebSocket → Firestoreブリッジ
│   └── Firebase Security      # Firestoreセキュリティルール
│
└── old/                       # 旧版（JS版バックアップ + specification.md）
```

---

## 4. アーキテクチャ全体図

```
┌────────────────────── クライアント (SPA) ──────────────────────┐
│                                                                  │
│  app.ts ─→ dataManager.ts ─→ server.ts ─→ Firebase (Firestore) │
│    │              │                            ↕                 │
│    │              ├─→ cal.ts (計算)     Firebase Auth + AppCheck │
│    │              └─→ calWorker.ts (Worker)                      │
│    │                                                             │
│    ├─→ mobCard.ts (カード描画)                                   │
│    ├─→ mobSorter.ts (ソート・フィルタ)                           │
│    ├─→ sidebar.ts (ナビ・通知)                                   │
│    └─→ modal.ts (モーダル)                                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
         ↕                              ↕
  Cloudflare Worker              Faloop WebSocket
    (Lodestone認証)               (faloop.py → Firestore)
```

---

## 5. 状態管理 (dataManager.ts)

### 5.1 AppState（シングルトン）

`dataManager.ts` の `state` オブジェクトでアプリ全体の状態を一元管理する。
`getState()` でアクセスし、各setter関数で更新する。

```typescript
interface AppState {
  userId: string | null;          // Firebase Anonymous Auth UID
  lodestoneId: string | null;     // Lodestone キャラクターID
  characterName: string | null;   // キャラクター名
  isVerified: boolean;            // Lodestone認証済みか

  baseMobData: Mob[];             // 基礎モブデータ（JSONから読み込み）
  mobs: Mob[];                    // 現在のモブ配列（リアルタイム情報を含む）
  mobsMap: Map<string, Mob>;      // MobNo → Mob の高速参照マップ
  sMobMap: Map<string, Mob>;      // "{area}_{instance}" → Sモブ の参照マップ

  maintenance: any | null;        // メンテナンス情報
  initialLoadComplete: boolean;   // 初期ロード完了フラグ
  worker: Worker | null;          // Web Worker インスタンス

  filter: FilterState;            // 現在のフィルター状態
  openMobCardNo: number | null;   // 現在開いているモブカードの番号
  notificationEnabled: boolean;   // 通知有効/無効

  pendingCalculationMobs: Set<number>;  // 計算中のモブ番号
  pendingStatusMap: any | null;         // 初期ロード前に受信した討伐データ
  pendingMaintenanceData: any | null;   // 初期ロード前のメンテデータ
  pendingLocationsMap: any | null;      // 初期ロード前の位置データ
  pendingMemoData: any | null;          // 初期ロード前のメモデータ

  _filterVersion: number;         // フィルタキャッシュのバージョン
  hasUnreadTelop: boolean;        // 未読の告知があるか
  mobLocations?: Record<string, Record<string, CullStatus>>;  // 座標埋め状態
}
```

### 5.2 永続化

| データ | 保存先 | キー |
| --- | --- | --- |
| ユーザーID | localStorage | `user_uuid` |
| LodestoneID | localStorage | `lodestone_id` |
| キャラクター名 | localStorage | `character_name` |
| 認証状態 | localStorage | `is_verified` |
| フィルター状態 | localStorage | `huntFilterState` |
| 通知設定 | localStorage | `huntNotificationEnabled` |
| 基礎モブデータ | IndexedDB (HuntDB) | `mobDataCache` |
| 討伐ステータス | IndexedDB (HuntDB) | `mobStatusCache` |
| スポーン条件キャッシュ | IndexedDB (HuntDB) | `spawnConditionCache` |
| 位置データ | IndexedDB (HuntDB) | `mobLocationsCache` |

---

## 6. データ構造

### 6.1 モブ番号体系 (MobNo)

5桁の数値: `EEMMN`

| 桁 | 意味 | 例 |
| --- | --- | --- |
| EE (上2桁) | 拡張版ID | 01=新生, 02=蒼天, 03=紅蓮, 04=漆黒, 05=暁月, 06=黄金 |
| MM (中2桁) | モブ固有ID | 01〜 |
| N (下1桁) | インスタンス番号 | 1〜3 |

**例**: `06011` = 黄金(06), モブ01, インスタンス1

### 6.2 mob_data.json の構造

```json
{
  "mobs": {
    "11011": {
      "r": "A",           // ランク (S/A/F)
      "n": "醜男のヴォガージャ",  // 名前
      "a": "中央ラノシア",       // エリア
      "min": 12600,       // 最短リポップ秒数
      "max": 16200,       // 最大リポップ秒数
      "cond": "",         // 出現条件テキスト（任意）
      // Sモブのみの追加フィールド:
      "moonPhase": "新月",              // 月齢条件
      "timeRange": {"start": 18, "end": 6},  // ET時間範囲
      "weatherSeedRange": [0, 19],      // 天候シード範囲
      "weatherDuration": {"minutes": 46},// 必要天候持続時間
      "conditions": {...}               // 複合条件
    }
  }
}
```

正規化後（`processMobData()`）:

```typescript
interface Mob {
  No: number;              // モブ番号 (5桁)
  rank: "S" | "A" | "F";
  name: string;            // 表示名（"1_ボナコン" 形式あり）
  area: string;            // エリア名（日本語）
  repopSeconds: number;    // 最短リポップ秒
  maxRepopSeconds: number; // 最大リポップ秒
  condition: string;       // 出現条件テキスト
  Expansion: string;       // 拡張名（"新生"〜"黄金"）
  ExpansionId: number;     // 拡張ID (1〜6)

  last_kill_time: number;          // 最終討伐Unix秒（Firestoreから）
  prev_kill_time: number;          // 前回討伐Unix秒
  spawn_cull_status: Record<string, CullStatus>;  // 座標埋め状態
  memo_text: string;               // 共有メモ
  repopInfo: RepopInfo;            // 計算済みリポップ情報
  _spawnCache: SpawnCache | null;  // 条件探索キャッシュ

  // Sモブ特殊条件
  moonPhase?: string;
  timeRange?: TimeRange;
  weatherSeedRange?: [number, number];
  weatherDuration?: WeatherDuration;
  conditions?: MobConditions;
}
```

### 6.3 mob_locations.json の構造

```json
{
  "高地ラノシア": {
    "mapImage": "Upper_La_Noscea.webp",
    "locations": [
      {"id": "UN_101", "x": 33.5, "y": 8.0, "mob_ranks": ["S","A","B1"]},
      ...
    ]
  }
}
```

### 6.4 表示名規則

- インスタンスがある場合: `"1_ボナコン"` → `"①ボナコン"` のようにレンダリング
- `renderNameWithInstance()` で処理

---

## 7. Firestore コレクション構造

| コレクション | ドキュメント | フィールド | 説明 |
| --- | --- | --- | --- |
| `mob_status` | `s_latest` | `{mobNo}: {last_kill_time, prev_kill_time, reporter_id}` | Sモブ討伐時刻 |
| `mob_status` | `a_latest` | 同上 | Aモブ討伐時刻 |
| `mob_status` | `f_latest` | 同上 | Fモブ（FATE）討伐時刻 |
| `mob_locations` | `{area}_{instance}` | `points.{locationId}.{culled_at, uncull_at, reporter_id}` | 座標埋め状態 |
| `shared_data` | `memo` | `{mobNo}: [{memo_text, created_at, reporter_id}]` | 共有メモ |
| `shared_data` | `maintenance` | `{start, end, serverUp, message}` | メンテナンス情報 |
| `users` | `{uid}` | `{lodestone_id, character_name, updated_at}` | ユーザー情報 |

### リアルタイムリスナー（`startRealtime()`で登録）

1. **mob_status** (`s_latest`, `a_latest`, `f_latest`): 討伐時刻の変更を監視
2. **mob_locations**: 座標埋め状態の変更を監視
3. **shared_data/memo**: メモの変更を監視
4. **shared_data/maintenance**: メンテナンス情報の変更を監視

---

## 8. 初期化フロー

```
DOMContentLoaded
  └→ initApp()
      ├→ initAppEventListeners()       // イベント登録
      ├→ attachMobCardEvents()          // カードクリックイベント
      ├→ initGlobalMagnifier()          // 拡大鏡初期化
      ├→ await loadBaseMobData()        // 基礎データロード
      │   ├→ IDB.get(mobDataCache)      // キャッシュから暫定表示
      │   ├→ fetch(mob_data.json)       // 最新データ取得
      │   ├→ processMobData()           // 正規化・初期計算
      │   └→ loadLocationData()         // スポーン地点ロード
      │
      ├→ initializeAuth()               // Firebase Anonymous Auth
      │   └→ getUserData() → 認証状態復元
      │
      ├→ startRealtime()                // Firestoreリスナー開始
      │   ├→ subscribeMobStatusDocs()   // 討伐時刻
      │   ├→ subscribeMobLocations()    // 座標埋め
      │   ├→ subscribeMobMemos()        // メモ
      │   └→ subscribeMaintenance()     // メンテ
      │
      ├→ initModal() / initAppNav() / etc.
      └→ setTimeout(6s) → ローディングタイムアウト
```

### 初期ロード完了条件

`checkInitialLoadComplete()` が以下すべて `true` のとき `initialLoadComplete = true` となる:

1. `initialLoadState.status` = true（mob_statusデータ受信済み）
2. `initialLoadState.maintenance` = true（メンテナンスデータ受信済み）
3. `pendingCalculationMobs.size === 0`（全条件計算完了）

完了時に `initialDataLoaded` イベント発火 → `filterAndRender({ isInitialLoad: true })` で初回描画。

**タイムアウト**: Firestoreが8秒以内に応答しない場合、キャッシュデータで強制初期化。

---

## 9. 更新サイクル（Tier）

### 9.1 メインループ

`setInterval(updateProgressBarsOptimized, EORZEA_MINUTE_MS)` で約2,917ms (エオルゼア1分) ごとに実行。

### 9.2 Tier B — 1分周期（論理監視）

- **間隔**: 60,000ms
- **対象**: `getFilteredMobs()` の全件
- **処理**: `updateMobState()` → `checkAndNotify()`
- **動作条件**: 表示/非表示**問わず**実行（通知のため）
- **重要**: Tier B 実行時は `lastTierCTime` も同時にリセット（重複防止）

### 9.3 Tier C — 約3秒周期（境界直前の高精度更新）

- **間隔**: 2,917ms（エオルゼア1分）
- **対象**: `nextBoundarySec - nowSec <= 60` のモブのみ
- **動作条件**: `hasUrgentMob` が `true` のときのみ実行
- **目的**: 境界（minRepop / maxRepop / conditionWindowEnd等）まで残り1分を切ったモブの高精度更新

### 9.4 可視性ガード

- **非表示時**: `updateVisibleCards()`（DOM描画）をスキップ。論理監視は継続。
- **復帰時**: `visibilitychange → visible` で `updateProgressBarsOptimized(force=true)` を即時実行。

---

## 10. リポップ計算 (cal.ts)

### 10.1 エオルゼア時間の定数

| 定数 | 値 | 説明 |
| --- | --- | --- |
| `ET_HOUR_SEC` | 175 | 1ET時間 = 175リアル秒 |
| `WEATHER_CYCLE_SEC` | 1400 | 天候サイクル = 8ET時間 |
| `ET_DAY_SEC` | 4200 | 1ET日 = 24ET時間 |
| `MOON_CYCLE_SEC` | 134400 | 1月齢サイクル = 32ET日 |
| `EORZEA_MINUTE_MS` | 2917 | 1ET分 ≈ 2,917リアルms |
| `MAINT_FACTOR` | 0.6 | メンテ後リポップ係数 |

### 10.2 `calculateRepop()` — 主要リポップ計算関数

```
入力: Mob, maintenance, options
出力: RepopInfo
```

**計算フロー**:

1. `getMaintenanceRepop()` で `minRepop` / `maxRepop` を算出（メンテ補正込み）
2. 特殊条件モブ（天候/月齢/ET）の場合、`findNextSpawn()` で次回出現時刻を探索
3. 現在時刻と比較してステータスを決定
4. `nextBoundarySec` を算出（次にステータスが変化する時刻）

### 10.3 メンテナンス補正

- メンテ終了後のリポップ: `repopSeconds × MAINT_FACTOR (0.6)` に短縮
- **ランクF（FATE）は補正対象外**（常に1.0倍）
- **猶予期間**: メンテ開始から30分 (1800秒) 以内はメンテ補正を適用せず、通常の `lastKill` ベース
- `last_kill_time` がメンテ後より古い場合、`serverUp` を基準に計算

### 10.4 特殊条件 (Sモブ)

Sモブは以下の条件の組み合わせで出現する:

| 条件 | 判定関数 | 周期 |
| --- | --- | --- |
| 月齢 | `getEorzeaMoonInfo()` | 32ET日サイクル（新月/満月） |
| 天候 | `getEorzeaWeatherSeed()` | 1400秒サイクル |
| ET時間 | `checkEtCondition()` | 175秒サイクル |
| 天候持続 | `weatherDuration` | N分連続で同一天候 |

**探索**: `findNextSpawn()` が月齢→天候→ET の順にジェネレータで有効区間を交差させ、最も近い出現ウィンドウを特定する。

### 10.5 キャッシュ (`_spawnCache`)

- `findNextSpawn()` の結果を `mob._spawnCache = { appliedFactor, start, end }` にキャッシュ
- 以下の条件で再計算:
  - `forceRecalc: true` が指定された場合
  - `appliedFactor` が変わった場合（メンテ状態変更）
  - 現在時刻がキャッシュの `end` を超えた場合
- IndexedDB にもデバウンスして保存 (`spawnConditionCache`)

### 10.6 nextBoundarySec

ステータスが変化する可能性のある**最短の未来時刻**を保持:

- 対象: `minRepop`, `maxRepop`, `nextConditionSpawnDate`, `conditionWindowEnd`
- 現在時刻より未来のもののうち最小値

**重要**: `nextBoundarySec` を現在時刻が超えたとき（境界を跨いだとき）のみ `calculateRepop()` を再実行する。
定期ループ内では `nextBoundarySec` との比較のみを行い、重い計算は実行しない。

---

## 11. モブステータスの定義

| ステータス | ラベル | 意味 |
| --- | --- | --- |
| `MaxOver` | 超過 | 最大リポップ時間を超過 |
| `ConditionActive` | なう | リポップ窓内で特殊条件を**満たしている** |
| `PopWindow` | 残り | リポップ窓内だが条件未充足（または条件なし） |
| `NextCondition` | 次回(S) / 残り(他) | リポップ窓内だが次の条件待ち |
| `Next` | 次回(S) / 残り(他) | 最短リポップ時間に未到達 |
| `Maintenance` | 停止 | メンテナンス中またはメンテによるリポップ停止 |

---

## 12. ソート順序 (mobSorter.ts)

### グループ分類（優先順位順）

1. `MAX_OVER` (🔚 Time Over) — 最優先
2. `WINDOW` (⏳ Pop Window) — `PopWindow`, `ConditionActive`, `NextCondition`
3. `NEXT` (🔜 Respawning) — リポップ待ち
4. `MAINTENANCE` (🛠️ Maintenance) — メンテ停止中

### 同一グループ内のソート (`allTabComparator`)

1. `ConditionActive`（条件合致中）のモブを最優先
2. 基本は `elapsedPercent` の降順（進行度が高い順）
3. 同じ場合: ランク優先度 (S > A > F)
4. 同じ場合: 拡張版ID降順（新しい拡張優先）
5. 同じ場合: モブID昇順 → インスタンス番号昇順

**MaxOverグループ特有**: `ConditionActive` → `maxRepop` 昇順（より長く超過しているもの優先）→ ランク (S > F > A)

---

## 13. UI描画 (app.ts + mobCard.ts)

### 13.1 リスト構造

`#moblist-container` にグループヘッダー + モブアイテムを flat に配置。
`syncDomOrder()` で DOM の順序を `getSortedFilteredMobs()` の結果に合わせる。

### 13.2 カード更新の最適化

- `cardCache`: `Map<mobNoStr, HTMLElement>` で DOM 要素を高速参照
- `visibleCards`: スクロール範囲内のカードのみ更新
- `_lastStateHash`: 状態ハッシュ比較で不要な再描画をスキップ
- `updateCardFull()`: リストアイテムとモブカードの両方を更新

### 13.3 モブカード詳細

- PC (≥1024px): `#mobcard-pane` に右パネルとして表示
- モバイル (<1024px): オーバーレイとして表示 (`body-lock` で背面スクロール防止)
- テンプレートベース (`#mobcard-card-template`) でDOM生成

### 13.4 座標埋め（スポーン候補地調査）

- マップ上にスポーン地点をドット表示
- 調査済み (culled) / 未調査 (unculled) を色で区別
- PCは右クリックで拡大鏡、スマホはダブルタップでチェック切替
- Firestoreにリアルタイム同期

---

## 14. 認証フロー

### 14.1 Firebase Anonymous Auth

1. アプリ起動時に `signInAnonymously()` でUID取得
2. UIDは `localStorage` に保存

### 14.2 Lodestone認証

1. 認証モーダルで検証コード (`HUNT-XXXXXXXX`) を生成
2. ユーザーがLodestoneプロフィールの自己紹介欄にコードを貼り付け
3. ユーザーがLodestone URLまたはキャラクターIDを入力
4. **Cloudflare Worker** がLodestoneページをスクレイピング:
   - Firebase ID Token検証
   - 日本国外アクセスブロック
   - Bot UAブロック
   - HTMLをパースして自己紹介欄からコードを検索
5. 検証成功 → Firestore `users/{uid}` にキャラクター情報保存
6. `isVerified = true` で報告・メモ・座標埋め機能が有効化

---

## 15. 通知システム (sidebar.ts)

- **対象**: 出現条件合致の2分前 および 開始直後
- **PC**: デスクトップ通知 (`Notification API`)
- **スマホ**: リンクシェル音 (`01 FFXIV_Linkshell_Transmission.mp3`)
- `checkAndNotify()` がTier B / Tier Cで呼ばれ、`notifiedCycles` で重複防止

---

## 16. 外部連携

### 16.1 Cloudflare Worker (`server/cloudflare-worker.js`)

- エンドポイント: `https://icy-resonance-2526.the-hunt-ifrit.workers.dev/`
- パラメータ: `?lodestoneId={id}`
- ヘッダー: `Authorization: Bearer {Firebase ID Token}`
- 機能: Lodestoneキャラクターページの取得（CORS回避）
- セキュリティ: Firebase Token検証 / 国制限(JP) / Bot UA拒否

### 16.2 Faloop ブリッジ (`server/faloop.py`)

- Faloop (モブハント情報サービス) のWebSocketをリッスン
- Ifritサーバーの討伐報告を抽出
- Firestoreの `mob_status/{rank}_latest` に自動書き込み
- `FALOOP_TO_NO_MAP` で Faloop内部IDとモブ番号を対応付け

---

## 17. Web Worker

- **ファイル**: `src/workers/calWorker.ts`
- **役割**: `calculateRepop()` をメインスレッドからオフロード
- **通信**: `postMessage` で `{ type: 'CALCULATE', mob, maintenance, options }` を送信 → `{ type: 'RESULT', mobNo, repopInfo, spawnCache }` を受信
- **利用**: 主にSモブの天候・月齢探索計算（重いため）
- **境界タイマー**: `scheduleRepopTimer()` が `nextBoundarySec` に基づいてタイマーをセットし、境界到達時に `forceRecalc: true` で再計算

---

## 18. カスタムイベント

アプリ内のモジュール間通信に `window.dispatchEvent(CustomEvent)` を使用:

| イベント | トリガー | 処理 |
| --- | --- | --- |
| `initialDataLoaded` | 初期ロード完了 | 初回描画 |
| `initialSortComplete` | 初回ソート完了 | ローディング非表示 |
| `filterChanged` | フィルタ変更 | 再フィルタ・再描画 |
| `mobUpdated` | 個別モブ更新（Worker結果） | カード更新・ソート |
| `mobsBatchUpdated` | 複数モブ一括更新 | バッチ更新・ソート |
| `mobsUpdated` | モブ全体更新 | プログレスバー更新 |
| `locationDataReady` | 位置データロード完了 | カード再描画 |
| `locationsUpdated` | 座標埋め状態変更 | マップ更新 |
| `maintenanceUpdated` | メンテ情報更新 | メンテ表示更新 |
| `characterNameSet` | キャラクター名設定 | ウェルカムメッセージ更新 |
| `appNotify` | エラー/成功通知 | トースト表示 |
| `notificationSettingChanged` | 通知設定変更 | UIトグル反映 |
| `criticalDataLoadError` | 致命的データエラー | エラー画面表示 |

---

## 19. CSS設計

### デザイントークン (`root.css :root`)

| カテゴリ | 主要変数 |
| --- | --- |
| 背景 | `--c-bg: #070d17`, `--c-surface: #142238` |
| ランク色 | `--c-s: #f59e0b (金)`, `--c-a: #22d3ee (シアン)`, `--c-f: #a855f7 (紫)` |
| テキスト | `--c-text-hi: #f0f4f8`, `--c-text-lo: #8fa3c0` |
| z-index | sidebar:50, card:60, magnifier:88, header:90, modal:100, toast:105, loading:110 |
| レイアウト | `--layout-w: 1024px`, `--header-h: 48px` |
| フォント | `--font-ui: Inter, Roboto, ...`, `--font-mono: Roboto Mono, JetBrains Mono` |

### レスポンシブ

- **ブレークポイント**: 1024px (`CONFIG.BREAKPOINT_PC`)
- PC: サイドナビ + リスト + モブカード詳細の3ペイン
- モバイル: トップバー + リスト、カード詳細はオーバーレイ

---

## 20. AI向け禁止事項

以下は仕様違反であり、AIが自己判断で実装してはならない:

### 更新サイクル

- ❌ Tier Cの対象を `ConditionActive` 状態で別途抽出する
- ❌ Tier Cを全件（全filteredモブ）に対して実行する
- ❌ 定期ループ内で `calculateRepop()` / `findNextSpawn()` を無条件に呼び出す
- ❌ Tier Bの対象を一部のモブに絞り込む
- ❌ `updateVisibleCards` の visibility チェックを省略する

### 計算・ロジック

- ❌ メンテナンス猶予期間（1800秒）を無視したリポップ計算
- ❌ FATEモブ（ランクF）にメンテ係数を適用する
- ❌ UIスレッドでの大規模な再計算ループの実行
- ❌ `_spawnCache` を無視して毎回 `findNextSpawn()` を呼ぶ

### 命名・構造

- ❌ `1_ボナコン` のような命名規則を独断で変更する
- ❌ `cal.ts` の定数や計算ロジックを指示なく変更する
- ❌ モブ番号体系（5桁 EEMMN）を変更する
- ❌ Firestoreのコレクション/ドキュメント構造を変更する

### 重い計算の実行タイミング

`findNextSpawn()` 等の条件探索は**以下のトリガー時のみ**実行:

1. 初回ロード時
2. 討伐報告の受信時（Firestoreからの更新）
3. `nextBoundarySec` を現在時刻が超えた時（境界タイマー or Tier B/C内）

定期ループ内では保存済みの `nextBoundarySec` との時刻比較（O(1)）のみを行う。

---

## 21. モジュール間の依存関係

```
app.ts
  ├─ imports: dataManager, cal, mobCard, mobSorter, modal, sidebar, server, readme
  └─ exports: filterAndRender, sortAndRedistribute, updateProgressBarsOptimized, ...

dataManager.ts
  ├─ imports: types/mob, types/state, cal, server
  └─ exports: state, getState, CONFIG, DOM, STATUS_LABELS, loadBaseMobData, startRealtime, ...

server.ts
  ├─ imports: dataManager, modal, cal, types/mob
  ├─ external: Firebase SDK (ESM CDN, @ts-ignore)
  └─ exports: initializeAuth, submitReport, submitMemo, toggleCrushStatus, subscribe*, ...

cal.ts
  ├─ imports: types/mob
  └─ exports: calculateRepop, getMaintenanceRepop, getEorzeaTime, formatters, ...

mobCard.ts
  ├─ imports: cal, dataManager, server, modal, types/mob
  └─ exports: createMobCard, updateProgressBar, updateSimpleMobItem, ...

mobSorter.ts
  ├─ imports: types/state, types/mob, dataManager, mobCard, sidebar
  └─ exports: getFilteredMobs, getSortedFilteredMobs, allTabComparator, ...

sidebar.ts
  ├─ imports: dataManager, app, readme, mobCard, types/mob
  └─ exports: initAppNav, checkAndNotify, togglePanel, handleRankTabClick, ...

modal.ts
  ├─ imports: dataManager, server, mobCard
  └─ exports: openReportModal, closeReportModal, openAuthModal, closeAuthModal, initModal
```

---

## 22. 設定値一覧 (`CONFIG`)

| キー | 値 | 説明 |
| --- | --- | --- |
| `APP_LOAD_TIMEOUT` | 6000ms | ローディングタイムアウト |
| `TIER_B_UPDATE_INTERVAL` | 60000ms | Tier B更新間隔 |
| `TOAST_DURATION` | 4000ms | トースト表示時間 |
| `CLICK_THRESHOLD` | 1000ms | ダブルタップ判定閾値 |
| `DEBOUNCE_DELAY` | 100ms | デバウンス遅延 |
| `BREAKPOINT_PC` | 1024px | PC/モバイル判定 |
| `REPOP_CALC_DELAY` | 2000ms | リポップ計算遅延 |
| `NOTIFICATION_OFFSET_MS` | 120000ms | 通知オフセット（2分前） |
| `MAP_ZOOM_SCALE` | 2.0 | マップ拡大率 |
| `AUTH_TIMEOUT` | 10000ms | 認証タイムアウト |
| `REPORT_FUTURE_THRESHOLD` | 600000ms | 報告可能な未来の閾値（10分） |
| `REPORT_EARLY_THRESHOLD` | 300000ms | 報告可能な最短時刻前の猶予（5分） |
| `MEMO_MAX_LENGTH` | 30 | メモ最大文字数 |
| `FIRESTORE_LOAD_TIMEOUT` | 8000ms | Firestoreロードタイムアウト |

---

## 23. Service Worker

- **キャッシュ名**: `hunt-cache-v5`
- **キャッシュ対象**: JSONデータ、マップ画像、アイコン、通知音
- **戦略**:
  - Firestoreリクエスト/認証: ネットワークのみ（キャッシュしない）
  - JSON: ネットワーク優先、失敗時キャッシュ
  - その他: キャッシュ優先、失敗時ネットワーク
