import React, { useEffect, useMemo, useState } from 'react';
import MultiFilter from './MultiFilter.jsx';
import MonthCalendarFilter from './MonthCalendarFilter.jsx';
import { normalizeText } from './kcfxUtils.js';

export function useDashboardFilters(rows, filters, { searchFields = [], searchValue = '', defaultSelections = {} } = {}) {
  const [openFilter, setOpenFilter] = useState('');
  const [selections, setSelections] = useState(() => emptySelections(filters, defaultSelections));
  const defaultSelectionKey = useMemo(() => JSON.stringify(defaultSelections || {}), [defaultSelections]);

  useEffect(() => {
    setSelections((current) => {
      let changed = false;
      const next = { ...current };
      for (const filter of filters) {
        const currentValues = current[filter.id] || [];
        const defaultValues = defaultSelections[filter.id] || [];
        if (!currentValues.length && defaultValues.length) {
          next[filter.id] = defaultValues;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [defaultSelectionKey, filters]);

  const { normalizedSelections, optionsById } = useMemo(() => {
    const firstOptionsById = buildLinkedOptions(rows, filters, selections);
    let changed = false;
    const nextSelections = Object.fromEntries(filters.map((filter) => {
      const currentValues = selections[filter.id] || [];
      const allowed = new Set((firstOptionsById[filter.id] || []).map((option) => option.value));
      const nextValues = currentValues.filter((value) => allowed.has(value));
      if (nextValues.length !== currentValues.length) changed = true;
      return [filter.id, nextValues];
    }));
    return {
      normalizedSelections: nextSelections,
      optionsById: changed ? buildLinkedOptions(rows, filters, nextSelections) : firstOptionsById
    };
  }, [filters, rows, selections]);
  const filteredRows = useMemo(() => {
    const query = normalizeText(searchValue).toLowerCase();
    return rows.filter((row) => {
      if (!rowMatchesSelections(row, filters, normalizedSelections)) return false;
      if (!query) return true;
      return searchFields.some((field) => normalizeText(row[field]).toLowerCase().includes(query));
    });
  }, [filters, normalizedSelections, rows, searchFields, searchValue]);

  function setFilterValue(id, value) {
    setSelections((current) => ({ ...current, [id]: value }));
  }

  function resetFilters() {
    setSelections(emptySelections(filters, defaultSelections));
    setOpenFilter('');
  }

  return {
    filteredRows,
    optionsById,
    selections: normalizedSelections,
    openFilter,
    setOpenFilter,
    setFilterValue,
    resetFilters
  };
}

export function FilterToolbar({ filters, optionsById, selections, openFilter, setOpenFilter, setFilterValue, resetFilters, searchValue, setSearchValue, searchPlaceholder = '搜索' }) {
  return (
    <section className="toolbar filter-toolbar" onClick={(event) => event.stopPropagation()}>
      <div className="filter-row">
        {filters.map((filter) => (
          filter.type === 'month' ? (
            <MonthCalendarFilter
              key={filter.id}
              id={filter.id}
              label={filter.allLabel}
              allLabel={filter.monthAllLabel || filter.allLabel}
              options={optionsById[filter.id] || []}
              selected={selections[filter.id] || []}
              onChange={(value) => setFilterValue(filter.id, value)}
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
            />
          ) : (
            <MultiFilter
              key={filter.id}
              id={filter.id}
              label={filter.allLabel}
              allLabel={filter.allLabel}
              options={optionsById[filter.id] || []}
              selected={selections[filter.id] || []}
              onChange={(value) => setFilterValue(filter.id, value)}
              openFilter={openFilter}
              setOpenFilter={setOpenFilter}
            />
          )
        ))}
        {setSearchValue && (
          <input
            className="kcfx-search-input"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={searchPlaceholder}
          />
        )}
        <button
          type="button"
          className="ghost compact-button"
          onClick={() => {
            resetFilters();
            setSearchValue?.('');
          }}
        >
          清空筛选
        </button>
      </div>
    </section>
  );
}

export function buildLinkedOptions(rows, filters, selections) {
  return Object.fromEntries(filters.map((filter) => [
    filter.id,
    linkedFilterValues(rows, filters, filter, selections).map((value) => ({
      value,
      label: filter.labelFormatter ? filter.labelFormatter(value) : value
    }))
  ]));
}

export function rowMatchesSelections(row, filters, selections, excludedFilterId = '') {
  return filters.every((filter) => {
    if (filter.id === excludedFilterId) return true;
    const selected = selections[filter.id] || [];
    if (!selected.length) return true;
    const value = normalizeText(row[filter.field]);
    if (filter.matchMonthNumber) {
      const rowMonth = value.slice(5, 7);
      return selected.some((selectedValue) => normalizeText(selectedValue).slice(5, 7) === rowMonth);
    }
    return selected.includes(value);
  });
}

export function uniqueValues(rows, field) {
  return [...new Set(rows.map((row) => normalizeText(row[field])).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function linkedFilterValues(rows, filters, targetFilter, selections) {
  const totals = new Map();
  for (const row of rows) {
    if (!rowMatchesSelections(row, filters, selections, targetFilter.id)) continue;
    const value = normalizeText(row[targetFilter.field]);
    if (!value) continue;
    totals.set(value, (totals.get(value) || 0) + (Number(row[targetFilter.sortValueField || 'qty']) || Number(row.amount) || Number(row.value) || 1));
  }
  const values = [...totals.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort((a, b) => {
      if (targetFilter.sortByName) return a[0].localeCompare(b[0], 'zh-CN');
      return b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN');
    })
    .map(([value]) => value);
  return targetFilter.preferredOrder ? sortByPreferredOrder(values, targetFilter.preferredOrder) : values;
}

function sortByPreferredOrder(values, preferredOrder) {
  const order = new Map(preferredOrder.map((value, index) => [value, index]));
  return [...values].sort((a, b) => {
    const ai = order.has(a) ? order.get(a) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b) ? order.get(b) : Number.MAX_SAFE_INTEGER;
    return ai - bi || a.localeCompare(b, 'zh-CN');
  });
}

function emptySelections(filters, defaultSelections = {}) {
  return Object.fromEntries(filters.map((filter) => [filter.id, [...(defaultSelections[filter.id] || [])]]));
}
