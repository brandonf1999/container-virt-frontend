import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TableColumn } from "./useTableState";

type ColumnSelectorProps<Row> = {
  columns: TableColumn<Row>[];
  visibleColumnIds: string[];
  toggleColumn: (id: string) => void;
  canToggleColumn: (id: string) => boolean;
};

export function ColumnSelector<Row>({ columns, visibleColumnIds, toggleColumn, canToggleColumn }: ColumnSelectorProps<Row>) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [panelCoords, setPanelCoords] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(event: MouseEvent) {
      if (!panelRef.current) return;
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const updatePanelPosition = useCallback(() => {
    if (!triggerRef.current || !panelRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();

    let top = triggerRect.bottom + 8;
    if (top + panelRect.height > window.innerHeight - 12) {
      top = Math.max(12, triggerRect.top - 8 - panelRect.height);
    }

    const right = Math.max(12, window.innerWidth - triggerRect.right);
    setPanelCoords({ top, right });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
  }, [open, updatePanelPosition, columns, visibleColumnIds]);

  useEffect(() => {
    if (!open) return undefined;
    const handleResize = () => updatePanelPosition();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [open, updatePanelPosition]);

  return (
    <div className="column-selector">
      <button
        ref={triggerRef}
        type="button"
        className="column-selector__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Choose columns"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <span aria-hidden="true" className="column-selector__icon">
          <svg width="4" height="20" viewBox="0 0 4 16" fill="currentColor">
            <circle cx="2" cy="2" r="2" />
            <circle cx="2" cy="8" r="2" />
            <circle cx="2" cy="14" r="2" />
          </svg>
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className="column-selector__panel column-selector__panel--floating"
          style={{ position: "fixed", top: panelCoords?.top ?? 0, right: panelCoords?.right ?? 12 }}
        >
          {columns.map((column) => {
            const checked = visibleColumnIds.includes(column.id);
            const disabled = !canToggleColumn(column.id);
            return (
              <label key={column.id} className="column-selector__item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleColumn(column.id)}
                  disabled={checked && disabled}
                />
                <span>{column.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
