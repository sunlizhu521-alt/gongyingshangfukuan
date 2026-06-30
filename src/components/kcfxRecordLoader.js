import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../constants.js';
import { getCache, setCache } from '../indexedDbCache.js';

const recordCache = new Map();
const inflightRecordRequests = new Map();
let recordCacheVersion = '';

function uniqueRecordIds(ids = []) {
  return [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function syncRecordCacheVersion(savedAt) {
  if (!savedAt) return;
  if (recordCacheVersion && recordCacheVersion !== savedAt) {
    recordCache.clear();
    inflightRecordRequests.clear();
  }
  recordCacheVersion = savedAt;
}

export async function fetchKcfxRecord(id, { force = false } = {}) {
  if (!force && recordCache.has(id)) return recordCache.get(id);
  if (!force && inflightRecordRequests.has(id)) return inflightRecordRequests.get(id);

  const cacheKey = `kcfx:${recordCacheVersion}:${id}`;
  if (!force) {
    const cached = await getCache(cacheKey);
    if (cached) {
      recordCache.set(id, cached);
      return cached;
    }
  }

  const request = fetch(`${API}/api/kcfx-library/records/${encodeURIComponent(id)}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const record = payload.record || { id, rows: [] };
      recordCache.set(record.id || id, record);
      void setCache(cacheKey, record, 10 * 60 * 1000);
      return record;
    })
    .finally(() => {
      inflightRecordRequests.delete(id);
    });

  inflightRecordRequests.set(id, request);
  return request;
}

export async function fetchKcfxRecordMap(ids, options = {}) {
  const currentIds = uniqueRecordIds(ids);
  const results = await Promise.all(currentIds.map(async (id) => {
      try {
        return { id, record: await fetchKcfxRecord(id, options) };
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

export async function prefetchKcfxRecords(ids, { force = false, batchSize = 3, delayMs = 50, signal } = {}) {
  const currentIds = uniqueRecordIds(ids);
  const failedIds = [];
  for (let index = 0; index < currentIds.length; index += batchSize) {
    if (signal?.aborted) break;
    const batch = currentIds.slice(index, index + batchSize);
    const result = await fetchKcfxRecordMap(batch, { force });
    failedIds.push(...result.failedIds);
    if (delayMs > 0 && index + batchSize < currentIds.length) await wait(delayMs);
  }
  return { ok: failedIds.length === 0, failedIds };
}

export function kcfxRecordsArrayToMap(records) {
  if (Array.isArray(records)) {
    return Object.fromEntries(records.map((record) => [record.id, record]).filter(([id]) => id));
  }
  return records || {};
}

export function useKcfxRecordMap(kcfxData, ids) {
  const idsKey = useMemo(() => ids.join('|'), [ids]);
  const metadataRecords = useMemo(() => kcfxRecordsArrayToMap(kcfxData?.records), [kcfxData]);
  const savedAt = kcfxData?.savedAt || '';
  const [rowRecords, setRowRecords] = useState(() => {
    const cached = {};
    for (const id of ids) {
      if (recordCache.has(id)) cached[id] = recordCache.get(id);
    }
    return cached;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async ({ force = false } = {}) => {
    const currentIds = idsKey.split('|').filter(Boolean);
    const cached = {};
    if (!force) {
      for (const id of currentIds) {
        if (recordCache.has(id)) cached[id] = recordCache.get(id);
      }
      if (Object.keys(cached).length === currentIds.length) {
        setRowRecords(cached);
        setError('');
        return cached;
      }
    }

    setLoading(true);
    setError('');
    try {
      const result = await fetchKcfxRecordMap(currentIds, { force });
      setRowRecords(result.records);
      const hasRows = Object.values(result.records).some((record) => Array.isArray(record?.rows) && record.rows.length > 0);
      setError(!hasRows && result.failedIds.length ? `记录加载失败：${result.failedIds.join('、')}` : '');
      return result.records;
    } catch (loadError) {
      setError(loadError?.message || String(loadError));
      return {};
    } finally {
      setLoading(false);
    }
  }, [idsKey]);

  useEffect(() => {
    syncRecordCacheVersion(savedAt);
    reload({ force: false });
  }, [reload, savedAt]);

  const records = useMemo(() => ({
    ...metadataRecords,
    ...rowRecords
  }), [metadataRecords, rowRecords]);

  return { records, loading, error, reload };
}
