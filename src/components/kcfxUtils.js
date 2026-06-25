export const KCFX_COLORS = ['#007aff', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#5ac8fa', '#5856d6', '#30d158', '#bf5af2', '#ff6b35'];

export function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

export function normalizeHeaderName(value) {
  return normalizeText(value)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function normalizeMaterialCode(value) {
  return normalizeText(value).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');
}

export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = normalizeText(value).replace(/[,\s￥元]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
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

export function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

export function formatQuantity(value) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function moneyWan(value) {
  return `${formatNumber((Number(value) || 0) / 10000, 2)}万`;
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

export function mapProducts(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ['物料编码', '货品编码', '商品编码']), nthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      materialName: firstText([firstValue(row, ['金蝶名称', '物料名称', '货品名称', '商品名称']), nthValue(row, 4)]),
      productLine: firstText([firstValue(row, ['销售产品线', '产品线']), nthValue(row, 7)]),
      productSeries: firstText([firstValue(row, ['销售系列', '产品系列', '系列']), nthValue(row, 8)]),
      model: firstText([firstValue(row, ['型号', '规格型号']), nthValue(row, 16)]),
      department: firstText([firstValue(row, ['采购分组', '事业部']), nthValue(row, 22)]),
      settlementPrice: firstNumber([
        firstValue(row, ['结算价（含税）', '结算价(含税)', '结算价含税', '结算价', '内部结算价', '26年内部结算价', '2026年内部结算价']),
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
      type: firstText([firstValue(row, ['仓库类型', '结存类型', '类型']), nthValue(row, 7)]),
      location: firstText([firstValue(row, ['仓库位置', '结存位置', '位置']), nthValue(row, 8)])
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
  return rowsOf(records[recordId]).map((row) => enrichInventoryRow(row, { productMap, warehouseMap, departmentMap }))
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
    nthValue(row, 3)
  ]);
  const organization = firstText([firstValue(row, ['使用组织', '库存组织', '组织']), nthValue(row, 4)]);
  const qty = firstNumber([
    firstValue(row, ['关账结存库存', '合计库存数量', '合计数量', '合计', '0430结存库存数量', '结余库存数量']),
    firstValueByHeaderIncludes(row, ['结存', '库存']),
    firstValueByHeaderIncludes(row, ['合计', '库存', '数量']),
    firstValueByHeaderIncludes(row, ['合计', '数量'])
  ]);
  const product = maps.productMap.get(materialCode) || {};
  const warehouseInfo = maps.warehouseMap.get(warehouse) || {};
  const price = firstNumber([
    firstValue(row, ['结算价（含税）', '结算价(含税)', '结算价含税', '结算价']),
    firstValueByHeaderIncludes(row, ['结算价']),
    product.settlementPrice
  ]);
  const amount = firstNumber([
    firstValue(row, ['库存金额', '金额合计', '库存货值', '货值']),
    firstValueByHeaderIncludes(row, ['库存', '金额']),
    firstValueByHeaderIncludes(row, ['货值'])
  ]) || qty * price;
  const departmentKey = normalizeDepartmentKey(`${organization}${warehouse}${materialCode}`);
  return {
    sourceRow: row,
    materialCode,
    warehouse,
    organization,
    qty,
    price,
    amount,
    materialName: product.materialName || firstText([firstValue(row, ['物料名称', '货品名称', '商品名称', '金蝶名称']), nthValue(row, 2)]),
    productLine: product.productLine || '未分类产品线',
    productSeries: product.productSeries || '未分类系列',
    model: product.model || '',
    warehouseType: warehouseInfo.type || '未分类仓库类型',
    warehouseLocation: warehouseInfo.location || '未分类仓库位置',
    department: maps.departmentMap.get(departmentKey) || product.department || organization || '未匹配事业部',
    ageGroup: getAgeGroup(row),
    month: getMonth(row)
  };
}

export function getSalesRows(records) {
  const productMap = mapProducts(rowsOf(records['dim-product']));
  const storeMap = mapStoreInfo(rowsOf(records['dim-customer-material']));
  const departmentMap = mapSalesDepartments(rowsOf(records['dim-store-name']));
  return rowsOf(records['sales-data']).map((row) => {
    const materialCode = normalizeMaterialCode(firstText([
      firstValue(row, ['物料编码', '货品编码', '商品编码', '产品编码', 'SKU', 'MSKU']),
      firstValueByHeaderIncludes(row, ['物料', '编码']),
      nthValue(row, 3)
    ]));
    const customer = firstText([firstValue(row, ['客户名称', '客户', '店铺名称', '店铺']), nthValue(row, 2)]);
    const product = productMap.get(materialCode) || {};
    const salesMonth = formatSalesMonth(firstText([
      firstValue(row, ['销售月份', '月份', '销售月', '出库月份']),
      firstValue(row, ['销售日期', '出库日期', '单据日期', '审核日期', '日期']),
      firstValueByHeaderIncludes(row, ['月份'])
    ]));
    const storeInfo = storeMap.get(normalizeStoreName(customer));
    const departmentKey = normalizeStoreName(firstText([firstValue(row, ['客户物料编码', '客户物料', '型号', '销售部门匹配键']), nthValue(row, 12)]));
    return {
      sourceRow: row,
      salesMonth,
      salesYear: salesMonth.slice(0, 4),
      salesMonthNumber: salesMonth.slice(5, 7),
      salesOrg: departmentMap.get(departmentKey) || firstText([firstValue(row, ['销售部门', '部门', '事业部'])]),
      customer,
      storeShortName: storeInfo?.shortName || customer,
      materialCode,
      materialName: firstText([firstValue(row, ['物料名称', '货品名称', '商品名称', '产品名称', '金蝶名称', '品名']), product.materialName]),
      productLine: product.productLine || '未分类产品线',
      productSeries: product.productSeries || '未分类系列',
      model: product.model || firstText([firstValue(row, ['型号', '规格型号'])]),
      qty: firstNumber([firstValue(row, ['应收数量', '销售数量', '数量', '出库数量']), nthValue(row, 9)])
    };
  }).filter((row) => row.customer || row.materialCode || row.qty);
}

function mapStoreInfo(rows) {
  const map = new Map();
  for (const row of rows) {
    const rawName = firstText([nthValue(row, 2), firstValue(row, ['金蝶名称', '客户名称', '店铺名称', '店铺', '公司名称', '全称'])]);
    const normalized = normalizeStoreName(rawName);
    if (!normalized || map.has(normalized)) continue;
    map.set(normalized, {
      rawName,
      shortName: firstText([
        firstValue(row, ['日常汇报沟通简称', '日常沟通简称', '汇报简称', '店铺简称', '简称']),
        firstValueByHeaderIncludes(row, ['日常', '简称']),
        firstValueByHeaderIncludes(row, ['简称']),
        nthValue(row, 4),
        rawName
      ])
    });
  }
  return map;
}

function mapSalesDepartments(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeStoreName(firstText([firstValue(row, ['匹配键', '客户物料匹配键', '客户物料编码', '客户物料', '型号']), nthValue(row, 4)]));
    const department = firstText([firstValue(row, ['销售部门', '部门', '事业部', '销售组织']), nthValue(row, 5)]);
    if (key && department && !map.has(key)) map.set(key, department);
  }
  return map;
}

function getAgeGroup(row) {
  const explicit = firstText([firstValue(row, ['库龄段', '库龄区间']), firstValueByHeaderIncludes(row, ['库龄段'])]);
  if (explicit) return explicit;
  const age = firstNumber([firstValue(row, ['库龄', '库龄天数', '账龄']), firstValueByHeaderIncludes(row, ['库龄'])]);
  if (age > 120) return '120天以上';
  if (age > 90) return '91-120天';
  if (age > 60) return '61-90天';
  if (age > 30) return '31-60天';
  return '0-30天';
}

function getMonth(row) {
  const raw = firstText([
    firstValue(row, ['月份', '库存月份', '关账月份']),
    firstValueByHeaderIncludes(row, ['月份'])
  ]);
  const text = normalizeText(raw);
  const matched = text.match(/(?:20\d{2})?\D?(1[0-2]|0?[1-9])\D?/);
  return matched ? String(Number(matched[1])).padStart(2, '0') : '';
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

function normalizeStoreName(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[&＆]/g, '')
    .replace(/[()（）【】\[\]{}<>《》]/g, '')
    .replace(/[，,、；;：:\-_\s]/g, '')
    .toLowerCase();
}
