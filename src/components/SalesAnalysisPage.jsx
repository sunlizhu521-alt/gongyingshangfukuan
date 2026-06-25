import React, { useMemo } from 'react';
import { BarPanel, KcfxPageShell, MetricCards, PanelGrid, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { formatNumber, getSalesRows, groupSum, recordSourceText, sum, uniqueCount } from './kcfxUtils.js';
import { useKcfxRecordMap } from './kcfxRecordLoader.js';

export default function SalesAnalysisPage({ kcfxData = null, kcfxRecords = {}, loading = false, error = '', lastLoadedAt = '', onRefresh }) {
  const { records: loadedRecords, loading: recordsLoading, error: recordsError, reload } = useKcfxRecordMap(kcfxData, SALES_ANALYSIS_RECORD_IDS);
  const records = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageLoading = loading || recordsLoading;
  const pageError = recordsError || error;
  const rows = useMemo(() => getSalesRows(records), [records]);
  const totalQty = useMemo(() => sum(rows, 'qty'), [rows]);
  const status = pageLoading
    ? '数据加载中...'
    : pageError || `已读取 ${formatNumber(rows.length)} 行月度销售数据，应收数量 ${formatNumber(totalQty, 2)}${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;
  const refresh = async () => {
    await Promise.all([reload(), onRefresh?.()]);
  };

  return (
    <KcfxPageShell title="月度销售数据" status={status} loading={pageLoading} onRefresh={refresh}>
      <MetricCards metrics={[
        { label: '销售数量', value: formatNumber(totalQty, 2) },
        { label: '销售月份', value: formatNumber(uniqueCount(rows, 'salesMonth')) },
        { label: '销售部门', value: formatNumber(uniqueCount(rows, 'salesOrg')) },
        { label: '店铺简称', value: formatNumber(uniqueCount(rows, 'storeShortName')) },
        { label: '物料数量', value: formatNumber(uniqueCount(rows, 'materialCode')) }
      ]} />
      <PanelGrid>
        <BarPanel title="全部销售部门" rows={groupSum(rows, 'salesOrg', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="店铺简称（日常汇报沟通简称）" rows={groupSum(rows, 'storeShortName', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="销售产品线" rows={groupSum(rows, 'productLine', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="销售系列" rows={groupSum(rows, 'productSeries', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
        <BarPanel title="型号" rows={groupSum(rows, 'model', 'qty', 10)} total={totalQty} valueFormatter={(value) => formatNumber(value, 2)} />
      </PanelGrid>
      <section className="kcfx-panel">
        <h3>销售数据明细</h3>
        <SimpleTable
          rows={rows}
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

const SALES_ANALYSIS_RECORD_IDS = ['sales-data'];
