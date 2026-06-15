const KC_FILE_LIBRARY_MANIFEST = "data/kcfx-library/manifest.json";
const KC_SERVER_LIBRARY_API = `${resolveKcfxApiBase()}/api/kcfx-library`;
const KC_SYSTEM_OWNER_NAME = "孙立柱";
const KC_SERVER_LOAD_TIMEOUT_MS = 15000;
const KC_SERVER_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const kcSharedLibraryLoadPromises = new Map();

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

async function loadSharedLibrary(options = {}) {
  const statusEl = options.statusEl || null;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const metadataOnly = Boolean(options.metadataOnly);
  const promiseKey = metadataOnly ? "metadata" : "full";
  if (options.force) kcSharedLibraryLoadPromises.delete(promiseKey);
  if (!kcSharedLibraryLoadPromises.has(promiseKey)) {
    kcSharedLibraryLoadPromises.set(promiseKey, loadKcfxFileLibrary(null, { onProgress, metadataOnly }));
  }
  const result = await kcSharedLibraryLoadPromises.get(promiseKey);
  if (statusEl) renderSharedLibraryStatus(statusEl, result);
  return result;
}

function renderSharedLibraryStatus(statusEl, result) {
  if (!result?.ok) {
    statusEl.textContent = `文件库未加载：${result?.error?.message || "未知错误"}`;
    return;
  }
  const entries = Object.entries(result.manifest?.records || {});
  statusEl.textContent = buildSharedLibraryStatus(result.imported, result.cleared, entries.length);
}

async function loadKcfxFileLibrary(statusEl, options = {}) {
  const cacheKey = `v=${Date.now()}`;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const metadataOnly = Boolean(options.metadataOnly);
  onProgress?.({ percent: 12, message: "正在连接服务器文件库..." });
  const serverResult = await loadServerKcfxFileLibrary(statusEl, { onProgress, metadataOnly });
  if (serverResult.ok) return serverResult;
  try {
    onProgress?.({ percent: 18, message: "服务器文件库不可用，正在读取备用清单..." });
    const response = await fetch(`${KC_FILE_LIBRARY_MANIFEST}?${cacheKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const entries = Object.entries(manifest.records || {});
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
    const cleared = await clearStaleSharedRecords(new Set(entries.map(([id]) => id)));
    if (statusEl) statusEl.textContent = buildSharedLibraryStatus(imported, cleared, entries.length);
    return { ok: true, imported, cleared, manifest };
  } catch (error) {
    if (statusEl) statusEl.textContent = `文件库未加载：${error.message}`;
    return { ok: false, error };
  }
}

async function loadServerKcfxFileLibrary(statusEl, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const metadataOnly = Boolean(options.metadataOnly);
  try {
    onProgress?.({ percent: 20, message: "正在下载服务器文件库..." });
    const response = await fetchKcfxApi(`${KC_SERVER_LIBRARY_API}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    onProgress?.({ percent: 45, message: "正在解析服务器文件库..." });
    const manifest = await response.json();
    const result = await importLibraryManifestRecords(manifest, { onProgress, metadataOnly });
    if (statusEl) statusEl.textContent = buildSharedLibraryStatus(result.imported, result.cleared, result.sharedCount);
    return { ok: true, ...result, manifest, source: "server" };
  } catch (error) {
    return { ok: false, error, source: "server" };
  }
}

async function importLibraryManifestRecords(manifest, options = {}) {
  const entries = Object.entries(manifest.records || {});
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const metadataOnly = Boolean(options.metadataOnly);
  let imported = 0;
  for (const [index, [id, record]] of entries.entries()) {
    onProgress?.({
      percent: entries.length ? 50 + Math.round((index / entries.length) * 35) : 85,
      message: `正在导入文件记录 ${index + 1}/${entries.length}`
    });
    if (!SLOT_BY_ID[id]) continue;
    const local = await getRecord(id);
    let importRecord = record;
    if (!metadataOnly && !Array.isArray(importRecord.rows)) {
      importRecord = await loadServerKcfxFullRecord(id, index, entries.length, onProgress);
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
  const cleared = await clearStaleSharedRecords(new Set(entries.map(([id]) => id)));
  return { imported, cleared, sharedCount: entries.length, manifest };
}

async function loadServerKcfxFullRecord(id, index, total, onProgress) {
  onProgress?.({
    percent: total ? 50 + Math.round((index / total) * 35) : 85,
    message: `正在读取完整数据 ${index + 1}/${total}`
  });
  const response = await fetchKcfxApi(`${KC_SERVER_LIBRARY_API}/records/${encodeURIComponent(id)}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${id} HTTP ${response.status}`);
  const payload = await response.json();
  return payload.record || null;
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

async function uploadKcfxServerFile(slot, file, parsedRecord = null) {
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
  const response = await fetchKcfxApi(`${KC_SERVER_LIBRARY_API}/records/${encodeURIComponent(slot.id)}/upload?${kcfxUserQuery()}`, {
    method: "POST",
    body: form
  }, KC_SERVER_UPLOAD_TIMEOUT_MS);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  const payload = await response.json();
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
  if (isDeletedRecord(local) || hasPendingRecord(local)) return false;
  if (isLocalBrowserRecord(local)) return false;
  if (recordIsNewer(shared, local)) return true;
  return sharedIsNotOlder(shared, local) && libraryRecordDiffers(shared, local);
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

async function clearStaleSharedRecords(activeSharedIds) {
  const records = await getAllRecords();
  let cleared = 0;
  for (const record of records) {
    if (!record?.id || !SLOT_BY_ID[record.id]) continue;
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
  if (!sharedCount && cleared) return `文件库共享默认数据已清空，已清理 ${cleared} 个旧共享记录。`;
  if (!sharedCount) return "文件库共享默认数据为空，请上传并应用最新文件。";
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
