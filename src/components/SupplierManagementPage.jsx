import React from 'react';
import DataTable from './DataTable.jsx';
import MultiFilter from './MultiFilter.jsx';
import OwnerManagementPage from './OwnerManagementPage.jsx';

export default function SupplierManagementPage({
  suppliers,
  owners,
  supplierStats,
  supplierImportResult,
  ownerImportResult,
  ownerOptions,
  ownerFilter,
  setOwnerFilter,
  uploadSupplierTerms,
  uploadOwners,
  downloadImportResult,
  dimensionShortNameOptions,
  dimensionShortNameFilter,
  setDimensionShortNameFilter,
  dimensionOwnerOptions,
  dimensionOwnerFilter,
  setDimensionOwnerFilter,
  dimensionAnnualOptions,
  dimensionAnnualFilter,
  setDimensionAnnualFilter,
  openFilter,
  setOpenFilter,
  resetDimensionFilters,
  downloadAppliedPreview,
  filteredAppliedDimensionRows,
  supplierFilter,
  setSupplierFilter,
  supplierOptions,
  supplierFilterOptions,
  handleSupplierChange,
  downloadSuppliers,
  addSupplier,
  addOwner,
  deleteOwner,
  deleteSupplier,
  uploadSuppliers
}) {
  void supplierFilter;
  void setSupplierFilter;
  void supplierOptions;
  void supplierFilterOptions;
  void handleSupplierChange;
  void downloadSuppliers;
  void addSupplier;
  void deleteSupplier;
  void uploadSuppliers;

  return (
    <>
      <h2>供应商管理维度表</h2>
      <div className="metric-grid">
        <div className="metric-card">
          <span>供应商数量</span>
          <strong>{supplierStats.total}</strong>
        </div>
        <div className="metric-card">
          <span>成功的供应商数量</span>
          <strong>{supplierStats.success}</strong>
        </div>
        <div className="metric-card">
          <span>失败的供应商数量</span>
          <strong>{supplierStats.failed}</strong>
        </div>
      </div>
      <div className="management-grid">
        <section>
          <h3>供应商账期维度表</h3>
          <label
            className="mini-drop-zone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); uploadSupplierTerms(event.dataTransfer.files); }}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => uploadSupplierTerms(event.target.files)}
            />
            <span>点击或拖拽上传账期维度表</span>
          </label>
          {supplierImportResult && (
            <div className="import-summary">
              <strong>读取结果</strong>
              <span>成功 {supplierImportResult.importedCount} 行，失败 {supplierImportResult.failedCount} 行</span>
              {supplierImportResult.failedCount > 0 && (
                <span>失败行：{supplierImportResult.failed.slice(0, 3).map((item) => `${item.rowNumber}行`).join('、')}</span>
              )}
              <button className="ghost" onClick={() => downloadImportResult('supplier', supplierImportResult)}>下载识别结果</button>
            </div>
          )}
          <DataTable
            className="limited-table"
            rows={suppliers}
            columns={['供应商', '供应商简称', '账期']}
            render={(row) => [row.name, row.shortName || row.name, `${row.termDays} 天`]}
          />
        </section>
        <OwnerManagementPage
          owners={owners}
          ownerOptions={ownerOptions}
          ownerFilter={ownerFilter}
          setOwnerFilter={setOwnerFilter}
          ownerImportResult={ownerImportResult}
          openFilter={openFilter}
          setOpenFilter={setOpenFilter}
          addOwner={addOwner}
          deleteOwner={deleteOwner}
          uploadOwners={uploadOwners}
          downloadImportResult={downloadImportResult}
        />
      </div>
      <section className="applied-preview">
        <div className="section-heading-row">
          <h3>应用的表预览</h3>
          <div className="filter-row" onClick={(event) => event.stopPropagation()}>
            <MultiFilter
              id="dimensionShortName"
              label="供应商简称"
              allLabel="供应商简称"
              options={dimensionShortNameOptions}
              selected={dimensionShortNameFilter}
              onChange={setDimensionShortNameFilter}
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
            />
            <MultiFilter
              id="dimensionOwner"
              label="采购员"
              allLabel="采购员"
              options={dimensionOwnerOptions}
              selected={dimensionOwnerFilter}
              onChange={setDimensionOwnerFilter}
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
            />
            <MultiFilter
              id="dimensionAnnual"
              label="是否有年框"
              allLabel="是否有年框"
              options={dimensionAnnualOptions}
              selected={dimensionAnnualFilter}
              onChange={setDimensionAnnualFilter}
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
            />
            <button className="ghost compact-button" onClick={resetDimensionFilters}>清空筛选</button>
            <button className="ghost compact-button" onClick={downloadAppliedPreview}>下载预览</button>
          </div>
        </div>
        <DataTable
          className="applied-preview-table"
          rows={filteredAppliedDimensionRows}
          columns={['供应商', '供应商简称', '采购员', '是否有年框', '账期', '备注信息']}
          render={(row) => [
            row.supplier,
            row.shortName,
            row.owner,
            row.hasAnnualFrame,
            row.termDays ? `${row.termDays} 天` : '',
            row.remark
          ]}
        />
      </section>
    </>
  );
}
