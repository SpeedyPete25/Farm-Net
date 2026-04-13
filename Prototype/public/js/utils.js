export function showError(element, message) {
  element.textContent = message;
}

export function formatDuration(duration) {
  const value = Number(duration);
  if (!Number.isFinite(value)) return `${duration}h`;
  const minutes = Math.round(value * 60);
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes} min`;
}

export function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function getNextQuarterTime() {
  const now = new Date();
  const nextQuarter = Math.ceil(now.getMinutes() / 15) * 15;
  let hours = now.getHours();
  let minutes = nextQuarter;

  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  if (hours >= 24) {
    return '23:45';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
