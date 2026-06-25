import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../constants.js';

export async function fetchKcfxRecord(id) {
  const response = await fetch(`${API}/api/kcfx-library/records/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.record || { id, rows: [] };
}

export async function fetchKcfxRecordMap(ids) {
  const results = await Promise.all(ids.map(async (id) => {
    try {
      return { id, record: await fetchKcfxRecord(id) };
    } catch (error) {
      return { id, error: error?.message || String(error) };
    }
  }));
  const records = {};
  const failedIds = [];
  for (const result of results) {
    if (result.record) {
      records[result.record.id || result.id] = result.record;
    } else {
      failedIds.push(result.id);
      records[result.id] = { id: result.id, rows: [], loadError: result.error };
    }
  }
  return { records, failedIds };
}

export function kcfxRecordsArrayToMap(records) {
  if (Array.isArray(records)) {
    return Object.fromEntries(records.map((record) => [record.id, record]).filter(([id]) => id));
  }
  return records || {};
}

export function useKcfxRecordMap(kcfxData, ids) {
  const metadataRecords = useMemo(() => kcfxRecordsArrayToMap(kcfxData?.records), [kcfxData]);
  const savedAt = kcfxData?.savedAt || '';
  const [rowRecords, setRowRecords] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchKcfxRecordMap(ids);
      setRowRecords(result.records);
      const hasRows = Object.values(result.records).some((record) => Array.isArray(record?.rows) && record.rows.length > 0);
      setError(!hasRows && result.failedIds.length ? `记录加载失败：${result.failedIds.join('、')}` : '');
    } catch (loadError) {
      setError(loadError?.message || String(loadError));
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    reload();
  }, [reload, savedAt]);

  const records = useMemo(() => ({
    ...metadataRecords,
    ...rowRecords
  }), [metadataRecords, rowRecords]);

  return { records, loading, error, reload };
}
