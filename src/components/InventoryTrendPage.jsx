import React, { useMemo } from 'react';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { formatNumber, getInventoryRows, groupBy, groupSum, moneyWan, recordSourceText, sum } from './kcfxUtils.js';
import { useKcfxRecordMap } from './kcfxRecordLoader.js';

export default function InventoryTrendPage({ kcfxData = null, kcfxRecords = {}, loading = false, error = '', lastLoadedAt = '', onRefresh }) {
  const { records: loadedRecords, loading: recordsLoading, error: recordsError, reload } = useKcfxRecordMap(kcfxData, INVENTORY_TREND_RECORD_IDS);
  const records = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageLoading = loading || recordsLoading;
  const pageError = recordsError || error;
  const rows = useMemo(() => getInventoryRows(records), [records]);
  const monthRows = useMemo(() => buildMonthRows(rows), [rows]);
  const totalAmount = useMemo(() => sum(rows, 'amount'), [rows]);
  const totalQty = useMemo(() => sum(rows, 'qty'), [rows]);
  const status = pageLoading
    ? '数据加载中...'
    : pageError || `参与趋势计算 ${formatNumber(rows.length)} 行，库存金额 ${moneyWan(totalAmount)}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;
  const refresh = async () => {
    await Promise.all([reload(), onRefresh?.()]);
  };

  return (
    <KcfxPageShell title="库存趋势分析" status={status} loading={pageLoading} onRefresh={refresh}>
      <MetricCards metrics={[
        { label: '库存金额', value: moneyWan(totalAmount) },
        { label: '库存数量', value: formatNumber(totalQty, 2) },
        { label: '趋势月份', value: formatNumber(monthRows.length) },
        { label: '最大月份金额', value: moneyWan(Math.max(...monthRows.map((row) => row.amount), 0)) }
      ]} />
      <PanelGrid>
        <BarPanel title="库存货值趋势" rows={monthRows.map((row) => ({ name: row.month, value: row.amount }))} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="库存数量趋势" rows={monthRows.map((row) => ({ name: row.month, value: row.qty }))} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="产品线库存趋势基础" rows={groupSum(rows, 'productLine', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
      </PanelGrid>
      <section className="kcfx-panel">
        <h3>趋势明细</h3>
        <SimpleTable
          rows={monthRows}
          columns={[
            { key: 'month', label: '月份' },
            { key: 'qty', label: '库存合计', render: (row) => formatNumber(row.qty, 2) },
            { key: 'amount', label: '库存金额合计', render: (row) => moneyWan(row.amount) }
          ]}
        />
      </section>
      <SourcePanel sources={[
        { label: '库存数据', value: recordSourceText(records['fact-2']) },
        { label: '商品分类维表', value: recordSourceText(records['dim-product']) }
      ]} />
    </KcfxPageShell>
  );
}

const INVENTORY_TREND_RECORD_IDS = ['fact-inventory', 'fact-2'];

function buildMonthRows(rows) {
  const source = rows.some((row) => row.month)
    ? rows
    : rows.map((row) => ({ ...row, month: '当前关账库存' }));
  return groupBy(source, 'month')
    .map(([month, items]) => ({ month, qty: sum(items, 'qty'), amount: sum(items, 'amount') }))
    .sort((a, b) => a.month.localeCompare(b.month, 'zh-CN'));
}
