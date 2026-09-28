function getUtcDay(value?: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      parsedDate.getUTCFullYear() !== year
      || parsedDate.getUTCMonth() !== month - 1
      || parsedDate.getUTCDate() !== day
    ) {
      return null;
    }
  }

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getActivityDurationWeight(
  plannedStartDate?: string | null,
  plannedEndDate?: string | null,
): number {
  const startDay = getUtcDay(plannedStartDate);
  const endDay = getUtcDay(plannedEndDate);
  if (startDay === null || endDay === null || endDay < startDay) return 1;
  return (endDay - startDay) / 86_400_000 + 1;
}