import { MapService } from "./MapService";
import { MemoriesRepository } from "./MemoriesRepository";
import { Place } from "../models/Place";

declare const exifr: any;

export class PhotoUploader {
  private dropArea: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private mapService: MapService;
  private repository: MemoriesRepository;
  private serverUrl: string;

  constructor(
    mapService: MapService,
    repository: MemoriesRepository,
    serverUrl = "https://sweet-dreams-f8nc.onrender.com"
  ) {
    this.mapService = mapService;
    this.repository = repository;
    this.serverUrl = serverUrl;
  }

  init(): void {
    this.dropArea = document.getElementById("dropArea");
    this.fileInput = document.getElementById("fileInput") as HTMLInputElement;

    if (!this.dropArea || !this.fileInput) return;

    ["dragenter", "dragover"].forEach((ev) => {
      this.dropArea?.addEventListener(ev, (e) => {
        e.preventDefault();
        this.dropArea?.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((ev) => {
      this.dropArea?.addEventListener(ev, (e) => {
        e.preventDefault();
        this.dropArea?.classList.remove("dragover");
      });
    });

    this.dropArea.addEventListener("drop", (e: DragEvent) => {
      if (e.dataTransfer?.files) {
        this.handleFiles(Array.from(e.dataTransfer.files));
      }
    });

    this.fileInput.addEventListener("change", (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files) {
        this.handleFiles(Array.from(target.files));
        target.value = "";
      }
    });
  }

  private async handleFiles(files: File[]): Promise<void> {
    for (const file of files) {
      await this.processFile(file);
    }
  }

  private async processFile(file: File): Promise<void> {
    let gps: { latitude?: number; longitude?: number } | null = null;
    let exifDate: string | null = null;

    if (typeof exifr !== "undefined") {
      try {
        const exifData = await exifr.parse(file);
        if (exifData?.DateTimeOriginal) {
          const d = new Date(exifData.DateTimeOriginal);
          const day = d.getDate().toString().padStart(2, "0");
          const month = (d.getMonth() + 1).toString().padStart(2, "0");
          const year = d.getFullYear().toString().slice(-2);
          exifDate = `${day}.${month}.${year}`;
        }
      } catch {}

      try {
        gps = await exifr.gps(file);
      } catch {}
    }

    const coords: [number, number] | null =
      gps?.latitude && gps?.longitude
        ? [gps.latitude, gps.longitude]
        : await this.mapService.waitForClick();

    if (!coords) return;

    let previewUrl = "";
    try {
      previewUrl = URL.createObjectURL(file);
    } catch {}

    const tmpMarker = this.mapService.createTempMarker(coords, previewUrl);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("coords", JSON.stringify(coords));
      fd.append("placeTitle", "Новое место");
      if (exifDate) fd.append("exifDate", exifDate);

      const res = await fetch(`${this.serverUrl}/upload`, {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({ success: false }));
      if (!data.success) throw new Error("Upload failed");

      this.mapService.removeMarker(tmpMarker);

      const placeId = String(data.id || Date.now());
      const photoUrl = data.thumbUrl || data.fileUrl || "";

      const newPlace = new Place({
        id: placeId,
        coords,
        photos: [
          {
            origUrl: photoUrl,
            thumbUrl: photoUrl,
            date: exifDate || "",
            caption: "",
          },
        ],
        exifDate: exifDate || undefined,
      });

      this.repository.savePlace(newPlace);
    } catch (err: any) {
      this.mapService.removeMarker(tmpMarker);
      console.error("Upload failed:", err);
      const isNetwork =
        !navigator.onLine ||
        (err.message &&
          (err.message.includes("Failed to fetch") ||
            err.message.includes("NetworkError")));

      if (isNetwork) {
        alert(
          "❌ Ошибка соединения с сервером.\n\nВ России сервер Render.com может блокироваться без VPN.\nПожалуйста, включите VPN и попробуйте снова!"
        );
      } else {
        alert("Ошибка при загрузке: " + err.message);
      }
    }
  }
}
