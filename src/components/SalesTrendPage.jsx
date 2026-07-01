import React, { useMemo, useState } from 'react';
import MultiFilter from './MultiFilter.jsx';
import MonthCalendarFilter from './MonthCalendarFilter.jsx';
import { BarPanel, KcfxPageShell, PanelGrid } from './KcfxCommon.jsx';
import { KCFX_COLORS, formatNumber, formatQuantity, getCachedSalesRows, groupSum, recordSourceText, sum } from './kcfxUtils.js';
import { useKcfxRecordMap } from './kcfxRecordLoader.js';

const TREND_YEARS = ['2025', '2026'];
const TREND_YEAR_COLORS = { 2025: '#007aff', 2026: '#34c759' };
const TREND_FILTERS = [
  { id: 'salesMonth', field: 'salesMonth', allLabel: '全部销售月份', monthAllLabel: '全部数据月份', matchMonthNumber: true, limit: 300 },
  { id: 'salesOrg', field: 'salesOrg', allLabel: '全部销售部门', limit: 300 },
  { id: 'storeShortName', field: 'storeShortName', allLabel: '店铺简称', limit: 300 },
  { id: 'productLine', field: 'productLine', allLabel: '全部销售产品线', limit: 300 },
  { id: 'productSeries', field: 'productSeries', allLabel: '全部销售系列', limit: 300 },
  { id: 'model', field: 'model', allLabel: '型号', limit: 300 }
];
const EMPTY_SELECTIONS = Object.fromEntries(TREND_FILTERS.map((filter) => [filter.id, []]));
const SALES_TREND_RECORD_IDS = ['sales-data', 'dim-product', 'dim-store-name', 'dim-customer-material'];

export default function SalesTrendPage({ kcfxData = null, kcfxRecords = {}, error = '', lastLoadedAt = '', onRefresh }) {
  const [openFilter, setOpenFilter] = useState('');
  const [selections, setSelections] = useState(EMPTY_SELECTIONS);
  const { records: loadedRecords, loading: recordsLoading, error: recordsError, reload } = useKcfxRecordMap(kcfxData, SALES_TREND_RECORD_IDS);
  const records = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageLoading = recordsLoading;
  const pageError = recordsError || error;

  const salesRows = useMemo(() => getCachedSalesRows(records), [records]);
  const trendRows = useMemo(() => (
    salesRows
      .filter((row) => TREND_YEARS.includes(row.salesYear) && row.salesMonthNumber)
  ), [salesRows]);

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
      const optionValues = new Set((linkedOptions[filter.id] || []).map((option) => option.value));
      return [filter.id, (selections[filter.id] || []).filter((value) => optionValues.has(value))];
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
      map.set(key, (map.get(key) || 0) + (Number(row.qty) || 0));
    }
    return map;
  }, [filteredRows]);

  const totalQty = sum(filteredRows, 'qty');
  const status = pageLoading
    ? '数据加载中...'
    : pageError || `已按销售数据日期列读取 ${formatNumber(trendRows.length)} 行，年份：${TREND_YEARS.join(' / ')}，应收数量合计 ${formatQuantity(sum(trendRows, 'qty'))}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;

  const refresh = async () => {
    await Promise.all([reload({ force: true }), onRefresh?.()]);
  };

  function setFilterValue(id, value) {
    setSelections((current) => ({ ...current, [id]: value }));
  }

  function clearFilters() {
    setSelections(EMPTY_SELECTIONS);
    setOpenFilter('');
  }

  return (
    <KcfxPageShell title="销售趋势变化" status={status} loading={pageLoading} onRefresh={refresh}>
      <section className="toolbar trend-filter-toolbar">
        <MonthCalendarFilter
          id="sales-trend-salesMonth"
          label="全部销售月份"
          allLabel="全部数据月份"
          selected={normalizedSelections.salesMonth || []}
          options={linkedOptions.salesMonth || []}
          onChange={(value) => setFilterValue('salesMonth', value)}
          openFilter={openFilter}
          setOpenFilter={setOpenFilter}
        />
        {TREND_FILTERS.filter((filter) => filter.id !== 'salesMonth').map((filter) => (
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

      <section className="trend-embed-panel analysis-section-trend">
        <div className="trend-chart-grid">
          <section className="panel trend-panel">
            <h2>
              销售趋势
              <span className="chart-total">合计 {formatQuantity(totalQty)}</span>
            </h2>
            <VerticalTrendChart months={months} grouped={groupedTrend} />
          </section>
        </div>
      </section>

      <PanelGrid>
        <BarPanel title="全部销售部门" rows={groupSum(filteredRows, 'salesOrg', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="店铺简称（日常汇报沟通简称）" rows={groupSum(filteredRows, 'storeShortName', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="销售产品线" rows={groupSum(filteredRows, 'productLine', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="销售系列" rows={groupSum(filteredRows, 'productSeries', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="型号" rows={groupSum(filteredRows, 'model', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
      </PanelGrid>

      <section className="data-source-panel sales-trend-source-panel">
        <div><strong>销售数据文件</strong>：{recordSourceText(records['sales-data'])}</div>
        <div><strong>商品分类维表</strong>：{recordSourceText(records['dim-product'])}</div>
        <div><strong>客户与物料对照表</strong>：{recordSourceText(records['dim-store-name'])}；销售数据文件 L 列匹配维表 D 列，取维表 E 列作为销售部门</div>
        <div><strong>店铺名称汇总（金蝶&领星&简称）</strong>：{recordSourceText(records['dim-customer-material'])}</div>
      </section>
    </KcfxPageShell>
  );
}

function VerticalTrendChart({ months, grouped }) {
  const values = months.flatMap((month) => TREND_YEARS.map((year) => grouped.get(`${year}-${month}`) || 0));
  const max = Math.max(...values, 1);

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
        <div className="trend-category">
          <div className="trend-bar-group">
            {months.length ? months.map((month) => (
              <div className="trend-yoy-month-group" title={`${Number(month)}月`} key={month}>
                <div className="trend-yoy-bars">
                  {TREND_YEARS.map((year, index) => {
                    const value = grouped.get(`${year}-${month}`) || 0;
                    return (
                      <div className="trend-bar-wrap trend-yoy-bar-wrap" title={`${year}年${Number(month)}月 ${formatQuantity(value)}`} key={year}>
                        <div
                          className="trend-bar"
                          style={{
                            height: `${Math.max(value ? 2 : 0, (value / max) * 100)}%`,
                            background: TREND_YEAR_COLORS[year] || KCFX_COLORS[index % KCFX_COLORS.length]
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
          <div className="trend-category-label">销售趋势</div>
        </div>
      </div>
    </div>
  );
}

function linkedFilterOptions(rows, targetFilter, selections) {
  const totals = new Map();
  for (const row of rows) {
    if (!rowMatchesSelections(row, selections, targetFilter.id)) continue;
    const name = String(row[targetFilter.field] || '').trim();
    if (!name) continue;
    totals.set(name, (totals.get(name) || 0) + (Number(row.qty) || 0));
  }
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([name]) => name);
}

function rowMatchesSelections(row, selections, excludedFilterId = '') {
  return TREND_FILTERS.every((filter) => {
    if (filter.id === excludedFilterId) return true;
    const selected = selections[filter.id] || [];
    if (!selected.length) return true;
    const value = String(row[filter.field] || '').trim();
    if (filter.matchMonthNumber) {
      const rowMonth = value.slice(5, 7);
      return selected.some((selectedValue) => String(selectedValue || '').trim().slice(5, 7) === rowMonth);
    }
    return selected.includes(value);
  });
}

function formatMonthLabel(value) {
  const [year, month] = String(value || '').split('-');
  return year && month ? `${year}年${Number(month)}月` : value;
}
