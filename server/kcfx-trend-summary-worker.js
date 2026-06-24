import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initDb } from './db.js';

const [dataDirArg, outputPathArg] = process.argv.slice(2);
const dataDir = path.resolve(dataDirArg || 'data');
const outputPath = path.resolve(outputPathArg || path.join(dataDir, 'kcfx-trend-summary.json'));

const TREND_MONTHS = [
  { id: 'fact-3', label: 'M1' },
  { id: 'fact-4', label: 'M2' },
  { id: 'fact-5', label: 'M3' },
  { id: 'fact-6', label: 'M4' },
  { id: 'fact-7', label: 'M5' }
];
const REQUIRED_IDS = [
  ...TREND_MONTHS.map((month) => month.id),
  'fact-2',
  'dim-product',
  'dim-warehouse',
  'dim-warehouse-material'
];
const UNCLASSIFIED_LIMIT = 1000;

function safeId(id) {
  return path.basename(String(id || '').trim()).replace(/[^a-z0-9_-]/gi, '');
}

function rowsPathFor(id) {
  return path.join(dataDir, 'kcfx-records', `${safeId(id)}.json`);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function loadRecord(db, id) {
  const record = db.kcfxLibrary.records[id] || { id };
  const rowsPath = record.rowsPath
    ? path.join(dataDir, record.rowsPath)
    : rowsPathFor(id);
  const payload = await readJson(rowsPath, null);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) return null;
  return {
    ...record,
    id,
    rows,
    rowCount: Number(payload.rowCount || rows.length),
    rowsSavedAt: payload.savedAt || record.rowsSavedAt || ''
  };
}

function stripRows(record) {
  if (!record) return null;
  const { rows, ...metadata } = record;
  return {
    ...metadata,
    rowCount: Array.isArray(rows) ? rows.length : Number(metadata.rowCount || 0),
    hasRows: true
  };
}

function nthValue(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  if (Array.isArray(row?.__cells)) return row.__cells[index] ?? '';
  return Object.entries(row || {})
    .filter(([key]) => key !== '__cells')
    .map(([, value]) => value)[index] ?? '';
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function normalizeMaterialCode(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function normalizeDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, '').toLowerCase();
}

function makeDepartmentKey(materialA, warehouse, materialB) {
  return normalizeDepartmentKey(`${materialA}${warehouse}${materialB}`);
}

function normalizeHeaderText(value) {
  return normalizeText(value)
    .replace(/[()\[\]（）【】\s_：:、]/g, '')
    .toLowerCase();
}

function makePriceAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeHeaderText(key) }));
  const preferred = normalized.find(({ text }) => text.includes('结算价') && text.includes('含税'))
    || normalized.find(({ text }) => text.includes('结算价'))
    || normalized.find(({ text }) => text.includes('含税') && text.includes('价'));
  return preferred ? (row) => row?.[preferred.key] : (row) => nthValue(row, 16);
}

function makeQtyAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeHeaderText(key) }));
  const preferred = normalized.find(({ text }) => text.includes('结余库存数量'))
    || normalized.find(({ text }) => text.includes('结存') && text.includes('数量'))
    || normalized.find(({ text }) => text.includes('库存数量') && !text.includes('占比'))
    || normalized.find(({ text }) => text === '数量');
  return preferred ? (row) => row?.[preferred.key] : (row) => nthValue(row, 11);
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value);
  if (!text || text.startsWith('#')) return 0;
  const parsed = Number(text.replace(/[,，\s￥¥元]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildDimensionMaps(records) {
  const departmentByKey = new Map();
  for (const row of records['dim-warehouse-material']?.rows || []) {
    const key = normalizeDepartmentKey(nthValue(row, 6));
    const department = normalizeText(nthValue(row, 7));
    if (key && department && !departmentByKey.has(key)) departmentByKey.set(key, department);
  }

  const warehouseTypeByName = new Map();
  const warehouseLocationByName = new Map();
  for (const row of records['dim-warehouse']?.rows || []) {
    const warehouseName = normalizeText(nthValue(row, 2));
    const warehouseType = normalizeText(nthValue(row, 7));
    const warehouseLocation = normalizeText(nthValue(row, 8));
    if (warehouseName && warehouseType && !warehouseTypeByName.has(warehouseName)) warehouseTypeByName.set(warehouseName, warehouseType);
    if (warehouseName && warehouseLocation && !warehouseLocationByName.has(warehouseName)) warehouseLocationByName.set(warehouseName, warehouseLocation);
  }

  const productLineByMaterial = new Map();
  const productSeriesByMaterial = new Map();
  const settlementPriceByMaterial = new Map();
  for (const row of records['dim-product']?.rows || []) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const productLine = normalizeText(nthValue(row, 7));
    const productSeries = normalizeText(nthValue(row, 8));
    if (materialCode && productLine && !productLineByMaterial.has(materialCode)) productLineByMaterial.set(materialCode, productLine);
    if (materialCode && productSeries && !productSeriesByMaterial.has(materialCode)) productSeriesByMaterial.set(materialCode, productSeries);
    const price = toNumber(nthValue(row, 10));
    if (materialCode && price && !settlementPriceByMaterial.has(materialCode)) settlementPriceByMaterial.set(materialCode, price);
  }

  const inventoryMonthRows = records['fact-2']?.rows || [];
  const monthPriceAccessor = makePriceAccessor(inventoryMonthRows[0]);
  for (const row of inventoryMonthRows) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const price = toNumber(monthPriceAccessor(row));
    if (materialCode && price) settlementPriceByMaterial.set(materialCode, price);
  }

  return { departmentByKey, warehouseTypeByName, warehouseLocationByName, productLineByMaterial, productSeriesByMaterial, settlementPriceByMaterial };
}

function summarizeMonth(month, record, maps) {
  const sourceRows = record?.rows || [];
  const rows = sourceRows.length ? sourceRows.slice(0, -1) : [];
  const qtyAccessor = makeQtyAccessor(sourceRows[0]);
  const priceAccessor = makePriceAccessor(sourceRows[0]);
  const groupedItems = new Map();
  const summary = {
    ...month,
    record: stripRows(record),
    totalRows: sourceRows.length,
    skippedSummaryRows: sourceRows.length ? 1 : 0,
    usedRows: 0,
    totalQty: 0,
    totalValue: 0,
    pricedRows: 0,
    directPricedRows: 0,
    fallbackPricedRows: 0,
    items: [],
    unclassifiedRows: [],
    unclassifiedTruncated: false
  };

  for (const row of rows) {
    const materialA = normalizeMaterialCode(nthValue(row, 1));
    const materialB = normalizeMaterialCode(nthValue(row, 2));
    const materialName = normalizeText(nthValue(row, 3));
    const warehouse = normalizeText(nthValue(row, 4));
    const qty = toNumber(qtyAccessor(row));
    if (!qty) continue;
    const directSettlementPrice = toNumber(priceAccessor(row));
    const fallbackSettlementPrice = maps.settlementPriceByMaterial.get(materialB) || 0;
    const settlementPrice = directSettlementPrice || fallbackSettlementPrice;
    const value = qty * settlementPrice;

    const department = maps.departmentByKey.get(makeDepartmentKey(materialA, warehouse, materialB)) || '';
    const productLine = maps.productLineByMaterial.get(materialB) || '';
    const productSeries = maps.productSeriesByMaterial.get(materialB) || '';
    const warehouseType = maps.warehouseTypeByName.get(warehouse) || '';
    const warehouseLocation = maps.warehouseLocationByName.get(warehouse) || '';
    const item = {
      qty,
      value,
      warehouseType: warehouseType || 'Unclassified warehouse type',
      department: department || 'Unmatched department',
      productLine: productLine || 'Unclassified product line',
      productSeries: productSeries || 'Unclassified sales series',
      warehouseLocation: warehouseLocation || 'Unclassified warehouse location'
    };
    const groupKey = [item.warehouseType, item.department, item.productLine, item.productSeries, item.warehouseLocation].join('\u001f');
    const grouped = groupedItems.get(groupKey) || { ...item, qty: 0, value: 0 };
    grouped.qty += qty;
    grouped.value += value;
    groupedItems.set(groupKey, grouped);

    summary.usedRows += 1;
    summary.totalQty += qty;
    summary.totalValue += value;
    if (settlementPrice) summary.pricedRows += 1;
    if (directSettlementPrice) summary.directPricedRows += 1;
    else if (fallbackSettlementPrice) summary.fallbackPricedRows += 1;

    const missingReasons = [
      department ? '' : 'Missing department',
      productLine ? '' : 'Missing product line',
      warehouseLocation ? '' : 'Missing warehouse location'
    ].filter(Boolean);
    if (missingReasons.length) {
      if (summary.unclassifiedRows.length < UNCLASSIFIED_LIMIT) {
        summary.unclassifiedRows.push({
          month: month.label,
          reason: missingReasons.join('、'),
          materialA,
          materialCode: materialB,
          materialName,
          warehouse,
          qty,
          department,
          productLine,
          warehouseLocation
        });
      } else {
        summary.unclassifiedTruncated = true;
      }
    }
  }

  summary.items = [...groupedItems.values()];
  return summary;
}

async function main() {
  const db = await initDb(dataDir);
  const records = {};
  for (const id of REQUIRED_IDS) {
    records[id] = await loadRecord(db, id);
  }
  const maps = buildDimensionMaps(records);
  const monthSummaries = TREND_MONTHS.map((month) => summarizeMonth(month, records[month.id], maps));
  const payload = {
    ok: true,
    status: 'ready',
    source: 'server-trend-summary',
    savedAt: db.kcfxLibrary.savedAt || '',
    generatedAt: new Date().toISOString(),
    monthSummaries,
    records: Object.fromEntries(Object.entries(records).map(([id, record]) => [id, stripRows(record)]))
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload), 'utf8');
  process.stdout.write(JSON.stringify({
    ok: true,
    monthCount: monthSummaries.length,
    rowCount: monthSummaries.reduce((total, month) => total + month.usedRows, 0),
    outputPath
  }));
}

main().catch((error) => {
  process.stderr.write(error?.stack || error?.message || String(error));
  process.exit(1);
});
