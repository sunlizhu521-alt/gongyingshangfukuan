export const KCFX_COLORS = ['#007aff', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#5ac8fa', '#5856d6', '#30d158', '#bf5af2', '#ff6b35'];

export const INVENTORY_TREND_MONTHS = [
  { id: 'fact-3', label: '1月' },
  { id: 'fact-4', label: '2月' },
  { id: 'fact-5', label: '3月' },
  { id: 'fact-6', label: '4月' },
  { id: 'fact-7', label: '5月' }
];

const AGE_BUCKETS = ['0-30天', '31-60天', '61-90天', '91-120天', '121-150天', '150天以上'];
const AGE_BUCKET_DEFINITIONS = [
  { label: '0-30天', candidates: ['0-30天数量', '0-30天库存数量', '0-30天结余库存数量', '0-30天库龄数量', '0-30天'] },
  { label: '31-60天', candidates: ['31-60天数量', '31-60天库存数量', '31-60天结余库存数量', '31-60天库龄数量', '31-60天'] },
  { label: '61-90天', candidates: ['61-90天数量', '61-90天库存数量', '61-90天结余库存数量', '61-90天库龄数量', '61-90天'] },
  { label: '91-120天', candidates: ['91-120天数量', '91-120天库存数量', '91-120天结余库存数量', '91-120天库龄数量', '91-120天'] },
  { label: '121-150天', candidates: ['121-150天数量', '121-150天库存数量', '121-150天结余库存数量', '121-150数量', '121-150天', '121-150'] },
  { label: '150天以上', candidates: ['>150天', '＞150天', '>150天数量', '＞150天数量', '大于150天数量', '150天以上数量', '150天及以上数量', '150以上数量', '150天以上', '150天及以上', '150以上'] }
];

const SALEABLE_NEW_WAREHOUSE_TYPES = new Set(['销售出库仓', '销售供应商仓', '生产成品仓']);
const RAW_MATERIAL_WAREHOUSE_TYPES = new Set(['生产材料仓', '生成材料仓']);
const OTHER_UNSALEABLE_WAREHOUSE_TYPES = new Set(['系统集成仓', '销售海上在途仓', '销售售后配件仓', '样品/展厅仓', '样品展厅仓']);
const SALEABLE_RETURN_CATEGORIES = new Set(['二手商品-九大产品新', '二手商品-其他/成品', '全新换包装-九大产品线']);
const UNINSPECTED_RETURN_CATEGORIES = new Set(['全新品', '其他/成品']);
const OTHER_UNSALEABLE_RETURN_CATEGORIES = new Set(['健康办公', '其他/配件']);
const EXCLUDED_SALES_PRODUCT_VALUES = new Set(['其他/配件', '健康办公', '护理床附件'].map(normalizeSalesExclusionText));

export function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

export function normalizeHeaderName(value) {
  return normalizeText(value)
    .replace(/[()\[\]（）【】\s_：:，,、-]/g, '')
    .toLowerCase();
}

export function normalizeMaterialCode(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
}

export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value);
  if (!text || text.startsWith('#')) return 0;
  const parsed = Number(text.replace(/[,，\s￥¥元]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function nthValue(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  if (Array.isArray(row?.__cells)) return row.__cells[index] ?? '';
  return Object.entries(row || {})
    .filter(([key]) => key !== '__cells')
    .map(([, value]) => value)[index] ?? '';
}

export function firstValue(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row || {}, name) && normalizeText(row[name]) !== '') return row[name];
  }
  const wanted = names.map(normalizeHeaderName);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(normalizeHeaderName(key)) && normalizeText(value) !== '') return value;
  }
  return '';
}

export function firstValueByHeaderIncludes(row, includeWords, excludeWords = []) {
  const includes = includeWords.map(normalizeHeaderName).filter(Boolean);
  const excludes = excludeWords.map(normalizeHeaderName).filter(Boolean);
  for (const [key, value] of Object.entries(row || {})) {
    const header = normalizeHeaderName(key);
    if (includes.every((word) => header.includes(word)) && !excludes.some((word) => header.includes(word)) && normalizeText(value) !== '') {
      return value;
    }
  }
  return '';
}

export function firstText(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return '';
}

export function firstNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    const value = toNumber(candidate);
    if (value !== 0 || text === '0') return value;
  }
  return 0;
}

function firstOptionalNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (!text) continue;
    const value = toNumber(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

export function formatQuantity(value) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function moneyWan(value) {
  return `${formatNumber((Number(value) || 0) / 10000, 2)}万元`;
}

export function percent(value, total) {
  const denominator = Number(total) || 0;
  if (!denominator) return '0.00%';
  return `${((Number(value) || 0) / denominator * 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

export function uniqueCount(rows, key) {
  return new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean)).size;
}

export function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || '未分类';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  }
  return [...map.entries()];
}

export function groupSum(rows, key, valueKey = 'amount', limit = 10) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || '未分类';
    map.set(name, (map.get(name) || 0) + (Number(row[valueKey]) || 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((row) => row.value !== 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, limit);
}

export function recordSourceText(record) {
  if (!record) return '未引用';
  const time = record.appliedAt || record.savedAt ? new Date(record.appliedAt || record.savedAt).toLocaleString('zh-CN', { hour12: false }) : '-';
  return `${record.fileName || record.title || record.id || '-'}；记录 ${formatNumber(record.rows?.length || record.rowCount || 0)} 行；当前引用：${time}`;
}

export function rowsOf(record) {
  return Array.isArray(record?.rows) ? record.rows : [];
}

let salesRowsCache = {
  salesRecord: null,
  productRecord: null,
  storeRecord: null,
  departmentRecord: null,
  rows: null
};

export function mapProducts(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ['物料编码', '货品编码', '商品编码']), nthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      materialName: firstText([firstValue(row, ['金蝶名称', '物料名称', '货品名称', '商品名称']), nthValue(row, 4)]),
      productCategory: firstText([firstValue(row, ['销售产品分类', '产品分类', '销售产品类别', '产品类别', '品类'])]),
      productLine: firstText([firstValue(row, ['销售产品线', '产品线']), nthValue(row, 7)]),
      productSeries: firstText([firstValue(row, ['销售系列', '产品系列', '系列']), nthValue(row, 8)]),
      model: firstText([firstValue(row, ['型号', '规格型号']), nthValue(row, 16)]),
      department: firstText([firstValue(row, ['采购分组', '事业部']), nthValue(row, 22)]),
      settlementPrice: firstNumber([
        firstValue(row, ['结算价(含税)', '结算价（含税）', '结算价含税', '结算价', '内部结算价', '26年内部结算价', '2026年内部结算价']),
        firstValueByHeaderIncludes(row, ['结算价']),
        nthValue(row, 10)
      ])
    });
  }
  return map;
}

export function mapWarehouses(rows) {
  const map = new Map();
  for (const row of rows) {
    const name = firstText([firstValue(row, ['仓库金蝶名称', '仓库名称', '金蝶名称', '仓库']), nthValue(row, 2), nthValue(row, 1)]);
    if (!name || map.has(name)) continue;
    map.set(name, {
      type: firstText([firstValue(row, ['一级仓库分类', '仓库类型', '结存类型', '类型']), nthValue(row, 7)]),
      location: firstText([firstValue(row, ['二级仓库分类', '仓库位置', '结存位置', '位置']), nthValue(row, 8)])
    });
  }
  return map;
}

export function mapDepartments(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeDepartmentKey(firstText([
      firstValue(row, ['F列', '匹配键', '三元组合', '三元联合键']),
      nthValue(row, 6),
      [firstValue(row, ['使用组织', '库存组织', '组织']), firstValue(row, ['仓库名称', '仓库', '金蝶仓库', '库存仓库']), firstValue(row, ['物料编码'])].join('')
    ]));
    const department = firstText([firstValue(row, ['事业部', '部门', '仓库事业部', '所属事业部']), nthValue(row, 7)]);
    if (key && department && !map.has(key)) map.set(key, department);
  }
  return map;
}

export function getInventoryRows(records) {
  return getInventoryRowsByRecordId(records, 'fact-2');
}

export function getClosedInventoryRows(records) {
  return getInventoryRowsByRecordId(records, 'fact-inventory');
}

function getInventoryRowsByRecordId(records, recordId) {
  const productMap = mapProducts(rowsOf(records['dim-product']));
  const warehouseMap = mapWarehouses(rowsOf(records['dim-warehouse']));
  const departmentMap = mapDepartments(rowsOf(records['dim-warehouse-material']));
  return rowsOf(records[recordId])
    .map((row) => enrichInventoryRow(row, { productMap, warehouseMap, departmentMap }))
    .filter((row) => row.materialCode || row.warehouse || row.qty || row.amount);
}

function enrichInventoryRow(row, maps) {
  const materialCode = normalizeMaterialCode(firstText([
    firstValue(row, ['物料编码', '货品编码', '商品编码', 'SKU']),
    firstValueByHeaderIncludes(row, ['物料', '编码']),
    nthValue(row, 1)
  ]));
  const warehouse = firstText([
    firstValue(row, ['仓库', '仓库名称', '金蝶仓库', '库存仓库']),
    firstValueByHeaderIncludes(row, ['仓库']),
    nthValue(row, 3)
  ]);
  const organization = firstText([firstValue(row, ['使用组织', '库存组织', '组织']), firstValueByHeaderIncludes(row, ['组织']), nthValue(row, 4)]);
  const qty = firstNumber([
    firstValue(row, ['关账结存库存', '0430结余库存数量', '合计库存数量', '合计数量', '合计', '结余库存数量']),
    firstValueByHeaderIncludes(row, ['结存', '库存'], ['金额']),
    firstValueByHeaderIncludes(row, ['结余', '库存', '数量']),
    firstValueByHeaderIncludes(row, ['合计', '库存', '数量']),
    firstValueByHeaderIncludes(row, ['合计', '数量'])
  ]);
  const product = maps.productMap.get(materialCode) || {};
  const warehouseInfo = maps.warehouseMap.get(warehouse) || {};
  const price = firstNumber([
    firstValue(row, ['结算价(含税)', '结算价（含税）', '结算价含税', '结算价']),
    firstValueByHeaderIncludes(row, ['结算价']),
    product.settlementPrice
  ]);
  const amount = firstNumber([
    firstValue(row, ['库存金额合计', '库存金额', '金额合计', '库存货值', '货值']),
    firstValueByHeaderIncludes(row, ['库存', '金额']),
    firstValueByHeaderIncludes(row, ['货值'])
  ]) || qty * price;
  const departmentKey = normalizeDepartmentKey(`${organization}${warehouse}${materialCode}`);
  const productCategory = product.productCategory || firstText([firstValue(row, ['销售产品分类', '产品分类', '品类'])]);
  const warehouseType = warehouseInfo.type || '';
  return {
    sourceRow: row,
    materialCode,
    warehouse,
    organization,
    qty,
    price,
    amount,
    materialName: product.materialName || firstText([firstValue(row, ['物料名称', '货品名称', '商品名称', '金蝶名称']), nthValue(row, 2)]),
    productCategory,
    productLine: product.productLine || firstText([firstValue(row, ['销售产品线', '产品线'])]) || '未分类产品线',
    productSeries: product.productSeries || firstText([firstValue(row, ['销售系列', '系列'])]) || '未分类系列',
    model: product.model || firstText([firstValue(row, ['型号', '规格型号'])]),
    warehouseType: warehouseType || '未分类仓库类型',
    saleStatus: classifySaleStatus(warehouseType, productCategory),
    warehouseLocation: warehouseInfo.location || '未分类仓库位置',
    department: maps.departmentMap.get(departmentKey) || product.department || firstText([firstValue(row, ['事业部'])]) || organization || '未匹配事业部',
    ageGroup: getAgeGroup(row),
    month: getMonth(row)
  };
}

export function buildInventoryTrendRows(records) {
  const maps = {
    productMap: mapProducts(rowsOf(records['dim-product'])),
    warehouseMap: mapWarehouses(rowsOf(records['dim-warehouse'])),
    departmentMap: mapDepartments(rowsOf(records['dim-warehouse-material']))
  };
  return INVENTORY_TREND_MONTHS.map((month) => summarizeTrendMonth(month, records[month.id], records['fact-2'], maps));
}

function summarizeTrendMonth(month, record, inventoryMonthRecord, maps) {
  const sourceRows = rowsOf(record);
  const rows = sourceRows.length ? sourceRows.slice(0, -1) : [];
  const qtyAccessor = makeTrendQtyAccessor(sourceRows[0]);
  const priceAccessor = makeTrendPriceAccessor(sourceRows[0]);
  const fallbackPriceMap = buildFallbackPriceMap(inventoryMonthRecord, maps.productMap);
  const items = [];
  let totalQty = 0;
  let totalValue = 0;

  for (const row of rows) {
    const materialA = normalizeMaterialCode(nthValue(row, 1));
    const materialCode = normalizeMaterialCode(nthValue(row, 2));
    const warehouse = normalizeText(nthValue(row, 4));
    const qty = toNumber(qtyAccessor(row));
    if (!qty) continue;
    const price = toNumber(priceAccessor(row)) || fallbackPriceMap.get(materialCode) || 0;
    const value = qty * price;
    const product = maps.productMap.get(materialCode) || {};
    const warehouseInfo = maps.warehouseMap.get(warehouse) || {};
    const departmentKey = normalizeDepartmentKey(`${materialA}${warehouse}${materialCode}`);
    const item = {
      month: month.label,
      qty,
      amount: value,
      value,
      warehouseType: warehouseInfo.type || '未分类仓库类型',
      department: maps.departmentMap.get(departmentKey) || '未匹配事业部',
      productLine: product.productLine || '未分类产品线',
      productSeries: product.productSeries || '未分类销售系列',
      warehouseLocation: warehouseInfo.location || '未分类仓库位置'
    };
    items.push(item);
    totalQty += qty;
    totalValue += value;
  }

  return {
    ...month,
    record,
    usedRows: items.length,
    qty: totalQty,
    amount: totalValue,
    totalQty,
    totalValue,
    items
  };
}

function buildFallbackPriceMap(inventoryMonthRecord, productMap) {
  const map = new Map();
  for (const [materialCode, product] of productMap.entries()) {
    if (product.settlementPrice) map.set(materialCode, product.settlementPrice);
  }
  const rows = rowsOf(inventoryMonthRecord);
  const priceAccessor = makeTrendPriceAccessor(rows[0]);
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(nthValue(row, 1));
    const price = toNumber(priceAccessor(row));
    if (materialCode && price) map.set(materialCode, price);
  }
  return map;
}

function makeTrendPriceAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeHeaderName(key) }));
  const preferred = normalized.find(({ text }) => text.includes('结算价') && text.includes('含税'))
    || normalized.find(({ text }) => text.includes('结算价'))
    || normalized.find(({ text }) => text.includes('含税') && text.includes('价'));
  return preferred ? (row) => row?.[preferred.key] : (row) => nthValue(row, 16);
}

function makeTrendQtyAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeHeaderName(key) }));
  const preferred = normalized.find(({ text }) => text.includes('结余库存数量'))
    || normalized.find(({ text }) => text.includes('结存') && text.includes('数量'))
    || normalized.find(({ text }) => text.includes('库存数量') && !text.includes('占比'))
    || normalized.find(({ text }) => text === '数量');
  return preferred ? (row) => row?.[preferred.key] : (row) => nthValue(row, 11);
}

function classifySaleStatus(warehouseType, productCategory) {
  const type = normalizeText(warehouseType);
  const category = normalizeText(productCategory);
  if (SALEABLE_NEW_WAREHOUSE_TYPES.has(type)) return '可售-全新品';
  if (RAW_MATERIAL_WAREHOUSE_TYPES.has(type)) return '不可售-原材料';
  if (OTHER_UNSALEABLE_WAREHOUSE_TYPES.has(type)) return '不可售-集成/在途/配件等';
  if (type.includes('销售退货拆检仓')) {
    if (SALEABLE_RETURN_CATEGORIES.has(category)) return '可售-已拆检';
    if (UNINSPECTED_RETURN_CATEGORIES.has(category)) return '不可售-未拆检';
    if (OTHER_UNSALEABLE_RETURN_CATEGORIES.has(category)) return '不可售-集成/在途/配件等';
  }
  return '';
}

export function getSalesRows(records) {
  const productMap = mapProducts(rowsOf(records['dim-product']));
  const storeMap = mapStoreInfo(rowsOf(records['dim-customer-material']));
  const departmentMap = mapSalesDepartments(rowsOf(records['dim-store-name']));
  return rowsOf(records['sales-data']).map((row) => {
    const materialCode = getSalesMaterialCode(row);
    const customer = getSalesCustomerName(row);
    const product = productMap.get(materialCode) || {};
    const salesMonth = getSalesMonth(row);
    const storeInfo = storeMap.get(normalizeStoreName(customer));
    const departmentKey = getSalesDepartmentKey(row);
    return {
      sourceRow: row,
      salesMonth,
      salesYear: salesMonth.slice(0, 4),
      salesMonthNumber: salesMonth.slice(5, 7),
      salesOrg: departmentMap.get(departmentKey) || '',
      customer,
      storeShortName: storeInfo?.shortName || customer,
      salesDepartmentKey: departmentKey,
      materialCode,
      materialName: getSalesMaterialName(row) || product.materialName || '',
      productLine: product.productLine || '',
      productCategory: product.productCategory || '',
      productSeries: product.productSeries || '',
      model: product.model || '',
      qty: getSalesReceivableQty(row),
      storeMatchStatus: storeInfo ? '已匹配' : '未匹配'
    };
  }).filter((row) => (row.customer || row.materialCode || row.model || row.qty) && !isExcludedSalesRow(row));
}

export function getCachedSalesRows(records) {
  const salesRecord = records['sales-data'];
  const productRecord = records['dim-product'];
  const storeRecord = records['dim-customer-material'];
  const departmentRecord = records['dim-store-name'];
  if (
    salesRowsCache.rows
    && salesRowsCache.salesRecord === salesRecord
    && salesRowsCache.productRecord === productRecord
    && salesRowsCache.storeRecord === storeRecord
    && salesRowsCache.departmentRecord === departmentRecord
  ) {
    return salesRowsCache.rows;
  }
  const rows = getSalesRows(records);
  salesRowsCache = {
    salesRecord,
    productRecord,
    storeRecord,
    departmentRecord,
    rows
  };
  return rows;
}

function mapStoreInfo(rows) {
  const map = new Map();
  for (const row of rows) {
    const rawName = firstText([
      nthValue(row, 2),
      firstValue(row, ['金蝶名称', '客户名称', '店铺名称', '店铺', '公司名称', '全称'])
    ]);
    const normalized = normalizeStoreName(rawName);
    if (!normalized || map.has(normalized)) continue;
    const shortName = firstText([
      firstValue(row, ['日常汇报沟通简称', '日常沟通简称', '汇报简称', '店铺简称', '简称']),
      firstValueByHeaderIncludes(row, ['日常', '简称']),
      firstValueByHeaderIncludes(row, ['汇报', '简称']),
      firstValueByHeaderIncludes(row, ['简称']),
      nthValue(row, 4),
      nthValue(row, 3),
      rawName
    ]);
    map.set(normalized, {
      rawName,
      shortName: normalizeText(shortName) || rawName
    });
  }
  return map;
}

function mapSalesDepartments(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeSalesDepartmentKey(firstText([
      firstValue(row, ['匹配键', '客户物料匹配键', '客户物料编码', '客户物料', '型号']),
      nthValue(row, 4)
    ]));
    const department = normalizeText(firstText([
      firstValue(row, ['销售部门', '部门', '事业部', '销售组织']),
      nthValue(row, 5)
    ]));
    if (key && department && !map.has(key)) map.set(key, department);
  }
  return map;
}

function getSalesMonth(row) {
  const rawValue = firstText([
    firstValue(row, ['销售月份', '月份', '销售月', '出库月份']),
    firstValue(row, ['销售日期', '出库日期', '单据日期', '审核日期', '日期']),
    firstValueByHeaderIncludes(row, ['月份'])
  ]);
  return formatSalesMonth(rawValue);
}

function getSalesDepartmentKey(row) {
  return normalizeSalesDepartmentKey(firstText([
    firstValue(row, ['客户物料编码', '客户物料', '型号', '销售部门匹配键']),
    nthValue(row, 12)
  ]));
}

function getSalesCustomerName(row) {
  return normalizeText(firstText([
    firstValue(row, ['客户名称', '客户', '店铺名称', '店铺']),
    nthValue(row, 2)
  ]));
}

function getSalesMaterialCode(row) {
  return normalizeMaterialCode(firstText([
    firstValue(row, ['物料编码', '货品编码', '商品编码', '产品编码', 'SKU', 'MSKU']),
    firstValueByHeaderIncludes(row, ['物料', '编码']),
    nthValue(row, 3)
  ]));
}

function getSalesMaterialName(row) {
  return normalizeText(firstText([
    firstValue(row, ['物料名称', '货品名称', '商品名称', '产品名称', '金蝶名称', '品名']),
    firstValueByHeaderIncludes(row, ['物料', '名称'])
  ]));
}

function getSalesReceivableQty(row) {
  return firstNumber([
    firstValue(row, ['应收数量', '销售数量', '数量', '出库数量']),
    nthValue(row, 9)
  ]);
}

function isExcludedSalesRow(row) {
  if (hasInternalTransaction(row)) return true;
  return [row.productLine, row.productCategory, row.productSeries].some((value) => EXCLUDED_SALES_PRODUCT_VALUES.has(normalizeSalesExclusionText(value)));
}

function hasInternalTransaction(row) {
  const knownValues = [
    row.customer,
    row.storeShortName,
    row.salesOrg,
    row.salesDepartmentKey,
    row.materialName,
    row.productLine,
    row.productCategory,
    row.productSeries,
    row.model
  ];
  if (knownValues.some(isInternalTransactionText)) return true;
  if (Array.isArray(row.sourceRow?.__cells)) {
    return row.sourceRow.__cells.some(isInternalTransactionText);
  }
  for (const [key, value] of Object.entries(row.sourceRow || {})) {
    if (key !== '__cells' && isInternalTransactionText(value)) return true;
  }
  return false;
}

function isInternalTransactionText(value) {
  const text = normalizeText(value);
  return text === '内部交易' || text.includes('内部交易');
}

function normalizeSalesExclusionText(value) {
  return normalizeText(value)
    .replace(/／/g, '/')
    .replace(/\s+/g, '');
}

function getAgeGroup(row) {
  const explicit = firstText([firstValue(row, ['库龄段', '库龄区间']), firstValueByHeaderIncludes(row, ['库龄段'])]);
  if (explicit) return explicit;
  const bucket = AGE_BUCKET_DEFINITIONS.find((definition) => getAgeQuantity(row, definition) !== 0);
  if (bucket) return bucket.label;
  const age = firstOptionalNumber([firstValue(row, ['库龄', '库龄天数', '账龄']), firstValueByHeaderIncludes(row, ['库龄'])]);
  if (age === null) return '0-30天';
  if (age > 150) return '150天以上';
  if (age > 120) return '121-150天';
  if (age > 90) return '91-120天';
  if (age > 60) return '61-90天';
  if (age > 30) return '31-60天';
  return '0-30天';
}

function getAgeQuantity(row, definition) {
  return firstOptionalNumber([
    ...definition.candidates.map((name) => firstValue(row, [name])),
    firstValueByHeaderIncludes(row, [definition.label, '数量'])
  ]) || 0;
}

function getMonth(row) {
  const raw = firstText([
    firstValue(row, ['月份', '库存月份', '关账月份']),
    firstValueByHeaderIncludes(row, ['月份'])
  ]);
  const text = normalizeText(raw);
  const matched = text.match(/(?:20\d{2})?\D?(1[0-2]|0?[1-9])\D?/);
  return matched ? `${Number(matched[1])}月` : '';
}

function formatSalesMonth(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const excelSerial = Number(text);
  if (Number.isFinite(excelSerial) && excelSerial > 20000 && excelSerial < 80000) {
    const date = new Date(Math.round((excelSerial - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const matched = text.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])/);
  if (matched) return `${matched[1]}-${String(Number(matched[2])).padStart(2, '0')}`;
  return text;
}

function normalizeDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, '').toLowerCase();
}

function normalizeSalesDepartmentKey(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
}

function normalizeStoreName(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[&＆]/g, '')
    .replace(/[()（）【】\[\]{}<>《》]/g, '')
    .replace(/[，,。.、；;：:\-_\s]/g, '')
    .toLowerCase();
}
