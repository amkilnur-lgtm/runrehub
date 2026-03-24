import { useEffect, useRef, useState } from "react";
import type { LngLatBoundsLike, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

const DEFAULT_BOUNDS_PADDING = 10;
const DEFAULT_MAX_ZOOM = 17;
const DEFAULT_MAPTILER_STYLE_URL = "https://api.maptiler.com/maps/dataviz-v4/style.json?key={API_KEY}";

function createFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      cartoBase: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
          "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
          "https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
          "https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      },
      cartoLabels: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
          "https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
          "https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
          "https://d.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
        ],
        tileSize: 256,
        attribution: ""
      }
    },
    layers: [
      {
        id: "carto-base",
        type: "raster",
        source: "cartoBase"
      },
      {
        id: "carto-labels",
        type: "raster",
        source: "cartoLabels",
        paint: {
          "raster-opacity": 0.68
        }
      }
    ]
  };
}

function buildRouteFeatureCollection(points: [number, number][]) {
  const coordinates = points.map(([lat, lng]) => [lng, lat]);
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { kind: "route" },
        geometry: {
          type: "LineString" as const,
          coordinates
        }
      },
      {
        type: "Feature" as const,
        properties: { kind: "start" },
        geometry: {
          type: "Point" as const,
          coordinates: start
        }
      },
      {
        type: "Feature" as const,
        properties: { kind: "end" },
        geometry: {
          type: "Point" as const,
          coordinates: end
        }
      }
    ]
  };
}

function getBounds(points: [number, number][]): LngLatBoundsLike {
  const coordinates = points.map(([lat, lng]) => [lng, lat] as [number, number]);
  let minLng = coordinates[0][0];
  let maxLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLat = coordinates[0][1];

  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}

function resolveStyleUrl() {
  const styleUrl = import.meta.env.VITE_MAP_STYLE_URL?.trim();
  const apiKey = import.meta.env.VITE_MAP_API_KEY?.trim();

  if (styleUrl) {
    if (apiKey && styleUrl.includes("{API_KEY}")) {
      return styleUrl.replaceAll("{API_KEY}", apiKey);
    }

    return styleUrl;
  }

  if (apiKey) {
    return DEFAULT_MAPTILER_STYLE_URL.replaceAll("{API_KEY}", apiKey);
  }

  return null;
}

export function WorkoutRouteMap({ points }: { points: [number, number][] }) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    mode: "pending" | "map" | "scroll";
  } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "160px 0px"
      }
    );

    observer.observe(shell);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || points.length < 2 || !isVisible) {
      return;
    }

    setIsReady(false);
    setHasError(false);

    let cancelled = false;
    let activeMap: MapLibreMap | null = null;

    const initializeMap = async () => {
      const { default: maplibregl } = await import("maplibre-gl");
      if (cancelled) {
        return;
      }

      const style = resolveStyleUrl() ?? createFallbackStyle();
      const routeData = buildRouteFeatureCollection(points);
      const bounds = getBounds(points);
      const isTouchDevice =
        typeof window !== "undefined" &&
        (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches);

      const map = new maplibregl.Map({
        container,
        style,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false
      });

      activeMap = map;
      mapRef.current = map;
      map.scrollZoom.disable();
      map.keyboard.disable();
      map.touchZoomRotate.enable();
      map.touchZoomRotate.disableRotation();
      if (isTouchDevice) {
        map.dragPan.disable();
        map.doubleClickZoom.disable();
        map.boxZoom.disable();
      }
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true
        })
      );

      map.on("error", () => {
        if (!cancelled) {
          setHasError(true);
        }
      });

      map.on("load", () => {
        if (cancelled) {
          return;
        }

        map.addSource("route", {
          type: "geojson",
          data: routeData
        });

        map.addLayer({
          id: "route-shadow",
          type: "line",
          source: "route",
          filter: ["==", ["get", "kind"], "route"],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": 7.6,
            "line-opacity": 0.98
          }
        });

        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          filter: ["==", ["get", "kind"], "route"],
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": "#fc4c02",
            "line-width": 4.2,
            "line-opacity": 1
          }
        });

        map.addLayer({
          id: "route-start",
          type: "circle",
          source: "route",
          filter: ["==", ["get", "kind"], "start"],
          paint: {
            "circle-radius": 6.2,
            "circle-color": "#181510",
            "circle-stroke-width": 2.3,
            "circle-stroke-color": "#ffffff"
          }
        });

        map.addLayer({
          id: "route-end",
          type: "circle",
          source: "route",
          filter: ["==", ["get", "kind"], "end"],
          paint: {
            "circle-radius": 5.6,
            "circle-color": "#ffffff",
            "circle-stroke-width": 2.1,
            "circle-stroke-color": "#fc4c02"
          }
        });

        map.fitBounds(bounds, {
          padding: DEFAULT_BOUNDS_PADDING,
          maxZoom: DEFAULT_MAX_ZOOM,
          animate: false
        });

        setIsReady(true);
      });
    };

    void initializeMap();

    return () => {
      cancelled = true;
      activeMap?.remove();
      mapRef.current = null;
    };
  }, [isVisible, points]);

  useEffect(() => {
    const shell = shellRef.current;
    const map = mapRef.current;

    if (!shell || !map || !isReady) {
      return;
    }

    const isTouchDevice =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches);

    if (!isTouchDevice) {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStateRef.current = null;
        return;
      }

      const touch = event.touches[0];
      touchStateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        mode: "pending"
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStateRef.current = null;
        return;
      }

      const touchState = touchStateRef.current;
      if (!touchState) {
        return;
      }

      const touch = event.touches[0];
      const totalDx = touch.clientX - touchState.startX;
      const totalDy = touch.clientY - touchState.startY;
      const stepDx = touch.clientX - touchState.lastX;
      const stepDy = touch.clientY - touchState.lastY;

      if (touchState.mode === "pending") {
        if (Math.abs(totalDx) > 10 || Math.abs(totalDy) > 10) {
          touchState.mode = Math.abs(totalDx) > Math.abs(totalDy) * 1.2 ? "map" : "scroll";
        }
      }

      touchState.lastX = touch.clientX;
      touchState.lastY = touch.clientY;

      if (touchState.mode === "map") {
        event.preventDefault();
        map.panBy([-stepDx, -stepDy], {
          animate: false
        });
      }
    };

    const resetTouchState = () => {
      touchStateRef.current = null;
    };

    shell.addEventListener("touchstart", handleTouchStart, { passive: true });
    shell.addEventListener("touchmove", handleTouchMove, { passive: false });
    shell.addEventListener("touchend", resetTouchState, { passive: true });
    shell.addEventListener("touchcancel", resetTouchState, { passive: true });

    return () => {
      shell.removeEventListener("touchstart", handleTouchStart);
      shell.removeEventListener("touchmove", handleTouchMove);
      shell.removeEventListener("touchend", resetTouchState);
      shell.removeEventListener("touchcancel", resetTouchState);
    };
  }, [isReady]);

  if (points.length < 2) {
    return null;
  }

  return (
    <div ref={shellRef} className="workout-route-map-shell">
      {!isReady && !hasError ? (
        <div className="workout-route-loading skeleton-card" aria-hidden="true">
          <div className="workout-route-loading-grid" />
        </div>
      ) : null}
      {hasError ? <div className="workout-route-error">Не удалось загрузить карту.</div> : null}
      <div
        ref={containerRef}
        className={`workout-route-map workout-route-maplibre${isReady ? " is-ready" : ""}${hasError ? " is-hidden" : ""}`}
        aria-label="Маршрут пробежки"
      />
    </div>
  );
}
