const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
  useGrouping: false,
});

const signedPercentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
  useGrouping: false,
  signDisplay: "exceptZero",
});

/** Format a percentage for display only; never round the value used by calculations. */
export function formatDisplayPercent(value: number, signed = false): string {
  return `${(signed ? signedPercentFormatter : percentFormatter).format(value)}%`;
}