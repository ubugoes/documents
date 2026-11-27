# 【正式データ仕様書】大阪市産科・分娩施設マスターデータ (`osaka_maternity_facilities.csv`)

> **📌 旧仕様書からの移行について（Important）**
> 本ドキュメントは、開発初期の仮想サンプル仕様書（[sample_osaka_maternity_facilities_doc.md](./sample_osaka_maternity_facilities_doc.md)）を置き換える**正式な後継データ仕様書**です。
> 実在の公的調査データ（[ubunavi_osaka_integrated.csv](../data/ubunavi_osaka_integrated.csv)）および厚労省「医療情報ネット」オープンデータ（[osaka_extracted/](../osaka_extracted)）をもとに、バッチ処理（[build_osaka_maternity_facilities.mjs](../scripts/build_osaka_maternity_facilities.mjs)）によって生成される正規化済みCSV（[osaka_maternity_facilities.csv](../data/osaka_maternity_facilities.csv)）の仕様を定義します。

> **📖 本ドキュメントの読み方**
> * **【前半パート（第1章〜第3章）】**: **企画・デザイン・PMなど非エンジニア向け**。対象範囲、理想データとのギャップをどう解決したか、収録36施設と除外6施設の内訳をわかりやすく解説します。
> * **【後半パート（第4章〜第6章）】**: **エンジニア・実装AI向け**。バッチ処理（ETL）仕様、全51カラムのデータディクショナリ、Enum定義、TypeScriptインターフェース、フィルタ・表示用ロジックを網羅しています。

---

# ──【前半パート】対象範囲・設計方針と収録施設一覧 ──

## 1. このデータは何のためにあるの？（ビジネス概要と旧仕様からの変更点）

### 1.1 「うぶナビ大阪」での役割とデータ対象範囲
本CSVファイル（`data/osaka_maternity_facilities.csv`）は、機能③（[ubunavi-osaka-func3-ux-spec.md](./ubunavi-osaka-func3-ux-spec.md)）の検索・一覧・詳細画面を支える正規化済みマスターデータです。

* **対象施設**: 厚労省「出産なび」等で分娩提供が確認され、かつ施設種別（病院・診療所・助産所）が確認済みの **大阪市内36の分娩取扱施設**（病院20件・診療所10件・有床助産所4件・無床/出張専門助産所2件）。
* **カバーエリア**: 大阪市24区のうち **20区**（`港区`、`大正区`、`東成区`、`西成区` は対象施設0件のため、アプリ側では近隣区を含む検索を案内します）。
* **健診専門クリニックについて**: 実データには「分娩設備を持たない健診専門クリニック」が含まれていないため、**MVP版の本データセットは「分娩取扱施設専用」**として設計しています（里帰り健診専用ユーザー等には検索画面外・0件時ガイドで案内）。

### 1.2 旧サンプル仕様（理想フォーマット）との矛盾と解決方針

実データ（[ubunavi_osaka_integrated.csv](../data/ubunavi_osaka_integrated.csv)）と初期サンプル仕様（[sample_osaka_maternity_facilities_doc.md](./sample_osaka_maternity_facilities_doc.md)）の間に生じた構造的ギャップを、**「客観的事実を捏造しない」「未確認を『なし』に誤変換しない」**という原則で以下の通り解決しました。

| ギャップ領域 | 旧サンプル仕様（理想） | 実データの現実と採用した解決方針 |
| :--- | :--- | :--- |
| **1. 施設種別「未確認」の扱い** | 全施設が `tertiary`〜`midwife` のいずれかに確定。 | 元CSVの42件中6件が `施設の種類 = 未確認`。アプリ側に例外処理を持ち込まないため、**バッチ処理で6件を除外し、種別確定済みの36件のみを収録**する方針を採用。 |
| **2. マップ座標・住所の補完** | 全施設が `latitude` / `longitude` / `address` を保有。 | 元CSVには住所・座標列がないため、バッチ処理で [osaka_extracted/](../osaka_extracted) と名寄せして補完（病院20件＋有床助産所3件＝**23件は座標解決済み**、`0.0/0.0` 座標や出張専門は排除）。**診療所10件は `osaka_02-1_*.csv` 未配置のため `missing_source` 扱い**とし、将来ファイルを追加するだけで自動補完される設計とした。 |
| **3. 診察時間・写真・予約期限・個室** | 全施設に固定テキスト・写真・個室フラグ・予約週数目安を保持。 | 実データに根拠項目が存在しない（また予約枠・診療時間は変動が激しい）ため、**無理に作成せず廃止し、公式HP URLへ直接誘導**する方針に統一。 |
| **4. 無痛分娩の3軸表現** | 単一Enum（`24h` \| `scheduled` \| `none`）。 | 実データでは「24時間対応かつ計画分娩」「非24時間かつ自然陣痛後」「医学的適応のみ」「和痛分娩（筋注）」「経産婦限定」「未確認」が独立して存在するため、**実施区分・24時間対応・分娩方式の3カラムに直交分離**。 |
| **5. 出産費用の比較ソート** | `cost_estimate_min/max` による予算上限フィルタと安い順ソート。 | 元データ自体が「同条件比較不可（総額・無痛単価・初産婦例・未掲載が混在、11件が空欄/未掲載）」であるため、**金額による絞り込み・最安ソートを廃止**。表示種別と原文参考テキスト＋注記をそのまま提示する。 |
| **6. 産後ケアの公開終了対応** | `true` \| `false` の2値フラグ。 | 大阪警察病院が「2026年12月1日より産後ケア事業終了」であるほか、「出産なび掲載（市事業未確認）」が存在するため、**5値ステータス＋終了予定日 (`postpartum_care_end_date`)** で参照日基準の動的判定を行う。 |

---

## 2. データ項目グループの概要

生成された `osaka_maternity_facilities.csv` には、1施設につき以下の5グループの項目（全51カラム）が格納されています。

1. **① 基本・アクセス・マップ座標**
   * 出産なび施設ID（主キー）、厚労省医療情報ネットID、施設名、所在区、住所、緯度・経度、座標解決ステータス (`geo_status`)、アクセス種別（駅通院 / 出張専門）、最寄り駅、徒歩分数、正規化済み沿線リスト (`lines`)、公式HP URL、電話番号。
2. **② 施設種別・医療体制・分娩実績**
   * 施設カテゴリ（病院・診療所・有床助産所・出張専門助産所）、周産期母子医療センター指定区分（総合・地域・指定なし・未確認）、ハイリスク対応可否 (`high_risk_ready`)、NICU病床数、産科病床数、産科医・小児科医・助産師数、年間経腟分娩/帝王切開件数。
3. **③ 無痛分娩・麻酔体制（3軸＋補足）**
   * 希望可否・対象区分 (`painless_availability`)、24時間対応 (`painless_24h`)、分娩タイミング方式 (`painless_timing`)、追加費用メモ、麻酔管理者区分・注記、出典差分などの確認メモ。
4. **④ 助産ケア・産後ケア・産前産後サポート**
   * 院内助産、助産師外来、自施設での新生児聴覚検査、2週間・1ヶ月産婦健診、退院後の授乳支援外来、大阪市産後ケア事業ステータスおよび終了予定日。
5. **⑤ 費用参考情報・出典ガバナンス**
   * 費用表示区分 (`cost_display_type`)、費用参考テキスト、検索用特徴タグ (`feature_tags`)、出産なび・無痛分娩・最寄り駅の出典URL、資料確認日・追加項目確認日、免責事項。

---

## 3. 収録36施設の内訳と除外6施設

### 3.1 収録施設サマリー（36件）

```text
┌──────────────────────────────────────────────────────────────────────┐
│           大阪市内 分娩取扱施設マスターデータ（36施設・20区）          │
├──────────────────────────────────────────────────────────────────────┤
│ ① 総合周産期母子医療センター (2件) : 大阪市立総合医療センター / 愛染橋病院 │
│ ② 地域周産期母子医療センター (6件) : 大阪急性期 / 千船 / 大阪赤十字 /     │
│                                   北野 / 淀川キリスト教 / 大阪公立大   │
│ ③ 一般・産科病院 (12件)           : JCHO大阪（NICU 6床）含む公的・専門病院 │
│ ④ 診療所・クリニック (10件)        : 有床4件・診療所表記6件               │
│ ⑤ 有床助産所 (4件)               : あいっこ / motherゆり / 天子 / にじいろ │
│ ⑥ 無床・出張専門助産所 (2件)       : わたの出張 / とも助産院             │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 全36施設一覧（実測値）

> 表中の座標欄は `○`＝マップ表示可能 (`resolved`, 23件)、`住所のみ`＝座標 `0.0` のため住所表示のみ (`address_only`, 1件)、`未補完`＝診療所オープンデータ待ち (`missing_source`, 10件)、`出張`＝出張専門のため対象外 (`not_applicable_home_visit`, 2件) を表します。

| ID | 施設名 | 所在区 | カテゴリ | 周産期 / NICU | 座標 | 最寄り駅（徒歩） | 希望無痛 | 24H | 方式 | 市産後ケア |
|---|---|---|---|---|:---:|---|---|:---:|---|---|
| `10578` | 大阪医療センター | 中央区 | 病院 | 指定なし / 0床 | ○ | 谷町四丁目駅（1分） | 希望可 | × | 計画 | 掲載 |
| `10084` | 飯島病院 | 中央区 | 病院 | 指定なし / 0床 | ○ | 日本橋駅（4分） | 希望可 | ○ | 自然後 | 掲載 |
| `10389` | 大阪市立総合医療センター | 都島区 | 病院 | 総合 / 12床 | ○ | 都島駅（3分） | 医学的適応のみ | × | 計画 | 出産なびのみ |
| `10371` | 大阪急性期・総合医療センター | 住吉区 | 病院 | 地域 / 9床 | ○ | 長居駅（18分） | 希望可 | × | 計画 | 掲載 |
| `10372` | 大阪市立十三市民病院 | 淀川区 | 病院 | 指定なし / 0床 | ○ | 神崎川駅（10分） | なし | - | - | 掲載 |
| `10849` | 医誠会国際総合病院 | 北区 | 病院 | 指定なし / 0床 | ○ | 扇町駅（3分） | 希望可 | × | 計画 | 掲載 |
| `10797` | 千船病院 | 西淀川区 | 病院 | 地域 / 15床 | ○ | 福駅（1分） | 希望可 | ○ | 自然後 | 掲載 |
| `10500` | 大阪赤十字病院 | 天王寺区 | 病院 | 地域 / 6床 | ○ | 鶴橋駅（7分） | 希望可 | × | 両方 | 出産なびのみ |
| `10050` | JCHO大阪病院 | 福島区 | 病院 | 指定なし / 6床 | ○ | 新福島駅（5分） | 希望可 | × | 両方 | 掲載 |
| `10508` | 北野病院 | 北区 | 病院 | 地域 / 9床 | ○ | 中崎町駅（4分） | 希望可 | × | 両方 | 未確認 |
| `10514` | 日本生命病院 | 西区 | 病院 | 指定なし / 0床 | ○ | 阿波座駅（5分） | 希望可 | × | 計画 | 掲載 |
| `10220` | 聖バルナバ病院 | 天王寺区 | 病院 | 指定なし / 未登録 | ○ | 大阪上本町駅（7分） | 希望可 | ○ | 自然後 | 掲載 |
| `10041` | 愛染橋病院 | 浪速区 | 病院 | 総合 / 18床 | ○ | 恵美須町駅（1分） | 希望可 | ○ | 自然後 | 掲載 |
| `10842` | 淀川キリスト教病院 | 東淀川区 | 病院 | 地域 / 21床 | ○ | 柴島駅 / 崇禅寺駅（3分） | 希望可 | × | 自然後 | 掲載 |
| `10694` | 大阪公立大学医学部附属病院 | 阿倍野区 | 病院 | 地域 / 9床 | ○ | 天王寺駅（7分） | 医学的適応のみ | × | 計画 | 掲載なし |
| `10295` | 大阪暁明館病院 | 此花区 | 病院 | 指定なし / 0床 | ○ | 西九条駅（3分） | 希望可 | × | 計画 | 掲載 |
| `10830` | 大阪府済生会野江病院 | 城東区 | 病院 | 指定なし / 0床 | ○ | 今福鶴見駅（12分） | 未確認 | 未確認 | 未確認 | 掲載 |
| `10126` | 浜田病院 | 平野区 | 病院 | 指定なし / 0床 | ○ | 喜連瓜破駅（6分） | 希望可 | × | 計画 | 掲載 |
| `10717` | 大阪府済生会中津病院 | 北区 | 病院 | 指定なし / 未登録 | ○ | 中津駅（3分） | 希望可 | ○ | 計画 | 掲載なし |
| `10720` | 大阪警察病院 | 天王寺区 | 病院 | 指定なし / 未登録 | ○ | 桃谷駅（5分） | 希望可 | 未確認 | 自然後 | **2026-12-01終了** |
| `11361` | 川島産婦人科クリニック | 北区 | 診療所 | 未確認 | 未補完 | 天神橋筋六丁目駅（1分） | なし | - | - | 掲載 |
| `11556` | 脇本産婦人科 | 天王寺区 | 診療所 | 未確認 | 未補完 | 玉造駅（1分） | 希望可 | ○ | 計画 | 掲載 |
| `11094` | 神吉産婦人科 | 旭区 | 診療所 | 未確認 | 未補完 | 清水駅（5分） | なし | - | - | 掲載 |
| `11545` | 金井産婦人科 | 城東区 | 診療所 | 未確認 | 未補完 | 蒲生四丁目駅（3分） | 未確認 | 未確認 | 未確認 | 掲載 |
| `11507` | 米田産婦人科 | 鶴見区 | 診療所 | 未確認 | 未補完 | 横堤駅（7分） | 未確認 | 未確認 | 未確認 | 掲載 |
| `11383` | 西川医院 | 阿倍野区 | 診療所 | 未確認 | 未補完 | 寺田町駅 / 河堀口駅（5分） | 希望可 | ○ | 自然後 | 掲載 |
| `11113` | なかがわレディースクリニック | 住吉区 | 診療所 | 未確認 | 未補完 | 住吉大社駅（2分） | 希望可（経産婦のみ） | × | 計画 | 掲載 |
| `10886` | 高畑産婦人科 | 東住吉区 | 診療所 | 未確認 | 未補完 | 北田辺駅（2分） | 和痛分娩（筋注） | - | 自然後 | 掲載 |
| `11425` | 小川産婦人科 | 平野区 | 診療所 | 未確認 | 未補完 | 平野駅（3分） | なし | - | - | 掲載 |
| `12057` | 植田産婦人科 | 平野区 | 診療所 | 未確認 | 未補完 | 平野駅（10分） | 未確認 | 未確認 | 未確認 | 掲載 |
| `11779` | あいっこ助産院 | 住吉区 | 助産所(有床) | 未確認 | 住所のみ | 住吉東駅（5分） | 対象外 | - | - | 掲載 |
| `11939` | motherゆり助産所 | 生野区 | 助産所(有床) | 未確認 | ○ | 南巽駅（5分） | 対象外 | - | - | 掲載 |
| `11954` | 天子助産院 | 住之江区 | 助産所(有床) | 未確認 | ○ | 粉浜駅（2分） | 対象外 | - | - | 掲載 |
| `11730` | にじいろ助産院 | 淀川区 | 助産所(有床) | 未確認 | ○ | 十三駅（8分） | 対象外 | - | - | 掲載 |
| `12192` | わたの出張助産院 | 中央区 | 助産所(出張) | 未確認 | 出張 | 出張専門のため該当なし | 対象外 | - | - | 出産なびのみ |
| `12133` | とも助産院 | 淀川区 | 助産所(出張) | 未確認 | 出張 | 出張専門のため該当なし | 対象外 | - | - | 出産なびのみ |

### 3.3 バッチ処理で除外した施設（6件）

元CSVで `施設の種類 = "未確認"` となっていた以下の6施設は、カテゴリ分類の例外処理や誤分類を防ぐため、バッチ出力から除外しています（元データ側で種別が確認・更新された場合は、バッチ再実行のみで自動的に収録対象に復帰します）。

| 出産なびID | 施設名 | 所在区 | 除外理由 |
|---|---|---|---|
| `11475` | ENAレディースクリニック | 大阪市都島区 | 元データ `施設の種類` が `未確認` |
| `11029` | 大正病院附属産婦人科クリニック | 大阪市大正区 | 元データ `施設の種類` が `未確認` |
| `12024` | ウエナエ産婦人科 | 大阪市西区 | 元データ `施設の種類` が `未確認` |
| `11479` | 医療法人大和医院 | 大阪市港区 | 元データ `施設の種類` が `未確認` |
| `11407` | 小林産婦人科 | 大阪市都島区 | 元データ `施設の種類` が `未確認` |
| `12051` | かわばたレディスクリニック | 大阪市淀川区 | 元データ `施設の種類` が `未確認` |

---

# ──【後半パート】エンジニア・実装者向け詳細仕様 ──

## 4. バッチ処理（ETL）仕様

### 4.1 実行スクリプトと入出力

* **バッチスクリプト**: [build_osaka_maternity_facilities.mjs](../scripts/build_osaka_maternity_facilities.mjs)（Node.js ESM・外部依存なし）
* **実行コマンド**:
  ```bash
  node scripts/build_osaka_maternity_facilities.mjs
  ```
* **入力ファイル**:
  * Raw調査データ: [ubunavi_osaka_integrated.csv](../data/ubunavi_osaka_integrated.csv)（42行・36カラム）
  * 病院オープンデータ: [osaka_01-1_hospital_facility_info_20260601.csv](../osaka_extracted/osaka_01-1_hospital_facility_info_20260601.csv)（`osaka_01-1_*.csv` を自動検出）
  * 助産所オープンデータ: [osaka_04_maternity_home_20260601.csv](../osaka_extracted/osaka_04_maternity_home_20260601.csv)（`osaka_04_*.csv` を自動検出）
  * 診療所オープンデータ（任意）: `osaka_extracted/osaka_02-1_*.csv`（配置されていれば自動読み込み）
* **出力ファイル**:
  * [osaka_maternity_facilities.csv](../data/osaka_maternity_facilities.csv)（UTF-8 with BOM / LF改行 / RFC-4180準拠 / 36行・51カラム）

### 4.2 名寄せ・座標補完・バリデーションルール

1. **除外フィルタ**: `施設の種類 === "未確認"` の行を除外。
2. **オープンデータ名寄せ**:
   * `facility_category` に応じて参照プールを切り替え（`hospital` → `01-1`、`clinic` → `02-1`、`midwife_*` → `04`）。
   * 相手レコードの `所在地`（NFKC正規化後）が `所在区`（例: `大阪市中央区`）を含み、かつ `正式名称` または `略称` が `施設名` またはエイリアスマップ（`JCHO大阪病院` → `地域医療機能推進機構大阪病院`、`大阪警察病院` → `大阪けいさつ病院`）に一致するものを一意に特定。
3. **座標バウンディングボックス検証と `0.0` 座標排除**:
   * 緯度 `34.50 <= lat <= 34.80`、経度 `135.35 <= lng <= 135.65` を満たす数値のみ `resolved` として採用。
   * 厚労省助産所CSVに存在する `0.0, 0.0` 座標（`あいっこ助産院`、`わたの出張助産院`、`とも助産院`）は破棄し、空文字化する。
   * `midwife_home_visit`（出張専門助産所）は通院マップ非対象のため、座標を空とし `geo_status = "not_applicable_home_visit"` を設定する（公開所在地・厚労省IDのみ保持）。
4. **将来の診療所座標補完（運用手順）**:
   * 厚労省「医療情報ネット」から診療所基本情報CSV（`02-1_*.csv`）を取得し、`extract_osaka.py` で大阪府分を抽出して `osaka_extracted/osaka_02-1_...csv` として配置した上で上記バッチを再実行すると、コード変更なしで現在 `missing_source` の診療所10件に `mhlw_facility_id` / `address` / `latitude` / `longitude` が自動付与される。

---

## 5. 完全データディクショナリ（全51カラム）

CSV出力カラムは厳密な技術契約として以下の51カラムで構成されます（Nullable列は空文字 `""` で表現）。

| # | カラム名 | 型 | 必須 | 許容値 / フォーマット | 説明・変換ルール |
|---:|---|---|:---:|---|---|
| 1 | `id` | string | ○ | `^[0-9]{5}$` | Primary Key。`出産なび施設ID`。 |
| 2 | `mhlw_facility_id` | string | - | 13桁数字または `""` | `osaka_extracted/` 由来の厚労省機関ID。未突合は `""`。 |
| 3 | `name` | string | ○ | 文字列 | 施設の正式表示名称。 |
| 4 | `ward` | string | ○ | 大阪市24区名 | `所在区` から先頭の `大阪市` を除去した区名。 |
| 5 | `address` | string | - | 住所文字列または `""` | オープンデータから補完・半角数字/ハイフン正規化した所在地。 |
| 6 | `latitude` | float | - | `34.50`〜`34.80` または `""` | WGS84北緯。`geo_status === "resolved"` のみ値を持つ。 |
| 7 | `longitude` | float | - | `135.35`〜`135.65` または `""` | WGS84東経。`geo_status === "resolved"` のみ値を持つ。 |
| 8 | `geo_status` | enum | ○ | `resolved` \| `address_only` \| `missing_source` \| `not_applicable_home_visit` | 位置情報の解決状態。マップ表示可否判定の基準。 |
| 9 | `access_type` | enum | ○ | `station` \| `home_visit_only` | `station`: 最寄り駅あり（34件）、`home_visit_only`: 出張専門（2件）。 |
| 10 | `nearest_station` | string | - | 駅名（複数は ` / ` 区切り） | 例: `谷町四丁目駅`、`柴島駅 / 崇禅寺駅`。出張専門は `""`。 |
| 11 | `station_walk_minutes` | integer | - | 正の整数または `""` | 主駅の徒歩分数（`出口すぐ` は `1`）。出張専門は `""`。 |
| 12 | `access_note` | string | ○ | 文字列 | 元の「最寄り駅 / 駅からの所要」表示用テキスト。 |
| 13 | `lines` | JSON array | ○ | `["正規化路線名", ...]` | 5.2節の路線マスタに正規化済みの利用可能路線配列（出張専門は `[]`）。 |
| 14 | `website_url` | string (URL) | ○ | `https?://\S+` | 公式ホームページURL。診療時間・予約状況の一次確認先。 |
| 15 | `phone_number` | string (TEL) | ○ | `06`/`050`/`080`/`090`/`0570` 等ハイフン区切り | 問い合わせ電話番号。`0570-XXX-XXX` や携帯番号も許容。 |
| 16 | `facility_category` | enum | ○ | `hospital` \| `clinic` \| `midwife_inpatient` \| `midwife_home_visit` | `病院`(20)、`診療所`(10)、`有床助産所`(4)、`出張専門助産所`(2)。 |
| 17 | `facility_type_raw` | string | ○ | 元データ `施設の種類` | 例: `病院`, `診療所`, `診療所（有床）`, `助産所（有床）`, `助産所（無床・出張専門）`。 |
| 18 | `delivery_available` | boolean | ○ | `true` | 本データセットは分娩取扱施設のみのため全件 `true`。 |
| 19 | `perinatal_center_level` | enum | ○ | `comprehensive` \| `regional` \| `none` \| `unknown` | `comprehensive`: 総合周産期(2)、`regional`: 地域周産期(6)、`none`: 指定なし(12)、`unknown`: 未確認(16)。 |
| 20 | `high_risk_ready` | boolean | ○ | `true` \| `false` | `perinatal_center_level` が `comprehensive`/`regional` または `nicu_beds > 0` の場合に `true`（9件）。 |
| 21 | `nicu_beds` | integer | - | 非負整数または `""` | NICU病床数。`未確認`/`未登録`/空欄は `""`。 |
| 22 | `obstetric_beds` | integer | - | 非負整数または `""` | 産科病床数（助産所は入所可能ベッド数）。未確認は `""`。 |
| 23 | `obgyn_doctors` | number | - | 非負数値または `""` | 産科医師数（小数許容）。未確認は `""`。 |
| 24 | `pediatric_doctors` | number | - | 非負数値または `""` | 小児科医師数（小数許容）。未確認は `""`。 |
| 25 | `midwives_count` | number | - | 非負数値または `""` | 助産師数（小数許容）。未確認は `""`。 |
| 26 | `annual_vaginal_deliveries` | string | - | 件数レンジまたは `""` | 年間経腟分娩取扱件数（例: `301～400件`）。未確認は `""`。 |
| 27 | `annual_cesarean_deliveries` | string | - | 件数レンジまたは `""` | 年間帝王切開術取扱件数（例: `201～300件`）。未確認は `""`。 |
| 28 | `painless_availability` | enum | ○ | `elective` \| `elective_conditional` \| `medical_only` \| `analgesia_only` \| `none` \| `unknown` \| `not_applicable` | 希望無痛可(18)、条件付希望可(1: 経産婦のみ)、医学的適応のみ(2)、和痛分娩(1)、なし(4)、未確認(4)、助産所対象外(6)。 |
| 29 | `painless_24h` | enum | ○ | `yes` \| `no` \| `unknown` \| `not_applicable` | 24時間対応可(7)、不可(13)、未確認(5)、対象外/該当なし(11)。 |
| 30 | `painless_timing` | enum | ○ | `scheduled` \| `spontaneous` \| `both` \| `unknown` \| `not_applicable` | 計画分娩(11)、自然陣痛後(8)、両方(3)、未確認(4)、対象外/該当なし(10)。 |
| 31 | `painless_extra_cost_note` | string | - | 文字列または `""` | 無痛/和痛分娩の追加費用に関する実額・注記（判明分7件、未確認・非該当は `""`）。 |
| 32 | `anesthesia_manager_type` | enum | ○ | `anesthesiologist` \| `obgyn` \| `other_or_mixed` \| `unknown` \| `not_applicable` | 麻酔管理者区分。麻酔科専門医(3)、産婦人科専門医(2)、院長または麻酔科医師(1)、未確認(19)、非該当(11)。 |
| 33 | `anesthesia_manager_note` | string | - | 文字列または `""` | 麻酔管理者の補足テキスト（JCHO大阪病院等の留保注記を含む）。 |
| 34 | `painless_memo` | string | - | 文字列または `""` | 出典間の表現差や適応条件に関する詳細メモ。 |
| 35 | `in_hospital_midwifery` | enum | ○ | `yes` \| `no` \| `unknown` | 院内助産（`yes`: 5件）。 |
| 36 | `midwife_outpatient` | enum | ○ | `yes` \| `no` \| `unknown` | 助産師外来（`yes`: 21件）。 |
| 37 | `newborn_hearing_test` | enum | ○ | `yes` \| `unknown` | 自施設での新生児聴覚検査（`yes`: 21件）。 |
| 38 | `postpartum_checkup_2w_1m` | enum | ○ | `yes` \| `unknown` | 2週間・1ヶ月産婦健診の有無（`yes`: 27件）。 |
| 39 | `breastfeeding_clinic` | enum | ○ | `open_to_all` \| `delivered_here_only` \| `no` \| `unknown` | 退院後の授乳支援外来（一般可17、自院出産者のみ7、未確認12）。 |
| 40 | `postpartum_care_status` | enum | ○ | `osaka_city_listed` \| `osaka_city_ending` \| `birth_navi_only` \| `not_listed` \| `unknown` | 市事業掲載(28)、終了予定(1)、出産なび表示のみ(4)、掲載なし(2)、未確認(1)。 |
| 41 | `postpartum_care_end_date` | string | - | `YYYY-MM-DD` または `""` | 終了予定日（大阪警察病院: `2026-12-01`）。 |
| 42 | `postpartum_care_note` | string | ○ | 文字列 | 産後ケアに関する原本注記（月齢上限等を含む）。 |
| 43 | `cost_display_type` | enum | ○ | `delivery_range` \| `delivery_single_or_avg` \| `painless_example` \| `painless_addon_only` \| `unlisted` | 費用表示の性質区分（数値比較可否の誤用を防止）。 |
| 44 | `cost_reference_text` | string | - | 文字列または `""` | 費用掲載情報の参考テキスト（純粋な未掲載は `""`、とも助産院の公式参考価格は保持）。 |
| 45 | `feature_tags` | JSON array | ○ | `["TAG_CODE", ...]` | 5.1節定義の正規化特徴タグ配列。 |
| 46 | `birth_navi_url` | string (URL) | ○ | `https?://\S+` | 厚労省「出産なび」施設詳細URL。 |
| 47 | `painless_source_url` | string (URL) | ○ | URL文字列（`/` 区切り複数可） | 無痛分娩情報の出典URL群（JALA様式PDF、公式ページ、出産なび）。 |
| 48 | `station_source_url` | string (URL) | ○ | `https?://\S+` | 最寄り駅情報の出典URL。 |
| 49 | `source_checked_date` | string | ○ | `YYYY-MM-DD` | 基本項目確認日（ISO-8601）。 |
| 50 | `extra_checked_date` | string | ○ | `YYYY-MM-DD` | 追加項目確認日（ISO-8601）。 |
| 51 | `disclaimer_note` | string | ○ | 文字列 | 公的掲載値に関する免責事項テキスト。 |

### 5.1 `feature_tags` マスタコード体系（19種類）

| タグコード | 付与条件（厳密定義） | 該当件数 (36件中) | UI表示ラベル例 |
|---|---|---:|---|
| `COMPREHENSIVE_PERINATAL` | `perinatal_center_level === 'comprehensive'` | 2 | 総合周産期母子医療センター |
| `REGIONAL_PERINATAL` | `perinatal_center_level === 'regional'` | 6 | 地域周産期母子医療センター |
| `NICU` | `nicu_beds !== '' && Number(nicu_beds) > 0` | 9 | NICUあり |
| `PAINLESS_ELECTIVE` | `painless_availability` が `elective` または `elective_conditional` | 19 | 希望による無痛分娩可 |
| `PAINLESS_CONDITIONAL` | `painless_availability === 'elective_conditional'` | 1 | 経産婦のみ等・条件あり |
| `PAINLESS_24H` | `PAINLESS_ELECTIVE` かつ `painless_24h === 'yes'` | 7 | 24時間無痛対応 |
| `PAINLESS_SCHEDULED` | `PAINLESS_ELECTIVE` かつ `painless_timing` が `scheduled` または `both` | 12 | 計画無痛分娩対応 |
| `PAINLESS_SPONTANEOUS` | `PAINLESS_ELECTIVE` かつ `painless_timing` が `spontaneous` または `both` | 10 | 自然陣痛後の無痛対応 |
| `ANESTHESIOLOGIST_MANAGED` | `anesthesia_manager_type === 'anesthesiologist'` | 3 | 麻酔科専門医管理 |
| `OSAKA_POSTPARTUM_CARE` | `postpartum_care_status === 'osaka_city_listed'` | 28 | 大阪市産後ケア掲載 |
| `OSAKA_POSTPARTUM_CARE_ENDING` | `postpartum_care_status === 'osaka_city_ending'` | 1 | 市産後ケア終了予定 |
| `IN_HOSPITAL_MIDWIFERY` | `in_hospital_midwifery === 'yes'` | 5 | 院内助産あり |
| `MIDWIFE_OUTPATIENT` | `midwife_outpatient === 'yes'` | 21 | 助産師外来あり |
| `BREASTFEEDING_CLINIC` | `breastfeeding_clinic` が `open_to_all` または `delivered_here_only` | 24 | 授乳支援外来あり |
| `POSTPARTUM_CHECKUP` | `postpartum_checkup_2w_1m === 'yes'` | 27 | 2週間・1ヶ月健診あり |
| `NEWBORN_HEARING_TEST` | `newborn_hearing_test === 'yes'` | 21 | 新生児聴覚検査あり |
| `MIDWIFE_INPATIENT` | `facility_category === 'midwife_inpatient'` | 4 | 助産所（入所可） |
| `MIDWIFE_HOME_VISIT` | `facility_category === 'midwife_home_visit'` | 2 | 助産所（出張専門） |
| `STATION_NEAR` | `access_type === 'station'` かつ `station_walk_minutes <= 3` | 15 | 駅徒歩3分以内 |

> **注意**: `PAINLESS_SCHEDULED`（12件）および `PAINLESS_SPONTANEOUS`（10件）は、**希望による無痛分娩が可能な施設（`PAINLESS_ELECTIVE`）のみ**に付与されます。`medical_only`（医学的適応のみ2件）や `analgesia_only`（和痛分娩1件）には付与しないことで、検索結果への誤混入を防止します。

### 5.2 `lines` 正規化路線マスタ（全22路線）

`大阪メトロ` → `Osaka Metro`、`ＪＲ` → `JR`、`JR環状線` → `JR大阪環状線`、`阪堺線` → `阪堺電軌阪堺線`、複合路線（`鶴橋駅` の `近鉄` → `近鉄大阪線`/`近鉄奈良線`、`十三駅` の `阪急電鉄` → `阪急神戸線`/`阪急宝塚線`/`阪急京都線`）に展開済みです。

* **Osaka Metro（8路線）**: `Osaka Metro御堂筋線`, `Osaka Metro谷町線`, `Osaka Metro四つ橋線`, `Osaka Metro中央線`, `Osaka Metro千日前線`, `Osaka Metro堺筋線`, `Osaka Metro長堀鶴見緑地線`, `Osaka Metro今里筋線`
* **JR西日本（4路線）**: `JR大阪環状線`, `JR東西線`, `JR阪和線`, `JR関西本線`
* **私鉄・軌道（10路線）**: `阪急神戸線`, `阪急宝塚線`, `阪急京都線`, `阪急千里線`, `阪神なんば線`, `近鉄大阪線`, `近鉄奈良線`, `近鉄南大阪線`, `南海本線`, `南海高野線`, `阪堺電軌阪堺線`（※`京阪本線` 等は現36施設の最寄り駅には含まれません）

---

## 6. TypeScript型定義とアプリケーション組み込み例

### 6.1 TypeScript インターフェース定義

```typescript
export type GeoStatus =
  | 'resolved'
  | 'address_only'
  | 'missing_source'
  | 'not_applicable_home_visit';

export type AccessType = 'station' | 'home_visit_only';

export type FacilityCategory =
  | 'hospital'
  | 'clinic'
  | 'midwife_inpatient'
  | 'midwife_home_visit';

export type PerinatalCenterLevel =
  | 'comprehensive'
  | 'regional'
  | 'none'
  | 'unknown';

export type PainlessAvailability =
  | 'elective'
  | 'elective_conditional'
  | 'medical_only'
  | 'analgesia_only'
  | 'none'
  | 'unknown'
  | 'not_applicable';

export type Painless24h = 'yes' | 'no' | 'unknown' | 'not_applicable';

export type PainlessTiming =
  | 'scheduled'
  | 'spontaneous'
  | 'both'
  | 'unknown'
  | 'not_applicable';

export type AnesthesiaManagerType =
  | 'anesthesiologist'
  | 'obgyn'
  | 'other_or_mixed'
  | 'unknown'
  | 'not_applicable';

export type TriState = 'yes' | 'no' | 'unknown';

export type BreastfeedingClinic =
  | 'open_to_all'
  | 'delivered_here_only'
  | 'no'
  | 'unknown';

export type PostpartumCareStatus =
  | 'osaka_city_listed'
  | 'osaka_city_ending'
  | 'birth_navi_only'
  | 'not_listed'
  | 'unknown';

export type CostDisplayType =
  | 'delivery_range'
  | 'delivery_single_or_avg'
  | 'painless_example'
  | 'painless_addon_only'
  | 'unlisted';

export interface OsakaMaternityFacility {
  id: string;
  mhlw_facility_id: string | null;
  name: string;
  ward: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geo_status: GeoStatus;
  access_type: AccessType;
  nearest_station: string | null;
  station_walk_minutes: number | null;
  access_note: string;
  lines: string[];
  website_url: string;
  phone_number: string;
  facility_category: FacilityCategory;
  facility_type_raw: string;
  delivery_available: true;
  perinatal_center_level: PerinatalCenterLevel;
  high_risk_ready: boolean;
  nicu_beds: number | null;
  obstetric_beds: number | null;
  obgyn_doctors: number | null;
  pediatric_doctors: number | null;
  midwives_count: number | null;
  annual_vaginal_deliveries: string | null;
  annual_cesarean_deliveries: string | null;
  painless_availability: PainlessAvailability;
  painless_24h: Painless24h;
  painless_timing: PainlessTiming;
  painless_extra_cost_note: string | null;
  anesthesia_manager_type: AnesthesiaManagerType;
  anesthesia_manager_note: string | null;
  painless_memo: string | null;
  in_hospital_midwifery: TriState;
  midwife_outpatient: TriState;
  newborn_hearing_test: 'yes' | 'unknown';
  postpartum_checkup_2w_1m: 'yes' | 'unknown';
  breastfeeding_clinic: BreastfeedingClinic;
  postpartum_care_status: PostpartumCareStatus;
  postpartum_care_end_date: string | null; // YYYY-MM-DD
  postpartum_care_note: string;
  cost_display_type: CostDisplayType;
  cost_reference_text: string | null;
  feature_tags: string[];
  birth_navi_url: string;
  painless_source_url: string;
  station_source_url: string;
  source_checked_date: string;
  extra_checked_date: string;
  disclaimer_note: string;
}
```

### 6.2 実装上の重要ガードとフィルタ関数例

> [!IMPORTANT]
> 1. **未確認 (`unknown`) を「なし」と混ぜない・条件ON時は確定済みのみ返す**
> 2. **費用テキストを数値パースして「予算上限フィルタ／安い順ソート」を行わない**（`painless_addon_only` 15万円等が最安に誤表示されるため）
> 3. **産後ケア事業終了予定日 (`postpartum_care_end_date`) を参照日と比較し、期限到来後は掲載中として扱わない**

```typescript
// 1. 希望による無痛分娩フィルタ（医学的適応のみ・和痛分娩・未確認は除外）
export const filterElectivePainless = (
  facilities: OsakaMaternityFacility[],
  options?: { only24h?: boolean; timing?: 'scheduled' | 'spontaneous' }
) => {
  return facilities.filter((f) => {
    const isElective =
      f.painless_availability === 'elective' ||
      f.painless_availability === 'elective_conditional';
    if (!isElective) return false;
    if (options?.only24h && f.painless_24h !== 'yes') return false;
    if (options?.timing === 'scheduled') {
      return f.painless_timing === 'scheduled' || f.painless_timing === 'both';
    }
    if (options?.timing === 'spontaneous') {
      return f.painless_timing === 'spontaneous' || f.painless_timing === 'both';
    }
    return true;
  });
};

// 2. ハイリスク妊娠向け（周産期母子医療センター指定 または NICU保有施設）
export const filterHighRisk = (facilities: OsakaMaternityFacility[]) => {
  return facilities.filter((f) => f.high_risk_ready);
};

// 3. 大阪市産後ケア事業の対象判定（参照日 YYYY-MM-DD を考慮）
export const isOsakaPostpartumCareActive = (
  facility: OsakaMaternityFacility,
  referenceDateIso: string
): boolean => {
  if (facility.postpartum_care_status === 'osaka_city_listed') return true;
  if (facility.postpartum_care_status === 'osaka_city_ending') {
    // 終了日当日は終了済み（< 終了日 のみ有効）
    return Boolean(
      facility.postpartum_care_end_date &&
        referenceDateIso < facility.postpartum_care_end_date
    );
  }
  return false;
};

// 4. マップピン表示可否判定
export const canShowMapPin = (
  facility: OsakaMaternityFacility
): facility is OsakaMaternityFacility & { latitude: number; longitude: number } => {
  return (
    facility.geo_status === 'resolved' &&
    facility.latitude !== null &&
    facility.longitude !== null
  );
};

// 5. 沿線フィルタ用のユニーク路線抽出
export const getUniqueLines = (facilities: OsakaMaternityFacility[]): string[] => {
  return Array.from(new Set(facilities.flatMap((f) => f.lines)));
};
```
