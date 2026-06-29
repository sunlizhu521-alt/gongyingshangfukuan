import React, { useEffect, useRef } from 'react';

export default function MonthCalendarFilter({
  id,
  label,
  allLabel,
  options = [],
  selected = [],
  onChange,
  openFilter,
  setOpenFilter
}) {
  const isOpen = openFilter === id;
  const rootRef = useRef(null);
  const optionValues = options.map((option) => option.value).filter(Boolean).sort();
  const value = selected[0] || '';
  const selectedLabel = options.find((option) => option.value === value)?.label || value;
  const buttonText = value ? selectedLabel : allLabel;
  const min = optionValues[0] || '';
  const max = optionValues[optionValues.length - 1] || '';

  function changeMonth(nextValue) {
    onChange(nextValue ? [nextValue] : []);
    setOpenFilter('');
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    function closeOnOutsidePointer(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpenFilter('');
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen, setOpenFilter]);

  return (
    <div className="month-calendar-filter" ref={rootRef}>
      <button
        type="button"
        className="month-filter-trigger"
        aria-label={label || allLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setOpenFilter(isOpen ? '' : id)}
      >
        <span className="month-filter-icon" aria-hidden="true">月</span>
        <span className="month-filter-text">{buttonText}</span>
        <span className="month-filter-caret" aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <div className="month-filter-menu" role="dialog" aria-label={label || allLabel}>
          <div className="month-filter-menu-title">{label}</div>
          <input
            type="month"
            value={value}
            min={min}
            max={max}
            onChange={(event) => changeMonth(event.target.value)}
          />
          <button type="button" className="month-filter-all" onClick={() => changeMonth('')}>
            {allLabel}
          </button>
        </div>
      )}
    </div>
  );
}
