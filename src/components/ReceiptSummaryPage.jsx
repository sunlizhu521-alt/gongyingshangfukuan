import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../constants.js';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { FilterToolbar, useDashboardFilters } from './KcfxFilters.jsx';
import { formatNumber, groupSum, moneyWan, recordSourceText, sum, uniqueCount } from './kcfxUtils.js';

const RECEIPT_FILTERS = [
  { id: 'receiptWarehouseType', field: 'warehouseType', allLabel: '全部仓库类型', sortByName: true, sortValueField: 'amount' },
  { id: 'receiptDepartment', field: 'department', allLabel: '全部事业部', sortValueField: 'amount' },
  { id: 'receiptAgeGroup', field: 'ageGroup', allLabel: '全部库龄', sortByName: true, sortValueField: 'amount' },
  { id: 'receiptSaleStatus', field: 'saleStatus', allLabel: '全部可售状态', sortValueField: 'amount' },
  { id: 'receiptProductCategory', field: 'productCategory', allLabel: '全部商品分类', sortValueField: 'amount' },
  { id: 'receiptProductLine', field: 'productLine', allLabel: '全部销售产品线', sortValueField: 'amount' },
  { id: 'receiptProductSeries', field: 'productSeries', allLabel: '全部销售系列', sortValueField: 'amount' },
  { id: 'receiptWarehouseLocation', field: 'warehouseLocation', allLabel: '全部仓库位置', sortValueField: 'amount' }
];
const RECEIPT_SEARCH_FIELDS = ['materialCode', 'materialName', 'warehouse', 'organization', 'department', 'warehouseType', 'saleStatus', 'productCategory', 'productLine', 'productSeries', 'warehouseLocation'];

export default function ReceiptSummaryPage({ kcfxData = null, kcfxRecords = {}, error = '', lastLoadedAt = '', onRefresh }) {
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const response = await fetch(`${API}/api/kcfx-library/receipt-summary`, { cache: 'no-store' });
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

  const records = summary?.records || kcfxRecords || {};
  const pageError = summaryError || error;
  const rows = useMemo(() => expandReceiptSummaryRows(summary), [summary]);
  const filterState = useDashboardFilters(rows, RECEIPT_FILTERS, { searchFields: RECEIPT_SEARCH_FIELDS, searchValue: search });
  const filteredRows = filterState.filteredRows;
  const totalAmount = useMemo(() => sum(filteredRows, 'amount'), [filteredRows]);
  const totalQty = useMemo(() => sum(filteredRows, 'qty'), [filteredRows]);
  const status = summaryLoading
    ? '数据加载中...'
    : pageError || `已读取 ${formatNumber(rows.length)} 行关账库存，筛选后 ${formatNumber(filteredRows.length)} 行，库存金额 ${moneyWan(totalAmount)}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;

  const refresh = async () => {
    await Promise.all([loadSummary(), onRefresh?.()]);
  };

  return (
    <KcfxPageShell title="关账库存分析" status={status} loading={summaryLoading} onRefresh={refresh}>
      <FilterToolbar
        filters={RECEIPT_FILTERS}
        searchValue={search}
        setSearchValue={setSearch}
        searchPlaceholder="搜索物料、仓库、事业部"
        {...filterState}
      />

      <MetricCards metrics={[
        { label: '库存金额合计', value: moneyWan(totalAmount) },
        { label: '库存合计', value: formatNumber(totalQty, 2) },
        { label: '物料数量', value: formatNumber(uniqueCount(filteredRows, 'materialCode')) },
        { label: '仓库数量', value: formatNumber(uniqueCount(filteredRows, 'warehouse')) },
        { label: '事业部数量', value: formatNumber(uniqueCount(filteredRows, 'department')) }
      ]} />

      <PanelGrid className="receipt-summary-amount-grid">
        <BarPanel title="仓库类型库存金额" rows={groupSum(filteredRows, 'warehouseType', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="库龄段库存金额" rows={groupSum(filteredRows, 'ageGroup', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="销售产品线库存金额" rows={groupSum(filteredRows, 'productLine', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="销售系列库存金额" rows={groupSum(filteredRows, 'productSeries', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
        <BarPanel title="仓库位置库存金额" rows={groupSum(filteredRows, 'warehouseLocation', 'amount', 10)} total={totalAmount} valueFormatter={moneyWan} />
      </PanelGrid>

      <section className="kcfx-panel">
        <h3>库存分析月份表</h3>
        <SimpleTable
          rows={filteredRows}
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
        { label: '库存分析月份表', value: recordSourceText(records['fact-2']) },
        { label: '商品分类维表', value: recordSourceText(records['dim-product']) },
        { label: '仓库维表', value: recordSourceText(records['dim-warehouse']) },
        { label: '仓库物料事业部对照表', value: recordSourceText(records['dim-warehouse-material']) }
      ]} />
    </KcfxPageShell>
  );
}

function expandReceiptSummaryRows(summary) {
  const fields = Array.isArray(summary?.rowFields) ? summary.rowFields : [];
  const compactRows = Array.isArray(summary?.rowsCompact) ? summary.rowsCompact : [];
  const ageBuckets = Array.isArray(summary?.ageBuckets) ? summary.ageBuckets : [];
  return compactRows.map((values) => {
    const row = {};
    fields.forEach((field, index) => {
      const value = values[index];
      if (field === 'ageQuantities' || field === 'ageSettlementAmounts') {
        row[field] = Object.fromEntries(ageBuckets.map((bucket, bucketIndex) => [bucket, Number(value?.[bucketIndex]) || 0]));
      } else {
        row[field] = value;
      }
    });
    const qty = Number(row.inventoryTotal || row.endingQty || row.ageQuantityTotal) || 0;
    const amount = Number(row.inventoryAmountTotal || row.settlementAmount || row.ageSettlementAmount) || 0;
    return {
      ...row,
      qty,
      amount,
      productSeries: row.productSeries || row.series || '',
      ageGroup: dominantAgeBucket(row.ageQuantities, row.ageSettlementAmounts)
    };
  });
}

function dominantAgeBucket(ageQuantities = {}, ageSettlementAmounts = {}) {
  const entries = Object.keys(ageQuantities).map((bucket) => ({
    bucket,
    value: Number(ageSettlementAmounts[bucket]) || Number(ageQuantities[bucket]) || 0
  }));
  return entries.sort((a, b) => b.value - a.value)[0]?.bucket || '';
}
