import React, { useMemo, useState } from 'react';
import MultiFilter from './MultiFilter.jsx';
import { useKcfxRecordMap } from './kcfxRecordLoader.js';

const COLORS = ['#007aff', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#5ac8fa', '#5856d6', '#30d158', '#bf5af2', '#ff6b35'];
const TREND_YEARS = ['2025', '2026'];
const TREND_YEAR_COLORS = { 2025: '#007aff', 2026: '#34c759' };
const EXCLUDED_SALES_PRODUCT_VALUES = new Set(['其他/配件', '健康办公', '护理床附件'].map(normalizeSalesExclusionText));

const TREND_FILTERS = [
  { id: 'salesMonth', field: 'salesMonth', allLabel: '全部销售月份', matchMonthNumber: true, limit: 300 },
  { id: 'salesOrg', field: 'salesOrg', allLabel: '全部销售部门', limit: 300 },
  { id: 'storeShortName', field: 'storeShortName', allLabel: '客户名称', limit: 300 },
  { id: 'productLine', field: 'productLine', allLabel: '全部销售产品线', limit: 300 },
  { id: 'productSeries', field: 'productSeries', allLabel: '全部销售系列', limit: 300 },
  { id: 'model', field: 'model', allLabel: '型号', limit: 300 }
];

const EMPTY_SELECTIONS = Object.fromEntries(TREND_FILTERS.map((filter) => [filter.id, []]));

export default function SalesTrendPage({
  kcfxData = null,
  kcfxRecords = {},
  loading = false,
  error = '',
  lastLoadedAt = '',
  onRefresh
}) {
  const [openFilter, setOpenFilter] = useState('');
  const [selections, setSelections] = useState(EMPTY_SELECTIONS);

  const { records: loadedRecords, loading: recordsLoading, error: recordsError, reload } = useKcfxRecordMap(kcfxData, SALES_TREND_RECORD_IDS);
  const records = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageLoading = loading || recordsLoading;
  const pageError = recordsError || error;
  const salesData = useMemo(() => buildSalesRows(records), [records]);
  const trendRows = useMemo(() => (
    salesData.rows
      .filter((row) => TREND_YEARS.includes(row.salesYear) && row.salesMonthNumber)
      .map((row) => ({ ...row, value: Number(row.qty) || 0 }))
  ), [salesData.rows]);

  const linkedOptions = useMemo(() => (
    Object.fromEntries(TREND_FILTERS.map((filter) => [
      filter.id,
      linkedFilterOptions(trendRows, filter, selections).map((value) => ({
        value,
        label: filter.id === 'salesMonth' ? formatMonthLabel(value) : value
      }))
    ]))
  ), [selections, trendRows]);

  const normalizedSelections = useMemo(() => (
    Object.fromEntries(TREND_FILTERS.map((filter) => {
      const options = new Set((linkedOptions[filter.id] || []).map((option) => option.value));
      return [filter.id, (selections[filter.id] || []).filter((value) => options.has(value))];
    }))
  ), [linkedOptions, selections]);

  const filteredRows = useMemo(() => (
    trendRows.filter((row) => rowMatchesSelections(row, normalizedSelections))
  ), [normalizedSelections, trendRows]);

  const months = useMemo(() => (
    [...new Set(filteredRows.map((row) => row.salesMonthNumber).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b))
  ), [filteredRows]);

  const groupedTrend = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      const key = `${row.salesYear}-${row.salesMonthNumber}`;
      map.set(key, (map.get(key) || 0) + (Number(row.value) || 0));
    }
    return map;
  }, [filteredRows]);

  const totalQty = useMemo(() => sum(filteredRows, 'value'), [filteredRows]);
  const statusText = buildPageStatus({ loading: pageLoading, error: pageError, salesData, trendRows, lastLoadedAt });
  const conditionLabel = buildSalesTrendConditionLabel(normalizedSelections);
  const refresh = async () => {
    await Promise.all([reload(), onRefresh?.()]);
  };

  function setFilterValue(id, value) {
    setSelections((current) => ({ ...current, [id]: value }));
  }

  function clearFilters() {
    setSelections(EMPTY_SELECTIONS);
    setOpenFilter('');
  }

  return (
    <section className="sales-trend-page">
      <header className="board-heading-row errors-heading">
        <div>
          <h2>销售趋势变化</h2>
          <p className="section-count">{statusText}</p>
        </div>
        <div className="errors-actions">
          <button type="button" onClick={refresh} disabled={pageLoading}>
            {pageLoading ? '读取中' : '应用刷新'}
          </button>
        </div>
      </header>

      <section className="trend-embed-panel analysis-section-trend">
        <div className="table-title-row">
          <div>
            <div className="table-title">销售趋势变化</div>
            <p className="status-line">
              已按销售数据日期列读取 {formatNumber(trendRows.length, 0)} 行，年份：{TREND_YEARS.join(' / ')}，应收数量合计 {formatQuantity(sum(trendRows, 'value'))}。
            </p>
          </div>
        </div>

        <section className="toolbar trend-filter-toolbar">
          {TREND_FILTERS.map((filter) => (
            <MultiFilter
              key={filter.id}
              id={`sales-trend-${filter.id}`}
              label={filter.allLabel}
              allLabel={filter.allLabel}
              options={linkedOptions[filter.id] || []}
              selected={normalizedSelections[filter.id] || []}
              onChange={(value) => setFilterValue(filter.id, value)}
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
            />
          ))}
          <button type="button" onClick={clearFilters}>清除所有筛选</button>
        </section>

        <section className="trend-chart-grid">
          <div className="panel trend-panel">
            <h2>
              销售趋势
              <span className="trend-condition">{conditionLabel}</span>
              <span className="chart-total">合计 {formatQuantity(totalQty)}</span>
            </h2>
            <VerticalTrendChart months={months} grouped={groupedTrend} selections={normalizedSelections} />
          </div>
        </section>

        <section className="dashboard-grid receipt-chart-grid sales-trend-dimension-grid">
          <BarPanel title="全部销售部门" rows={groupSum(filteredRows, 'salesOrg', 10)} />
          <BarPanel title="店铺简称（日常汇报沟通简称）" rows={groupSum(filteredRows, 'storeShortName', 10)} />
          <BarPanel title="销售产品线" rows={groupSum(filteredRows, 'productLine', 10)} />
          <BarPanel title="销售系列" rows={groupSum(filteredRows, 'productSeries', 10)} />
          <BarPanel title="型号" rows={groupSum(filteredRows, 'model', 10)} />
        </section>
      </section>

      <section className="data-source-panel sales-trend-source-panel">
        <div><strong>销售数据文件</strong>：{recordSourceText(records['sales-data'])}</div>
        <div><strong>商品分类维表</strong>：{recordSourceText(records['dim-product'])}</div>
        <div><strong>客户与物料对照表</strong>：{recordSourceText(records['dim-store-name'])}；销售数据文件 L 列匹配维表 D 列，取维表 E 列作为销售部门</div>
        <div><strong>店铺名称汇总（金蝶&领星&简称）</strong>：{recordSourceText(records['dim-customer-material'])}</div>
      </section>
    </section>
  );
}

const SALES_TREND_RECORD_IDS = ['sales-data'];

function VerticalTrendChart({ months, grouped, selections }) {
  const values = months.flatMap((month) => TREND_YEARS.map((year) => grouped.get(`${year}-${month}`) || 0));
  const max = Math.max(...values, 1);
  const label = getSalesInventoryTrendAggregateLabel(selections);

  return (
    <div className="vertical-trend-chart">
      <div className="trend-legend">
        {TREND_YEARS.map((year) => (
          <span key={year}><i style={{ background: TREND_YEAR_COLORS[year] }} />{year}年</span>
        ))}
      </div>
      <div
        className="trend-bars-vertical trend-one-row single-category sales-yoy-trend"
        style={{ '--trend-month-count': Math.max(months.length, 1) }}
        aria-label="2025年和2026年同月同比趋势"
      >
        <div className="trend-category" title={label}>
          <div className="trend-bar-group">
            {months.length ? months.map((month) => (
              <div className="trend-yoy-month-group" title={`${Number(month)}月`} key={month}>
                <div className="trend-yoy-bars">
                  {TREND_YEARS.map((year) => {
                    const value = grouped.get(`${year}-${month}`) || 0;
                    return (
                      <div className="trend-bar-wrap trend-yoy-bar-wrap" title={`${year}年${Number(month)}月 ${formatQuantity(value)}`} key={year}>
                        <div
                          className="trend-bar"
                          style={{
                            height: `${Math.max(value ? 2 : 0, (value / max) * 100)}%`,
                            background: TREND_YEAR_COLORS[year]
                          }}
                        >
                          <span className="trend-bar-value">{formatQuantity(value)}</span>
                        </div>
                        <span className="trend-year-label">{year.slice(2)}年</span>
                      </div>
                    );
                  })}
                </div>
                <span className="trend-month-label trend-yoy-month-label">{Number(month)}月</span>
              </div>
            )) : <div className="empty">暂无数据</div>}
          </div>
          <div className="trend-category-label">{label}</div>
        </div>
      </div>
    </div>
  );
}

function BarPanel({ title, rows }) {
  const total = rows.reduce((sumValue, row) => sumValue + row.value, 0);
  return (
    <div className="panel">
      <h2>{title} <span className="chart-total">合计 {formatQuantity(total)}</span></h2>
      <div className="chart-bars">
        {rows.length ? rows.map((row, index) => {
          const max = Math.max(...rows.map((item) => item.value), 1);
          const width = Math.max(2, (row.value / max) * 100);
          const valueText = `${formatQuantity(row.value)}（${formatPercent(row.value, total)}）`;
          return (
            <div className="bar-row" title={`${row.name} ${valueText}`} key={row.name}>
              <div className="bar-label">{row.name}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${width}%`, background: COLORS[index % COLORS.length] }} />
              </div>
              <div className="bar-value">{valueText}</div>
            </div>
          );
        }) : <div className="empty">暂无数据</div>}
      </div>
    </div>
  );
}

function buildSalesRows(records) {
  const salesRecord = records['sales-data'];
  if (!salesRecord) return { rows: [], message: '缺少销售数据文件，请先到销售数据文件页面上传并应用。' };
  if (!Array.isArray(salesRecord.rows) || !salesRecord.rows.length) {
    return { rows: [], message: '腾讯云已找到销售数据文件，但完整解析数据还未就绪，请稍后刷新。' };
  }

  const productMap = mapProducts(records['dim-product']?.rows || []);
  const salesDepartmentMap = mapSalesDepartments(records['dim-store-name']?.rows || []);
  const storeMap = mapStoreInfo(records['dim-customer-material']);
  const allSalesRows = (salesRecord.rows || []).map((row) => {
    const materialCode = getSalesMaterialCode(row);
    const customer = getSalesCustomerName(row);
    const product = productMap.get(materialCode) || {};
    const model = product.model || '';
    const qty = getSalesReceivableQty(row);
    const storeInfo = storeMap.get(normalizeStoreNameForSales(customer)) || null;
    const salesDepartmentKey = getSalesDepartmentKey(row);
    const salesMonth = getSalesMonth(row);
    return {
      salesMonth,
      salesYear: salesMonth.slice(0, 4),
      salesMonthNumber: salesMonth.slice(5, 7),
      salesOrg: salesDepartmentMap.get(salesDepartmentKey) || '',
      customer,
      storeShortName: storeInfo?.shortName || customer,
      salesDepartmentKey,
      sourceRow: row,
      materialCode,
      model,
      materialName: getSalesMaterialName(row) || product.materialName || '',
      productLine: product.productLine || '',
      productCategory: product.productCategory || '',
      productSeries: product.productSeries || '',
      qty,
      storeMatchStatus: storeInfo ? '已匹配' : '未匹配'
    };
  }).filter((row) => row.customer || row.materialCode || row.model || row.qty);

  return {
    rows: allSalesRows.filter((row) => !isExcludedSalesRow(row)),
    message: ''
  };
}

function buildPageStatus({ loading, error, salesData, trendRows, lastLoadedAt }) {
  if (loading) return '数据加载中...';
  if (error) return `读取失败：${error}`;
  if (salesData.message) return salesData.message;
  const loadedText = lastLoadedAt ? `；读取时间：${lastLoadedAt}` : '';
  return `已读取 ${formatNumber(salesData.rows.length, 0)} 行销售数据；参与趋势计算 ${formatNumber(trendRows.length, 0)} 行${loadedText}`;
}

function linkedFilterOptions(rows, targetFilter, selections) {
  const totals = new Map();
  for (const row of rows) {
    if (!rowMatchesSelections(row, selections, targetFilter.id)) continue;
    const name = normalizeText(row[targetFilter.field]);
    if (!name) continue;
    totals.set(name, (totals.get(name) || 0) + (Number(row.value) || 0));
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, targetFilter.limit || 300)
    .map(([name]) => name);
}

function rowMatchesSelections(row, selections, excludedFilterId = '') {
  return TREND_FILTERS.every((filter) => {
    if (filter.id === excludedFilterId) return true;
    const selected = selections[filter.id] || [];
    if (!selected.length) return true;
    const value = normalizeText(row[filter.field]);
    if (filter.matchMonthNumber) {
      const rowMonth = value.slice(5, 7);
      return selected.some((selectedValue) => normalizeText(selectedValue).slice(5, 7) === rowMonth);
    }
    return selected.includes(value);
  });
}

function groupSum(rows, key, limit = 10) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || '未分类';
    map.set(name, (map.get(name) || 0) + (Number(row.qty) || 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, limit);
}

function mapProducts(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ['物料编码']), nthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      model: normalizeText(nthValue(row, 16)),
      materialName: normalizeText(firstText([firstValue(row, ['金蝶名称', '物料名称', '货品名称']), nthValue(row, 4)])),
      productCategory: normalizeText(firstText([firstValue(row, ['销售产品分类', '产品分类', '销售产品类别', '产品类别', '品类'])])),
      productLine: normalizeText(firstText([firstValue(row, ['销售产品线', '产品线']), nthValue(row, 7)])),
      productSeries: normalizeText(firstText([firstValue(row, ['销售系列', '产品系列', '系列']), nthValue(row, 8)]))
    });
  }
  return map;
}

function mapStoreInfo(record) {
  const rows = record?.rows || [];
  const map = new Map();
  for (const row of rows) {
    const rawName = firstText([
      nthValue(row, 2),
      firstValue(row, ['金蝶名称', '客户名称', '店铺名称', '店铺', '公司名称', '全称'])
    ]);
    const normalized = normalizeStoreNameForSales(rawName);
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
  return [row.productLine, row.productCategory, row.productSeries].some((value) => {
    const text = normalizeSalesExclusionText(value);
    return EXCLUDED_SALES_PRODUCT_VALUES.has(text);
  });
}

function hasInternalTransaction(row) {
  const sourceValues = Array.isArray(row.sourceRow?.__cells)
    ? row.sourceRow.__cells
    : Object.entries(row.sourceRow || {}).filter(([key]) => key !== '__cells').map(([, value]) => value);
  const fields = [
    row.customer,
    row.storeShortName,
    row.salesOrg,
    row.salesDepartmentKey,
    row.materialName,
    row.productLine,
    row.productCategory,
    row.productSeries,
    row.model,
    ...sourceValues
  ];
  return fields.some(isInternalTransactionText);
}

function isInternalTransactionText(value) {
  const text = normalizeText(value);
  return text === '内部交易' || text.includes('内部交易');
}

function getSalesInventoryTrendAggregateLabel(selections) {
  const selected = TREND_FILTERS.flatMap((filter) => selections[filter.id] || []);
  if (!selected.length) return '全部销售趋势';
  if (selected.length === 1) return selected[0];
  return `已选${selected.length}项合计`;
}

function buildSalesTrendConditionLabel(selections) {
  const parts = [
    trendConditionPart(selections, 'salesOrg', '全部销售部门'),
    trendConditionPart(selections, 'storeShortName', '全部客户'),
    trendConditionPart(selections, 'productLine', '全部销售产品线'),
    trendConditionPart(selections, 'productSeries', '全部销售系列'),
    trendConditionPart(selections, 'model', '全部型号')
  ];
  return parts.filter(Boolean).join('-');
}

function trendConditionPart(selections, id, fallback) {
  const values = selections[id] || [];
  if (!values.length) return fallback;
  if (values.length <= 2) return values.join('、');
  return `已选${values.length}项`;
}

function recordSourceText(record) {
  if (!record) return '未引用';
  const time = record.appliedAt || record.savedAt ? formatRecordTime(record.appliedAt || record.savedAt) : '-';
  return `${record.fileName || record.title || '-'}；当前引用：${time}`;
}

function formatRecordTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function normalizeSalesExclusionText(value) {
  return normalizeText(value)
    .replace(/＆/g, '/')
    .replace(/\s+/g, '');
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

function formatMonthLabel(value) {
  const [year, month] = normalizeText(value).split('-');
  return year && month ? `${year}年${Number(month)}月` : value;
}

function normalizeSalesDepartmentKey(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
}

function normalizeStoreNameForSales(value) {
  return normalizeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[&＆]/g, '')
    .replace(/[()（）【】[\]{}<>《》]/g, '')
    .replace(/[，,、；;：:\-_\s]/g, '')
    .toLowerCase();
}

function firstText(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return '';
}

function firstNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    const value = toNumber(candidate);
    if (value !== 0 || text === '0') return value;
  }
  return 0;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  return numeric.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function formatPercent(value, total) {
  const denominator = Number(total) || 0;
  if (!denominator) return '0.00%';
  return `${((Number(value) || 0) / denominator * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function normalizeHeaderName(value) {
  return normalizeText(value)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeMaterialCode(value) {
  return normalizeText(value).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = normalizeText(value).replace(/[,\s￥元]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && normalizeText(row[name]) !== '') {
      return row[name];
    }
  }
  const wanted = names.map(normalizeHeaderName);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(normalizeHeaderName(key)) && normalizeText(value) !== '') {
      return value;
    }
  }
  return '';
}

function firstValueByHeaderIncludes(row, includeWords, excludeWords = []) {
  const includes = includeWords.map(normalizeHeaderName).filter(Boolean);
  const excludes = excludeWords.map(normalizeHeaderName).filter(Boolean);
  for (const [key, value] of Object.entries(row || {})) {
    const header = normalizeHeaderName(key);
    const hasAllWords = includes.every((word) => header.includes(word));
    const hasExcludedWord = excludes.some((word) => header.includes(word));
    if (hasAllWords && !hasExcludedWord && normalizeText(value) !== '') {
      return value;
    }
  }
  return '';
}

function nthValue(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  if (Array.isArray(row?.__cells)) {
    return row.__cells[index] ?? '';
  }
  return Object.entries(row || {})
    .filter(([key]) => key !== '__cells')
    .map(([, value]) => value)[index] ?? '';
}
