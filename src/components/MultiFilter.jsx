import React, { useEffect, useRef } from 'react';

function MultiFilter({ id, label, allLabel, options, selected = [], onChange, openFilter, setOpenFilter }) {
  const isOpen = openFilter === id;
  const rootRef = useRef(null);
  const selectedLabels = selected
    .map((value) => options.find((option) => option.value === value)?.label || value)
    .filter(Boolean);
  const buttonText = selectedLabels.length === 0
    ? allLabel
    : selectedLabels.length <= 2
      ? selectedLabels.join('、')
      : `已选${selectedLabels.length}项`;

  function toggle(value) {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
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
    <div className="multi-filter" ref={rootRef}>
      <button
        type="button"
        className="multi-filter-button"
        aria-label={label || allLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setOpenFilter(isOpen ? '' : id)}
      >
        {buttonText}
      </button>
      {isOpen && (
        <div className="multi-filter-menu" role="listbox">
          <label>
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            全部
          </label>
          {options.map((option) => (
            <label key={option.value} title={option.label}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default MultiFilter;
