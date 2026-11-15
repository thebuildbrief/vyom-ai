/** Read the interview identifier from the path used by the app's manual router. */
export function interviewIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/interview\/([^/?#]+)(?:\/|$)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); }
  catch { return ''; }
}
