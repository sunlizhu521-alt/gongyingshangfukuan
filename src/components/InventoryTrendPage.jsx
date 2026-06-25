import React, { useMemo } from 'react';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { INVENTORY_TREND_MONTHS, buildInventoryTrendRows, formatNumber, groupSum, moneyWan, recordSourceText, sum } from './kcfxUtils.js';
import { useKcfxRecordMap } from './kcfxRecordLoader.js';

export default function InventoryTrendPage({ kcfxData = null, kcfxRecords = {}, loading = false, error = '', lastLoadedAt = '', onRefresh }) {
  const { records: loadedRecords, loading: recordsLoading, error: recordsError, reload } = useKcfxRecordMap(kcfxData, INVENTORY_TREND_RECORD_IDS);
  const records = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageLoading = loading || recordsLoading;
  const pageError = recordsError || error;
  const monthRows = useMemo(() => buildInventoryTrendRows(records), [records]);
  const items = useMemo(() => monthRows.flatMap((row) => row.items || []), [monthRows]);
  const totalAmount = useMemo(() => sum(monthRows, 'amount'), [monthRows]);
  const totalQty = useMemo(() => sum(monthRows, 'qty'), [monthRows]);
  const status = pageLoading
    ? '数据加载中...'
    : pageError || `已读取 ${monthRows.filter((row) => row.record).length}/${INVENTORY_TREND_MONTHS.length} 个月份文件，参与趋势计算 ${formatNumber(items.length)} 行，库存货值 ${moneyWan(totalAmount)}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;
  const refresh = async () => {
    await Promise.all([reload(), onRefresh?.()]);
  };

  return (
    <KcfxPageShell title="库存趋势分析" status={status} loading={pageLoading} onRefresh={refresh}>
      <MetricCards metrics={[
        { label: '库存货值', value: moneyWan(totalAmount) },
        { label: '库存数量', value: formatNumber(totalQty, 2) },
        { label: '趋势月份', value: formatNumber(monthRows.filter((row) => row.record).length) },
        { label: '最大月份金额', value: moneyWan(Math.max(...monthRows.map((row) => row.amount), 0)) }
      ]} />

      <PanelGrid>
        <BarPanel title="库存货值趋势" rows={monthRows.map((row) => ({ name: row.label, value: row.amount }))} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="库存数量趋势" rows={monthRows.map((row) => ({ name: row.label, value: row.qty }))} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="事业部库存货值" rows={groupSum(items, 'department', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="销售产品线库存货值" rows={groupSum(items, 'productLine', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="仓库位置库存货值" rows={groupSum(items, 'warehouseLocation', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
      </PanelGrid>

      <section className="kcfx-panel">
        <h3>趋势明细</h3>
        <SimpleTable
          rows={monthRows}
          columns={[
            { key: 'label', label: '月份' },
            { key: 'usedRows', label: '参与行数', render: (row) => formatNumber(row.usedRows) },
            { key: 'qty', label: '库存合计', render: (row) => formatNumber(row.qty, 2) },
            { key: 'amount', label: '库存金额合计', render: (row) => moneyWan(row.amount) }
          ]}
        />
      </section>

      <SourcePanel sources={[
        ...INVENTORY_TREND_MONTHS.map((month) => ({ label: `${month.label}库存事实表`, value: recordSourceText(records[month.id]) })),
        { label: '库存分析月份表', value: recordSourceText(records['fact-2']) },
        { label: '商品分类维表', value: recordSourceText(records['dim-product']) },
        { label: '仓库维表', value: recordSourceText(records['dim-warehouse']) },
        { label: '仓库物料事业部对照表', value: recordSourceText(records['dim-warehouse-material']) }
      ]} />
    </KcfxPageShell>
  );
}

const INVENTORY_TREND_RECORD_IDS = ['fact-2', 'fact-3', 'fact-4', 'fact-5', 'fact-6', 'fact-7', 'dim-product', 'dim-warehouse', 'dim-warehouse-material'];
