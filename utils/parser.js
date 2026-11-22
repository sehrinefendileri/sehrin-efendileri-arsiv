export function parseNumber(str) {
  if (!str) return 0;
  const clean = String(str).split('(')[0].trim();
  const parsed = parseInt(clean.replace(/\./g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
export function parsePercent(str) {
  if (!str) return 0;
  const match = String(str).match(/\(([\d.]+)%\)/);
  if (match) return parseFloat(match[1]);
  const direct = String(str).match(/([\d.]+)/);
  return direct ? parseFloat(direct[1]) : 0;
}
