/**
 * Format a timestamp as a relative time string ("2m ago", "1h ago", "3d ago").
 * Uses native Intl.RelativeTimeFormat — zero dependencies.
 */
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Infinity],
];

export function timeAgo(timestamp: number): string {
  let diff = (timestamp - Date.now()) / 1000; // seconds ago (negative)

  for (const [unit, threshold] of UNITS) {
    if (Math.abs(diff) < threshold) {
      return rtf.format(Math.round(diff), unit);
    }
    diff /= threshold;
  }
  return rtf.format(Math.round(diff), "year");
}

/**
 * Format a timestamp as a full date string for tooltips.
 */
export function fullDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Format a number with K/M suffixes for compact display.
 * 1234 → "1.2K", 1234567 → "1.2M"
 */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Get the epoch ms for the start of today (midnight local time).
 */
export function todayMidnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
