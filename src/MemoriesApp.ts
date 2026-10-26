import { MemoriesRepository } from "./services/MemoriesRepository";
import { MapService } from "./services/MapService";
import { GalleryViewer } from "./components/GalleryViewer";
import { NostalgiaEngine } from "./services/NostalgiaEngine";
import { NostalgiaWidget } from "./components/NostalgiaWidget";
import { LoveCounterWidget } from "./components/LoveCounterWidget";
import { PhotoUploader } from "./services/PhotoUploader";
import { Place } from "./models/Place";

export class MemoriesApp {
  private repository: MemoriesRepository;
  private mapService: MapService;
  private gallery: GalleryViewer;
  private nostalgia: NostalgiaEngine;
  private nostalgiaWidget: NostalgiaWidget;
  private loveCounter: LoveCounterWidget;
  private uploader: PhotoUploader;
  private isUrlActionHandled: boolean = false;

  constructor() {
    this.repository = new MemoriesRepository();
    this.mapService = new MapService("map");
    this.gallery = new GalleryViewer(
      "https://sweet-dreams-f8nc.onrender.com",
      (place) => {
        this.repository.savePlace(place);
      }
    );
    this.nostalgia = new NostalgiaEngine();
    this.nostalgiaWidget = new NostalgiaWidget();
    this.loveCounter = new LoveCounterWidget();
    this.uploader = new PhotoUploader(this.mapService, this.repository);
  }

  async start(): Promise<void> {
    this.mapService.init();
    this.gallery.init();
    this.loveCounter.init();
    this.uploader.init();
    this.nostalgiaWidget.init((item) => {
      this.mapService.flyTo(item.coords, 16, 1.2);
      const place = this.repository.getById(item.placeId);
      if (place) {
        setTimeout(() => this.gallery.open(place), 1300);
      }
    });

    this.setupActionButtons();

    this.repository.subscribe((places) => {
      this.mapService.renderPlaces(places, (clickedPlace) => {
        this.gallery.open(clickedPlace);
      });
      this.nostalgia.setPlaces([...places]);
      this.loveCounter.update(places.length);

      const nostalgiaItems = this.nostalgia.findOnThisDay();
      this.nostalgiaWidget.updateItems(nostalgiaItems);

      this.handleUrlActionsOnce(places, nostalgiaItems.length > 0);
    });

    this.repository.loadFromLocalCache();
    this.repository.initRealtimeSync();
    this.syncWithServer();
    this.registerServiceWorker();
  }

  private registerServiceWorker(): void {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }
  }

  private setupActionButtons(): void {
    const randomBtn = document.getElementById("randomMemoryBtn");
    const mobileRandomBtn = document.getElementById("mobileRandomBtn");

    const triggerRandom = () => {
      const random = this.nostalgia.getRandomMemory();
      if (!random) return;
      this.mapService.flyTo(random.place.coords, 16, 1.5);
      setTimeout(() => this.gallery.open(random.place, random.photoIdx), 1200);
    };

    randomBtn?.addEventListener("click", triggerRandom);
    mobileRandomBtn?.addEventListener("click", triggerRandom);

    const overviewBtn = document.getElementById("mobileOverviewBtn");
    overviewBtn?.addEventListener("click", () => {
      this.mapService.fitAllMarkers();
    });
  }

  private handleUrlActionsOnce(places: readonly Place[], hasNostalgia: boolean): void {
    if (this.isUrlActionHandled || places.length === 0) return;

    const urlParams = new URLSearchParams(window.location.search);
    const isRandomMemory = urlParams.get("randomMemory") === "true";
    const isAutoNostalgia = urlParams.get("autoOpenNostalgia") === "true";
    const recentUploadsParam = urlParams.get("recentUploads");
    const isRecentUploads = !!recentUploadsParam;

    if (!isRandomMemory && !isAutoNostalgia && !isRecentUploads) return;

    if (isRandomMemory) {
      this.isUrlActionHandled = true;
      const randomItem = this.nostalgia.getRandomMemory();
      if (randomItem) {
        this.mapService.flyTo(randomItem.place.coords, 16, 1.2);
        setTimeout(() => {
          this.gallery.open(randomItem.place, randomItem.photoIdx);
        }, 1300);
      }
      this.cleanUrlParams();
    } else if (isAutoNostalgia && hasNostalgia) {
      this.isUrlActionHandled = true;
      setTimeout(() => {
        this.nostalgiaWidget.showCard();
      }, 400);
      this.cleanUrlParams();
    } else if (isRecentUploads) {
      const ids =
        recentUploadsParam !== "true"
          ? recentUploadsParam
              .split(",")
              .map((id) => decodeURIComponent(id.trim()))
              .filter(Boolean)
          : [];

      const hasRequested =
        ids.length === 0 ||
        ids.some((id) => places.some((p) => String(p.id) === String(id)));

      if (!hasRequested) return;

      const recentItems = this.nostalgia.findRecentUploads(ids);
      if (recentItems.length > 0) {
        this.isUrlActionHandled = true;
        this.mapService.flyTo(recentItems[0].coords, 16, 1.2);
        setTimeout(() => {
          this.nostalgiaWidget.showRecentUploads(recentItems);
        }, 400);
        this.cleanUrlParams();
      }
    }
  }

  private cleanUrlParams(): void {
    const cleanUrl =
      window.location.protocol +
      "//" +
      window.location.host +
      window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, "", cleanUrl);
  }

  private async syncWithServer(): Promise<void> {
    try {
      await this.repository.fetchFromRender();
    } catch (err) {
      console.warn("Sync failed:", err);
    } finally {
      const urlParams = new URLSearchParams(window.location.search);
      if (!this.isUrlActionHandled) {
        if (urlParams.get("autoOpenNostalgia") === "true") {
          this.isUrlActionHandled = true;
          this.cleanUrlParams();
        } else if (urlParams.has("recentUploads")) {
          const recentUploadsParam = urlParams.get("recentUploads") || "";
          const ids =
            recentUploadsParam !== "true"
              ? recentUploadsParam
                  .split(",")
                  .map((id) => decodeURIComponent(id.trim()))
                  .filter(Boolean)
              : [];
          const recentItems = this.nostalgia.findRecentUploads(ids);
          if (recentItems.length > 0) {
            this.mapService.flyTo(recentItems[0].coords, 16, 1.2);
            setTimeout(() => {
              this.nostalgiaWidget.showRecentUploads(recentItems);
            }, 400);
          }
          this.isUrlActionHandled = true;
          this.cleanUrlParams();
        }
      }
    }
  }
}
