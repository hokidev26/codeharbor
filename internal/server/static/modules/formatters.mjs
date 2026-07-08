export function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("zh-CN").format(number);
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "$0.0000";
  return `$${number.toFixed(number >= 1 ? 2 : 4)}`;
}

export function formatDuration(ms) {
  const number = Number(ms || 0);
  if (!Number.isFinite(number) || number <= 0) return "0 ms";
  if (number < 1000) return `${Math.round(number)} ms`;
  if (number < 60000) return `${(number / 1000).toFixed(1)} s`;
  return `${(number / 60000).toFixed(1)} min`;
}

export function formatTimestamp(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}
