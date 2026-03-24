import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Pane, Polyline, TileLayer, useMap } from "react-leaflet";
import { latLngBounds, type LatLngBoundsExpression } from "leaflet";

function FitRouteBounds({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length < 2) {
      return;
    }

    map.fitBounds(latLngBounds(points), {
      padding: [24, 24],
      maxZoom: 15
    });
  }, [map, points]);

  return null;
}

export function WorkoutRouteMap({ points }: { points: [number, number][] }) {
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (points.length < 2) {
      return null;
    }

    return latLngBounds(points);
  }, [points]);

  if (!bounds) {
    return null;
  }

  const start = points[0];
  const end = points[points.length - 1];

  return (
    <div className="workout-route-map" aria-label="Маршрут пробежки">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom={false}
        dragging
        zoomControl={false}
        attributionControl
        className="workout-route-leaflet"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitRouteBounds points={points} />
        <Pane name="route-shadow" style={{ zIndex: 410 }}>
          <Polyline
            positions={points}
            pathOptions={{
              color: "#ffffff",
              weight: 8,
              opacity: 0.92,
              lineCap: "round",
              lineJoin: "round"
            }}
            pane="route-shadow"
          />
        </Pane>
        <Pane name="route-line" style={{ zIndex: 420 }}>
          <Polyline
            positions={points}
            pathOptions={{
              color: "#fc4c02",
              weight: 4.6,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round"
            }}
            pane="route-line"
          />
        </Pane>
        <CircleMarker
          center={start}
          radius={7}
          pathOptions={{
            color: "#ffffff",
            weight: 3,
            fillColor: "#fc4c02",
            fillOpacity: 1
          }}
        />
        <CircleMarker
          center={end}
          radius={7}
          pathOptions={{
            color: "#ffffff",
            weight: 3,
            fillColor: "#181510",
            fillOpacity: 1
          }}
        />
      </MapContainer>
    </div>
  );
}
