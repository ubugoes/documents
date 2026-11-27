#!/usr/bin/env node
/**
 * Batch ETL script: builds normalized Osaka maternity facilities CSV
 * from raw survey data (`data/ubunavi_osaka_integrated.csv`) and
 * MHLW open data (`osaka_extracted/`).
 *
 * Rules:
 * - Drops rows where `施設の種類 === "未確認"` (6 rows).
 * - Enriches `mhlw_facility_id`, `address`, `latitude`, `longitude`, `geo_status`
 *   from `osaka_extracted/` (`01-1` hospitals, `04` midwifery homes, optional `02-1` clinics).
 * - Rejects out-of-bounds or `0.0, 0.0` coordinates; never invents missing coords.
 * - Normalizes wards, stations, canonical railway lines, painless delivery 3-axis enums,
 *   postpartum care status & end dates, medical services, and derived feature tags.
 * - Drops clinic hours (directed to official HP URLs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

const OSAKA_WARDS = new Set([
  '北区', '都島区', '福島区', '此花区', '中央区', '西区',
  '港区', '大正区', '天王寺区', '浪速区', '西淀川区', '淀川区',
  '東淀川区', '東成区', '生野区', '旭区', '城東区', '鶴見区',
  '阿倍野区', '住吉区', '東住吉区', '平野区', '住之江区', '西成区',
]);

const CANONICAL_LINES = [
  'Osaka Metro御堂筋線',
  'Osaka Metro谷町線',
  'Osaka Metro四つ橋線',
  'Osaka Metro中央線',
  'Osaka Metro千日前線',
  'Osaka Metro堺筋線',
  'Osaka Metro長堀鶴見緑地線',
  'Osaka Metro今里筋線',
  'JR大阪環状線',
  'JR東西線',
  'JR阪和線',
  'JR関西本線',
  '阪急神戸線',
  '阪急宝塚線',
  '阪急京都線',
  '阪急千里線',
  '阪神なんば線',
  '近鉄大阪線',
  '近鉄奈良線',
  '近鉄南大阪線',
  '南海本線',
  '南海高野線',
  '阪堺電軌阪堺線',
];
const CANONICAL_LINE_SET = new Set(CANONICAL_LINES);

const FACILITY_NAME_ALIASES = {
  'JCHO大阪病院': ['地域医療機能推進機構大阪病院'],
  '大阪警察病院': ['大阪けいさつ病院'],
};

const LAT_MIN = 34.50;
const LAT_MAX = 34.80;
const LNG_MIN = 135.35;
const LNG_MAX = 135.65;

const OUTPUT_COLUMNS = [
  'id',
  'mhlw_facility_id',
  'name',
  'ward',
  'address',
  'latitude',
  'longitude',
  'geo_status',
  'access_type',
  'nearest_station',
  'station_walk_minutes',
  'access_note',
  'lines',
  'website_url',
  'phone_number',
  'facility_category',
  'facility_type_raw',
  'delivery_available',
  'perinatal_center_level',
  'high_risk_ready',
  'nicu_beds',
  'obstetric_beds',
  'obgyn_doctors',
  'pediatric_doctors',
  'midwives_count',
  'annual_vaginal_deliveries',
  'annual_cesarean_deliveries',
  'painless_availability',
  'painless_24h',
  'painless_timing',
  'painless_extra_cost_note',
  'anesthesia_manager_type',
  'anesthesia_manager_note',
  'painless_memo',
  'in_hospital_midwifery',
  'midwife_outpatient',
  'newborn_hearing_test',
  'postpartum_checkup_2w_1m',
  'breastfeeding_clinic',
  'postpartum_care_status',
  'postpartum_care_end_date',
  'postpartum_care_note',
  'cost_display_type',
  'cost_reference_text',
  'feature_tags',
  'birth_navi_url',
  'painless_source_url',
  'station_source_url',
  'source_checked_date',
  'extra_checked_date',
  'disclaimer_note',
];

function parseArgs(argv) {
  const opts = {
    input: path.join(DEFAULT_ROOT, 'data/ubunavi_osaka_integrated.csv'),
    openDataDir: path.join(DEFAULT_ROOT, 'osaka_extracted'),
    output: path.join(DEFAULT_ROOT, 'data/osaka_maternity_facilities.csv'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      opts.input = path.resolve(argv[++i]);
    } else if (arg === '--open-data-dir' && argv[i + 1]) {
      opts.openDataDir = path.resolve(argv[++i]);
    } else if (arg === '--output' && argv[i + 1]) {
      opts.output = path.resolve(argv[++i]);
    } else {
      throw new Error(`Unknown or incomplete CLI argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * RFC-4180 compliant CSV parser (handles BOM, quoted commas/newlines, "" escapes).
 */
function parseCsv(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r') {
      if (clean[i + 1] === '\n') i++;
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else if (ch === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0] === '') continue;
    if (row.length !== headers.length) {
      throw new Error(
        `CSV column count mismatch on row ${r + 1}: expected ${headers.length}, got ${row.length}`
      );
    }
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    records.push(obj);
  }
  return { headers, records };
}

function serializeCsvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(serializeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => serializeCsvCell(row[h])).join(','));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\n') + '\n', 'utf8');
}

function normKey(str) {
  return String(str || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normAddress(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFKC')
    .replace(/(?<=\d)[ー−‐–—](?=\d)/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMatchingFile(dirPath, regex) {
  if (!fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath).filter((f) => regex.test(f)).sort();
  return files.length > 0 ? path.join(dirPath, files[0]) : null;
}

function loadOpenData(openDataDir) {
  const hospitalFile = findMatchingFile(openDataDir, /^osaka_01-1_.*\.csv$/);
  const clinicFile = findMatchingFile(openDataDir, /^osaka_02-1_.*\.csv$/);
  const midwifeFile = findMatchingFile(openDataDir, /^osaka_04_.*\.csv$/);

  if (!hospitalFile) {
    throw new Error(`Required hospital open data file (osaka_01-1_*.csv) not found in ${openDataDir}`);
  }
  if (!midwifeFile) {
    throw new Error(`Required maternity home open data file (osaka_04_*.csv) not found in ${openDataDir}`);
  }

  const hospitals = parseCsv(fs.readFileSync(hospitalFile, 'utf8')).records;
  const midwives = parseCsv(fs.readFileSync(midwifeFile, 'utf8')).records;
  let clinics = [];
  if (clinicFile) {
    clinics = parseCsv(fs.readFileSync(clinicFile, 'utf8')).records;
    console.log(`[OpenData] Loaded clinics file: ${path.basename(clinicFile)} (${clinics.length} rows)`);
  } else {
    console.log(
      `[OpenData] Optional clinics file (osaka_02-1_*.csv) not found in ${openDataDir}; clinic coordinates will be marked geo_status="missing_source".`
    );
  }
  console.log(
    `[OpenData] Loaded hospitals: ${path.basename(hospitalFile)} (${hospitals.length} rows), midwives: ${path.basename(midwifeFile)} (${midwives.length} rows)`
  );
  return { hospitals, clinics, midwives };
}

function mapFacilityCategory(rawType) {
  const t = rawType.trim();
  if (t === '病院') return 'hospital';
  if (t === '診療所' || t === '診療所（有床）') return 'clinic';
  if (t === '助産所（有床）') return 'midwife_inpatient';
  if (t === '助産所（無床・出張専門）') return 'midwife_home_visit';
  throw new Error(`Unexpected facility type: ${rawType}`);
}

function enrichGeo(row, category, openData) {
  const name = row['施設名'].trim();
  const rawWard = row['所在区'].trim();
  const wardNorm = normKey(rawWard);
  const targets = [name, ...(FACILITY_NAME_ALIASES[name] || [])].map(normKey);

  let pool = [];
  if (category === 'hospital') pool = openData.hospitals;
  else if (category === 'clinic') pool = openData.clinics;
  else pool = openData.midwives;

  const matches = pool.filter((candidate) => {
    const addrNorm = normKey(candidate['所在地']);
    if (!addrNorm.includes(wardNorm)) return false;
    const fullNorm = normKey(candidate['正式名称']);
    const shortNorm = normKey(candidate['略称']);
    return targets.some((t) => fullNorm.includes(t) || shortNorm.includes(t));
  });

  if (matches.length > 1) {
    throw new Error(`Ambiguous open-data match (${matches.length}) for ${name} (${rawWard})`);
  }

  const matched = matches[0] || null;
  if (!matched) {
    return {
      mhlw_facility_id: '',
      address: '',
      latitude: '',
      longitude: '',
      geo_status: category === 'midwife_home_visit' ? 'not_applicable_home_visit' : 'missing_source',
    };
  }

  const mhlwId = (matched['ID'] || '').trim();
  const address = normAddress(matched['所在地']);

  if (category === 'midwife_home_visit') {
    return {
      mhlw_facility_id: mhlwId,
      address,
      latitude: '',
      longitude: '',
      geo_status: 'not_applicable_home_visit',
    };
  }

  const latStr = (matched['所在地座標（緯度）'] || '').trim();
  const lngStr = (matched['所在地座標（経度）'] || '').trim();
  const lat = Number.parseFloat(latStr);
  const lng = Number.parseFloat(lngStr);

  const validCoords =
    latStr !== '' &&
    lngStr !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= LAT_MIN &&
    lat <= LAT_MAX &&
    lng >= LNG_MIN &&
    lng <= LNG_MAX;

  if (validCoords) {
    return {
      mhlw_facility_id: mhlwId,
      address,
      latitude: latStr,
      longitude: lngStr,
      geo_status: 'resolved',
    };
  }

  return {
    mhlw_facility_id: mhlwId,
    address,
    latitude: '',
    longitude: '',
    geo_status: address ? 'address_only' : 'missing_source',
  };
}

/**
 * Expands a raw line descriptor (e.g. "Osaka Metro谷町線・中央線",
 * "JR大阪環状線・近鉄・大阪メトロ千日前線", "阪急電鉄") into canonical line names.
 */
function expandLineDescriptor(rawDesc, stationName) {
  const desc = rawDesc
    .normalize('NFKC')
    .replace(/大阪メトロ/g, 'Osaka Metro')
    .trim();

  const parts = desc.split('・').map((p) => p.trim()).filter(Boolean);
  const result = [];
  let currentOperator = '';

  for (const part of parts) {
    if (part === 'JR環状線') {
      currentOperator = 'JR';
      result.push('JR大阪環状線');
      continue;
    }
    if (part === '阪堺線') {
      currentOperator = '阪堺電軌';
      result.push('阪堺電軌阪堺線');
      continue;
    }
    if (part === '阪急電鉄' && stationName === '十三駅') {
      currentOperator = '阪急';
      result.push('阪急神戸線', '阪急宝塚線', '阪急京都線');
      continue;
    }
    if (part === '近鉄' && stationName === '鶴橋駅') {
      currentOperator = '近鉄';
      result.push('近鉄大阪線', '近鉄奈良線');
      continue;
    }

    const opMatch = part.match(/^(Osaka Metro|JR|阪急|阪神|近鉄|南海|京阪|阪堺電軌)(.*)$/);
    if (opMatch) {
      currentOperator = opMatch[1];
      const rest = opMatch[2].trim();
      const canonical = `${currentOperator}${rest}`;
      if (!CANONICAL_LINE_SET.has(canonical)) {
        throw new Error(`Unrecognized canonical line "${canonical}" from "${rawDesc}"`);
      }
      result.push(canonical);
    } else if (currentOperator) {
      const canonical = `${currentOperator}${part}`;
      if (!CANONICAL_LINE_SET.has(canonical)) {
        throw new Error(`Unrecognized compound line "${canonical}" from "${rawDesc}"`);
      }
      result.push(canonical);
    } else {
      throw new Error(`Line token without operator "${part}" from "${rawDesc}"`);
    }
  }

  return result;
}

function parseAccess(rawStationField, rawWalkField) {
  const stRaw = rawStationField.trim();
  const wkRaw = rawWalkField.trim();

  if (stRaw === '出張専門のため該当なし' || wkRaw === '出張専門のため該当なし') {
    return {
      access_type: 'home_visit_only',
      nearest_station: '',
      station_walk_minutes: '',
      access_note: '出張専門のため該当なし',
      lines: [],
    };
  }

  const primaryWalkPart = wkRaw.split('（')[0];
  let walkMinutes = '';
  const walkMinMatch = primaryWalkPart.match(/徒歩\s*約?\s*(\d+)\s*分/);
  if (walkMinMatch) {
    walkMinutes = String(Number.parseInt(walkMinMatch[1], 10));
  } else if (/出口すぐ|すぐ/.test(primaryWalkPart)) {
    walkMinutes = '1';
  } else {
    throw new Error(`Could not parse walk minutes from "${wkRaw}"`);
  }

  const segments = stRaw.split('／').map((s) => s.trim()).filter(Boolean);
  const stationNames = [];
  const lines = [];

  for (const seg of segments) {
    const segNorm = seg.normalize('NFKC').replace(/より$/, '').trim();
    let linePart = '';
    let stationPart = '';

    const spaceIdx = segNorm.lastIndexOf(' ');
    if (spaceIdx !== -1) {
      // Check if space is part of "Osaka Metro" with no space before station
      const afterSpace = segNorm.slice(spaceIdx + 1);
      if (/駅$/.test(afterSpace) && !/線駅$/.test(afterSpace)) {
        linePart = segNorm.slice(0, spaceIdx).trim();
        stationPart = afterSpace.trim();
      }
    }

    if (!stationPart) {
      const m = segNorm.match(/^(.+線)(.+駅)$/);
      if (!m) {
        throw new Error(`Could not split line and station in "${seg}"`);
      }
      linePart = m[1].trim();
      stationPart = m[2].trim();
    }

    stationNames.push(stationPart);
    for (const ln of expandLineDescriptor(linePart, stationPart)) {
      if (!lines.includes(ln)) lines.push(ln);
    }
  }

  // Also parse secondary transfer lines mentioned in walk-note parentheses
  const parenMatch = wkRaw.match(/（([^）]+)）/);
  if (parenMatch) {
    const note = parenMatch[1].normalize('NFKC');
    // Match "<line descriptor> <station name>駅"
    const subMatches = note.matchAll(/((?:Osaka Metro|大阪メトロ|JR|阪急|阪神|近鉄|南海|阪堺)[^\sから]+)\s+([^\sから]+駅)/g);
    for (const sm of subMatches) {
      for (const ln of expandLineDescriptor(sm[1], sm[2])) {
        if (!lines.includes(ln)) lines.push(ln);
      }
    }
  }

  return {
    access_type: 'station',
    nearest_station: stationNames.join(' / '),
    station_walk_minutes: walkMinutes,
    access_note: `${stRaw} / ${wkRaw}`,
    lines,
  };
}

function parseOptionalInt(raw) {
  const s = (raw || '').trim();
  if (!s || s === '未確認' || s === '未登録') return '';
  const m = s.match(/^(\d+(?:\.\d+)?)/);
  if (!m) return '';
  return String(Number.parseInt(m[1], 10));
}

function parseOptionalNumber(raw) {
  const s = (raw || '').trim();
  if (!s || s === '未確認' || s === '未登録') return '';
  const m = s.match(/^(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

function parseDeliveryRange(raw) {
  const s = (raw || '').trim();
  if (!s || s === '未確認' || s === '未登録') return '';
  return s;
}

function mapPerinatalLevel(raw) {
  const s = (raw || '').trim();
  if (s === '総合周産期母子医療センター') return 'comprehensive';
  if (s === '地域周産期母子医療センター') return 'regional';
  if (s === '指定なし') return 'none';
  if (!s || s === '未確認') return 'unknown';
  throw new Error(`Unexpected perinatal level: ${raw}`);
}

function mapPainless(row, category) {
  const availRaw = row['無痛分娩の掲載区分'].trim();
  const h24Raw = row['無痛分娩24時間対応'].trim();
  const timingRaw = row['計画／自然陣痛'].trim();

  let painless_availability;
  if (category.startsWith('midwife') || availRaw.startsWith('対象外')) {
    painless_availability = 'not_applicable';
  } else if (availRaw.includes('経産婦のみ')) {
    painless_availability = 'elective_conditional';
  } else if (availRaw.startsWith('希望による無痛分娩可能')) {
    painless_availability = 'elective';
  } else if (availRaw.startsWith('医学的適応のみ')) {
    painless_availability = 'medical_only';
  } else if (availRaw.includes('和痛分娩')) {
    painless_availability = 'analgesia_only';
  } else if (availRaw.startsWith('なし')) {
    painless_availability = 'none';
  } else if (availRaw.startsWith('未確認')) {
    painless_availability = 'unknown';
  } else {
    throw new Error(`Unexpected 無痛分娩の掲載区分: ${availRaw}`);
  }

  let painless_24h;
  if (h24Raw.startsWith('対象外') || h24Raw.startsWith('該当なし')) {
    painless_24h = 'not_applicable';
  } else if (h24Raw === '24時間対応可能') {
    painless_24h = 'yes';
  } else if (h24Raw === '24時間は対応していない') {
    painless_24h = 'no';
  } else if (h24Raw.startsWith('未確認')) {
    painless_24h = 'unknown';
  } else {
    throw new Error(`Unexpected 無痛分娩24時間対応: ${h24Raw}`);
  }

  let painless_timing;
  if (timingRaw.startsWith('対象外') || timingRaw.startsWith('該当なし')) {
    painless_timing = 'not_applicable';
  } else if (timingRaw.startsWith('計画分娩・自然陣痛の両方')) {
    painless_timing = 'both';
  } else if (timingRaw === '計画分娩') {
    painless_timing = 'scheduled';
  } else if (timingRaw.startsWith('自然陣痛後')) {
    painless_timing = 'spontaneous';
  } else if (timingRaw.startsWith('未確認')) {
    painless_timing = 'unknown';
  } else {
    throw new Error(`Unexpected 計画／自然陣痛: ${timingRaw}`);
  }

  const extraCostRaw = (row['無痛分娩の追加費用'] || '').trim();
  const painless_extra_cost_note =
    !extraCostRaw || extraCostRaw.startsWith('未確認') || extraCostRaw.startsWith('該当なし')
      ? ''
      : extraCostRaw;

  const managerRaw = (row['麻酔管理者'] || '').trim();
  let anesthesia_manager_type;
  if (
    category.startsWith('midwife') ||
    painless_availability === 'none' ||
    painless_availability === 'analgesia_only'
  ) {
    anesthesia_manager_type = 'not_applicable';
  } else if (managerRaw === '麻酔科専門医') {
    anesthesia_manager_type = 'anesthesiologist';
  } else if (managerRaw === '産婦人科専門医') {
    anesthesia_manager_type = 'obgyn';
  } else if (managerRaw.includes('院長または麻酔科医師') || managerRaw.includes('麻酔科標榜医')) {
    anesthesia_manager_type = 'other_or_mixed';
  } else {
    anesthesia_manager_type = 'unknown';
  }

  const isBareUnconfirmed =
    !managerRaw ||
    /^未確認($|（(公式に)?(自施設分の)?公表(を確認できず|なし)）$)/.test(managerRaw) ||
    managerRaw.startsWith('該当なし');
  const anesthesia_manager_note = isBareUnconfirmed ? '' : managerRaw;

  return {
    painless_availability,
    painless_24h,
    painless_timing,
    painless_extra_cost_note,
    anesthesia_manager_type,
    anesthesia_manager_note,
    painless_memo: (row['無痛分娩の確認メモ'] || '').trim(),
  };
}

function mapYesNoUnknown(raw) {
  const s = (raw || '').trim();
  if (s.startsWith('あり')) return 'yes';
  if (s === 'なし') return 'no';
  if (!s || s.startsWith('未確認')) return 'unknown';
  throw new Error(`Unexpected yes/no/unknown value: ${raw}`);
}

function mapBreastfeeding(raw) {
  const s = (raw || '').trim();
  if (s === '授乳支援を行う外来を実施している') return 'open_to_all';
  if (s === '当施設で出産した産婦のみ対象に実施中') return 'delivered_here_only';
  if (s === '実施していない') return 'no';
  if (!s || s === '未確認') return 'unknown';
  throw new Error(`Unexpected 退院後の授乳支援外来: ${raw}`);
}

function mapPostpartumCare(raw) {
  const s = (raw || '').trim();
  let status;
  if (s.includes('終了')) {
    status = 'osaka_city_ending';
  } else if (s.startsWith('大阪市産後ケア事業掲載')) {
    status = 'osaka_city_listed';
  } else if (s.startsWith('大阪市産後ケア事業の掲載なし')) {
    status = 'not_listed';
  } else if (s.startsWith('出産なび')) {
    status = 'birth_navi_only';
  } else if (!s || s === '未確認') {
    status = 'unknown';
  } else {
    throw new Error(`Unexpected 産後ケア備考: ${raw}`);
  }

  let endDate = '';
  const dateMatch = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日より.*終了/);
  if (dateMatch) {
    const yyyy = dateMatch[1];
    const mm = dateMatch[2].padStart(2, '0');
    const dd = dateMatch[3].padStart(2, '0');
    endDate = `${yyyy}-${mm}-${dd}`;
  }

  return {
    postpartum_care_status: status,
    postpartum_care_end_date: endDate,
    postpartum_care_note: s,
  };
}

function mapCost(raw) {
  const s = (raw || '').trim();
  if (!s || s.startsWith('未掲載')) {
    return {
      cost_display_type: 'unlisted',
      cost_reference_text: s === '未掲載（出産なびに費用データなし）' ? '' : s,
    };
  }
  if (s.includes('出産総額でない')) {
    return { cost_display_type: 'painless_addon_only', cost_reference_text: s };
  }
  if (s.includes('初産婦無痛分娩')) {
    return { cost_display_type: 'painless_example', cost_reference_text: s };
  }
  if ((s.includes('〜') || s.includes('～')) && !s.includes('データなし')) {
    return { cost_display_type: 'delivery_range', cost_reference_text: s };
  }
  if (s.includes('平均') || s.includes('分娩費用目安・総額')) {
    return { cost_display_type: 'delivery_single_or_avg', cost_reference_text: s };
  }
  throw new Error(`Unexpected cost format: ${raw}`);
}

function normalizeIsoDate(raw) {
  const s = (raw || '').trim();
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) {
    throw new Error(`Unexpected date format: ${raw}`);
  }
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function buildFeatureTags(rec) {
  const tags = [];
  if (rec.perinatal_center_level === 'comprehensive') tags.push('COMPREHENSIVE_PERINATAL');
  if (rec.perinatal_center_level === 'regional') tags.push('REGIONAL_PERINATAL');
  if (rec.nicu_beds !== '' && Number(rec.nicu_beds) > 0) tags.push('NICU');
  if (rec.painless_availability === 'elective' || rec.painless_availability === 'elective_conditional') {
    tags.push('PAINLESS_ELECTIVE');
    if (rec.painless_availability === 'elective_conditional') tags.push('PAINLESS_CONDITIONAL');
    if (rec.painless_24h === 'yes') tags.push('PAINLESS_24H');
    if (rec.painless_timing === 'scheduled' || rec.painless_timing === 'both') tags.push('PAINLESS_SCHEDULED');
    if (rec.painless_timing === 'spontaneous' || rec.painless_timing === 'both') tags.push('PAINLESS_SPONTANEOUS');
  }
  if (rec.anesthesia_manager_type === 'anesthesiologist') tags.push('ANESTHESIOLOGIST_MANAGED');
  if (rec.postpartum_care_status === 'osaka_city_listed') tags.push('OSAKA_POSTPARTUM_CARE');
  if (rec.postpartum_care_status === 'osaka_city_ending') tags.push('OSAKA_POSTPARTUM_CARE_ENDING');
  if (rec.in_hospital_midwifery === 'yes') tags.push('IN_HOSPITAL_MIDWIFERY');
  if (rec.midwife_outpatient === 'yes') tags.push('MIDWIFE_OUTPATIENT');
  if (rec.breastfeeding_clinic === 'open_to_all' || rec.breastfeeding_clinic === 'delivered_here_only') {
    tags.push('BREASTFEEDING_CLINIC');
  }
  if (rec.postpartum_checkup_2w_1m === 'yes') tags.push('POSTPARTUM_CHECKUP');
  if (rec.newborn_hearing_test === 'yes') tags.push('NEWBORN_HEARING_TEST');
  if (rec.facility_category === 'midwife_inpatient') tags.push('MIDWIFE_INPATIENT');
  if (rec.facility_category === 'midwife_home_visit') tags.push('MIDWIFE_HOME_VISIT');
  if (rec.access_type === 'station' && Number(rec.station_walk_minutes) <= 3) tags.push('STATION_NEAR');
  return tags;
}

function validateRecord(rec) {
  if (!/^\d{5}$/.test(rec.id)) {
    throw new Error(`Invalid id: ${rec.id}`);
  }
  if (!OSAKA_WARDS.has(rec.ward)) {
    throw new Error(`Invalid Osaka ward "${rec.ward}" for ${rec.name}`);
  }
  if (!/^(0\d{1,2}-\d{4}-\d{4}|0[5789]0-\d{4}-\d{4}|0570-\d{3}-\d{3}|0120-\d{3}-\d{3})$/.test(rec.phone_number)) {
    throw new Error(`Invalid phone number "${rec.phone_number}" for ${rec.name}`);
  }
  if (!/^https?:\/\/\S+$/.test(rec.website_url)) {
    throw new Error(`Invalid website_url "${rec.website_url}" for ${rec.name}`);
  }
  if (!/^https?:\/\/\S+$/.test(rec.birth_navi_url)) {
    throw new Error(`Invalid birth_navi_url "${rec.birth_navi_url}" for ${rec.name}`);
  }
  if (rec.geo_status === 'resolved') {
    const lat = Number(rec.latitude);
    const lng = Number(rec.longitude);
    if (!(lat >= LAT_MIN && lat <= LAT_MAX && lng >= LNG_MIN && lng <= LNG_MAX)) {
      throw new Error(`Out-of-bounds resolved coordinates for ${rec.name}: ${rec.latitude}, ${rec.longitude}`);
    }
  } else if (rec.latitude !== '' || rec.longitude !== '') {
    throw new Error(`Non-resolved geo_status must have empty coords for ${rec.name}`);
  }

  const parsedLines = JSON.parse(rec.lines);
  if (!Array.isArray(parsedLines)) throw new Error(`lines must be JSON array for ${rec.name}`);
  for (const ln of parsedLines) {
    if (!CANONICAL_LINE_SET.has(ln)) throw new Error(`Non-canonical line "${ln}" for ${rec.name}`);
  }
  if (rec.access_type === 'station') {
    if (parsedLines.length === 0 || !rec.nearest_station || !/^\d+$/.test(rec.station_walk_minutes)) {
      throw new Error(`Invalid station metadata for ${rec.name}`);
    }
  } else {
    if (parsedLines.length !== 0 || rec.nearest_station !== '' || rec.station_walk_minutes !== '') {
      throw new Error(`Home visit facility must not have station metadata: ${rec.name}`);
    }
  }

  const parsedTags = JSON.parse(rec.feature_tags);
  if (!Array.isArray(parsedTags)) throw new Error(`feature_tags must be JSON array for ${rec.name}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.source_checked_date) || !/^\d{4}-\d{2}-\d{2}$/.test(rec.extra_checked_date)) {
    throw new Error(`Invalid checked date for ${rec.name}`);
  }
}

function tally(arr) {
  const map = new Map();
  for (const item of arr) {
    map.set(item, (map.get(item) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rawParsed = parseCsv(fs.readFileSync(opts.input, 'utf8'));
  const openData = loadOpenData(opts.openDataDir);

  const excluded = [];
  const retained = [];

  for (const rawRow of rawParsed.records) {
    if (rawRow['施設の種類'].trim() === '未確認') {
      excluded.push({ id: rawRow['出産なび施設ID'].trim(), name: rawRow['施設名'].trim() });
      continue;
    }

    const facility_category = mapFacilityCategory(rawRow['施設の種類']);
    const ward = rawRow['所在区'].trim().replace(/^大阪市/, '');
    const geo = enrichGeo(rawRow, facility_category, openData);
    const access = parseAccess(rawRow['最寄り駅'], rawRow['駅からの所要']);
    const perinatal_center_level = mapPerinatalLevel(rawRow['周産期母子医療センター指定']);
    const nicu_beds = parseOptionalInt(rawRow['NICU病床数']);
    const high_risk_ready =
      perinatal_center_level === 'comprehensive' ||
      perinatal_center_level === 'regional' ||
      (nicu_beds !== '' && Number(nicu_beds) > 0);
    const painless = mapPainless(rawRow, facility_category);
    const postpartum = mapPostpartumCare(rawRow['産後ケア備考']);
    const cost = mapCost(rawRow['費用掲載情報（同条件比較不可）']);

    const out = {
      id: rawRow['出産なび施設ID'].trim(),
      mhlw_facility_id: geo.mhlw_facility_id,
      name: rawRow['施設名'].trim(),
      ward,
      address: geo.address,
      latitude: geo.latitude,
      longitude: geo.longitude,
      geo_status: geo.geo_status,
      access_type: access.access_type,
      nearest_station: access.nearest_station,
      station_walk_minutes: access.station_walk_minutes,
      access_note: access.access_note,
      lines: JSON.stringify(access.lines),
      website_url: rawRow['公式HP URL'].trim(),
      phone_number: rawRow['電話番号'].trim(),
      facility_category,
      facility_type_raw: rawRow['施設の種類'].trim(),
      delivery_available: 'true',
      perinatal_center_level,
      high_risk_ready: String(high_risk_ready),
      nicu_beds,
      obstetric_beds: parseOptionalInt(rawRow['産科病床数']),
      obgyn_doctors: parseOptionalNumber(rawRow['産科医師数']),
      pediatric_doctors: parseOptionalNumber(rawRow['小児科医師数']),
      midwives_count: parseOptionalNumber(rawRow['助産師数']),
      annual_vaginal_deliveries: parseDeliveryRange(rawRow['年間経腟分娩取扱件数']),
      annual_cesarean_deliveries: parseDeliveryRange(rawRow['年間帝王切開術取扱件数']),
      painless_availability: painless.painless_availability,
      painless_24h: painless.painless_24h,
      painless_timing: painless.painless_timing,
      painless_extra_cost_note: painless.painless_extra_cost_note,
      anesthesia_manager_type: painless.anesthesia_manager_type,
      anesthesia_manager_note: painless.anesthesia_manager_note,
      painless_memo: painless.painless_memo,
      in_hospital_midwifery: mapYesNoUnknown(rawRow['院内助産']),
      midwife_outpatient: mapYesNoUnknown(rawRow['助産師外来']),
      newborn_hearing_test: mapYesNoUnknown(rawRow['新生児聴覚検査（自施設）']),
      postpartum_checkup_2w_1m:
        rawRow['産婦健診（2週間・1ヶ月）'].trim() === '2週間・1ヶ月ともあり' ? 'yes' : 'unknown',
      breastfeeding_clinic: mapBreastfeeding(rawRow['退院後の授乳支援外来']),
      postpartum_care_status: postpartum.postpartum_care_status,
      postpartum_care_end_date: postpartum.postpartum_care_end_date,
      postpartum_care_note: postpartum.postpartum_care_note,
      cost_display_type: cost.cost_display_type,
      cost_reference_text: cost.cost_reference_text,
      feature_tags: '[]',
      birth_navi_url: rawRow['施設詳細URL'].trim(),
      painless_source_url: rawRow['無痛分娩の出典URL'].trim(),
      station_source_url: rawRow['最寄り駅の出典URL'].trim(),
      source_checked_date: normalizeIsoDate(rawRow['資料確認日']),
      extra_checked_date: normalizeIsoDate(rawRow['追加項目確認日']),
      disclaimer_note: rawRow['利用上の注意'].trim(),
    };

    out.feature_tags = JSON.stringify(buildFeatureTags(out));
    validateRecord(out);
    retained.push(out);
  }

  writeCsv(opts.output, OUTPUT_COLUMNS, retained);

  const coveredWards = new Set(retained.map((r) => r.ward));
  const zeroWards = [...OSAKA_WARDS].filter((w) => !coveredWards.has(w));
  const uniqueLines = [...new Set(retained.flatMap((r) => JSON.parse(r.lines)))];

  console.log('\n=== BUILD SUMMARY ===');
  console.log(`Input raw rows: ${rawParsed.records.length}`);
  console.log(`Excluded (施設の種類=未確認): ${excluded.length} -> ${excluded.map((e) => `${e.id}:${e.name}`).join(', ')}`);
  console.log(`Output rows: ${retained.length}, Columns: ${OUTPUT_COLUMNS.length}`);
  console.log(`Output file: ${opts.output}`);
  console.log(`Covered wards: ${coveredWards.size}/24 (Zero: ${zeroWards.join(', ')})`);
  console.log('facility_category:', Object.fromEntries(tally(retained.map((r) => r.facility_category))));
  console.log('geo_status:', Object.fromEntries(tally(retained.map((r) => r.geo_status))));
  console.log('perinatal_center_level:', Object.fromEntries(tally(retained.map((r) => r.perinatal_center_level))));
  console.log('high_risk_ready:', Object.fromEntries(tally(retained.map((r) => r.high_risk_ready))));
  console.log('painless_availability:', Object.fromEntries(tally(retained.map((r) => r.painless_availability))));
  console.log('painless_24h:', Object.fromEntries(tally(retained.map((r) => r.painless_24h))));
  console.log('painless_timing:', Object.fromEntries(tally(retained.map((r) => r.painless_timing))));
  console.log('anesthesia_manager_type:', Object.fromEntries(tally(retained.map((r) => r.anesthesia_manager_type))));
  console.log('postpartum_care_status:', Object.fromEntries(tally(retained.map((r) => r.postpartum_care_status))));
  console.log('cost_display_type:', Object.fromEntries(tally(retained.map((r) => r.cost_display_type))));
  console.log(`Unique canonical lines (${uniqueLines.length}): ${uniqueLines.join(', ')}`);
}

main();
