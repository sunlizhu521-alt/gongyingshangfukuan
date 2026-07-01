import React, { useCallback, useMemo, useState } from 'react';
import { API } from '../constants.js';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { FilterToolbar, useDashboardFilters } from './KcfxFilters.jsx';
import { downloadKcfxRowsAsXlsx } from './kcfxExport.js';
import { formatNumber, getCachedSalesRows, groupSum, recordSourceText, sum, uniqueCount } from './kcfxUtils.js';
import { useKcfxRecordMap, useKcfxSalesRows } from './kcfxRecordLoader.js';

const SALES_ANALYSIS_RECORD_IDS = ['sales-data', 'dim-product', 'dim-store-name', 'dim-customer-material'];
const SALES_FILTERS = [
  { id: 'salesMonth', field: 'salesMonth', allLabel: '全部销售月份', monthAllLabel: '全部数据月份', type: 'month', sortByName: true, matchMonthNumber: true, sortValueField: 'qty' },
  { id: 'salesOrg', field: 'salesOrg', allLabel: '全部销售部门', sortValueField: 'qty' },
  { id: 'storeShortName', field: 'storeShortName', allLabel: '店铺简称', sortValueField: 'qty' },
  { id: 'productLine', field: 'productLine', allLabel: '全部销售产品线', sortValueField: 'qty' },
  { id: 'productSeries', field: 'productSeries', allLabel: '全部销售系列', sortValueField: 'qty' },
  { id: 'model', field: 'model', allLabel: '型号', limit: 300, sortValueField: 'qty' }
];
const SALES_SEARCH_FIELDS = ['customer', 'storeShortName', 'model', 'materialCode', 'materialName', 'salesOrg', 'productLine', 'productSeries'];
const SALES_TABLE_COLUMNS = [
  { key: 'salesMonth', label: '销售月份' },
  { key: 'salesOrg', label: '销售部门' },
  { key: 'storeShortName', label: '店铺简称' },
  { key: 'productLine', label: '销售产品线' },
  { key: 'productSeries', label: '销售系列' },
  { key: 'model', label: '型号' },
  { key: 'qty', label: '销售数量', render: (row) => formatNumber(row.qty, 2), exportValue: (row) => Number(row.qty) || 0 }
];

export default function SalesAnalysisPage({ user = null, kcfxData = null, kcfxRecords = {}, error = '', lastLoadedAt = '', onRefresh }) {
  const [search, setSearch] = useState('');
  const [feedbackDrafts, setFeedbackDrafts] = useState({});
  const salesRowsResult = useKcfxSalesRows(kcfxData);
  const shouldUseFallbackRecords = salesRowsResult.loaded && !salesRowsResult.loading && salesRowsResult.rows.length === 0;
  const fallbackRecordsResult = useKcfxRecordMap(kcfxData, shouldUseFallbackRecords ? SALES_ANALYSIS_RECORD_IDS : []);
  const fallbackRows = shouldUseFallbackRecords
    ? getCachedSalesRows({ ...kcfxRecords, ...fallbackRecordsResult.records })
    : [];
  const rows = salesRowsResult.rows.length
    ? salesRowsResult.rows
    : fallbackRows;
  const usingFallbackRows = !salesRowsResult.rows.length && fallbackRows.length > 0;
  const loadedRecords = salesRowsResult.rows.length ? salesRowsResult.records : fallbackRecordsResult.records;
  const recordsLoading = salesRowsResult.loading || fallbackRecordsResult.loading;
  const recordsError = usingFallbackRows ? fallbackRecordsResult.error : (salesRowsResult.error || fallbackRecordsResult.error);
  const reload = async ({ force = false } = {}) => {
    const result = await salesRowsResult.reload({ force });
    if (!Array.isArray(result?.rows) || result.rows.length === 0) {
      await fallbackRecordsResult.reload({ force });
    }
    return result;
  };
  const records = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageError = recordsError || error;
  const latestSalesMonth = useMemo(() => (
    [...new Set(rows.map((row) => row.salesMonth).filter(Boolean))].sort().at(-1) || ''
  ), [rows]);
  const defaultSelections = useMemo(() => (
    latestSalesMonth ? { salesMonth: [latestSalesMonth] } : {}
  ), [latestSalesMonth]);
  const filterState = useDashboardFilters(rows, SALES_FILTERS, { searchFields: SALES_SEARCH_FIELDS, searchValue: search, defaultSelections });
  const filteredRows = filterState.filteredRows;
  const totalQty = useMemo(() => sum(filteredRows, 'qty'), [filteredRows]);
  const status = recordsLoading
    ? '数据加载中...'
    : pageError || `已读取 ${formatNumber(rows.length)} 行月度销售数据，筛选后 ${formatNumber(filteredRows.length)} 行，应收数量 ${formatNumber(totalQty, 2)}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;

  const refresh = async () => {
    await Promise.all([reload({ force: true }), onRefresh?.()]);
  };

  const downloadSalesRows = useCallback(() => {
    downloadKcfxRowsAsXlsx('月度销售数据', filteredRows, SALES_TABLE_COLUMNS, '月度销售数据');
  }, [filteredRows]);

  const salesFeedbackKey = useCallback((row) => (
    [row.salesMonth, row.salesOrg, row.storeShortName, row.materialCode, row.model].filter(Boolean).join('|')
  ), []);

  const updateSalesFeedbackDraft = useCallback((row, value) => {
    const key = salesFeedbackKey(row);
    setFeedbackDrafts((current) => ({ ...current, [key]: value }));
  }, [salesFeedbackKey]);

  const submitSalesFeedback = useCallback(async (row) => {
    const rowKey = salesFeedbackKey(row);
    const feedback = feedbackDrafts[rowKey] || '';
    if (!feedback.trim()) return;
    const rowSummary = [row.salesMonth, row.storeShortName, row.model].filter(Boolean).join(' / ');
    const response = await fetch(`${API}/api/kcfx-feedback/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: user?.name,
        feedback,
        rowKey,
        rowSummary,
        rowData: {
          salesMonth: row.salesMonth,
          salesOrg: row.salesOrg,
          storeShortName: row.storeShortName,
          productLine: row.productLine,
          productSeries: row.productSeries,
          model: row.model,
          materialCode: row.materialCode,
          materialName: row.materialName,
          customer: row.customer,
          qty: Number(row.qty) || 0
        }
      })
    });
    if (!response.ok) {
      window.alert('反馈提交失败，请稍后重试');
      return;
    }
    setFeedbackDrafts((current) => ({ ...current, [rowKey]: '' }));
    window.alert('反馈已提交');
  }, [feedbackDrafts, salesFeedbackKey, user?.name]);

  const salesTableColumns = useMemo(() => [
    ...SALES_TABLE_COLUMNS,
    {
      key: 'feedbackText',
      label: '问题反馈',
      render: (row) => {
        const key = salesFeedbackKey(row);
        return (
          <input
            className="table-input kcfx-feedback-input"
            value={feedbackDrafts[key] || ''}
            onChange={(event) => updateSalesFeedbackDraft(row, event.target.value)}
            placeholder="填写问题反馈"
          />
        );
      }
    },
    {
      key: 'feedbackAction',
      label: '操作',
      render: (row) => (
        <button
          type="button"
          className="ghost compact-button"
          onClick={() => submitSalesFeedback(row)}
          disabled={!String(feedbackDrafts[salesFeedbackKey(row)] || '').trim()}
        >
          提交
        </button>
      )
    }
  ], [feedbackDrafts, salesFeedbackKey, submitSalesFeedback, updateSalesFeedbackDraft]);

  return (
    <KcfxPageShell title="月度销售数据" status={status} loading={recordsLoading} onRefresh={refresh}>
      <FilterToolbar
        filters={SALES_FILTERS}
        searchValue={search}
        setSearchValue={setSearch}
        searchPlaceholder="搜索客户、型号、物料"
        {...filterState}
      />

      <MetricCards metrics={[
        { label: '销售数量', value: formatNumber(totalQty, 2) },
        { label: '销售月份', value: formatNumber(uniqueCount(filteredRows, 'salesMonth')) },
        { label: '销售部门', value: formatNumber(uniqueCount(filteredRows, 'salesOrg')) },
        { label: '店铺简称', value: formatNumber(uniqueCount(filteredRows, 'storeShortName')) },
        { label: '物料数量', value: formatNumber(uniqueCount(filteredRows, 'materialCode')) }
      ]} />
      <PanelGrid>
        <BarPanel title="全部销售部门" rows={groupSum(filteredRows, 'salesOrg', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="店铺简称（日常汇报沟通简称）" rows={groupSum(filteredRows, 'storeShortName', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="销售产品线" rows={groupSum(filteredRows, 'productLine', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="销售系列" rows={groupSum(filteredRows, 'productSeries', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="型号" rows={groupSum(filteredRows, 'model', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
      </PanelGrid>
      <section className="kcfx-panel">
        <div className="table-title-row">
          <h3>销售数据明细</h3>
          <button type="button" className="ghost compact-button" onClick={downloadSalesRows} disabled={recordsLoading || !filteredRows.length}>
            导出
          </button>
        </div>
        <SimpleTable rows={filteredRows} maxRows={150} columns={salesTableColumns} />
      </section>
      <SourcePanel sources={[
        { label: '销售数据文件', value: recordSourceText(records['sales-data']) },
        { label: '商品分类维表', value: recordSourceText(records['dim-product']) },
        { label: '店铺简称维表', value: recordSourceText(records['dim-customer-material']) },
        { label: '销售部门维表', value: recordSourceText(records['dim-store-name']) }
      ]} />
    </KcfxPageShell>
  );
}
