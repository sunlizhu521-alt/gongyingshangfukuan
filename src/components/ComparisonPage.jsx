import React, { useMemo } from 'react';
import { KcfxPageShell, MetricCards, SimpleTable, SourcePanel } from './KcfxCommon.jsx';
import { formatNumber, recordSourceText, rowsOf } from './kcfxUtils.js';

export default function ComparisonPage({ kcfxData = null, kcfxRecords = {}, loading = false, error = '', lastLoadedAt = '', onRefresh }) {
  const kcfxRecordsFromProps = useMemo(() => kcfxData?.records || kcfxRecords || {}, [kcfxData, kcfxRecords]);
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
  const status = loading
    ? '数据加载中...'
    : error || `已加载 ${formatNumber(records.length)} 个文件槽位${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;

  return (
    <KcfxPageShell title="表格对比分析" status={status} loading={loading} onRefresh={onRefresh}>
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
