import { useEffect, useRef, useState } from "react";

import { useResolvedTheme, type ResolvedTheme } from "../hooks/useResolvedTheme";

// Статичная карта для ленты: мозаика растровых тайлов CARTO + маршрут поверх.
// Выглядит как настоящая карта, но без MapLibre на каждую карточку —
// это просто <img> тайлы, которые браузер кэширует.
const TILE_SIZE = 256;
const PADDING = 26;
const MIN_ZOOM = 3;
const MAX_ZOOM = 16;

const TILE_VARIANT: Record<ResolvedTheme, string> = {
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
  let polyline = "";
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
    const variant = TILE_VARIANT[theme];

    for (let tx = firstTileX; tx <= lastTileX; tx += 1) {
      for (let ty = firstTileY; ty <= lastTileY; ty += 1) {
        // долгота зациклена
        const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${zi}-${tx}-${ty}-${theme}`,
          src: `https://${tileSubdomain(wrappedX, ty)}.basemaps.cartocdn.com/${variant}/${zi}/${wrappedX}/${ty}@2x.png`,
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
    polyline = projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
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
      {size && polyline ? (
        <svg
          className="feed-map-overlay"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-hidden="true"
        >
          <polyline
            points={polyline}
            fill="none"
            stroke={ROUTE_COLORS[theme].casing}
            strokeOpacity="0.92"
            strokeWidth="6.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={polyline}
            fill="none"
            stroke="#fc4c02"
            strokeWidth="3.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {start ? (
            <circle cx={start[0]} cy={start[1]} r="5.4" fill={ROUTE_COLORS[theme].startFill} stroke={ROUTE_COLORS[theme].startStroke} strokeWidth="2.2" />
          ) : null}
          {end ? (
            <circle cx={end[0]} cy={end[1]} r="5" fill={ROUTE_COLORS[theme].endFill} stroke={ROUTE_COLORS[theme].endStroke} strokeWidth="2.2" />
          ) : null}
        </svg>
      ) : null}
      <span className="feed-map-attrib">© OpenStreetMap · © CARTO</span>
    </div>
  );
}
