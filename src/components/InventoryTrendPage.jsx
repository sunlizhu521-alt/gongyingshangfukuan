import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../constants.js';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { FilterToolbar, useDashboardFilters } from './KcfxFilters.jsx';
import { INVENTORY_TREND_MONTHS, KCFX_COLORS, formatNumber, groupSum, moneyWan, recordSourceText, sum } from './kcfxUtils.js';

const INVENTORY_TREND_FILTERS = [
  { id: 'trendWarehouseType', field: 'warehouseType', allLabel: '全部仓库类型', sortByName: true, sortValueField: 'amount' },
  { id: 'trendDepartment', field: 'department', allLabel: '全部事业部', sortValueField: 'amount' },
  { id: 'trendProductLine', field: 'productLine', allLabel: '全部销售产品线', sortValueField: 'amount' },
  { id: 'trendProductSeries', field: 'productSeries', allLabel: '全部销售系列', sortValueField: 'amount' },
  { id: 'trendWarehouseLocation', field: 'warehouseLocation', allLabel: '全部仓库位置', sortValueField: 'amount' }
];

const INVENTORY_TREND_BAR_LIMIT = 1000;

export default function InventoryTrendPage({ kcfxData = null, kcfxRecords = {}, error = '', lastLoadedAt = '', onRefresh }) {
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const response = await fetch(`${API}/api/kcfx-library/trend-summary`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.message || payload?.error || 'summary not ready');
      setSummary(payload);
    } catch (loadError) {
      setSummaryError(loadError?.message || String(loadError));
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary, kcfxData?.savedAt]);

  const records = kcfxRecords || {};
  const pageError = summaryError || error;
  const monthRows = useMemo(() => expandTrendSummaryRows(summary), [summary]);
  const items = useMemo(() => monthRows.flatMap((row) => (row.items || []).map((item) => ({ ...item, month: row.label }))), [monthRows]);
  const filterState = useDashboardFilters(items, INVENTORY_TREND_FILTERS);
  const filteredItems = filterState.filteredRows;
  const filteredMonthRows = useMemo(() => (
    monthRows.map((row) => {
      const monthItems = filteredItems.filter((item) => item.month === row.label);
      return {
        ...row,
        items: monthItems,
        usedRows: monthItems.length,
        qty: sum(monthItems, 'qty'),
        amount: sum(monthItems, 'amount')
      };
    })
  ), [filteredItems, monthRows]);
  const totalAmount = useMemo(() => sum(filteredMonthRows, 'amount'), [filteredMonthRows]);
  const totalQty = useMemo(() => sum(filteredMonthRows, 'qty'), [filteredMonthRows]);
  const loadedMonthCount = monthRows.filter((row) => row.record).length;
  const status = summaryLoading
    ? '数据加载中...'
    : pageError || `已读取 ${loadedMonthCount}/${INVENTORY_TREND_MONTHS.length} 个月份文件，筛选后 ${formatNumber(filteredItems.length)} 行，库存货值 ${moneyWan(totalAmount)}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;

  const refresh = async () => {
    await Promise.all([loadSummary(), onRefresh?.()]);
  };

  return (
    <KcfxPageShell title="库存趋势分析" status={status} loading={summaryLoading} onRefresh={refresh}>
      <FilterToolbar filters={INVENTORY_TREND_FILTERS} {...filterState} />

      <MetricCards metrics={[
        { label: '库存货值', value: moneyWan(totalAmount) },
        { label: '库存数量', value: formatNumber(totalQty, 2) },
        { label: '趋势月份', value: formatNumber(loadedMonthCount) },
        { label: '最大月份金额', value: moneyWan(Math.max(...filteredMonthRows.map((row) => row.amount), 0)) }
      ]} />

      <section className="trend-embed-panel analysis-section-trend">
        <div className="trend-chart-grid inventory-trend-chart-grid">
          <section className="panel trend-panel">
            <h2>
              库存货值趋势
              <span className="chart-total">合计 {moneyWan(totalAmount)}</span>
            </h2>
            <MonthTrendChart rows={filteredMonthRows.map((row) => ({ ...row, value: row.amount }))} formatter={moneyWan} />
          </section>
          <section className="panel trend-panel">
            <h2>
              库存数量趋势
              <span className="chart-total">合计 {formatNumber(totalQty, 2)}</span>
            </h2>
            <MonthTrendChart rows={filteredMonthRows.map((row) => ({ ...row, value: row.qty }))} formatter={(value) => formatNumber(value, 2)} />
          </section>
        </div>
      </section>

      <PanelGrid className="inventory-trend-three-grid">
        <BarPanel title="事业部库存货值" rows={groupSum(filteredItems, 'department', 'amount', INVENTORY_TREND_BAR_LIMIT)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="销售产品线库存货值" rows={groupSum(filteredItems, 'productLine', 'amount', INVENTORY_TREND_BAR_LIMIT)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="仓库位置库存货值" rows={groupSum(filteredItems, 'warehouseLocation', 'amount', INVENTORY_TREND_BAR_LIMIT)} total={totalAmount} valueFormatter={moneyWan} />
      </PanelGrid>

      <section className="kcfx-panel">
        <h3>趋势明细</h3>
        <SimpleTable
          rows={filteredMonthRows}
          columns={[
            { key: 'label', label: '月份' },
            { key: 'usedRows', label: '参与行数', render: (row) => formatNumber(row.usedRows) },
            { key: 'qty', label: '库存合计', render: (row) => formatNumber(row.qty, 2) },
            { key: 'amount', label: '库存金额合计', render: (row) => moneyWan(row.amount) }
          ]}
        />
      </section>

      <SourcePanel sources={[
        ...monthRows.map((month) => ({ label: `${month.label}库存事实表`, value: recordSourceText(month.record) })),
        { label: '库存分析月份表', value: recordSourceText(records['fact-2']) },
        { label: '商品分类维表', value: recordSourceText(records['dim-product']) },
        { label: '仓库维表', value: recordSourceText(records['dim-warehouse']) },
        { label: '仓库物料事业部对照表', value: recordSourceText(records['dim-warehouse-material']) }
      ]} />
    </KcfxPageShell>
  );
}

function expandTrendSummaryRows(summary) {
  const rows = Array.isArray(summary?.monthSummaries) ? summary.monthSummaries : [];
  return rows.map((row, index) => ({
    ...row,
    label: `${index + 1}月`,
    amount: Number(row.amount ?? row.totalValue) || 0,
    qty: Number(row.qty ?? row.totalQty) || 0,
    usedRows: Number(row.usedRows) || 0,
    items: Array.isArray(row.items) ? row.items.map((item) => ({
      ...item,
      amount: Number(item.amount ?? item.value) || 0,
      value: Number(item.value ?? item.amount) || 0,
      qty: Number(item.qty) || 0
    })) : []
  }));
}

function MonthTrendChart({ rows, formatter }) {
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);

  return (
    <div className="vertical-trend-chart">
      <div
        className="trend-bars-vertical trend-one-row single-category"
        style={{ '--trend-month-count': Math.max(rows.length, 1) }}
      >
        <div className="trend-category">
          <div className="trend-bar-group">
            {rows.length ? rows.map((row, index) => {
              const value = Number(row.value) || 0;
              return (
                <div className="trend-bar-wrap" title={`${row.label} ${formatter(value)}`} key={row.id || row.label}>
                  <div
                    className="trend-bar"
                    style={{
                      height: `${Math.max(value ? 2 : 0, (value / max) * 100)}%`,
                      background: KCFX_COLORS[index % KCFX_COLORS.length]
                    }}
                  >
                    <span className="trend-bar-value">{formatter(value)}</span>
                  </div>
                </div>
              );
            }) : <div className="empty">暂无数据</div>}
          </div>
          <div className="trend-category-label">月份趋势</div>
        </div>
      </div>
      <div className="trend-month-axis" style={{ '--trend-month-count': Math.max(rows.length, 1) }}>
        {rows.map((row) => <span key={row.id || row.label}>{row.label}</span>)}
      </div>
    </div>
  );
}
