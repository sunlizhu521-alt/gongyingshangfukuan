import React from 'react';
import DataTable from './DataTable.jsx';
import MultiFilter from './MultiFilter.jsx';

export default function RemindersPage({
  logRows,
  filteredLogRows,
  logSecondPageOptions,
  logSecondPageFilter,
  setLogSecondPageFilter,
  logThirdPageOptions,
  logThirdPageFilter,
  setLogThirdPageFilter,
  logStartDate,
  setLogStartDate,
  logEndDate,
  setLogEndDate,
  openFilter,
  setOpenFilter,
  resetLogFilters
}) {
  return (
    <>
      <div className="section-heading-row">
        <h2>操作日志</h2>
        <span className="section-count">筛选结果 {filteredLogRows.length} / {logRows.length}</span>
      </div>
      <div className="filter-row log-filter-row" onClick={(event) => event.stopPropagation()}>
        <MultiFilter
          id="logSecondPage"
          label="二级页面"
          allLabel="二级页面"
          options={logSecondPageOptions}
          selected={logSecondPageFilter}
          onChange={setLogSecondPageFilter}
          openFilter={openFilter}
          setOpenFilter={setOpenFilter}
        />
        <MultiFilter
          id="logThirdPage"
          label="三级页面"
          allLabel="三级页面"
          options={logThirdPageOptions}
          selected={logThirdPageFilter}
          onChange={setLogThirdPageFilter}
          openFilter={openFilter}
          setOpenFilter={setOpenFilter}
        />
        <div className="date-filter">
          <span>开始时间</span>
          <input
            type="date"
            value={logStartDate}
            onChange={(event) => setLogStartDate(event.target.value)}
          />
        </div>
        <div className="date-filter">
          <span>结束时间</span>
          <input
            type="date"
            value={logEndDate}
            onChange={(event) => setLogEndDate(event.target.value)}
          />
        </div>
        <button className="ghost compact-button" onClick={resetLogFilters}>清空筛选</button>
      </div>
      <DataTable
        rows={filteredLogRows}
        columns={['时间', '二级页面', '三级页面', '类型', '对象', '内容']}
        render={(row) => [row.createdAt, row.secondPage, row.thirdPage, row.type, row.target, row.content]}
      />
    </>
  );
}
