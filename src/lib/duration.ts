import type { Locale } from './i18n';

/** Format nonnegative elapsed `milliseconds` in the most useful unit for `locale`.
 * Milliseconds remain exact below a second; seconds/minutes use at most one decimal.
 * Unit selection uses display precision to avoid rounded 60 s or 1,000 ms boundaries.
 */
export function formatDuration(milliseconds: number, locale: Locale): string {
  const ms = Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds)) : 0;
  const seconds = Math.round(ms / 100) / 10;
  const unit = ms < 1000 ? 'ms' : seconds < 60 ? 's' : 'min';
  const value = unit === 'ms' ? ms : unit === 's' ? seconds : ms / 60_000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'ms' ? 0 : 1 }).format(value)} ${unit}`;
}
