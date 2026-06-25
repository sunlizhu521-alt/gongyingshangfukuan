import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../constants.js';

export async function fetchKcfxRecord(id) {
  const response = await fetch(`${API}/api/kcfx-library/records/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.record || { id, rows: [] };
}

export async function fetchKcfxRecordMap(ids) {
  const records = await Promise.all(ids.map((id) => fetchKcfxRecord(id)));
  return Object.fromEntries(records.map((record, index) => [record.id || ids[index], record]));
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
      setRowRecords(await fetchKcfxRecordMap(ids));
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
