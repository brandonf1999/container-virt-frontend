import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type SortValue = string | number | boolean | null | undefined;

export type TableColumn<Row> = {
  id: string;
  label: string;
  sortable?: boolean;
  sortAccessor?: (row: Row) => SortValue;
  sortComparer?: (a: Row, b: Row) => number;
  renderCell: (row: Row) => ReactNode;
};

export type SortDirection = "asc" | "desc";
export type SortState = { columnId: string; direction: SortDirection };

function compareValues(a: SortValue, b: SortValue): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function readStoredColumns(storageKey: string | undefined, fallback: string[], validIds: Set<string>) {
  if (!storageKey || typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((id: unknown): id is string => typeof id === "string" && validIds.has(id));
      if (filtered.length > 0) {
        return filtered;
      }
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

interface TableStateOptions {
  defaultVisible?: string[];
  storageKey?: string;
  minVisible?: number;
  initialSort?: SortState | null;
}

export function useTableState<Row>(
  columns: TableColumn<Row>[],
  rows: Row[],
  options: TableStateOptions = {},
) {
  const { defaultVisible, storageKey, minVisible = 1, initialSort = null } = options;

  const columnOrder = useMemo(() => columns.map((column) => column.id), [columns]);
  const columnsById = useMemo(() => {
    const map = new Map<string, TableColumn<Row>>();
    columns.forEach((column) => {
      map.set(column.id, column);
    });
    return map;
  }, [columns]);

  const defaultVisibleIds = useMemo(() => {
    const declared = defaultVisible && defaultVisible.length > 0 ? defaultVisible : columnOrder;
    const filtered = declared.filter((id) => columnsById.has(id));
    return filtered.length > 0 ? filtered : columnOrder;
  }, [columnOrder, columnsById, defaultVisible]);

  const [visibleIds, setVisibleIds] = useState<string[]>(() =>
    readStoredColumns(storageKey, defaultVisibleIds, new Set(columnOrder)),
  );

  useEffect(() => {
    setVisibleIds((prev) => {
      const valid = prev.filter((id) => columnsById.has(id));
      if (valid.length === prev.length && prev.length > 0) return prev;
      const fallback = valid.length > 0 ? valid : defaultVisibleIds;
      return fallback;
    });
  }, [columnsById, defaultVisibleIds]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visibleIds));
    } catch {
      /* ignore */
    }
  }, [storageKey, visibleIds]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => visibleIds.includes(column.id)),
    [columns, visibleIds],
  );
  const hiddenColumnIds = useMemo(
    () => columns.map((column) => column.id).filter((id) => !visibleIds.includes(id)),
    [columns, visibleIds],
  );

  const [sortState, setSortState] = useState<SortState | null>(initialSort);

  useEffect(() => {
    if (!sortState) return;
    const column = columnsById.get(sortState.columnId);
    if (!column || !column.sortable) {
      setSortState(null);
    }
  }, [columnsById, sortState]);

  const sortedRows = useMemo(() => {
    if (!sortState) return rows;
    const column = columnsById.get(sortState.columnId);
    if (!column || !column.sortable) return rows;

    const { sortComparer, sortAccessor } = column;
    if (!sortComparer && !sortAccessor) return rows;

    const data = [...rows];
    data.sort((a, b) => {
      const result = sortComparer
        ? sortComparer(a, b)
        : compareValues(sortAccessor ? sortAccessor(a) : undefined, sortAccessor ? sortAccessor(b) : undefined);
      return sortState.direction === "asc" ? result : -result;
    });
    return data;
  }, [columnsById, rows, sortState]);

  const toggleColumn = useCallback(
    (id: string) => {
      setVisibleIds((prev) => {
        const isVisible = prev.includes(id);
        if (isVisible) {
          if (prev.length <= minVisible) return prev;
          return prev.filter((value) => value !== id);
        }
        if (!columnsById.has(id)) return prev;
        const next = [...prev, id];
        next.sort((a, b) => columnOrder.indexOf(a) - columnOrder.indexOf(b));
        return next;
      });
    },
    [columnOrder, columnsById, minVisible],
  );

  const canToggleColumn = useCallback(
    (id: string) => {
      const isVisible = visibleIds.includes(id);
      if (!isVisible) return true;
      return visibleIds.length > minVisible;
    },
    [minVisible, visibleIds],
  );

  const requestSort = useCallback(
    (columnId: string) => {
      const column = columnsById.get(columnId);
      if (!column || !column.sortable) return;
      setSortState((prev) => {
        if (!prev || prev.columnId !== columnId) {
          return { columnId, direction: "asc" };
        }
        if (prev.direction === "asc") {
          return { columnId, direction: "desc" };
        }
        return null;
      });
    },
    [columnsById],
  );

  return {
    columns,
    visibleColumns,
    visibleColumnIds: visibleIds,
    hiddenColumnIds,
    toggleColumn,
    canToggleColumn,
    allColumns: columns,
    sortedRows,
    sortState,
    requestSort,
  } as const;
}
