import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from "react-leaflet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, ExternalLink } from "lucide-react";
import { fmtLibyaDateTime } from "@/lib/attendance-utils";

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

const SiteIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#0ea5e9;border:3px solid white;box-shadow:0 0 0 1px #0369a1;"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export interface AttendanceMapPoint {
  lat: number;
  lng: number;
  accuracy?: number | null;
  distance?: number | null;
  outOfRange?: boolean | null;
  fullName?: string | null;
  type?: "check_in" | "check_out" | null;
  recordedAt?: string | Date | null;
  siteLat?: number | null;
  siteLng?: number | null;
  siteRadius?: number | null;
}

function FitBounds({ point }: { point: AttendanceMapPoint }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLngBounds([[point.lat, point.lng]]);
    if (point.accuracy && point.accuracy > 0) {
      const m = point.accuracy;
      bounds.extend(L.latLng(point.lat, point.lng).toBounds(m * 2));
    }
    if (point.siteLat != null && point.siteLng != null) {
      bounds.extend([point.siteLat, point.siteLng]);
      const r = point.siteRadius ?? 200;
      bounds.extend(L.latLng(point.siteLat, point.siteLng).toBounds(r * 2));
    }
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    setTimeout(() => map.invalidateSize(), 100);
  }, [map, point]);
  return null;
}

interface Props {
  point: AttendanceMapPoint | null;
  onClose: () => void;
}

export function AttendanceLocationMapDialog({ point, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = !!point;

  const center = useMemo<[number, number] | null>(
    () => (point ? [point.lat, point.lng] : null),
    [point],
  );

  if (!point || !center) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-3xl"><div /></DialogContent>
      </Dialog>
    );
  }

  const typeLabel = point.type === "check_in" ? "حضور" : point.type === "check_out" ? "انصراف" : "موقع";
  const typeColor = point.type === "check_in" ? "bg-green-600" : point.type === "check_out" ? "bg-amber-600" : "bg-slate-600";
  const osmHref = `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=18/${point.lat}/${point.lng}`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent ref={dialogRef} className="max-w-3xl p-0 overflow-hidden" dir="rtl">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <MapPin className="h-5 w-5 text-primary" />
            <span>موقع التسجيل</span>
            <Badge className={`${typeColor} hover:${typeColor} text-white`}>{typeLabel}</Badge>
            {point.outOfRange && (
              <Badge variant="destructive">خارج نطاق الموقع</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-2 text-xs sm:text-sm text-muted-foreground space-y-1">
          {point.fullName && (
            <div><span className="text-foreground font-medium">الموظف:</span> {point.fullName}</div>
          )}
          {point.recordedAt && (
            <div><span className="text-foreground font-medium">الوقت:</span> {fmtLibyaDateTime(point.recordedAt)}</div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <div>
              <span className="text-foreground font-medium">الإحداثيات:</span>{" "}
              <span dir="ltr" className="inline-block">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</span>
            </div>
            {point.accuracy != null && Number.isFinite(point.accuracy) && (
              <div><span className="text-foreground font-medium">دقة:</span> ±{Math.round(point.accuracy)} م</div>
            )}
            {point.distance != null && Number.isFinite(point.distance) && (
              <div><span className="text-foreground font-medium">المسافة من الموقع:</span> {Math.round(point.distance)} م</div>
            )}
          </div>
        </div>

        <div className="w-full h-[60vh] sm:h-[480px] bg-muted">
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

            {/* Project site marker + geofence */}
            {point.siteLat != null && point.siteLng != null && (
              <>
                <Marker position={[point.siteLat, point.siteLng]} icon={SiteIcon}>
                  <Popup>موقع المشروع</Popup>
                </Marker>
                <Circle
                  center={[point.siteLat, point.siteLng]}
                  radius={point.siteRadius ?? 200}
                  pathOptions={{ color: "#0ea5e9", fillColor: "#0ea5e9", fillOpacity: 0.08, weight: 1 }}
                />
              </>
            )}

            {/* Recorded location marker */}
            <Marker position={center}>
              <Popup>
                <div className="text-sm space-y-0.5" dir="rtl">
                  <div className="font-semibold">{typeLabel}{point.fullName ? ` — ${point.fullName}` : ""}</div>
                  {point.recordedAt && <div>{fmtLibyaDateTime(point.recordedAt)}</div>}
                  <div dir="ltr">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</div>
                </div>
              </Popup>
            </Marker>

            {/* Accuracy halo */}
            {point.accuracy != null && Number.isFinite(point.accuracy) && point.accuracy > 0 && (
              <Circle
                center={center}
                radius={point.accuracy}
                pathOptions={{ color: "#7c3aed", fillColor: "#7c3aed", fillOpacity: 0.1, weight: 1 }}
              />
            )}

            <FitBounds point={point} />
          </MapContainer>
        </div>

        <div className="px-4 py-3 border-t flex flex-wrap items-center gap-2 justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={osmHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
              <ExternalLink className="h-4 w-4" /> فتح في OpenStreetMap
            </a>
          </Button>
          <Button size="sm" onClick={onClose}>إغلاق</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
