import React, { useMemo } from 'react';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { formatNumber, getClosedInventoryRows, groupSum, moneyWan, recordSourceText, sum, uniqueCount } from './kcfxUtils.js';

export default function ReceiptSummaryPage({ kcfxData = null, kcfxRecords = {}, loading = false, error = '', lastLoadedAt = '', onRefresh }) {
  const records = useMemo(() => kcfxData?.records || kcfxRecords || {}, [kcfxData, kcfxRecords]);
  const rows = useMemo(() => getClosedInventoryRows(records), [records]);
  const totalAmount = useMemo(() => sum(rows, 'amount'), [rows]);
  const totalQty = useMemo(() => sum(rows, 'qty'), [rows]);
  const status = loading
    ? '数据加载中...'
    : error || `已读取 ${formatNumber(rows.length)} 行关账库存，库存金额 ${moneyWan(totalAmount)}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;

  return (
    <KcfxPageShell title="关账库存分析" status={status} loading={loading} onRefresh={onRefresh}>
      <MetricCards metrics={[
        { label: '库存金额合计', value: moneyWan(totalAmount) },
        { label: '库存合计', value: formatNumber(totalQty, 2) },
        { label: '物料数量', value: formatNumber(uniqueCount(rows, 'materialCode')) },
        { label: '仓库数量', value: formatNumber(uniqueCount(rows, 'warehouse')) },
        { label: '事业部数量', value: formatNumber(uniqueCount(rows, 'department')) }
      ]} />

      <PanelGrid>
        <BarPanel title="仓库类型库存金额" rows={groupSum(rows, 'warehouseType', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="库龄段库存金额" rows={groupSum(rows, 'ageGroup', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="销售产品线库存金额" rows={groupSum(rows, 'productLine', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="销售系列库存金额" rows={groupSum(rows, 'productSeries', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="仓库位置库存金额" rows={groupSum(rows, 'warehouseLocation', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
      </PanelGrid>

      <section className="kcfx-panel">
        <h3>库存分析月份表</h3>
        <SimpleTable
          rows={rows}
          maxRows={120}
          columns={[
            { key: 'department', label: '事业部' },
            { key: 'productLine', label: '销售产品线' },
            { key: 'productSeries', label: '销售系列' },
            { key: 'materialCode', label: '物料编码' },
            { key: 'materialName', label: '物料名称' },
            { key: 'warehouse', label: '仓库' },
            { key: 'qty', label: '关账结存库存', render: (row) => formatNumber(row.qty, 2) },
            { key: 'amount', label: '库存金额合计', render: (row) => moneyWan(row.amount) }
          ]}
        />
      </section>

      <SourcePanel sources={[
        { label: '最近关账库存', value: recordSourceText(records['fact-inventory']) },
        { label: '商品分类维表', value: recordSourceText(records['dim-product']) },
        { label: '仓库维表', value: recordSourceText(records['dim-warehouse']) },
        { label: '仓库物料事业部对照表', value: recordSourceText(records['dim-warehouse-material']) }
      ]} />
    </KcfxPageShell>
  );
}
