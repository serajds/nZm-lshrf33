export function parseActivityWeight(value: string): number | null {
  if (!value.trim()) return null;
  const weight = Number(value);
  return Number.isFinite(weight) && weight >= 0.01 && weight <= 100 ? weight : null;
}
