export function formatDistance(meters: number) {
  return `${(meters / 1000).toFixed(2)} км`;
}

export function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatPace(averageSpeed: number | null | undefined) {
  if (!averageSpeed || averageSpeed <= 0) {
    return "—";
  }
  const roundedSeconds = Math.round(1000 / averageSpeed);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/км`;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// Относительное время для ленты: «только что», «25 мин назад», «3 ч назад»,
// «вчера, 19:20», иначе дата.
export function formatAgo(value: string) {
  const then = new Date(value);
  const diffMs = Date.now() - then.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} ${pluralRu(min, "мин", "мин", "мин")} назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${pluralRu(hours, "ч", "ч", "ч")} назад`;
  const time = then.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (hours < 48) return `вчера, ${time}`;
  return then.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Километры для сводок: «24,6», от 100 км — без десятых
export function formatKm(meters: number, digits?: number) {
  const km = meters / 1000;
  const fraction = digits ?? (km >= 100 ? 0 : 1);
  return km.toLocaleString("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
}

export function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}
