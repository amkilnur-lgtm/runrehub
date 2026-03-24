import { useMemo } from "react";

function projectTrack(points: [number, number][]) {
  if (points.length < 2) {
    return null;
  }

  const latitudes = points.map(([lat]) => lat);
  const longitudes = points.map(([, lng]) => lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  const width = 100;
  const height = 100;
  const padding = 10;
  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;
  const deltaLng = Math.max(maxLng - minLng, 1e-6);
  const deltaLat = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min(contentWidth / deltaLng, contentHeight / deltaLat);
  const usedWidth = deltaLng * scale;
  const usedHeight = deltaLat * scale;
  const offsetX = (width - usedWidth) / 2;
  const offsetY = (height - usedHeight) / 2;

  const projected = points.map(([lat, lng]) => {
    const x = offsetX + (lng - minLng) * scale;
    const y = offsetY + (maxLat - lat) * scale;
    return [x, y] as const;
  });

  const path = projected
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  return {
    path,
    start: projected[0],
    end: projected[projected.length - 1]
  };
}

export function WorkoutRouteMap({ points }: { points: [number, number][] }) {
  const route = useMemo(() => projectTrack(points), [points]);

  if (!route) {
    return null;
  }

  const [startX, startY] = route.start;
  const [endX, endY] = route.end;

  return (
    <div className="workout-route-map" aria-label="Маршрут пробежки">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-hidden="true">
        <defs>
          <pattern id="route-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 0 12" fill="none" stroke="rgba(24,21,16,0.04)" strokeWidth="0.6" />
          </pattern>
          <linearGradient id="route-line" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d67d32" />
            <stop offset="100%" stopColor="#8c4a17" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#route-grid)" />
        <path
          d={route.path}
          fill="none"
          stroke="url(#route-line)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={startX} cy={startY} r="2.7" fill="#ffffff" stroke="#8c4a17" strokeWidth="1.1" />
        <circle cx={endX} cy={endY} r="2.7" fill="#181510" stroke="#ffffff" strokeWidth="1.1" />
      </svg>
    </div>
  );
}
