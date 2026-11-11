// Личные пульсовые зоны (server/src/lib/hr-zones.ts): 5 зон Фрила от порогового пульса.
// bounds — верхние границы Z1–Z4 включительно.
export type AthleteHrZones = {
  bounds: [number, number, number, number];
  lthr: number;
  max_hr: number | null;
  source: "coach" | "intervals" | "estimate" | "default";
  ignored_icu_max?: number | null;
};

// без данных — клубный порог 170 (как на сервере)
export const DEFAULT_HR_ZONES: AthleteHrZones = { bounds: [144, 152, 161, 169], lthr: 170, max_hr: null, source: "default", ignored_icu_max: null };

export function zoneIndex(bpm: number, bounds: number[]) {
  let index = 0;
  while (index < 4 && bpm > bounds[index]!) index += 1;
  return index;
}

export function zoneRangeLabels(bounds: number[]) {
  return [0, 1, 2, 3, 4].map((zone) =>
    zone === 0 ? `до ${bounds[0]}` : zone === 4 ? `${bounds[3]! + 1}+` : `${bounds[zone - 1]! + 1}–${bounds[zone]}`
  );
}

export function zonesSourceNote(zones: AthleteHrZones) {
  if (zones.source === "coach")
    return zones.max_hr ? `Зоны по тесту тренера: макс. ${zones.max_hr} · порог ${zones.lthr}` : `Зоны по тесту тренера: порог ${zones.lthr}`;
  if (zones.source === "estimate" && zones.ignored_icu_max)
    return `Зоны по пробежкам: макс. ≈ ${zones.max_hr} · порог ≈ ${zones.lthr} (в intervals.icu макс. ${zones.ignored_icu_max} — ниже реальных пробежек)`;
  if (zones.source === "intervals") return `Личные зоны из intervals.icu · порог ${zones.lthr}`;
  if (zones.source === "estimate") return `Зоны по максимальному пульсу ${zones.max_hr} · порог ≈ ${zones.lthr}`;
  return `Общие зоны клуба · порог ${zones.lthr}`;
}

// Интенсивность: доля времени в 3–5 зоне (выше лёгкого бега), %
export function intensityPercent(seconds: number[]) {
  const total = seconds.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return Math.round((((seconds[2] ?? 0) + (seconds[3] ?? 0) + (seconds[4] ?? 0)) / total) * 100);
}
