# モブハント 更新サイクル仕様書

本仕様書はAIが誤った実装をしないよう、更新サイクルの動作を厳密に定義したものである。

---

## 1. 処理対象の範囲

**常に「現在UIで選択されているランクタブ・拡張タブのモブのみ」が対象。**
選択外のモブは計算・描画・通知のいかなる処理からも完全に除外される。
`getFilteredMobs()` の返却値がその範囲である。

---

## 2. 更新サイクル（Tier）

### Tier B — 1分周期（論理監視）

- **間隔**: 60,000ms（リアル1分）
- **対象**: `getFilteredMobs()` の全件
- **処理**: `updateMobState` / `checkAndNotify`（ステータス判定・通知）
- **動作条件**: ブラウザタブの表示・非表示に関わらず**常に実行する**
- **重要**: Tier B が実行された場合、`lastTierCTime` も同時にリセットする。
  これにより Tier B 直後の Tier C 重複実行を防ぐ。

### Tier C — 約3秒周期（境界直前の高精度更新）

- **間隔**: 2,917ms（エオルゼア1分）
- **対象**: `getFilteredMobs()` のうち `nextBoundarySec - nowSec <= 60` のモブのみ
- **処理**: `updateMobState` / `checkAndNotify`（Tier B と同一）
- **動作条件**: ブラウザタブが**表示状態のときのみ** DOM 描画（`updateVisibleCards`）を実行する
- **目的**: 境界（minRepop / maxRepop / conditionWindowEnd 等）まで残り1分を切ったモブは
  1分周期では更新が間に合わないため、3秒精度で補完する

#### 【重要】Tier C の対象判定について

- `nextBoundarySec` は `[minRepop, maxRepop, conditionWindowEnd, ...]` のうち
  現在時刻より未来の最小値である
- **特殊条件中（ConditionActive / なう）のモブに特別扱いはない**
  窓の残り時間が60秒を超えている間は Tier B（1分）のみで処理される
  窓終了60秒前になって初めて Tier C に昇格する
- **「ConditionActive なら常に3秒更新」という実装は仕様違反である**

---

## 3. 可視性ガード（Visibility Guard）

- **非表示時（`document.visibilityState === 'hidden'`）**:
  - `updateVisibleCards()`（DOM描画）を実行しない
  - Tier B の論理監視・通知処理は継続する
- **復帰時（`visibilitychange` → `visible`）**:
  - `updateProgressBarsOptimized(force = true)` を即座に実行し、
    全件の再計算と描画を遅延なく反映させる
  - これにより、バックグラウンド中に蓄積されたズレを即座に解消する

---

## 4. 重い計算（天候・月齢探索）の実行タイミング

- `findNextSpawn` 等の条件探索処理は以下の**トリガー発生時のみ**実行する:
  1. 初回ロード時
  2. 討伐報告の受信時（Firestore より更新が届いたとき）
  3. 算出済みの `nextBoundarySec` を現在時刻が超えた（境界を跨いだ）とき
- **定期ループ（Tier B / Tier C）内で条件探索を再実行してはならない**
  ループ内では保存済みの `nextBoundarySec` との時刻比較（O(1)）のみを行う
- 探索結果は `mob._spawnCache` にキャッシュされ、`cacheKey` が変わるまで再利用される

---

## 5. モブステータスの定義

| ステータス | 意味 |
| :--- | :--- |
| `MaxOver` | 最大リポップ時間を超過している状態 |
| `ConditionActive` | リポップ窓内で、かつ天候・時間等の特殊条件を満たしている状態（なう） |
| `PopWindow` | リポップ窓内だが、特殊条件を満たしていない（または条件がない）状態 |
| `NextCondition` | リポップ窓内だが、次の特殊条件待ちの状態 |
| `Next` | 最短リポップ時間に到達していない状態 |
| `Maintenance` | メンテナンス中、またはメンテナンスによるリポップ停止状態 |

---

## 6. リポップ計算（cal.js）の重要ロジック

### メンテナンス時のリポップ補正

- メンテナンス終了後（またはサーバ稼働後）のリポップ時間は、通常時間に `MAINT_FACTOR (0.6)` を乗じた値となる。
- **ランクF（FATE）は補正対象外**（常に 1.0 倍）。
- **猶予期間**: メンテナンス開始時刻から **30分（1800秒）以内** は、メンテナンス補正を適用せず通常の `lastKill` ベースで計算する。

### 次回境界（nextBoundarySec）の算出

- ステータスが変化する可能性のある最短の未来時刻を保持する。
- 対象: `minRepop`, `maxRepop`, `nextConditionSpawnDate`, `conditionWindowEnd`

---

## 7. ソート順序（mobSorter.js）

表示上のグループ（GroupKey）は以下の優先順位で分類される：

1. `MAX_OVER`: 時間切れ（最優先）
2. `WINDOW`: 窓開け中（`PopWindow`, `ConditionActive`, `NextCondition`）
3. `NEXT`: リポップ待ち
4. `MAINTENANCE`: メンテナンス停止中

### 同一グループ内の詳細順序

- `ConditionActive`（条件合致）のモブを最優先。
- 基本は `minRepop` の昇順（早く沸くもの順）。
- 同じ `minRepop` の場合はランク優先度（S > A > F）、拡張版ID（新しい順）、モブID、インスタンス番号の順。

---

## 8. 命名規則とデータ構造

- **モブ番号（No）**: `5桁の数値`（例: 06011）
  - 上2桁: 拡張版ID
  - 中2桁: モブ固有ID
  - 下1桁: インスタンス番号（1〜3）
- **表示名**: `インスタンス番号_名前`（例: `1_ボナコン`）の形式でレンダリングされる。

---

## 9. データ管理と同期 (dataManager.js)

### 状態管理 (State)

- アプリの状態は `dataManager.js` の `state` オブジェクトで一元管理される。
- **Firestore 同期**: 討伐時間 (`last_kill_time`)、位置情報、メモなどは Firestore を通じてリアルタイムに同期される。
- **キャッシュ**: 基礎データや計算結果 (`_spawnCache`) は IndexedDB にキャッシュされ、オフライン時や再起動時の高速化を図っている。

### 初期ロードのライフサイクル

1. `loadBaseMobData`: IndexedDB からキャッシュを読み込み、暫定表示。
2. Firestore 購読開始: 最新の討伐状況を受信。
3. `initialLoadComplete`: すべての必須データ（Status, Maintenance）が揃い、全件の計算が完了した時点で `true` となる。
4. タイムアウト (8秒): Firestore の応答が遅い場合、キャッシュデータで強制的に初期化を完了させる。

---

## 10. Sランク特有の仕様

Sランクモブは、他のランク（A, F）と一部の表示・計算ロジックが異なる。

- **ステータスラベル**:

  - `Next` / `NextCondition` の場合、Sランクは「次回」、他は「残り」と表示される。
- **計算の重さ**:
  - Sランクは天候・月齢等の複雑な条件を持つため、計算コストが高い。
  - そのため、計算は主スレッドをブロックしないよう **Web Worker (worker.js)** で実行される。

---

## 11. Web Worker の役割

- `calculateRepop` を含む重い計算ロジックは Web Worker 上で実行される。
- UIスレッドからは `requestWorkerCalculation` を通じて依頼を出し、結果をメッセージで受け取る。
- **AIへの注意**: UIスレッド（`app.js` 等）で重いループ処理や大規模な再計算を直接実行せず、ワーカーや `pendingCalculationMobs` の仕組みを尊重すること。

---

## 12. AI向け禁止事項（まとめ）

以下は仕様違反であり、AIが自己判断で実装してはならない。これらはシステムの安定性と整合性を守るための絶対規律である。

- **更新サイクル関連**:
  - Tier C の対象を `ConditionActive` 状態で別途抽出する処理
  - Tier C を全件（全 `filtered` モブ）に対して実行する処理
  - 定期ループ内で `calculateRepop` / `findNextSpawn` を無条件に呼び出す処理
  - Tier B の対象を「一部のモブ」に絞り込む処理
  - `updateVisibleCards` の visibility チェックを省略する処理
- **計算・ロジック関連**:
  - メンテナンス猶予期間（1800秒）を無視したリポップ計算
  - Aランクのソート順を独断でSランクと異なるルールにする処理
  - UIスレッドでの大規模な再計算ループの実行
- **その他**:
  - `cal.js` の定数や計算ロジックを指示なく変更すること
  - `1_ボナコン` のような命名規則を独断で変更すること
