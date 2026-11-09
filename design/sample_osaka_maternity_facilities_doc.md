# 【データ仕様書】大阪市産科医療機関サンプルデータ (`sample_osaka_maternity_facilities.csv`)

> **📖 本ドキュメントの読み方**
> * **【前半パート（第1章〜第3章）】**: **企画・デザイン・PMなど非エンジニア向け**。専門用語を使わず、「このデータが何のためにあり、何が書かれているのか」を日常の言葉でわかりやすく解説します。
> * **【後半パート（第4章〜第6章）】**: **エンジニア・実装AI向け**。データ型、Enumの定義、TypeScriptインターフェース、フィルタリング実装コードなど、開発に必要な技術仕様を網羅しています。

---

# ──【前半パート】誰でもわかるCSVの基礎知識とデータ一覧 ──

## 1. このデータは何のためにあるの？（ビジネス概要）

### 1.1 「うぶナビ大阪」での役割
このCSVファイル（`sample_osaka_maternity_facilities.csv`）は、アプリがユーザーに「あなたにぴったりの産院はここです」と提案（レコメンド）するための元データです。

### 1.2 なぜ「病院の事実（客観データ）」だけを入れているの？
アプリを作っていると、「診断の質問を5問から3問に減らそう」「質問の順番を変えよう」といった改善が頻繁に起こります。
もしデータの中に「これは第2問用」「これはAランク」といった **アプリ都合のルール** を直接書き込んでしまうと、画面を変更するたびにデータ全体を作り直さなければならなくなります。

そのため、このCSVには「この病院にはどんな設備があり、どんなお産ができるか」という客観的な事実（ファクト）だけを綺麗に並べています。こうしておくことで、画面や診断ルールが後からどう変わっても、データをずっと使い続けることができます。

---

## 2. データ項目

CSVには、1つの施設につき以下の項目が記録されています。

### ① どこにあって、どう連絡するか（基本情報）
* **施設ID (`id`)**: 施設ごとの整理番号（例: `hosp_001`）
* **施設名 (`name`)**: 病院やクリニックの正式名称
* **所在区 (`ward`)**: 大阪市24区のどこにあるか（例: `都島区`, `浪速区`）
* **住所 (`address`)**: 正確な所在地（地図表示やナビ用）
* **最寄り駅 (`nearest_station`)**: 一番近い駅（例: `都島駅`）
* **乗り入れ沿線 (`lines`)**: 通っている電車の路線（例: 地下鉄谷町線、JR環状線）
* **ホームページURL (`website_url`)**: 施設の公式Webサイト
* **電話番号 (`phone_number`)**: 予約や問い合わせ先の電話番号
* **紹介文 (`description`)**: どんな特徴があるかを100文字程度でまとめた解説

### ② どんな医療に対応できるか（安全とスタイル）
* **病院の種類 (`facility_type`)**: 
  * 府内トップレベルの大病院（総合周産期）
  * 地域の中核病院（地域周産期・総合病院）
  * 街の産科クリニック
  * 助産所
* **ハイリスク対応 (`high_risk_ready`)**: 持病（高血圧や糖尿病など）や双子以上の妊娠に対応できる設備（集中治療室など）があるか。
* **分娩ができるか (`delivery_available`)**: 赤ちゃんを産む（入院する）設備があるか。
* **妊婦健診ができるか (`prenatal_care_available`)**: 定期健診の外来をやっているか。
  > **💡 ここがポイント！**  
  > 大阪では「健診は近所のクリニックに通い、お産は大きな病院でする（セミオープン）」という人が多くいます。また「里帰り出産するから健診だけ受けたい」という人もいます。「健診だけ」「お産も両方」を区別するためにこの2つの項目を分けています。
* **無痛分娩ができるか (`painless_mode`)**:
  * `24h`: 夜や土日でも24時間いつでも無痛分娩ができる
  * `scheduled`: 計画無痛分娩（平日やあらかじめ決めた日程での計画的対応）
  * `none`: 無痛分娩はやっていない（自然分娩のみ）

### ③ 産後のサポートとお金（安心と費用）
* **大阪市産後ケアが使えるか (`osaka_postpartum_care`)**: 大阪市が補助してくれる格安の産後ケア（宿泊型：1泊4,250円）の対象施設かどうか。
* **個室があるか (`private_room_available`)**: まわりを気にせず休める個室のお部屋があるか。
* **出産の費用目安 (`cost_estimate_min / max`)**: 普通分娩でだいたい何円〜何円くらいかかるかの目安数値（例: 45万円〜52万円）。
* **費用のひとこと補足 (`cost_note`)**: 「国の出産一時金（50万円）でほぼ収まる」「無痛分娩はプラス10万円」などの分かりやすい注釈。
* **特徴キーワード (`medical_services`)**: 「NICU完備」「駅直結」「全室個室」「女医在籍」などの特徴タグ。

---

## 3. 収録されている20施設の内訳

アプリのテストやデモがスムーズにできるよう、大阪市内の代表的な施設を**タイプの異なる6つのグループから合計20施設**ピックアップしています。

```
┌───────────────────────────────────────────────────────────────┐
│              大阪市内の代表的な産科医療機関（20施設）            │
├───────────────────────────────────────────────────────────────┤
│ ① 総合周産期センター (2件)  : 超重症・多胎・高度医療の最後の砦   │
│ ② 地域周産期センター (3件)  : 総合病院の安心感・セミオープン受入 │
│ ③ 総合病院 (1件)            : 自然分娩・小児科との密接連携       │
│ ④ 産科クリニック (8件)      : 24時間無痛・豪華個室・産後ケア充実 │
│ ⑤ 健診専門クリニック (3件)  : 駅直結・夜間診療・里帰り健診特化   │
│ ⑥ 助産所 (2件)              : 自然分娩・アットホームな産後ケア   │
└───────────────────────────────────────────────────────────────┘
```

| 施設ID | 施設名 | 所在区 | 最寄り駅 | お産 | 健診 | 無痛分娩 | 市産後ケア | 費用の目安 | 主な特徴 |
|---|---|---|---|:---:|:---:|:---:|:---:|---|---|
| `hosp_001` | 大阪市立総合医療センター | 都島区 | 都島駅 | ○ | ○ | **計画無痛** | ○ | 約45万〜52万 | 大阪市中核の周産期センター・NICU完備 |
| `hosp_002` | 千船病院 | 西淀川区 | 福駅 | ○ | ○ | **24時間** | ○ | 約55万〜65万 | 駅直結・24H無痛・ホテルライク個室 |
| `hosp_003` | 愛染橋病院 | 浪速区 | 恵美須町駅 | ○ | ○ | **計画無痛** | ○ | 約46万〜53万 | 歴史ある地域周産期・良心的な費用設定 |
| `hosp_004` | 大阪赤十字病院 | 天王寺区 | 桃谷駅 | ○ | ○ | **計画無痛** | ○ | 約50万〜58万 | 各科連携の総合病院・安心のバックアップ |
| `hosp_005` | JCHO大阪病院 | 福島区 | 新福島駅 | ○ | ○ | なし | ○ | 約45万〜52万 | 福島区の公的病院・安心の自然分娩 |
| `hosp_006` | 大阪公立大学医学部附属病院 | 阿倍野区 | 天王寺駅 | ○ | ○ | **計画無痛** | × | 約48万〜55万 | 大学病院高度医療・超ハイリスク対応 |
| `cln_007` | オーク住吉産婦人科 | 西成区 | 玉出駅 | ○ | ○ | **24時間** | ○ | 約60万〜75万 | 24H無痛・全室個室・アメニティ充実 |
| `cln_008` | 浜田病院 | 平野区 | 喜連瓜破駅 | ○ | ○ | **24時間** | ○ | 約60万〜70万 | 実績多数の産科専門病院・お祝い膳豪華 |
| `cln_009` | 飯島病院 | 中央区 | 長堀橋駅 | ○ | ○ | **24時間** | ○ | 約65万〜80万 | 心斎橋近く・洗練されたホテルライク産院 |
| `cln_010` | 小川産婦人科 | 平野区 | 平野駅 | ○ | ○ | **計画無痛** | ○ | 約53万〜62万 | 平野の下町で温かいケア・産後ケア多数 |
| `cln_011` | ENAレディースクリニック | 都島区 | 都島駅 | ○ | ○ | **24時間** | ○ | 約62万〜75万 | 完全個室・最新設備・アロマエステ |
| `cln_012` | ウエナエ産婦人科 | 西区 | 九条駅 | ○ | ○ | **計画無痛** | ○ | 約52万〜60万 | 地域密着40年・助産師外来が充実 |
| `cln_013` | なかがわレディースクリニック | 住吉区 | 住吉大社駅 | ○ | ○ | **計画無痛** | ○ | 約50万〜58万 | 駅徒歩2分・自然分娩と計画無痛 |
| `cln_014` | 金井産婦人科 | 城東区 | 蒲生四丁目 | ○ | ○ | **計画無痛** | × | 約52万〜58万 | 駅近・家族の立ち会い出産サポート |
| `cln_015` | 神吉産婦人科 | 旭区 | 森小路駅 | ○ | ○ | なし | ○ | 約48万〜53万 | 一時金内で収まりやすい良心的な下町産院 |
| `cln_016` | 川島産婦人科クリニック | 北区 | 天神橋六丁目 | **×** | **○** | なし | × | 健診のみ | **健診特化**・駅直結・平日夜間診療あり |
| `cln_017` | 本町レディースクリニック | 中央区 | 本町駅 | **×** | **○** | なし | × | 健診のみ | **健診特化**・オフィス街・女医担当日あり |
| `cln_018` | 大正病院附属産婦人科 | 大正区 | 大正駅 | **×** | **○** | なし | × | 健診のみ | **健診特化**・大正区の貴重な外来拠点 |
| `mid_019` | はも助産院 | 北区 | 南森町駅 | ○ | ○ | なし | ○ | 約50万〜56万 | 畳の個室・母乳ケア・産後ケア認定 |
| `mid_020` | ひまわり助産院 | 東住吉区 | 駒川中野駅 | ○ | ○ | なし | ○ | 約48万〜54万 | 家庭的な温食・親身な育児相談 |

---

# ──【後半パート】エンジニア・実装者向け詳細仕様 ──

## 4. 完全データディクショナリ（型・許容値・バリデーション）

CSVファイルの各カラムに関する厳密な技術仕様です。全20カラムで構成されます。

| カラム名 (ヘッダー) | 型 | 必須 | 許容値 / フォーマット | バリデーション・説明 |
|---|---|:---:|---|---|
| `id` | string | ○ | `^[a-z]{3,4}_[0-9]{3}$` | Primary Key。プレフィックス: `hosp_`（病院）, `cln_`（診療所）, `mid_`（助産所）。 |
| `name` | string | ○ | 文字列（1〜50文字） | 医療機関の正式名称。 |
| `facility_type` | enum | ○ | `tertiary` \| `regional` \| `general` \| `clinic` \| `midwife` | 厚労省周産期医療体制コードに準拠した医療区分。 |
| `ward` | string | ○ | 大阪市24区名 | `都島区`, `福島区`, `此花区`, `西区`, `港区`, `大正区`, `天王寺区`, `浪速区`, `西淀川区`, `東淀川区`, `東成区`, `生野区`, `旭区`, `城東区`, `阿倍野区`, `住吉区`, `東住吉区`, `西成区`, `淀川区`, `鶴見区`, `住之江区`, `平野区`, `北区`, `中央区` のいずれか。 |
| `address` | string | ○ | 日本国内住所表記 | 都道府県から番地・ビル名まで記載。 |
| `nearest_station` | string | ○ | 駅名（〜駅） | 最寄り駅名称。オートコンプリート検索用インデックス。 |
| `lines` | JSON array | ○ | `["路線名", ...]` | 文字列配列のJSON表現。例: `["OsakaMetro谷町線", "JR大阪環状線"]`。 |
| `website_url` | string (URL) | ○ | `https?://[^\s]+` | 有効なWebサイトURL。 |
| `phone_number` | string (TEL) | ○ | `^06-[0-9]{4}-[0-9]{4}$` | 市外局番（06）を含むハイフン区切り電話番号。 |
| `description` | string | ○ | 文字列（50〜200文字） | UI詳細カード・ボトムシート表示用テキスト。 |
| `high_risk_ready` | boolean | ○ | `true` \| `false` | MFICU保有、多胎・合併症管理体制の有無。 |
| `delivery_available` | boolean | ○ | `true` \| `false` | 有床・分娩受入の有無。健診専門施設は `false`。 |
| `prenatal_care_available` | boolean | ○ | `true` \| `false` | 妊婦健診の外来受入の有無。 |
| `painless_mode` | enum | ○ | `24h` \| `scheduled` \| `none` | 麻酔科管理による無痛分娩体制。 |
| `osaka_postpartum_care` | boolean | ○ | `true` \| `false` | 大阪市産後ケア事業（ショートステイ・デイケア）委託事業者か。 |
| `private_room_available` | boolean | ○ | `true` \| `false` | 個室（差額ベッド含む）の提供可否。 |
| `cost_estimate_min` | integer | ○ | 非負整数 (円) | 自然分娩・標準泊数の概算費用下限。健診専門は `0`。 |
| `cost_estimate_max` | integer | ○ | 非負整数 (円) | 自然分娩・標準泊数の概算費用上限。健診専門は `0`。 |
| `cost_note` | string | - | 文字列 | 費用に関する特記事項（一時金との差額、無痛加算等）。 |
| `medical_services` | JSON array | ○ | `["CODE", ...]` | 定数サービスコードの配列。下記マスタ参照。 |

### `medical_services` で使用する共通コード体系
* `NICU`: 新生児集中治療室あり
* `MFICU`: 母体胎児集中治療室あり
* `24H_PAINLESS`: 24時間無痛分娩体制
* `SCHEDULED_PAINLESS`: 計画無痛分娩（平日・予約制等）
* `POSTPARTUM_CARE`: 大阪市産後ケア事業受託
* `SEMI_OPEN_HOSPITAL`: セミオープン分娩受入側中核病院
* `SEMI_OPEN_CLINIC`: セミオープン健診協力クリニック
* `PRENATAL_ONLY`: 健診専門（分娩設備なし）
* `PRIVATE_ROOM_ALL`: 全室個室
* `PRIVATE_ROOM`: 個室設備あり
* `STATION_DIRECT`: 駅直結・徒歩1分以内
* `STATION_NEAR`: 駅徒歩3分以内
* `NIGHT_CLINIC`: 18時以降の夜間外来あり
* `FEMALE_DOCTOR`: 女性産婦人科医在籍・担当枠あり
* `ONLINE_RESERVATION`: WEB/アプリ即時予約対応

---

## 5. アプリケーション組み込み・クエリ設計例

データが客観的事実として独立しているため、フロントエンド（React / Next.js / React Native）側で任意のクエリ関数をシンプルに組み立てることができます。

### 5.1 典型的なフィルタリングロジック例

```typescript
// 1. 里帰り出産希望（近所で健診だけ受けたい）
export const filterForReturnBirth = (facilities: MaternityFacility[]) => {
  return facilities.filter(f => f.prenatal_care_available && !f.delivery_available);
};

// 2. 医療リスクあり（大病院・周産期センターに限定）
export const filterForHighRisk = (facilities: MaternityFacility[]) => {
  return facilities.filter(f => 
    f.high_risk_ready && ['tertiary', 'regional', 'general'].includes(f.facility_type)
  );
};

// 3. 24時間無痛分娩 ＋ 大阪市産後ケアを両立したい
export const filterForPainlessAndCare = (facilities: MaternityFacility[]) => {
  return facilities.filter(f => 
    f.delivery_available && f.painless_mode === '24h' && f.osaka_postpartum_care
  );
};

// 4. 予算上限フィルター（例: 自己負担15万円以内 ＝ 総額65万円以下）
export const filterByBudget = (facilities: MaternityFacility[], maxBudget: number = 650000) => {
  return facilities
    .filter(f => f.delivery_available && f.cost_estimate_min <= maxBudget)
    .sort((a, b) => a.cost_estimate_min - b.cost_estimate_min); // 安い順
};

// 5. 駅名サジェスト用インデックス抽出
export const getUniqueStations = (facilities: MaternityFacility[], query: string) => {
  if (!query) return [];
  const queryLower = query.toLowerCase();
  return Array.from(new Set(facilities.map(f => f.nearest_station)))
    .filter(station => station.toLowerCase().includes(queryLower))
    .slice(0, 5); // 最大5件サジェスト
};
```

---

## 6. TypeScript型定義 & CSVパーサー実装

CSVを読み込んでアプリケーションのステートとして扱うための完全なコードスニペットです。

```typescript
// facilityTypes.ts
export type FacilityType = 'tertiary' | 'regional' | 'general' | 'clinic' | 'midwife';
export type PainlessMode = '24h' | 'scheduled' | 'none';

export interface MaternityFacility {
  id: string;
  name: string;
  facility_type: FacilityType;
  ward: string;
  address: string;
  nearest_station: string;
  lines: string[];
  website_url: string;
  phone_number: string;
  description: string;
  high_risk_ready: boolean;
  delivery_available: boolean;
  prenatal_care_available: boolean;
  painless_mode: PainlessMode;
  osaka_postpartum_care: boolean;
  private_room_available: boolean;
  cost_estimate_min: number;
  cost_estimate_max: number;
  cost_note: string;
  medical_services: string[];
}

// csvParser.ts
export function parseFacilityCsvRow(row: Record<string, any>): MaternityFacility {
  const safeJsonParse = (val: any, fallback: any = []) => {
    if (!val) return fallback;
    if (Array.isArray(val)) return val;
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  };

  const toBoolean = (val: any): boolean => {
    return val === 'true' || val === true || val === 1 || val === '1';
  };

  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    facility_type: (row.facility_type || 'clinic') as FacilityType,
    ward: String(row.ward || ''),
    address: String(row.address || ''),
    nearest_station: String(row.nearest_station || ''),
    lines: safeJsonParse(row.lines, []),
    website_url: String(row.website_url || ''),
    phone_number: String(row.phone_number || ''),
    description: String(row.description || ''),
    high_risk_ready: toBoolean(row.high_risk_ready),
    delivery_available: toBoolean(row.delivery_available),
    prenatal_care_available: toBoolean(row.prenatal_care_available),
    painless_mode: (row.painless_mode || 'none') as PainlessMode,
    osaka_postpartum_care: toBoolean(row.osaka_postpartum_care),
    private_room_available: toBoolean(row.private_room_available),
    cost_estimate_min: Number(row.cost_estimate_min) || 0,
    cost_estimate_max: Number(row.cost_estimate_max) || 0,
    cost_note: String(row.cost_note || ''),
    medical_services: safeJsonParse(row.medical_services, []),
  };
}
```
