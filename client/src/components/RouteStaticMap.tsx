import { useEffect, useRef, useState } from "react";

import { useResolvedTheme, type ResolvedTheme } from "../hooks/useResolvedTheme";

// Статичная карта для ленты: мозаика растровых тайлов + маршрут поверх.
// Выглядит как настоящая карта, но без MapLibre на каждую карточку —
// это просто <img> тайлы, которые браузер кэширует.
// С ключом MapTiler используем те же стили, что на большой карте разбора
// (streets-v2 / streets-v2-dark); без ключа — фолбэк на CARTO.
const TILE_SIZE = 256;
const PADDING = 26;
const MIN_ZOOM = 3;
// z18 хватает, чтобы круги по стадиону заняли весь баннер, а не сжались в комок
const MAX_ZOOM = 18;

const MAPTILER_STYLE: Record<ResolvedTheme, string> = {
  light: "streets-v2",
  dark: "streets-v2-dark"
};

const CARTO_VARIANT: Record<ResolvedTheme, string> = {
  light: "rastertiles/voyager",
  dark: "dark_all"
};

// Цвета маршрута согласованы с большой картой на странице разбора (WorkoutRouteMap)
const ROUTE_COLORS: Record<ResolvedTheme, {
  casing: string;
  startFill: string;
  startStroke: string;
  endFill: string;
  endStroke: string;
}> = {
  light: { casing: "#ffffff", startFill: "#181510", startStroke: "#ffffff", endFill: "#ffffff", endStroke: "#fc4c02" },
  dark: { casing: "#181b26", startFill: "#f2f3f7", startStroke: "#181b26", endFill: "#181b26", endStroke: "#ff6a3a" }
};

function mercatorX(lng: number) {
  return (lng + 180) / 360;
}

function mercatorY(lat: number) {
  const rad = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  return Math.min(1, Math.max(0, y));
}

function tileSubdomain(x: number, y: number) {
  return ["a", "b", "c", "d"][(x + y) % 4];
}

function tileUrl(theme: ResolvedTheme, z: number, x: number, y: number) {
  const apiKey = import.meta.env.VITE_MAP_API_KEY?.trim();
  if (apiKey) {
    return `https://api.maptiler.com/maps/${MAPTILER_STYLE[theme]}/256/${z}/${x}/${y}@2x.png?key=${apiKey}`;
  }
  return `https://${tileSubdomain(x, y)}.basemaps.cartocdn.com/${CARTO_VARIANT[theme]}/${z}/${x}/${y}@2x.png`;
}

// Сглаживание трека (Catmull-Rom -> кубические Безье): GPS-ломаная из
// прореженных точек выглядит угловатой, особенно на коротких кругах.
function smoothPath(points: Array<[number, number]>) {
  if (points.length < 3) {
    return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")}`;
  }
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function RouteStaticMap({ points }: { points: [number, number][] | null }) {
  const theme = useResolvedTheme();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const measure = () => {
      const rect = shell.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width > 0 && height > 0) {
        setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  if (!points || points.length < 2) {
    return null;
  }

  let tiles: Array<{ key: string; src: string; left: number; top: number; size: number }> = [];
  let routePath = "";
  let start: [number, number] | null = null;
  let end: [number, number] | null = null;

  if (size) {
    const xs = points.map((p) => mercatorX(p[1]));
    const ys = points.map((p) => mercatorY(p[0]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);

    // Дробный зум: маршрут вписывается в баннер вплотную (как в Страве).
    // Мозаика рисуется на целом уровне zi и масштабируется в 1..2 раза —
    // тайлы @2x при этом остаются чёткими.
    const exactZoom = Math.log2(
      Math.min(
        (size.width - PADDING * 2) / (TILE_SIZE * spanX),
        (size.height - PADDING * 2) / (TILE_SIZE * spanY)
      )
    );
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, exactZoom));
    const zi = Math.floor(clampedZoom);
    const scale = 2 ** (clampedZoom - zi);
    const tileScreen = TILE_SIZE * scale;

    const world = TILE_SIZE * 2 ** clampedZoom;
    const originX = ((minX + maxX) / 2) * world - size.width / 2;
    const originY = ((minY + maxY) / 2) * world - size.height / 2;

    const tileCount = 2 ** zi;
    const firstTileX = Math.floor(originX / tileScreen);
    const lastTileX = Math.floor((originX + size.width) / tileScreen);
    const firstTileY = Math.max(0, Math.floor(originY / tileScreen));
    const lastTileY = Math.min(tileCount - 1, Math.floor((originY + size.height) / tileScreen));

    for (let tx = firstTileX; tx <= lastTileX; tx += 1) {
      for (let ty = firstTileY; ty <= lastTileY; ty += 1) {
        // долгота зациклена
        const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${zi}-${tx}-${ty}-${theme}`,
          src: tileUrl(theme, zi, wrappedX, ty),
          left: tx * tileScreen - originX,
          top: ty * tileScreen - originY,
          size: tileScreen
        });
      }
    }

    const projected = points.map(([lat, lng]): [number, number] => [
      mercatorX(lng) * world - originX,
      mercatorY(lat) * world - originY
    ]);
    routePath = smoothPath(projected);
    start = projected[0];
    end = projected[projected.length - 1];
  }

  return (
    <div ref={shellRef} className="feed-map" aria-label="Маршрут пробежки">
      <div className="feed-map-tiles" aria-hidden="true">
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            loading="lazy"
            draggable={false}
            style={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
          />
        ))}
      </div>
      {size && routePath ? (
        <svg
          className="feed-map-overlay"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-hidden="true"
        >
          <path
            d={routePath}
            fill="none"
            stroke={ROUTE_COLORS[theme].casing}
            strokeOpacity="0.92"
            strokeWidth="4.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={routePath}
            fill="none"
            stroke="#fc4c02"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {start ? (
            <circle cx={start[0]} cy={start[1]} r="4.8" fill={ROUTE_COLORS[theme].startFill} stroke={ROUTE_COLORS[theme].startStroke} strokeWidth="2" />
          ) : null}
          {end ? (
            <circle cx={end[0]} cy={end[1]} r="4.4" fill={ROUTE_COLORS[theme].endFill} stroke={ROUTE_COLORS[theme].endStroke} strokeWidth="2" />
          ) : null}
        </svg>
      ) : null}
      <span className="feed-map-attrib">
        {import.meta.env.VITE_MAP_API_KEY?.trim() ? "© MapTiler · © OpenStreetMap" : "© OpenStreetMap · © CARTO"}
      </span>
    </div>
  );
}
