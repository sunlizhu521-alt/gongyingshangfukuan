const $ = (selector) => document.querySelector(selector);
const selectedServerFiles = new Map();
const slotStatusMessages = new Map();

document.addEventListener("DOMContentLoaded", () => {
  applyEmbeddedHostClass();
  if (!libraryCanManage()) {
    renderOwnerOnlyLibraryNotice();
    return;
  }
  bindToolbar();
  applyToolbarPermissions();
  renderLibraryShell();
  startInitialLibrarySync();
});

function applyEmbeddedHostClass() {
  if (new URLSearchParams(window.location.search).get("embed") === "1") {
    document.body.classList.add("embedded-host");
  }
}

function bindToolbar() {
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#uploadAllServerBtn")?.addEventListener("click", uploadAllToServer);
  $("#applyAllBtn").addEventListener("click", refreshAll);
  $("#clearCacheBtn")?.addEventListener("click", clearAllLibraryCache);
  $("#downloadSharedBtn").addEventListener("click", downloadSharedLibrary);
  $("#importSharedBtn")?.addEventListener("click", () => $("#importSharedInput")?.click());
  $("#importSharedInput")?.addEventListener("change", importSharedLibraryFile);
}

function libraryCanManage() {
  return typeof canManageKcfxLibrary === "function" && canManageKcfxLibrary();
}

function adminOnlyMessage() {
  return "只有孙立柱可以查看和维护文件库，其他账号不可见。";
}

function renderOwnerOnlyLibraryNotice() {
  const content = document.querySelector(".content");
  if (!content) return;
  content.innerHTML = `
    <section class="library-summary">
      <div>
        <span class="summary-eyebrow">OWNER ONLY</span>
        <h1>维护文件库</h1>
        <p>${escapeHtml(adminOnlyMessage())}</p>
      </div>
    </section>
  `;
}

function applyToolbarPermissions() {
  if (libraryCanManage()) return;
  ["#uploadAllServerBtn", "#applyAllBtn", "#clearCacheBtn", "#downloadSharedBtn", "#importSharedBtn", "#importSharedInput"].forEach((selector) => {
    const el = $(selector);
    if (el) el.style.display = "none";
  });
}

function startInitialLibrarySync() {
  setLibraryLoadProgress(8, "正在读取服务器文件库...");
  loadSharedLibrary({
    statusEl: $("#sharedStatus"),
    metadataOnly: true,
    onProgress: ({ percent, message }) => setLibraryLoadProgress(percent, message)
  })
    .then(() => {
      setLibraryLoadProgress(92, "正在刷新文件槽位...");
      return renderLibrary();
    })
    .then(() => {
      setLibraryLoadProgress(100, "文件库读取完成");
      window.setTimeout(() => setLibraryLoadProgress(0, "", { hidden: true }), 800);
    })
    .catch((error) => {
      setLibraryLoadProgress(100, `文件库同步失败：${error?.message || error}`);
      setLibraryStatus(`文件库同步失败：${error?.message || error}`);
    });
}

function ensureLibraryLoadProgress() {
  let progress = $("#libraryLoadProgress");
  if (progress) {
    placeLibraryGridInSummary(progress);
    return progress;
  }
  const toolbar = document.querySelector(".toolbar");
  progress = document.createElement("div");
  progress.id = "libraryLoadProgress";
  progress.className = "library-load-progress is-hidden";
  progress.innerHTML = `
    <div class="library-load-progress-head">
      <span id="libraryLoadProgressText">正在读取文件库...</span>
      <strong id="libraryLoadProgressValue">0%</strong>
    </div>
    <div class="library-load-progress-track">
      <span id="libraryLoadProgressBar"></span>
    </div>
  `;
  toolbar?.insertAdjacentElement("afterend", progress);
  placeLibraryGridInSummary(progress);
  return progress;
}

function placeLibraryGridInSummary(anchor = $("#libraryLoadProgress") || document.querySelector(".toolbar")) {
  const grid = $("#libraryGrid");
  const summary = document.querySelector(".library-summary");
  if (!grid || !summary || grid.parentElement === summary) return;
  anchor?.insertAdjacentElement("afterend", grid);
}

function setLibraryLoadProgress(percent, message, options = {}) {
  const progress = ensureLibraryLoadProgress();
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  progress.classList.toggle("is-hidden", Boolean(options.hidden));
  $("#libraryLoadProgressText").textContent = message || "";
  $("#libraryLoadProgressValue").textContent = options.hidden ? "" : `${Math.round(value)}%`;
  $("#libraryLoadProgressBar").style.width = `${value}%`;
}

function setSlotStatus(slotId, message, options = {}) {
  if (!slotId) return;
  if (options.remember === false) {
    // Keep the existing cached message when this is only replaying after a re-render.
  } else if (message) {
    slotStatusMessages.set(slotId, message);
  } else {
    slotStatusMessages.delete(slotId);
  }
  const status = $(`#status-${slotId}`);
  if (status) status.textContent = message || "";
}

function applySlotStatusMessages() {
  slotStatusMessages.forEach((message, slotId) => {
    setSlotStatus(slotId, message, { remember: false });
  });
}

function setSingleUploadProgress(status, percent, message) {
  const numericPercent = Number(percent);
  const hasPercent = Number.isFinite(numericPercent);
  const value = hasPercent ? Math.max(0, Math.min(100, numericPercent)) : 0;
  const text = hasPercent && value >= 100 ? "已完成，正在等待服务器保存并解析..." : hasPercent ? `${message} ${Math.round(value)}%` : message;
  if (status) status.textContent = text;
  setLibraryLoadProgress(value, text);
}

function setBatchUploadProgress(uploaded, total, currentPercent) {
  const numericPercent = Number(currentPercent);
  const value = Number.isFinite(numericPercent) ? Math.max(0, Math.min(100, numericPercent)) : 0;
  const overall = total ? Math.round(((uploaded + value / 100) / total) * 100) : value;
  const currentText = value >= 100 ? "当前文件已完成，正在等待服务器保存并解析..." : `当前文件 ${Math.round(value)}%`;
  const text = `正在上传到腾讯云服务器：${uploaded + 1}/${total}，${currentText}`;
  setLibraryStatus(text);
  setLibraryLoadProgress(overall, text);
}

async function uploadAllToServer() {
  if (!libraryCanManage()) {
    setLibraryStatus(adminOnlyMessage());
    return;
  }
  const button = $("#uploadAllServerBtn");
  const uploadableSlots = pageSlots()
    .map((slot) => ({ slot, file: selectedServerFiles.get(slot.id) }))
    .filter((item) => item.file);

  if (!uploadableSlots.length) {
    setLibraryStatus("当前页面没有可上传的原始 Excel 文件，请重新选择或拖拽文件。");
    return;
  }

  if (button) button.disabled = true;
  setLibraryStatus(`正在上传 ${uploadableSlots.length} 个文件到腾讯云服务器...`);
  const uploadSlotIds = uploadableSlots.map(({ slot }) => slot.id);
  let uploaded = 0;
  let queued = 0;
  try {
    for (const { slot, file } of uploadableSlots) {
      const parsingMessage = `正在本地浏览器解析文件：${uploaded + 1}/${uploadableSlots.length}`;
      setLibraryStatus(parsingMessage);
      setSlotStatus(slot.id, parsingMessage);
      setBatchUploadProgress(uploaded, uploadableSlots.length, 5);
      const parsedRecord = await readExcelFile(file, slot);
      const uploadMessage = `本地解析完成，正在上传到腾讯云服务器：${uploaded + 1}/${uploadableSlots.length}`;
      setLibraryStatus(uploadMessage);
      setSlotStatus(slot.id, uploadMessage);
      setBatchUploadProgress(uploaded, uploadableSlots.length, 15);
      const serverRecord = await uploadKcfxServerFile(slot, file, parsedRecord, {
        onProgress: ({ percent }) => setBatchUploadProgress(uploaded, uploadableSlots.length, percent)
      });
      await saveRecord(serverRecord);
      setBatchUploadProgress(uploaded, uploadableSlots.length, 100);
      if (serverRecord?.parseStatus && serverRecord.parseStatus !== "ready") queued += 1;
      uploaded += 1;
      setLibraryStatus(`已完成：${uploaded}/${uploadableSlots.length} 个文件已保存到腾讯云服务器。`);
      setSlotStatus(slot.id, "已完成：已保存到腾讯云服务器。");
    }
    await loadSharedLibrary({ statusEl: $("#sharedStatus"), force: true });
    await renderLibrary();
    if (queued) {
      uploadSlotIds.forEach((slotId) => setSlotStatus(slotId, "已完成：已保存到腾讯云服务器，后台解析中。"));
      scheduleServerParseRefresh(uploadSlotIds);
      setLibraryStatus(`已保存 ${uploaded} 个原始文件到腾讯云服务器，后台解析中。`);
      return;
    }
    setLibraryStatus(`已上传到腾讯云服务器：${uploaded} 个文件。`);
  } catch (error) {
    setLibraryStatus(`上传到腾讯云服务器失败：${error?.message || error}`);
  } finally {
    if (button) button.disabled = false;
  }
}

let serverParseRefreshTimer = null;
let serverParseRefreshCount = 0;

function refreshRecordsForIds(records, ids = null) {
  const values = Object.values(records || {});
  if (!ids?.length) return values;
  const targetIds = new Set(ids);
  return values.filter((record) => targetIds.has(record?.id));
}

function shouldWaitForServerParse(records, ids = null) {
  return refreshRecordsForIds(records, ids).some((record) => ["queued", "parsing"].includes(record?.parseStatus));
}

function summarizeServerParse(records, ids = null) {
  const parsedRecords = refreshRecordsForIds(records, ids);
  const failed = parsedRecords.filter((record) => record?.parseStatus === "failed");
  const ready = parsedRecords.filter((record) => record?.parseStatus === "ready");
  return { failed, ready };
}

function scheduleServerParseRefresh(ids = null) {
  window.clearTimeout(serverParseRefreshTimer);
  serverParseRefreshTimer = window.setTimeout(async () => {
    serverParseRefreshCount += 1;
    const result = await loadSharedLibrary({ statusEl: $("#sharedStatus"), force: true, ids }).catch(() => null);
    await renderLibrary();
    const records = result?.manifest?.records || {};
    if (serverParseRefreshCount < 8 && shouldWaitForServerParse(records, ids)) {
      setLibraryStatus("腾讯云服务器正在解析文件，请稍后...");
      refreshRecordsForIds(records, ids).forEach((record) => {
        if (["queued", "parsing"].includes(record?.parseStatus)) {
          setSlotStatus(record.id, "已完成：已保存到腾讯云服务器，后台解析中。");
        }
      });
      scheduleServerParseRefresh(ids);
    } else {
      const { failed, ready } = summarizeServerParse(records, ids);
      serverParseRefreshCount = 0;
      if (failed.length) {
        const names = failed.map((record) => record.title || record.id).join("、");
        failed.forEach((record) => setSlotStatus(record.id, "服务器解析失败，请查看错误信息后重新上传。"));
        setLibraryStatus(`服务器解析失败：${names}。请查看槽位错误信息后重新上传。`);
        setLibraryLoadProgress(100, "服务器解析失败，请查看槽位错误信息。");
        return;
      }
      if (ready.length) {
        ready.forEach((record) => setSlotStatus(record.id, "服务器解析完成，文件已保存并可用于看板。"));
        setLibraryStatus(`服务器解析完成：${ready.length} 个文件已保存并可用于看板。`);
        setLibraryLoadProgress(100, "服务器解析完成，文件已可用于看板。");
        window.setTimeout(() => setLibraryLoadProgress(0, "", { hidden: true }), 1200);
      }
    }
  }, 3000);
}

async function refreshAll() {
  setLibraryLoadProgress(8, "正在刷新服务器文件库...");
  await loadSharedLibrary({
    statusEl: $("#sharedStatus"),
    force: true,
    metadataOnly: true,
    onProgress: ({ percent, message }) => setLibraryLoadProgress(percent, message)
  });
  setLibraryLoadProgress(92, "正在应用文件槽位...");
  const records = Object.fromEntries((await getAllRecords()).map((record) => [record.id, record]));
  const applicableSlots = pageSlots().filter((slot) => getDisplayRecord(records[slot.id]));
  const count = applicableSlots.length;
  if (!count) {
    await renderLibrary();
    setLibraryLoadProgress(100, "文件库刷新完成");
    window.setTimeout(() => setLibraryLoadProgress(0, "", { hidden: true }), 800);
    return;
  }
  let appliedCount = 0;
  for (const slot of applicableSlots) {
    const nextRecord = promotePendingRecord(records[slot.id]);
    if (nextRecord) {
      await saveRecord(nextRecord);
      appliedCount += 1;
    }
  }
  await renderLibrary();
  setLibraryLoadProgress(100, "文件库刷新完成");
  window.setTimeout(() => setLibraryLoadProgress(0, "", { hidden: true }), 800);
  setLibraryStatus(appliedCount ? `应用成功：已应用 ${appliedCount} 个文件。` : "当前没有需要应用的文件。");
}

function pageType() {
  return document.body.dataset.libraryType;
}

function pageSlots() {
  return ALL_SLOTS.filter((slot) => slot.type === pageType());
}

function pageLabels() {
  const labels = {
    dimension: {
      eyebrow: "DIMENSION FILES",
      summaryTitle: "月度维度表文件库",
      slotLabel: "DIMENSION SLOT",
      emptyAction: "上传维度文件",
      savedLabel: "维度文件已保存"
    },
    fact: {
      eyebrow: "INVENTORY FILES",
      summaryTitle: "月度库存数据文件",
      slotLabel: "INVENTORY SLOT",
      emptyAction: "上传库存数据文件",
      savedLabel: "库存数据文件已保存"
    },
    sales: {
      eyebrow: "SALES FILES",
      summaryTitle: "销售数据文件",
      slotLabel: "SALES SLOT",
      emptyAction: "上传销售数据文件",
      savedLabel: "销售数据文件已保存"
    }
  };
  return labels[pageType()] || labels.fact;
}

function renderLibraryShell() {
  renderLibraryFromRecords({});
}

async function renderLibrary() {
  const records = Object.fromEntries((await getAllRecords()).map((record) => [record.id, record]));
  renderLibraryFromRecords(records);
}

function renderLibraryFromRecords(records) {
  ensureLibraryLoadProgress();
  placeLibraryGridInSummary();
  const slots = pageSlots();
  const used = slots.filter((slot) => getDisplayRecord(records[slot.id])).length;
  const applied = slots.filter((slot) => records[slot.id]?.appliedAt && !isDeletedRecord(records[slot.id])).length;
  const latest = latestSavedAt(slots, records);
  const labels = pageLabels();

  $("#libraryEyebrow").textContent = labels.eyebrow;
  $("#libraryTitle").textContent = labels.summaryTitle;
  $("#savedBadge").textContent = labels.savedLabel;
  $("#slotLimit").textContent = slots.length;
  $("#uploadedCount").textContent = used;
  $("#appliedCount").textContent = applied;
  $("#latestUpdate").textContent = latest ? new Date(latest).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).replace(/\//g, "/") : "-";

  $("#libraryGrid").innerHTML = slots.map((slot) => renderCard(slot, isDeletedRecord(records[slot.id]) ? null : records[slot.id], labels)).join("");
  bindCardEvents();
  applyCardPermissions();
  applySlotStatusMessages();
}

function latestSavedAt(slots, records) {
  const times = slots
    .map((slot) => getDisplayRecord(records[slot.id])?.savedAt)
    .filter(Boolean)
    .map((item) => Date.parse(item))
    .filter((item) => Number.isFinite(item));
  return times.length ? Math.max(...times) : null;
}

function scoreReadableFileName(name) {
  const text = String(name || "");
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const replacement = (text.match(/\uFFFD/g) || []).length;
  const mojibake = (text.match(/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length;
  return chinese * 4 - replacement * 6 - mojibake;
}

function normalizeDisplayFileName(name) {
  const originalName = String(name || "");
  if (!originalName || typeof TextDecoder === "undefined") return originalName;
  try {
    const bytes = Uint8Array.from(Array.from(originalName, (char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return scoreReadableFileName(decoded) > scoreReadableFileName(originalName) ? decoded : originalName;
  } catch {
    return originalName;
  }
}

function renderCard(slot, record, labels) {
  const displayRecord = getDisplayRecord(record);
  const pending = hasPendingRecord(record) || (record && !record.appliedAt);
  const stateClass = pending ? "pending" : record?.appliedAt ? "applied" : "empty";
  const stateText = pending ? "待应用" : record?.appliedAt ? "当前引用" : "空";
  const fileName = normalizeDisplayFileName(displayRecord?.fileName || slot.expectedName);
  const month = displayRecord?.savedAt ? `${new Date(displayRecord.savedAt).getFullYear()}年${new Date(displayRecord.savedAt).getMonth() + 1}月` : "";
  const updateDate = displayRecord?.savedAt ? new Date(displayRecord.savedAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }) : "";

  if (!record) {
    return `
      <article class="library-card file-slot empty-card" data-slot-id="${slot.id}">
        <div class="slot-head">
          <span class="slot-kicker">${labels.slotLabel}</span>
          <span class="slot-state ${stateClass}">${stateText}</span>
        </div>
        <h2>${escapeHtml(slot.title)}</h2>
        <p class="slot-description">${escapeHtml(slot.description)}</p>
        <label class="drop-zone">
          <input class="slot-file-input" type="file" accept=".xlsx,.xlsm,.xls,.csv" data-file-input="${slot.id}">
          <strong>${labels.emptyAction}</strong>
          <span>刷新月份和更新日期会自动记录</span>
        </label>
        <div class="card-actions">
          <button type="button" data-save="${slot.id}">替换文件</button>
          <button class="secondary" type="button" data-apply="${slot.id}" disabled>应用刷新</button>
          <button class="danger" type="button" data-delete="${slot.id}" disabled>删除</button>
        </div>
        <p class="muted" id="status-${slot.id}"></p>
      </article>
    `;
  }

  return `
    <article class="library-card file-slot" data-slot-id="${slot.id}">
      <div class="slot-head">
        <span class="slot-kicker">${labels.slotLabel}</span>
        <span class="slot-state ${stateClass}">${stateText}</span>
      </div>
      <h2>${escapeHtml(slot.title)}</h2>
      <p class="slot-description">${escapeHtml(slot.description)}</p>
      <h3>${escapeHtml(fileName)}</h3>
      <p class="file-kind">Excel 工作簿 · ${formatFileSize(displayRecord.size || 0)}</p>
      <div class="slot-info">
        <span>刷新月份</span>
        <strong>${escapeHtml(month)}</strong>
      </div>
      <div class="slot-info">
        <span>更新日期</span>
        <strong>${escapeHtml(updateDate)}</strong>
      </div>
      <div class="slot-info path-info">
        <span>引用路径</span>
        <strong>${escapeHtml(recordReferencePath(record))}</strong>
      </div>
      ${renderParseStatus(displayRecord)}
      ${renderParseDiagnostics(displayRecord)}
      <input class="slot-file-input" type="file" accept=".xlsx,.xlsm,.xls,.csv" data-file-input="${slot.id}">
      <div class="card-actions">
        <button type="button" data-save="${slot.id}">替换文件</button>
        <button class="secondary" type="button" data-apply="${slot.id}">应用刷新</button>
        <button class="danger" type="button" data-delete="${slot.id}">删除</button>
      </div>
      <p class="muted" id="status-${slot.id}"></p>
    </article>
  `;
}

function bindCardEvents() {
  document.querySelectorAll(".file-slot").forEach((card) => {
    bindSlotDropEvents(card);
  });
  document.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => chooseSlotFile(button.dataset.save));
  });
  document.querySelectorAll("[data-file-input]").forEach((input) => {
    input.addEventListener("change", () => saveSlot(input.dataset.fileInput));
  });
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => clearSlot(button.dataset.delete));
  });
  document.querySelectorAll("[data-apply]").forEach((button) => {
    button.addEventListener("click", () => applySlot(button.dataset.apply));
  });
}

function applyCardPermissions() {
  if (libraryCanManage()) return;
  document.querySelectorAll(".slot-file-input").forEach((input) => {
    input.disabled = true;
  });
  document.querySelectorAll("[data-save], [data-apply], [data-delete]").forEach((button) => {
    button.disabled = true;
    button.style.display = "none";
  });
  document.querySelectorAll(".drop-zone").forEach((zone) => {
    zone.classList.add("readonly-zone");
    zone.style.pointerEvents = "none";
    const label = zone.querySelector("strong");
    const note = zone.querySelector("span");
    if (label) label.textContent = "文件由管理员维护";
    if (note) note.textContent = adminOnlyMessage();
  });
}

function bindSlotDropEvents(card) {
  if (!libraryCanManage()) return;
  const slotId = card.dataset.slotId;
  if (!slotId) return;
  ["dragenter", "dragover"].forEach((eventName) => {
    card.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.add("is-drag-over");
    });
  });
  ["dragleave", "dragend"].forEach((eventName) => {
    card.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (eventName === "dragleave" && card.contains(event.relatedTarget)) return;
      card.classList.remove("is-drag-over");
    });
  });
  card.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove("is-drag-over");
    await saveSlotFile(slotId, firstDroppedFile(event.dataTransfer));
  });
}

function firstDroppedFile(dataTransfer) {
  return [...(dataTransfer?.files || [])].find(Boolean) || null;
}

function chooseSlotFile(slotId) {
  if (!libraryCanManage()) {
    const status = $(`#status-${slotId}`);
    if (status) status.textContent = adminOnlyMessage();
    return;
  }
  const input = document.querySelector(`[data-file-input="${slotId}"]`);
  const status = $(`#status-${slotId}`);
  if (!input) return;
  input.value = "";
  setSlotStatus(slotId, "请选择要上传的 Excel 文件。");
  input.click();
}

async function saveSlot(slotId) {
  if (!libraryCanManage()) {
    const status = $(`#status-${slotId}`);
    if (status) status.textContent = adminOnlyMessage();
    return;
  }
  const slot = SLOT_BY_ID[slotId];
  const input = document.querySelector(`[data-file-input="${slotId}"]`);
  const status = $(`#status-${slotId}`);
  const file = input.files?.[0];
  if (!file) {
    setSlotStatus(slotId, "请先选择文件。");
    return;
  }

  try {
    selectedServerFiles.set(slotId, file);
    setSlotStatus(slotId, "正在本地浏览器解析文件...");
    setSingleUploadProgress(status, 5, "正在本地浏览器解析文件...");
    const parsedRecord = await readExcelFile(file, slot);
    setSlotStatus(slotId, "本地解析完成，正在上传原始文件和解析结果到腾讯云服务器...");
    setSingleUploadProgress(status, 15, "本地解析完成，正在上传原始文件和解析结果到腾讯云服务器...");
    const nextRecord = await uploadKcfxServerFile(slot, file, parsedRecord, {
      onProgress: ({ percent }) => setSingleUploadProgress(status, percent, "正在上传原始文件和解析结果到腾讯云服务器...")
    });
    await saveRecord(nextRecord);
    setLibraryLoadProgress(100, "已完成：已保存到腾讯云服务器。");
    setSlotStatus(slotId, "已完成：已保存到腾讯云服务器。");
    if (nextRecord?.parseStatus && nextRecord.parseStatus !== "ready") {
      setSlotStatus(slotId, "已完成：已保存到腾讯云服务器，后台解析中。");
      scheduleServerParseRefresh([slotId]);
      await renderLibrary();
      setSlotStatus(slotId, "已完成：已保存到腾讯云服务器，后台解析中。");
      return;
    }
    await loadSharedLibrary({ statusEl: $("#sharedStatus"), force: true, ids: [slotId] }).catch(() => null);
    setSlotStatus(slotId, "已上传到腾讯云服务器并解析保存，其他人刷新后会读取这份文件。");
    await renderLibrary();
    setSlotStatus(slotId, "已上传到腾讯云服务器并解析保存，其他人刷新后会读取这份文件。");
  } catch (error) {
    setSlotStatus(slotId, formatUploadError(error));
  }
}

async function saveSlotFile(slotId, file) {
  if (!libraryCanManage()) {
    const status = $(`#status-${slotId}`);
    if (status) status.textContent = adminOnlyMessage();
    return;
  }
  const slot = SLOT_BY_ID[slotId];
  const status = $(`#status-${slotId}`);
  if (!slot || !status) return;
  if (!file) {
    setSlotStatus(slotId, "请先选择或拖拽文件。");
    return;
  }
  if (!isAcceptedLibraryFile(file)) {
    setSlotStatus(slotId, "请上传 Excel 或 CSV 文件（.xlsx/.xlsm/.xls/.csv）。");
    return;
  }

  try {
    selectedServerFiles.set(slotId, file);
    setSlotStatus(slotId, "正在本地浏览器解析文件...");
    setSingleUploadProgress(status, 5, "正在本地浏览器解析文件...");
    const parsedRecord = await readExcelFile(file, slot);
    setSlotStatus(slotId, "本地解析完成，正在上传原始文件和解析结果到腾讯云服务器...");
    setSingleUploadProgress(status, 15, "本地解析完成，正在上传原始文件和解析结果到腾讯云服务器...");
    const nextRecord = await uploadKcfxServerFile(slot, file, parsedRecord, {
      onProgress: ({ percent }) => setSingleUploadProgress(status, percent, "正在上传原始文件和解析结果到腾讯云服务器...")
    });
    await saveRecord(nextRecord);
    setLibraryLoadProgress(100, "已完成：已保存到腾讯云服务器。");
    setSlotStatus(slotId, "已完成：已保存到腾讯云服务器。");
    if (nextRecord?.parseStatus && nextRecord.parseStatus !== "ready") {
      setSlotStatus(slotId, "已完成：已保存到腾讯云服务器，后台解析中。");
      scheduleServerParseRefresh([slotId]);
      await renderLibrary();
      setSlotStatus(slotId, "已完成：已保存到腾讯云服务器，后台解析中。");
      return;
    }
    await loadSharedLibrary({ statusEl: $("#sharedStatus"), force: true, ids: [slotId] }).catch(() => null);
    setSlotStatus(slotId, "已上传到腾讯云服务器并解析保存，其他人刷新后会读取这份文件。");
    await renderLibrary();
    setSlotStatus(slotId, "已上传到腾讯云服务器并解析保存，其他人刷新后会读取这份文件。");
  } catch (error) {
    setSlotStatus(slotId, formatUploadError(error));
  }
}

function isAcceptedLibraryFile(file) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(file?.name || "");
}

function formatUploadError(error) {
  const message = error?.message || String(error || "未知错误");
  if (/内存不足|Array buffer allocation failed|allocation failed|out of memory|memory/i.test(message)) {
    return `解析失败：${message}`;
  }
  if (/XLSX|解析组件|sheet_to_json|Excel/i.test(message)) {
    return `解析失败：Excel 解析组件未正常加载或文件格式无法识别。请点击“清除缓存”后刷新页面，再重新上传 .xlsx/.xlsm/.xls/.csv 文件。原始错误：${message}`;
  }
  return `解析失败：${message}`;
}

async function applySlot(slotId) {
  if (!libraryCanManage()) {
    const status = $(`#status-${slotId}`);
    if (status) status.textContent = adminOnlyMessage();
    return;
  }
  const record = await getRecord(slotId);
  if (!record) return;
  const nextRecord = promotePendingRecord(record);
  if (!nextRecord) return;
  await saveRecord(nextRecord);
  await renderLibrary();
  const status = $(`#status-${slotId}`);
  if (status) status.textContent = "应用成功，当前页面和看板会读取这份文件。";
  setLibraryStatus(`应用成功：${SLOT_BY_ID[slotId]?.title || slotId} 已更新。`);
}

async function clearSlot(slotId) {
  if (!libraryCanManage()) {
    const status = $(`#status-${slotId}`);
    if (status) status.textContent = adminOnlyMessage();
    return;
  }
  if (!window.confirm(`确认删除：${SLOT_BY_ID[slotId]?.title || slotId}？删除后刷新不会再从库存分析看板文件库自动恢复。`)) return;
  await deleteKcfxServerRecord(slotId);
  await deleteRecord(slotId);
  await renderLibrary();
}

async function clearAllLibraryCache() {
  if (!libraryCanManage()) {
    setLibraryStatus(adminOnlyMessage());
    return;
  }
  const slots = pageSlots();
  if (!window.confirm("确认清除当前页面的文件缓存？清除后需要重新上传本页面文件。")) return;
  setLibraryStatus("正在清除当前页面文件缓存...");
  for (const slot of slots) {
    await deleteRecord(slot.id);
  }
  await renderLibrary();
  setLibraryStatus("当前页面缓存已清除，请重新上传本页面文件并应用刷新。");
}

function recordReferencePath(record) {
  const source = record.libraryPath ? "库存分析看板文件库 + 浏览器本地库" : record.sharedSavedAt ? "GitHub共享包 + 浏览器本地库" : "浏览器本地库";
  const githubPath = record.libraryPath || `data/kcfx-library/${record.type === "fact" ? "fact" : "dimensions"}/${record.id}.json`;
  return `${source} / IndexedDB: ${KC_DB_NAME}/${KC_STORE}/${record.id} / GitHub: ${githubPath}`;
}

function renderParseStatus(record) {
  const status = record?.parseStatus || (record?.rows ? "ready" : "");
  if (!status) return "";
  const labels = {
    queued: "已保存，等待后台解析",
    parsing: "后台解析中",
    ready: "解析完成",
    failed: `解析失败：${record?.parseError || "请重新上传"}`
  };
  return `
    <div class="slot-info parse-status">
      <span>服务器状态</span>
      <strong>${escapeHtml(labels[status] || status)}</strong>
    </div>
  `;
}

function renderParseDiagnostics(record) {
  const diagnostics = record?.parseDiagnostics;
  if (!diagnostics) return "";
  const headerText = (diagnostics.headerFirst12 || []).filter(Boolean).join(" / ");
  const attemptedText = (diagnostics.attemptedHeaderRows || [])
    .slice(0, 5)
    .map((item) => `第${item.headerRowNumber}行 ${item.rowCount}行`)
    .join("；");
  const readModeText = diagnostics.readMode ? `；读取模式：${diagnostics.readMode}` : "";
  const gSamples = (diagnostics.gSamples || []).map((item) => normalizeText(item) || "-").join(" / ");
  const hSamples = (diagnostics.hSamples || []).map((item) => normalizeText(item) || "-").join(" / ");
  const adSamples = (diagnostics.adSamples || []).map((item) => normalizeText(item) || "-").join(" / ");
  return `
    <div class="slot-info parse-info">
      <span>解析诊断</span>
      <strong>Sheet：${escapeHtml(diagnostics.sheetName || "-")}；表头：第${escapeHtml(diagnostics.headerRowNumber || 1)}行${escapeHtml(readModeText)}；G列：${escapeHtml(diagnostics.gHeader || "-")}；H列：${escapeHtml(diagnostics.hHeader || "-")}；AD列：${escapeHtml(diagnostics.adHeader || "-")}</strong>
      <em>前12字段：${escapeHtml(headerText || "-")}</em>
      <em>兜底尝试：${escapeHtml(attemptedText || "-")}</em>
      <em>G列样例：${escapeHtml(gSamples || "-")}</em>
      <em>H列样例：${escapeHtml(hSamples || "-")}</em>
      <em>AD列样例：${escapeHtml(adSamples || "-")}</em>
    </div>
  `;
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function setLibraryStatus(message) {
  const status = $("#sharedStatus");
  if (status) status.textContent = message;
}
