export function normalizeText(text) {
  return String(text ?? '').toLowerCase().trim()
    .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ü/g,'u')
    .replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g');
}
