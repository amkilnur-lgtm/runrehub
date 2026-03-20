export type WorkoutCursor = {
  beforeDate: string;
  beforeId: number;
};

export function hasPartialCursor(input: {
  beforeDate?: string;
  beforeId?: number;
}) {
  return (input.beforeDate === undefined) !== (input.beforeId === undefined);
}

export function buildNextCursor<T extends { id: number; start_date: string | Date }>(
  rows: T[],
  pageSize: number
): WorkoutCursor | null {
  const lastRow = rows[rows.length - 1];
  if (!lastRow || rows.length !== pageSize) {
    return null;
  }

  return {
    beforeDate:
      lastRow.start_date instanceof Date
        ? lastRow.start_date.toISOString()
        : new Date(lastRow.start_date).toISOString(),
    beforeId: lastRow.id
  };
}
