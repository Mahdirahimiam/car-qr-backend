const digitMap = new Map([
  ['۰', '0'], ['۱', '1'], ['۲', '2'], ['۳', '3'], ['۴', '4'],
  ['۵', '5'], ['۶', '6'], ['۷', '7'], ['۸', '8'], ['۹', '9'],
  ['٠', '0'], ['١', '1'], ['٢', '2'], ['٣', '3'], ['٤', '4'],
  ['٥', '5'], ['٦', '6'], ['٧', '7'], ['٨', '8'], ['٩', '9']
]);

export function normalizeIranianMobile(value) {
  const digits = Array.from(String(value || ''))
    .map((character) => digitMap.get(character) || character)
    .join('')
    .replace(/\D/g, '');

  let normalized = digits;
  if (/^00989\d{9}$/.test(digits)) normalized = `0${digits.slice(4)}`;
  else if (/^989\d{9}$/.test(digits)) normalized = `0${digits.slice(2)}`;
  else if (/^9\d{9}$/.test(digits)) normalized = `0${digits}`;

  return /^09\d{9}$/.test(normalized) ? normalized : null;
}
