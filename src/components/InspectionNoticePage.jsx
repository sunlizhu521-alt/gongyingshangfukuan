import React from 'react';
import { INSPECTION_NOTICE_FIELDS, INSPECTION_DEPARTMENT_OPTIONS } from '../constants.js';
import { fuzzyMatchOption } from '../utils.js';
import DataTable from './DataTable.jsx';

export default function InspectionNoticePage({
  user,
  inspectionNoticeRows,
  inspectionNoticeSubmission,
  inspectionSupplierShortNameOptions,
  inspectionProductLineOptions,
  inspectionSeriesOptionsForProductLine,
  openFilter,
  setOpenFilter,
  updateInspectionNoticeRow,
  deleteInspectionNoticeRow,
  addInspectionNoticeRow,
  confirmInspectionNotice
}) {
  return (
    <>
      <div className="section-heading-row">
        <h2>验货通知</h2>
        <span className="section-count">共 {inspectionNoticeRows.length} 条</span>
        {inspectionNoticeSubmission.submittedAt && (
          <span className="section-count">已提交：{inspectionNoticeSubmission.submittedAt}</span>
        )}
        <button type="button" className="ghost" onClick={addInspectionNoticeRow}>新增一行</button>
        <button type="button" onClick={confirmInspectionNotice}>确认提交</button>
      </div>
      <DataTable
        className="inspection-notice-table"
        rows={inspectionNoticeRows}
        columns={[...INSPECTION_NOTICE_FIELDS.map((field) => field.label), '操作']}
        render={(row) => [
          ...INSPECTION_NOTICE_FIELDS.map((field) => {
            if (field.readonly) {
              return <span className="readonly-cell">{field.key === 'inspectionApplicant' ? user.name : row[field.key] || ''}</span>;
            }
            if (field.multiSelect) {
              const selected = Array.isArray(row[field.key]) ? row[field.key] : [];
              const dropdownId = `inspection-department-${row.id}`;
              const isOpen = openFilter === dropdownId;
              const buttonText = selected.length === 0
                ? '选择事业部'
                : selected.length === 1
                  ? selected[0]
                  : `已选${selected.length}项`;
              const toggleDepartment = (option) => {
                const nextSelected = selected.includes(option)
                  ? selected.filter((item) => item !== option)
                  : [...selected, option];
                updateInspectionNoticeRow(row.id, field.key, nextSelected);
              };
              return (
                <div className="inspection-department-select multi-filter">
                  <button
                    type="button"
                    className="inspection-department-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenFilter(isOpen ? '' : dropdownId);
                    }}
                  >
                    {buttonText}
                  </button>
                  {isOpen && (
                    <div className="inspection-department-menu" onClick={(event) => event.stopPropagation()}>
                      {INSPECTION_DEPARTMENT_OPTIONS.map((option) => (
                        <label key={option}>
                          <input
                            type="checkbox"
                            checked={selected.includes(option)}
                            onChange={() => toggleDepartment(option)}
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            if (field.select) {
              if (field.key === 'supplierShortName') {
                const dropdownId = `inspection-supplier-${row.id}`;
                const isOpen = openFilter === dropdownId;
                const matchedOptions = inspectionSupplierShortNameOptions
                  .filter((option) => fuzzyMatchOption(option.value, row.supplierShortName))
                  .slice(0, 30);
                return (
                  <div className="inspection-supplier-combobox" onClick={(event) => event.stopPropagation()}>
                    <input
                      className="table-input inspection-notice-input"
                      value={row.supplierShortName || ''}
                      placeholder="输入供应商"
                      onFocus={() => setOpenFilter(dropdownId)}
                      onClick={() => setOpenFilter(dropdownId)}
                      onChange={(event) => {
                        setOpenFilter(dropdownId);
                        updateInspectionNoticeRow(row.id, field.key, event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && matchedOptions[0]) {
                          event.preventDefault();
                          updateInspectionNoticeRow(row.id, field.key, matchedOptions[0].value);
                          setOpenFilter('');
                        }
                        if (event.key === 'Escape') setOpenFilter('');
                      }}
                    />
                    {isOpen && (
                      <div className="inspection-supplier-menu">
                        {matchedOptions.length ? matchedOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className="inspection-supplier-option"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              updateInspectionNoticeRow(row.id, field.key, option.value);
                              setOpenFilter('');
                            }}
                          >
                            {option.label}
                          </button>
                        )) : (
                          <div className="inspection-supplier-empty">无匹配供应商</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              const baseOptions = field.key === 'supplierShortName'
                ? inspectionSupplierShortNameOptions
                : field.key === 'salesProductLine'
                  ? inspectionProductLineOptions
                  : field.key === 'series'
                    ? appendOtherOption(inspectionSeriesOptionsForProductLine(row.salesProductLine))
                    : (field.options || []).map((option) => ({ value: option, label: option }));
              const hasCurrentValue = field.key !== 'supplierShortName' && row[field.key] && !baseOptions.some((option) => option.value === row[field.key]);
              const options = hasCurrentValue
                ? [{ value: row[field.key], label: row[field.key] }, ...baseOptions]
                : baseOptions;
              const placeholder = field.key === 'series' && !row.salesProductLine
                ? '先选择产品线'
                : field.placeholder || (field.key === 'supplierShortName' ? '选择供应商' : '选择');
              return (
                <select
                  className="table-input inspection-notice-input"
                  value={row[field.key] || ''}
                  disabled={field.key === 'series' && !row.salesProductLine}
                  onChange={(event) => updateInspectionNoticeRow(row.id, field.key, event.target.value)}
                >
                  <option value="">{placeholder}</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              );
            }
            return field.multiline ? (
              <textarea
                className="table-textarea inspection-notice-input"
                value={row[field.key] || ''}
                onChange={(event) => updateInspectionNoticeRow(row.id, field.key, event.target.value)}
              />
            ) : (
              <input
                type={field.inputType || 'text'}
                className="table-input inspection-notice-input"
                value={row[field.key] || ''}
                onChange={(event) => updateInspectionNoticeRow(row.id, field.key, event.target.value)}
              />
            );
          }),
          <button type="button" className="danger-button" onClick={() => deleteInspectionNoticeRow(row.id)}>删除</button>
        ]}
      />
    </>
  );
}

function appendOtherOption(options) {
  return options.some((option) => option.value === '其他')
    ? options
    : [...options, { value: '其他', label: '其他' }];
}
