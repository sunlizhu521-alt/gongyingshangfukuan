import React from 'react';
import DataTable from './DataTable.jsx';
import MultiFilter from './MultiFilter.jsx';

export default function OwnerManagementPage({
  owners,
  ownerOptions,
  ownerFilter,
  setOwnerFilter,
  ownerImportResult,
  openFilter,
  setOpenFilter,
  addOwner,
  deleteOwner,
  uploadOwners,
  downloadImportResult
}) {
  void MultiFilter;
  void ownerOptions;
  void ownerFilter;
  void setOwnerFilter;
  void openFilter;
  void setOpenFilter;
  void addOwner;
  void deleteOwner;

  return (
    <section>
      <h3>采购负责人维度表</h3>
      <label
        className="mini-drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); uploadOwners(event.dataTransfer.files); }}
      >
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(event) => uploadOwners(event.target.files)}
        />
        <span>点击或拖拽上传采购负责人维度表</span>
      </label>
      {ownerImportResult && (
        <div className="import-summary">
          <strong>读取结果</strong>
          <span>成功 {ownerImportResult.importedCount} 行，失败 {ownerImportResult.failedCount} 行</span>
          {ownerImportResult.failedCount > 0 && (
            <span>失败行：{ownerImportResult.failed.slice(0, 3).map((item) => `${item.rowNumber}行`).join('、')}</span>
          )}
          <button className="ghost" onClick={() => downloadImportResult('owner', ownerImportResult)}>下载识别结果</button>
        </div>
      )}
      <DataTable
        className="limited-table"
        rows={owners}
        columns={['采购人', '邮箱', '供应商']}
        render={(row) => [row.owner, row.email || '', row.supplier]}
      />
    </section>
  );
}
