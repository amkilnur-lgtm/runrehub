// Лёгкий статичный трек маршрута для ленты: полилиния из прореженного latlng,
// масштабированная в бокс с сохранением пропорций. Полная карта — на разборе.
const W = 600;
const H = 200;
const PAD = 16;

export function RouteTrack({ points }: { points: [number, number][] | null }) {
  if (!points || points.length < 2) {
    return null;
  }

  let minLat = points[0][0];
  let maxLat = points[0][0];
  let minLng = points[0][1];
  let maxLng = points[0][1];
  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLng = Math.max(maxLng - minLng, 1e-6);
  // равный масштаб по осям, чтобы форма не искажалась; долгота сжимается по широте
  const latMid = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const lngScale = Math.cos(latMid) || 1;
  const worldW = spanLng * lngScale;
  const worldH = spanLat;
  const scale = Math.min((W - PAD * 2) / worldW, (H - PAD * 2) / worldH);
  const drawW = worldW * scale;
  const drawH = worldH * scale;
  const offX = (W - drawW) / 2;
  const offY = (H - drawH) / 2;

  const xy = (lat: number, lng: number): [number, number] => [
    offX + (lng - minLng) * lngScale * scale,
    // инвертируем широту: север сверху
    offY + (maxLat - lat) * scale
  ];

  const coords = points.map(([lat, lng]) => xy(lat, lng));
  const poly = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [sx, sy] = coords[0];
  const [ex, ey] = coords[coords.length - 1];

  return (
    <div className="feed-map">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-label="Маршрут пробежки">
        <polyline
          points={poly}
          fill="none"
          stroke="var(--surface)"
          strokeOpacity="0.9"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={poly}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={sx} cy={sy} r="6" fill="var(--surface)" stroke="var(--brand-navy)" strokeWidth="2.4" />
        <circle cx={ex} cy={ey} r="5.4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2.4" />
      </svg>
    </div>
  );
}
