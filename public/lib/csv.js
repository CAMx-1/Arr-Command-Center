// CSV export helpers (RFC 4180 quoting) and a browser download.

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Spreadsheet formula injection: a cell starting with = + - @ is treated as
  // a formula by Excel/Sheets; prefix it so it stays text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows || []) lines.push(r.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(filename, text) {
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[:T]/g, '-');
