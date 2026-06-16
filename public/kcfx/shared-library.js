const KC_FILE_LIBRARY_MANIFEST = "data/kcfx-library/manifest.json";
const KC_SERVER_LIBRARY_API = `${resolveKcfxApiBase()}/api/kcfx-library`;
const KC_SERVER_PRELOADED_LIBRARY_API = `${KC_SERVER_LIBRARY_API}/preloaded`;
const KC_SYSTEM_OWNER_NAME = "孙立柱";
const KC_SERVER_LOAD_TIMEOUT_MS = 45000;
const KC_SERVER_PRELOAD_TIMEOUT_MS = 12000;
const KC_SERVER_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const KC_PRELOAD_STATE_KEY = "kcfx-auto-preload-state";
const KC_PRELOAD_WAIT_MS = 12000;
const KC_AUTO_PRELOAD_RECORD_IDS = [
  "sales-data",
  "fact-inventory",
  "fact-2",
  "dim-product",
  "dim-warehouse",
  "dim-warehouse-material",
  "dim-store-name",
  "dim-customer-material"
];
const kcSharedLibraryLoadPromises = new Map();
let kcAutoPreloadStarted = false;

function isKcfxPreloadFrame() {
  return new URLSearchParams(window.location.search).get("preload") === "1";
}

function resolveKcfxApiBase() {
  const { hostname, port } = window.location;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "5173") {
    return "http://localhost:4001";
  }
  return "";
}

async function fetchKcfxApi(url, options = {}, timeoutMs = KC_SERVER_LOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("后端服务长时间未返回，请确认腾讯云 Node 服务已启动并且文件没有过大。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function postKcfxFormWithProgress(url, form, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = timeoutMs;
    xhr.responseType = "json";

    if (typeof onProgress === "function") {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          onProgress({ percent: null, loaded: event.loaded || 0, total: null });
          return;
        }
        onProgress({
          percent: Math.round((event.loaded / event.total) * 100),
          loaded: event.loaded,
          total: event.total
        });
      };
    }

    xhr.onload = () => {
      let payload = xhr.response;
      if (!payload && xhr.responseText) {
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          payload = {};
        }
      }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        payload: payload || {}
      });
    };
    xhr.onerror = () => reject(new Error("上传到腾讯云服务器失败，请检查网络后重试。"));
    xhr.ontimeout = () => reject(new Error("上传到腾讯云服务器超时，请确认文件大小和网络状态。"));
    xhr.onabort = () => reject(new Error("上传已取消。"));
    xhr.send(form);
  });
}

async function loadSharedLibrary(options = {}) {
  const statusEl = options.statusEl || null;
  const onProgress = typeof options.onProgress === "function"
    ? options.onProgress
    : statusEl
      ? ({ percent, message }) => {
          statusEl.textContent = formatKcfxLoadProgress(message, percent);
        }
      : null;
  const metadataOnly = Boolean(options.metadataOnly);
  const targetIds = normalizeKcfxTargetIds(options.ids || options.targetIds);
  if (!options.force && !metadataOnly && targetIds) {
    const localReadyResult = await buildLocalReadyResult(targetIds);
    if (localReadyResult) {
      if (statusEl) renderSharedLibraryStatus(statusEl, localReadyResult);
      return localReadyResult;
    }
  }
  const targetKey = targetIds ? [...targetIds].sort().join(",") : "all";
  const promiseKey = `${metadataOnly ? "metadata" : "full"}:${targetKey}`;
  if (options.force) kcSharedLibraryLoadPromises.delete(promiseKey);
  if (!kcSharedLibraryLoadPromises.has(promiseKey)) {
    kcSharedLibraryLoadPromises.set(promiseKey, loadKcfxFileLibrary(null, { onProgress, metadataOnly, targetIds }));
  }
  const result = await kcSharedLibraryLoadPromises.get(promiseKey);
  if (statusEl) renderSharedLibraryStatus(statusEl, result);
  return result;
}

async function buildLocalReadyResult(targetIds) {
  const ids = [...targetIds];
  const records = await Promise.all(ids.map((id) => getRecord(id).catch(() => null)));
  const ready = records.filter((record) => Array.isArray(getLatestUploadedRecord(record)?.rows));
  if (ready.length !== ids.length) return null;
  return {
    ok: true,
    imported: 0,
    cleared: 0,
    sharedCount: ready.length,
    source: "indexeddb",
    manifest: {
      schemaVersion: 1,
      project: "kcfx",
      records: Object.fromEntries(ready.map((record) => {
        const displayRecord = getLatestUploadedRecord(record);
        return [displayRecord.id, displayRecord];
      }))
    }
  };
}

function readKcfxPreloadState() {
  try {
    return JSON.parse(localStorage.getItem(KC_PRELOAD_STATE_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function writeKcfxPreloadState(state) {
  try {
    localStorage.setItem(KC_PRELOAD_STATE_KEY, JSON.stringify({
      ...state,
      updatedAt: Date.now()
    }));
  } catch {}
}

async function waitForKcfxPreload(targetIds, onProgress) {
  const state = readKcfxPreloadState();
  const isRecent = Date.now() - Number(state.updatedAt || 0) < KC_PRELOAD_WAIT_MS;
  if (state.status !== "loading" || !isRecent) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < KC_PRELOAD_WAIT_MS) {
    onProgress?.({
      percent: 32,
      message: "正在等待维护文件库预加载完成"
    });
    const localReadyResult = await buildLocalReadyResult(targetIds);
    if (localReadyResult) return;
    const current = readKcfxPreloadState();
    if (current.status !== "loading") return;
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
}

function formatKcfxLoadProgress(message, percent) {
  const text = message || "正在读取腾讯云文件库";
  const numericPercent = Number(percent);
  if (!Number.isFinite(numericPercent)) return text;
  return `${text} ${Math.round(numericPercent)}%`;
}

function startKcfxAutoPreload(options = {}) {
  if (kcAutoPreloadStarted && !options.force) return;
  kcAutoPreloadStarted = true;
  const delayMs = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 0;
  window.setTimeout(() => {
    writeKcfxPreloadState({ status: "loading" });
    loadSharedLibrary({
      ids: KC_AUTO_PRELOAD_RECORD_IDS,
      force: Boolean(options.force),
      onProgress: options.onProgress
    }).then((result) => {
      writeKcfxPreloadState({ status: result?.ok ? "ready" : "failed" });
    }).catch((error) => {
      writeKcfxPreloadState({ status: "failed", error: error?.message || String(error) });
      console.warn("kcfx auto preload failed", error);
    });
  }, delayMs);
}

function scheduleKcfxAutoPreload() {
  if (!isKcfxPreloadFrame()) return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startKcfxAutoPreload({ force: true }), { once: true });
    return;
  }
  startKcfxAutoPreload({ force: true });
}

function normalizeKcfxTargetIds(ids) {
  if (!ids) return null;
  const values = Array.isArray(ids) ? ids : [ids];
  const filtered = values.map((id) => String(id || "").trim()).filter(Boolean);
  return filtered.length ? new Set(filtered) : null;
}

function filterKcfxLibraryEntries(entries, targetIds) {
  if (!targetIds) return entries;
  return entries.filter(([id]) => targetIds.has(id));
}

function renderSharedLibraryStatus(statusEl, result) {
  if (!result?.ok) {
    statusEl.textContent = `文件库未加载：${result?.error?.message || "未知错误"}`;
    return;
  }
  const entries = Object.entries(result.manifest?.records || {});
  statusEl.textContent = buildSharedLibraryStatus(result.imported, result.cleared, Number.isFinite(result.sharedCount) ? result.sharedCount : entries.length);
}

async function loadKcfxFileLibrary(statusEl, options = {}) {
  const cacheKey = `v=${Date.now()}`;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const metadataOnly = Boolean(options.metadataOnly);
  const targetIds = options.targetIds || null;
  onProgress?.({ percent: 12, message: "正在连接服务器文件库..." });
  const serverResult = await loadServerKcfxFileLibrary(statusEl, { onProgress, metadataOnly, targetIds });
  if (serverResult.ok) return serverResult;
  try {
    onProgress?.({ percent: 18, message: "服务器文件库不可用，正在读取备用清单..." });
    const response = await fetch(`${KC_FILE_LIBRARY_MANIFEST}?${cacheKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const entries = filterKcfxLibraryEntries(Object.entries(manifest.records || {}), targetIds);
    let imported = 0;

    for (const [index, [id, entry]] of entries.entries()) {
      onProgress?.({
        percent: entries.length ? 20 + Math.round((index / entries.length) * 60) : 80,
        message: `正在读取备用文件 ${index + 1}/${entries.length}`
      });
      if (!SLOT_BY_ID[id] || !entry.path) continue;
      const recordResponse = await fetch(`${entry.path}?${cacheKey}`, { cache: "no-store" });
      if (!recordResponse.ok) throw new Error(`${entry.path} HTTP ${recordResponse.status}`);
      const record = await recordResponse.json();
      if (!Array.isArray(record.rows)) continue;
      const nextRecord = {
        ...record,
        id,
        appliedAt: entry.appliedAt || record.appliedAt || record.savedAt || manifest.savedAt || "",
        libraryPath: entry.path,
        libraryManifestPath: KC_FILE_LIBRARY_MANIFEST,
        sharedSavedAt: manifest.savedAt || record.savedAt || ""
      };
      const local = await getRecord(id);
      if (shouldImportSharedRecord(nextRecord, local)) {
        await saveRecord(nextRecord);
        imported += 1;
      }
    }

    onProgress?.({ percent: 86, message: "正在清理旧文件记录..." });
    const cleared = await clearStaleSharedRecords(new Set(entries.map(([id]) => id)), { targetIds });
    if (statusEl) statusEl.textContent = buildSharedLibraryStatus(imported, cleared, entries.length);
    return { ok: true, imported, cleared, sharedCount: entries.length, manifest };
  } catch (error) {
    if (statusEl) statusEl.textContent = `文件库未加载：${error.message}`;
    return { ok: false, error };
  }
}

async function loadServerKcfxFileLibrary(statusEl, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const metadataOnly = Boolean(options.metadataOnly);
  const targetIds = options.targetIds || null;
  try {
    if (!metadataOnly) {
      try {
        const preloadedResult = await loadPreloadedServerKcfxFileLibrary({ onProgress, targetIds });
        if (statusEl) {
          statusEl.textContent = buildSharedLibraryStatus(
            preloadedResult.imported,
            preloadedResult.cleared,
            preloadedResult.sharedCount
          );
        }
        return preloadedResult;
      } catch (error) {
        console.warn("kcfx preloaded library failed, falling back to server records", error);
        onProgress?.({
          percent: 28,
          message: "\u9884\u70ed\u6570\u636e\u6682\u672a\u5c31\u7eea\uff0c\u6b63\u5728\u6539\u7528\u670d\u52a1\u5668\u6587\u4ef6\u5e93..."
        });
      }
    }
    onProgress?.({ percent: 20, message: "正在下载服务器文件库..." });
    const response = await fetchKcfxApi(`${KC_SERVER_LIBRARY_API}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    onProgress?.({ percent: 45, message: "正在解析服务器文件库..." });
    const manifest = await response.json();
    const result = await importLibraryManifestRecords(manifest, { onProgress, metadataOnly, targetIds });
    if (statusEl) statusEl.textContent = buildSharedLibraryStatus(result.imported, result.cleared, result.sharedCount);
    return { ok: true, ...result, manifest, source: "server" };
  } catch (error) {
    return { ok: false, error, source: "server" };
  }
}

async function loadPreloadedServerKcfxFileLibrary(options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const targetIds = options.targetIds || null;
  onProgress?.({ percent: 22, message: "\u6b63\u5728\u8bfb\u53d6\u670d\u52a1\u5668\u5df2\u9884\u70ed\u6570\u636e..." });
  const query = new URLSearchParams({ v: String(Date.now()) });
  if (targetIds) query.set("ids", [...targetIds].join(","));
  const response = await fetchKcfxApi(`${KC_SERVER_PRELOADED_LIBRARY_API}?${query.toString()}`, { cache: "no-store" }, KC_SERVER_PRELOAD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`preloaded HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.ok || payload.status !== "ready") {
    throw new Error(payload?.error || `preloaded ${payload?.status || "not ready"}`);
  }
  onProgress?.({ percent: 48, message: "\u6b63\u5728\u540c\u6b65\u670d\u52a1\u5668\u5df2\u9884\u70ed\u6570\u636e..." });
  const entries = filterKcfxLibraryEntries(Object.entries(payload.records || {}), targetIds);
  const manifest = {
    schemaVersion: payload.schemaVersion || 1,
    project: payload.project || "kcfx",
    savedAt: payload.savedAt || payload.completedAt || payload.preloadedAt || "",
    records: Object.fromEntries(entries)
  };
  const result = await importLibraryManifestRecords(manifest, { onProgress, metadataOnly: false, targetIds });
  onProgress?.({ percent: 92, message: "\u670d\u52a1\u5668\u9884\u70ed\u6570\u636e\u5df2\u540c\u6b65" });
  return {
    ok: true,
    ...result,
    manifest,
    source: "server-preload",
    preloadedAt: payload.preloadedAt || payload.completedAt || ""
  };
}

async function importLibraryManifestRecords(manifest, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const metadataOnly = Boolean(options.metadataOnly);
  const targetIds = options.targetIds || null;
  const entries = filterKcfxLibraryEntries(Object.entries(manifest.records || {}), targetIds);
  let imported = 0;
  if (!entries.length) {
    onProgress?.({ percent: 88, message: "服务器文件库暂无记录，保留本地已有槽位。" });
    return { imported: 0, cleared: 0, sharedCount: 0, manifest };
  }
  for (const [index, [id, record]] of entries.entries()) {
    onProgress?.({
      percent: entries.length ? 50 + Math.round((index / entries.length) * 35) : 85,
      message: `正在导入文件记录 ${index + 1}/${entries.length}`
    });
    if (!SLOT_BY_ID[id]) continue;
    const local = await getRecord(id);
    let importRecord = record;
    if (!metadataOnly && !Array.isArray(importRecord.rows)) {
      if (canReuseLocalKcfxRows(importRecord, local)) {
        importRecord = { ...importRecord, rows: getLatestUploadedRecord(local).rows };
      } else {
        try {
          importRecord = await loadServerKcfxFullRecord(id, index, entries.length, onProgress);
        } catch (error) {
          console.warn("kcfx full record load failed", id, error);
          continue;
        }
      }
    }
    if (!metadataOnly && !Array.isArray(importRecord?.rows)) continue;
    if (
      metadataOnly
      && !Array.isArray(importRecord.rows)
      && Array.isArray(local?.rows)
      && (!importRecord.serverFilePath || importRecord.serverFilePath === local.serverFilePath)
    ) {
      importRecord = { ...importRecord, rows: local.rows };
    }
    const nextRecord = {
      ...importRecord,
      id,
      appliedAt: importRecord.appliedAt || importRecord.serverSavedAt || importRecord.savedAt || manifest.savedAt || "",
      sharedSavedAt: importRecord.serverSavedAt || manifest.savedAt || importRecord.savedAt || "",
      libraryPath: importRecord.libraryPath || `${KC_SERVER_LIBRARY_API}/records/${id}`,
      libraryManifestPath: KC_SERVER_LIBRARY_API
    };
    if (shouldImportSharedRecord(nextRecord, local)) {
      await saveRecord(nextRecord);
      imported += 1;
    }
  }
  onProgress?.({ percent: 88, message: "正在清理旧文件记录..." });
  const cleared = await clearStaleSharedRecords(new Set(entries.map(([id]) => id)), { targetIds });
  return { imported, cleared, sharedCount: entries.length, manifest };
}

async function loadServerKcfxFullRecord(id, index, total, onProgress) {
  const percent = total ? 50 + Math.round((index / total) * 35) : 85;
  onProgress?.({
    percent,
    message: `正在读取完整数据 ${index + 1}/${total}`
  });
  const response = await fetchKcfxApi(`${KC_SERVER_LIBRARY_API}/records/${encodeURIComponent(id)}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${id} HTTP ${response.status}`);
  const payload = await response.json();
  return payload.record || null;
}

function canReuseLocalKcfxRows(serverRecord = {}, localRecord = {}) {
  const local = getLatestUploadedRecord(localRecord);
  if (!Array.isArray(local?.rows) || !local.rows.length) return false;
  if (serverRecord.serverFilePath && local.serverFilePath === serverRecord.serverFilePath) return true;
  if (serverRecord.rowsPath && local.rowsPath === serverRecord.rowsPath) return true;
  if (serverRecord.parseCompletedAt && local.parseCompletedAt === serverRecord.parseCompletedAt) return true;
  if (serverRecord.serverSavedAt && local.serverSavedAt === serverRecord.serverSavedAt) return true;
  return Boolean(
    serverRecord.fileName
    && local.fileName === serverRecord.fileName
    && Number(local.size || 0) === Number(serverRecord.size || 0)
    && Number(local.rowCount || local.rows.length || 0) === Number(serverRecord.rowCount || 0)
  );
}

function getKcfxCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("invoiceUser") || "null") || {};
  } catch {
    return {};
  }
}

function canManageKcfxLibrary() {
  return getKcfxCurrentUser().name === KC_SYSTEM_OWNER_NAME;
}

function kcfxUserQuery() {
  const user = getKcfxCurrentUser();
  return `user=${encodeURIComponent(user.name || "")}&role=${encodeURIComponent(user.role || "")}`;
}

async function saveKcfxServerRecord(record) {
  if (!canManageKcfxLibrary()) throw new Error("只有孙立柱可以维护文件库。");
  const response = await fetchKcfxApi(`${KC_SERVER_LIBRARY_API}/records/${encodeURIComponent(record.id)}?${kcfxUserQuery()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...record, user: getKcfxCurrentUser().name || "" })
  }, KC_SERVER_UPLOAD_TIMEOUT_MS);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  const payload = await response.json();
  return payload.record || record;
}

async function uploadKcfxServerFile(slot, file, parsedRecord = null, options = {}) {
  if (!canManageKcfxLibrary()) throw new Error("只有孙立柱可以维护文件库。");
  const form = new FormData();
  form.append("file", file);
  form.append("user", getKcfxCurrentUser().name || "");
  if (parsedRecord) form.append("record", JSON.stringify(parsedRecord));
  form.append("slot", JSON.stringify({
    id: slot.id,
    type: slot.type,
    title: slot.title,
    expectedName: slot.expectedName,
    sheetHint: slot.sheetHint || "",
    skipRows: slot.skipRows
  }));
  const result = await postKcfxFormWithProgress(
    `${KC_SERVER_LIBRARY_API}/records/${encodeURIComponent(slot.id)}/upload?${kcfxUserQuery()}`,
    form,
    KC_SERVER_UPLOAD_TIMEOUT_MS,
    options.onProgress
  );
  if (!result.ok) {
    throw new Error(result.payload?.error || `HTTP ${result.status}`);
  }
  const payload = result.payload || {};
  const serverRecord = payload.record || {};
  return {
    ...serverRecord,
    libraryPath: `${KC_SERVER_LIBRARY_API}/records/${encodeURIComponent(slot.id)}`,
    libraryManifestPath: KC_SERVER_LIBRARY_API,
    sharedSavedAt: serverRecord.serverSavedAt || serverRecord.savedAt || new Date().toISOString()
  };
}

async function deleteKcfxServerRecord(id) {
  if (!canManageKcfxLibrary()) throw new Error("只有孙立柱可以维护文件库。");
  const response = await fetchKcfxApi(`${KC_SERVER_LIBRARY_API}/records/${encodeURIComponent(id)}?${kcfxUserQuery()}`, {
    method: "DELETE"
  }, KC_SERVER_LOAD_TIMEOUT_MS);
  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
}

function shouldImportSharedRecord(shared, local) {
  if (!local) return true;
  if (isKcfxServerRecord(shared) && isCompleteKcfxRecord(shared)) return true;
  if (hasPendingRecord(local)) return false;
  if (isDeletedRecord(local)) return isKcfxServerRecord(shared);
  if (isLocalBrowserRecord(local)) return false;
  if (recordIsNewer(shared, local)) return true;
  return sharedIsNotOlder(shared, local) && libraryRecordDiffers(shared, local);
}

function isKcfxServerRecord(record) {
  return Boolean(record?.libraryManifestPath === KC_SERVER_LIBRARY_API || String(record?.libraryPath || '').startsWith(KC_SERVER_LIBRARY_API));
}

function isCompleteKcfxRecord(record) {
  return Array.isArray(record?.rows) && (record.rows.length > 0 || Number(record.rowCount || 0) > 0);
}

function isLocalBrowserRecord(record) {
  return Boolean(record)
    && !record.libraryPath
    && !record.libraryManifestPath
    && !record.sharedSavedAt;
}

function isSharedLibraryRecord(record) {
  return Boolean(record?.libraryPath || record?.libraryManifestPath || record?.sharedSavedAt);
}

function recordIsNewer(shared, local) {
  const sharedTime = Math.max(
    Date.parse(shared?.parseCompletedAt || 0) || 0,
    Date.parse(shared?.serverSavedAt || 0) || 0,
    Date.parse(shared?.savedAt || 0) || 0,
    Date.parse(shared?.appliedAt || 0) || 0,
    Date.parse(shared?.sharedSavedAt || 0) || 0
  );
  const localTime = Math.max(
    Date.parse(local?.parseCompletedAt || 0) || 0,
    Date.parse(local?.serverSavedAt || 0) || 0,
    Date.parse(local?.savedAt || 0) || 0,
    Date.parse(local?.appliedAt || 0) || 0,
    Date.parse(local?.sharedSavedAt || 0) || 0
  );
  return sharedTime > localTime;
}

async function clearStaleSharedRecords(activeSharedIds, options = {}) {
  const targetIds = options.targetIds || null;
  const records = await getAllRecords();
  let cleared = 0;
  for (const record of records) {
    if (!record?.id || !SLOT_BY_ID[record.id]) continue;
    if (targetIds && !targetIds.has(record.id)) continue;
    if (activeSharedIds.has(record.id)) continue;
    if (isDeletedRecord(record) || hasPendingRecord(record) || isLocalBrowserRecord(record)) continue;
    if (!isSharedLibraryRecord(record)) continue;
    const deletedAt = new Date().toISOString();
    await saveRecord({
      id: record.id,
      type: record.type || SLOT_BY_ID[record.id]?.type || "",
      title: record.title || SLOT_BY_ID[record.id]?.title || record.id,
      expectedName: record.expectedName || SLOT_BY_ID[record.id]?.expectedName || "",
      fileName: "",
      savedAt: deletedAt,
      deletedAt,
      clearedSharedDefault: true
    });
    cleared += 1;
  }
  return cleared;
}

function buildSharedLibraryStatus(imported, cleared, sharedCount) {
  if (!sharedCount && cleared) return `腾讯云文件库暂无记录，已保留本地槽位，并清理 ${cleared} 个旧共享记录。`;
  if (!sharedCount) return "腾讯云文件库暂无记录，已保留本地已有槽位。";
  if (imported && cleared) return `已同步 ${imported} 个文件库记录，并清理 ${cleared} 个旧共享记录。`;
  if (imported) return `已同步 ${imported} 个文件库记录。`;
  if (cleared) return `已清理 ${cleared} 个旧共享记录。`;
  return "文件库已检查，无需更新。";
}

function sharedIsNotOlder(shared, local) {
  const sharedTime = Date.parse(shared.savedAt || shared.appliedAt || shared.sharedSavedAt || 0);
  const localTime = Math.max(
    Date.parse(local.savedAt || 0) || 0,
    Date.parse(local.appliedAt || 0) || 0,
    Date.parse(local.sharedSavedAt || 0) || 0
  );
  if (!Number.isFinite(sharedTime) || !Number.isFinite(localTime)) return false;
  return sharedTime >= localTime;
}

function libraryRecordDiffers(shared, local) {
  if (!local) return true;
  if (hasPendingRecord(local)) return false;
  return isDeletedRecord(local)
    || (Array.isArray(shared.rows) && !Array.isArray(local.rows))
    || (local.libraryPath || "") !== (shared.libraryPath || "")
    || (local.savedAt || "") !== (shared.savedAt || "")
    || (local.appliedAt || "") !== (shared.appliedAt || "")
    || (local.sharedSavedAt || "") !== (shared.sharedSavedAt || "")
    || (local.size || 0) !== (shared.size || 0);
}

async function buildSharedLibraryPayload() {
  const all = await getAllRecords();
  const records = {};
  for (const record of all) {
    const displayRecord = getDisplayRecord(record);
    if (displayRecord) records[record.id] = displayRecord;
  }
  return {
    schemaVersion: 1,
    project: "kcfx",
    savedAt: new Date().toISOString(),
    records
  };
}

async function downloadSharedLibrary() {
  const payload = await buildSharedLibraryPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kcfx-file-library-package.json";
  link.click();
  URL.revokeObjectURL(url);
}

window.startKcfxAutoPreload = startKcfxAutoPreload;
scheduleKcfxAutoPreload();

async function importSharedLibraryFile(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const statusEl = document.querySelector("#sharedStatus");
  try {
    const payload = JSON.parse(await file.text());
    const records = payload.records || {};
    let imported = 0;
    for (const [id, record] of Object.entries(records)) {
      if (!SLOT_BY_ID[id] || !Array.isArray(record.rows)) continue;
      await saveRecord({ ...record, id, importedAt: new Date().toISOString() });
      imported += 1;
    }
    if (statusEl) statusEl.textContent = `已导入 ${imported} 个文件库记录。`;
    if (typeof renderLibrary === "function") await renderLibrary();
  } catch (error) {
    if (statusEl) statusEl.textContent = `导入失败：${error.message}`;
  } finally {
    input.value = "";
  }
}
