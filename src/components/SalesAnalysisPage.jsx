import React, { useMemo, useState } from 'react';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { FilterToolbar, useDashboardFilters } from './KcfxFilters.jsx';
import { formatNumber, getCachedSalesRows, groupSum, recordSourceText, sum, uniqueCount } from './kcfxUtils.js';
import { useKcfxRecordMap } from './kcfxRecordLoader.js';

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

export default function SalesAnalysisPage({ kcfxData = null, kcfxRecords = {}, error = '', lastLoadedAt = '', onRefresh }) {
  const [search, setSearch] = useState('');
  const { records: loadedRecords, loading: recordsLoading, error: recordsError, reload } = useKcfxRecordMap(kcfxData, SALES_ANALYSIS_RECORD_IDS);
  const records = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageError = recordsError || error;
  const rows = useMemo(() => getCachedSalesRows(records), [records]);
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
        <h3>销售数据明细</h3>
        <SimpleTable
          rows={filteredRows}
          maxRows={150}
          columns={[
            { key: 'salesMonth', label: '销售月份' },
            { key: 'salesOrg', label: '销售部门' },
            { key: 'storeShortName', label: '店铺简称' },
            { key: 'productLine', label: '销售产品线' },
            { key: 'productSeries', label: '销售系列' },
            { key: 'model', label: '型号' },
            { key: 'qty', label: '销售数量', render: (row) => formatNumber(row.qty, 2) }
          ]}
        />
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
