import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import "leaflet.markercluster";

type MarkerData = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  city?: string;
  popupContent?: string;
  /** CSS color (e.g. hsl(var(--primary))) */
  color?: string;
  /** If true, renders as outline-only (white interior) */
  outline?: boolean;
};

type LazyMapProps = {
  center: [number, number];
  zoom: number;
  markers: MarkerData[];
  scrollWheelZoom?: boolean;
  height?: string;
  /** Disable clustering (e.g. on the single-reality detail page) */
  cluster?: boolean;
  /** Minimum zoom level (default 5 — full Italy) */
  minZoom?: number;
  /** Maximum zoom level */
  maxZoom?: number;
  /** Bounds to constrain panning (default: Italy) */
  maxBounds?: [[number, number], [number, number]];
  /** When set, the map flies to this position and shows a "you are here" marker */
  userLocation?: { lat: number; lng: number } | null;
};

// Italian territory bounding box (with a little breathing room)
const ITALY_BOUNDS: [[number, number], [number, number]] = [
  [35.2, 6.2],   // SW
  [47.3, 19.0],  // NE
];

const buildIcon = (color: string, outline: boolean) => {
  const html = outline
    ? `<span class="ibp-marker ibp-marker--ghost" style="--mc:${color}">
         <span class="ibp-marker__ring"></span>
         <span class="ibp-marker__core"></span>
       </span>`
    : `<span class="ibp-marker ibp-marker--solid" style="--mc:${color}">
         <span class="ibp-marker__halo"></span>
         <span class="ibp-marker__core"></span>
       </span>`;

  return L.divIcon({
    html,
    className: "ibp-marker-wrap",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
};


const ClusterLayer = ({ markers, cluster }: { markers: MarkerData[]; cluster: boolean }) => {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    // Remove previous layer
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    const group: L.LayerGroup = cluster
      ? (L as unknown as {
          markerClusterGroup: (opts: Record<string, unknown>) => L.LayerGroup;
        }).markerClusterGroup({
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          maxClusterRadius: 50,
          iconCreateFunction: (c: { getChildCount: () => number }) => {
            const count = c.getChildCount();
            const size = count < 10 ? 36 : count < 50 ? 44 : 54;
            return L.divIcon({
              html: `<div class="ibp-cluster" style="width:${size}px;height:${size}px"><span>${count}</span></div>`,
              className: "ibp-cluster-wrap",
              iconSize: [size, size],
            });
          },
        })
      : L.layerGroup();

    markers.forEach((m) => {
      const marker = L.marker([m.lat, m.lng], {
        icon: buildIcon(m.color ?? "#8B5CFF", !!m.outline),
      });

      // Build popup HTML from popupContent if it's a string of trusted (pre-escaped) HTML,
      // otherwise fall back to the marker name with HTML-escaped fields.
      const popupEl = document.createElement("div");
      popupEl.className = "ibp-popup-body";
      if (typeof m.popupContent === "string") {
        popupEl.innerHTML = m.popupContent;
      } else {
        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        popupEl.innerHTML = `<strong style="font-family:var(--font-display,serif)">${esc(m.name)}</strong>${
          m.city ? `<br/><span style="font-size:12px;opacity:.7">${esc(m.city)}</span>` : ""
        }`;
      }
      marker.bindPopup(popupEl);
      group.addLayer(marker);
    });

    map.addLayer(group);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, markers, cluster]);

  return null;
};

/**
 * Auto-focus the map when the marker set changes (e.g. after applying a filter):
 * fits bounds to the visible markers, or zooms to a single point.
 * Skipped when there are no markers (leaves current view intact).
 */
const AutoFitLayer = ({ markers, enabled }: { markers: MarkerData[]; enabled: boolean }) => {
  const map = useMap();
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    if (markers.length === 0) {
      firstRunRef.current = false;
      return;
    }
    if (markers.length === 1) {
      const m = markers[0];
      map.setView([m.lat, m.lng], Math.max(map.getZoom(), 12), { animate: !firstRunRef.current });
    } else {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11, animate: !firstRunRef.current });
    }
    firstRunRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);
  return null;
};

const UserLocationLayer = ({ pos }: { pos: { lat: number; lng: number } | null | undefined }) => {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!pos) {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      return;
    }
    const icon = L.divIcon({
      html: `<span class="ibp-user-loc"><span class="ibp-user-loc__pulse"></span><span class="ibp-user-loc__dot"></span></span>`,
      className: "ibp-user-loc-wrap",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    if (markerRef.current) {
      markerRef.current.setLatLng([pos.lat, pos.lng]);
      markerRef.current.setIcon(icon);
    } else {
      markerRef.current = L.marker([pos.lat, pos.lng], { icon, interactive: false }).addTo(map);
    }
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      map.setView([pos.lat, pos.lng], 9);
    } else {
      map.flyTo([pos.lat, pos.lng], 9, { duration: 1.2 });
    }
    return () => {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    };
  }, [map, pos?.lat, pos?.lng]);

  return null;
};

/**
 * Abilita lo zoom solo su pinch trackpad (wheel + ctrlKey) o pinch touch.
 * Lo scroll a due dita verticale/orizzontale scorre la pagina, non zoomma la mappa.
 */
const PinchOnlyZoom = () => {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();

    const onWheel = (e: WheelEvent) => {
      // Trackpad pinch → il browser emette wheel con ctrlKey=true
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      // deltaY proporzionale all'intensità del pinch
      const zoomDelta = -e.deltaY * 0.02;
      const point = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      const currentZoom = map.getZoom();
      const targetZoom = Math.max(
        map.getMinZoom(),
        Math.min(map.getMaxZoom(), currentZoom + zoomDelta)
      );
      map.setZoomAround(point, targetZoom, { animate: false });
    };

    container.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => container.removeEventListener("wheel", onWheel, { capture: true } as any);
  }, [map]);
  return null;
};


const LazyMap = ({
  center,
  zoom,
  markers,
  scrollWheelZoom: _scrollWheelZoom = false,
  height = "100%",
  cluster = true,
  minZoom = 5,
  maxZoom = 18,
  maxBounds = ITALY_BOUNDS,
  userLocation = null,
  autoFit = true,
}: LazyMapProps & { autoFit?: boolean }) => {
  return (
    <div className="ibp-map-frame relative isolate z-0" style={{ height, width: "100%" }}>
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        maxBounds={maxBounds}
        maxBoundsViscosity={1.0}
        scrollWheelZoom={false}
        zoomSnap={0}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={80}
        zoomControl={false}

        style={{ height: "100%", width: "100%" }}
        className="ibp-map"
      >
        {/* OpenStreetMap standard tiles: gratuiti, senza API key (CARTO Voyager ora richiede una chiave) */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />
        <PinchOnlyZoom />
        <ClusterLayer markers={markers} cluster={cluster && markers.length > 1} />
        <AutoFitLayer markers={markers} enabled={autoFit && !userLocation} />
        <UserLocationLayer pos={userLocation} />
      </MapContainer>
    </div>
  );
};


export default LazyMap;
