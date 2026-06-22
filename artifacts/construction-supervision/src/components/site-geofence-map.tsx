import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import { Badge } from "@/components/ui/badge";

import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function FitToCircle({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  const map = useMap();
  useEffect(() => {
    const r = Math.max(radius, 20);
    const bounds = L.latLng(lat, lng).toBounds(r * 2);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: true });
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [map, lat, lng, radius]);
  return null;
}

function ClickToSetLocation({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

interface Props {
  lat: number;
  lng: number;
  radius: number;
  onChange?: (next: { lat: number; lng: number }) => void;
  className?: string;
}

export function SiteGeofenceMap({ lat, lng, radius, onChange, className }: Props) {
  const center = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  const safeRadius = Math.max(radius || 0, 1);
  const interactive = typeof onChange === "function";

  return (
    <div className={`relative w-full ${className ?? "h-72"} rounded-md border overflow-hidden`}>
      <MapContainer
        center={center}
        zoom={17}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker
          position={center}
          draggable={interactive}
          eventHandlers={
            interactive
              ? {
                  dragend(e) {
                    const m = e.target as L.Marker;
                    const p = m.getLatLng();
                    onChange?.({ lat: p.lat, lng: p.lng });
                  },
                }
              : undefined
          }
        />

        <Circle
          center={center}
          radius={safeRadius}
          pathOptions={{ color: "#0ea5e9", fillColor: "#0ea5e9", fillOpacity: 0.12, weight: 2 }}
        />

        {interactive && <ClickToSetLocation onPick={(la, ln) => onChange?.({ lat: la, lng: ln })} />}

        <FitToCircle lat={lat} lng={lng} radius={safeRadius} />
      </MapContainer>

      <div className="absolute top-2 right-2 z-[400] pointer-events-none">
        <Badge className="bg-sky-600 hover:bg-sky-600 text-white shadow">
          المدى المسموح: {Math.round(safeRadius)} م
        </Badge>
      </div>

      {interactive && (
        <div className="absolute bottom-2 left-2 z-[400] pointer-events-none">
          <Badge variant="secondary" className="text-[11px] shadow">
            اضغط على الخريطة أو اسحب العلامة لتغيير الموقع
          </Badge>
        </div>
      )}
    </div>
  );
}
