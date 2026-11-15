export function parseDbDate(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) return new Date(`${text.replace(' ', 'T')}Z`);
  return new Date(text);
}

export function formatDateTime(value) {
  return parseDbDate(value).toLocaleString();
}
