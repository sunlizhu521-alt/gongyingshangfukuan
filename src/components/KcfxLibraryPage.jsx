import React, { useMemo, useState } from 'react';
import { API } from '../constants.js';
import { KcfxPageShell, MetricCards, SimpleTable } from './KcfxCommon.jsx';
import { formatNumber, recordSourceText } from './kcfxUtils.js';

export default function KcfxLibraryPage({
  title,
  slots,
  kcfxData = null,
  library = {},
  user,
  loading = false,
  error = '',
  lastLoadedAt = '',
  onRefresh
}) {
  const [uploadingSlot, setUploadingSlot] = useState('');
  const [message, setMessage] = useState('');
  const activeLibrary = kcfxData || library || {};
  const records = activeLibrary.records || {};
  const rows = useMemo(() => slots.map((slot) => {
    const record = records[slot.id] || { id: slot.id };
    return {
      ...slot,
      fileName: record.fileName || record.originalName || '-',
      rowCount: record.rows?.length || record.rowCount || 0,
      sheetName: record.sheetName || record.selectedSheetName || '-',
      updatedAt: record.appliedAt || record.savedAt || '',
      source: recordSourceText(record)
    };
  }), [records, slots]);
  const canUpload = user?.name === '孙立柱';
  const status = loading
    ? '数据加载中...'
    : error || message || `已加载 ${formatNumber(rows.length)} 个文件槽位${lastLoadedAt ? `；读取时间：${lastLoadedAt}` : ''}`;

  async function uploadSlot(slotId, file) {
    if (!file) return;
    setUploadingSlot(slotId);
    setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('user', user?.name || '');
      const response = await fetch(`${API}/api/kcfx-library/records/${encodeURIComponent(slotId)}/upload`, {
        method: 'POST',
        body: form
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMessage('上传并解析成功');
      await onRefresh?.();
    } catch (uploadError) {
      setMessage(`上传失败：${uploadError?.message || uploadError}`);
    } finally {
      setUploadingSlot('');
    }
  }

  return (
    <KcfxPageShell title={title} status={status} loading={loading} onRefresh={onRefresh}>
      <MetricCards metrics={[
        { label: '槽位数量', value: formatNumber(rows.length) },
        { label: '已应用文件', value: formatNumber(rows.filter((row) => row.rowCount > 0).length) },
        { label: '总行数', value: formatNumber(rows.reduce((total, row) => total + row.rowCount, 0)) },
        { label: '保存时间', value: activeLibrary.savedAt ? new Date(activeLibrary.savedAt).toLocaleString('zh-CN', { hour12: false }) : '-' }
      ]} />
      <div className="kcfx-library-grid">
        {rows.map((row) => (
          <section className="kcfx-library-card" key={row.id}>
            <div>
              <h3>{row.label}</h3>
              <p>{row.description || row.id}</p>
            </div>
            <dl>
              <div><dt>文件</dt><dd>{row.fileName}</dd></div>
              <div><dt>Sheet</dt><dd>{row.sheetName}</dd></div>
              <div><dt>行数</dt><dd>{formatNumber(row.rowCount)}</dd></div>
            </dl>
            {canUpload && (
              <label className="kcfx-upload-button">
                {uploadingSlot === row.id ? '上传中...' : '上传替换'}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={Boolean(uploadingSlot)}
                  onChange={(event) => uploadSlot(row.id, event.target.files?.[0])}
                />
              </label>
            )}
          </section>
        ))}
      </div>
      <section className="kcfx-panel">
        <h3>文件槽位明细</h3>
        <SimpleTable
          rows={rows}
          maxRows={200}
          columns={[
            { key: 'id', label: '槽位' },
            { key: 'label', label: '名称' },
            { key: 'fileName', label: '文件名' },
            { key: 'sheetName', label: 'Sheet' },
            { key: 'rowCount', label: '行数', render: (row) => formatNumber(row.rowCount) },
            { key: 'updatedAt', label: '更新时间', render: (row) => row.updatedAt ? new Date(row.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '-' }
          ]}
        />
      </section>
    </KcfxPageShell>
  );
}
