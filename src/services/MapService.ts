import { Place } from "../models/Place";

declare const L: any;

export interface MapServiceOptions {
  center?: [number, number];
  zoom?: number;
  maxZoom?: number;
  tileUrl?: string;
}

export class MapService {
  private map: any = null;
  private markersGroup: any = null;
  private markersMap = new Map<string, any>();
  private containerId: string;
  private centerCoords: [number, number];
  private defaultZoom: number;
  private maxZoomLevel: number;
  private tileUrl: string;
  private onPlaceClickCallback?: (place: Place) => void;
  private resizeHandler?: () => void;
  private orientationHandler?: () => void;

  constructor(containerId: string = "map", options: MapServiceOptions = {}) {
    this.containerId = containerId;
    this.centerCoords = options.center || [55.75, 37.61];
    this.defaultZoom = options.zoom || 5;
    this.maxZoomLevel = options.maxZoom || 19;
    this.tileUrl =
      options.tileUrl || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  }

  init(): void {
    if (typeof L === "undefined") {
      throw new Error("Leaflet (L) is not defined");
    }

    const container = document.getElementById(this.containerId);
    if (!container) {
      console.warn(`Container #${this.containerId} not found in DOM`);
      return;
    }

    this.map = L.map(this.containerId, {
      zoomControl: false,
      fadeAnimation: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
    }).setView(
      this.centerCoords,
      this.defaultZoom
    );

    L.tileLayer(this.tileUrl, {
      maxZoom: this.maxZoomLevel,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);

    L.control.zoom({ position: "bottomright" }).addTo(this.map);

    this.markersGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      spiderfyDistanceMultiplier: 2.5,
    });
    this.map.addLayer(this.markersGroup);

    this.map.on("zoomend", () => this.updateMarkerSizes());

    this.resizeHandler = () => {
      if (this.map) this.map.invalidateSize();
    };
    this.orientationHandler = () => {
      setTimeout(() => {
        if (this.map) this.map.invalidateSize();
      }, 200);
    };

    window.addEventListener("resize", this.resizeHandler);
    window.addEventListener("orientationchange", this.orientationHandler);
  }

  renderPlaces(
    places: readonly Place[],
    onPlaceClick?: (place: Place) => void
  ): void {
    if (onPlaceClick) {
      this.onPlaceClickCallback = onPlaceClick;
    }

    if (!this.markersGroup) return;

    this.markersGroup.clearLayers();
    this.markersMap.clear();

    const layerList: any[] = [];
    for (const place of places) {
      const marker = this.createMarker(place);
      this.markersMap.set(place.id, marker);
      layerList.push(marker);
    }

    this.markersGroup.addLayers(layerList);
  }

  flyTo(coords: [number, number], zoom = 16, duration = 1.5): void {
    if (!this.map) return;
    this.map.flyTo(coords, zoom, { duration });
  }

  fitAllMarkers(maxZoom = 15): void {
    if (!this.map || !this.markersGroup) return;
    if (this.markersGroup.getLayers().length > 0) {
      const bounds = this.markersGroup.getBounds();
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom });
    } else {
      this.map.setView(this.centerCoords, this.defaultZoom);
    }
  }

  invalidateSize(): void {
    if (this.map) this.map.invalidateSize();
  }

  async waitForClick(timeoutMs = 30000): Promise<[number, number] | null> {
    if (!this.map) return null;
    return new Promise((resolve) => {
      const onClick = (e: any) => {
        this.map.off("click", onClick);
        resolve([e.latlng.lat, e.latlng.lng]);
      };
      this.map.on("click", onClick);
      setTimeout(() => {
        this.map.off("click", onClick);
        resolve(null);
      }, timeoutMs);
    });
  }

  createTempMarker(coords: [number, number], previewUrl: string): any {
    if (typeof L === "undefined") return null;
    const size = 40;
    const iconHtml = `
      <div class="pulsing-marker" style="display:flex;align-items:center;">
        <div style="width:${size}px;height:${size}px;border-radius:10px;background:#ffd1dc;position:relative;overflow:hidden;box-shadow:0 6px 16px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;">
          <span style="font-size:14px;">💖</span>
          <img src="${previewUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0.6;">
        </div>
      </div>
    `;
    const icon = L.divIcon({
      html: iconHtml,
      className: "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    const marker = L.marker(coords, { icon });
    if (this.markersGroup) {
      this.markersGroup.addLayer(marker);
    }
    return marker;
  }

  removeMarker(marker: any): void {
    if (marker && this.markersGroup) {
      this.markersGroup.removeLayer(marker);
    }
  }

  destroy(): void {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
    }
    if (this.orientationHandler) {
      window.removeEventListener("orientationchange", this.orientationHandler);
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  private createMarker(place: Place, isTemp = false): any {
    const coords = place.coords;
    const size = isTemp ? 40 : 56;
    const opacity = isTemp ? 0.5 : 1;
    const pulseClass = isTemp ? "pulsing-marker" : "";
    const primary = place.primaryPhoto;
    const thumbSrc = primary ? primary.thumbUrl || primary.origUrl : "";

    const hasMultiple = place.hasMultiplePhotos;
    const countBadgeHtml = hasMultiple
      ? `<div style="background:rgba(255,255,255,0.95);padding:4px 8px;border-radius:8px;font-weight:700;color:#222;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">${place.photosCount}</div>`
      : "";

    const iconHtml = `
      <div class="${pulseClass}" style="display:flex;align-items:center;gap:6px;">
        <div style="width:${size}px;height:${size}px;border-radius:10px;background:#ffd1dc;position:relative;overflow:hidden;box-shadow:0 6px 16px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;">
          <span style="font-size:14px;">💖</span>
          <img src="${thumbSrc}"
               loading="lazy"
               decoding="async"
               onload="this.style.opacity='${opacity}';"
               onerror="this.style.display='none';"
               style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s ease;">
        </div>
        ${countBadgeHtml}
      </div>
    `;

    const icon = L.divIcon({
      html: iconHtml,
      className: "",
      iconSize: [hasMultiple ? size + 40 : size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker(coords, { icon });
    marker.on("click", () => {
      if (this.onPlaceClickCallback) {
        this.onPlaceClickCallback(place);
      }
    });

    return marker;
  }

  private updateMarkerSizes(): void {
    if (!this.map) return;
    const zoom = this.map.getZoom();
    const scale = Math.pow(2, zoom - 13);
    const size = Math.max(20, Math.min(56, 40 * scale));
  }
}
