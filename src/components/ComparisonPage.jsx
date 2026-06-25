import React, { useMemo } from 'react';
import { KcfxPageShell, MetricCards, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { formatNumber, recordSourceText, rowsOf } from './kcfxUtils.js';
import { useKcfxRecordMap } from './kcfxRecordLoader.js';

export default function ComparisonPage({ kcfxData = null, kcfxRecords = {}, loading = false, error = '', lastLoadedAt = '', onRefresh }) {
  const { records: loadedRecords, loading: recordsLoading, error: recordsError, reload } = useKcfxRecordMap(kcfxData, COMPARISON_RECORD_IDS);
  const kcfxRecordsFromProps = useMemo(() => ({ ...kcfxRecords, ...loadedRecords }), [kcfxRecords, loadedRecords]);
  const pageLoading = loading || recordsLoading;
  const pageError = recordsError || error;
  const records = useMemo(() => (
    Object.entries(kcfxRecordsFromProps || {}).map(([id, record]) => ({
      id,
      title: record?.title || record?.slotName || id,
      fileName: record?.fileName || record?.originalName || '-',
      sheetName: record?.sheetName || record?.selectedSheetName || '-',
      rowCount: rowsOf(record).length || record?.rowCount || 0,
      columnCount: record?.columns?.length || rowsOf(record)[0] ? Object.keys(rowsOf(record)[0] || {}).length : 0,
      updatedAt: record?.appliedAt || record?.savedAt || ''
    }))
  ), [kcfxRecordsFromProps]);
  const status = pageLoading
    ? '数据加载中...'
    : pageError || `已加载 ${formatNumber(records.length)} 个文件槽位${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;
  const refresh = async () => {
    await Promise.all([reload(), onRefresh?.()]);
  };

  return (
    <KcfxPageShell title="表格对比分析" status={status} loading={pageLoading} onRefresh={refresh}>
      <MetricCards metrics={[
        { label: '文件槽位', value: formatNumber(records.length) },
        { label: '有数据槽位', value: formatNumber(records.filter((item) => item.rowCount > 0).length) },
        { label: '总行数', value: formatNumber(records.reduce((total, item) => total + item.rowCount, 0)) },
        { label: '最大文件行数', value: formatNumber(Math.max(...records.map((item) => item.rowCount), 0)) }
      ]} />
      <section className="kcfx-panel">
        <h3>文件槽位对比</h3>
        <SimpleTable
          rows={records}
          maxRows={200}
          columns={[
            { key: 'id', label: '槽位' },
            { key: 'title', label: '名称' },
            { key: 'fileName', label: '文件名' },
            { key: 'sheetName', label: 'Sheet' },
            { key: 'rowCount', label: '行数', render: (row) => formatNumber(row.rowCount) },
            { key: 'columnCount', label: '列数', render: (row) => formatNumber(row.columnCount) },
            { key: 'updatedAt', label: '更新时间', render: (row) => row.updatedAt ? new Date(row.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '-' }
          ]}
        />
      </section>
      <SourcePanel sources={records.map((record) => ({ label: record.title, value: recordSourceText(kcfxRecordsFromProps[record.id]) }))} />
    </KcfxPageShell>
  );
}

const COMPARISON_RECORD_IDS = ['fact-inventory', 'sales-data'];
