import { RawPlace } from "../types/memories";
import { PhotoItem } from "./PhotoItem";

export class Place {
  private placeId: string;
  private placeCoords: [number, number];
  private photoItems: PhotoItem[];
  private placeDescription: string;
  private placeDate: Date;

  constructor(data: RawPlace) {
    this.placeId = String(data.id || Place.generateTempId());
    
    const lat = Number(data.coords[0]);
    const lng = Number(data.coords[1]);
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error(`Некорректные координаты для точки ${this.placeId}: [${data.coords[0]}, ${data.coords[1]}]`);
    }
    this.placeCoords = [lat, lng];

    this.placeDescription = (data.description || "").trim();
    this.placeDate = Place.resolveDate(data);

    if (Array.isArray(data.photos) && data.photos.length > 0) {
      this.photoItems = data.photos.map((p) => new PhotoItem(p, this.placeDate));
    } else if (data.origUrl || data.thumbUrl) {
      this.photoItems = [
        new PhotoItem(
          {
            origUrl: data.origUrl,
            thumbUrl: data.thumbUrl,
            caption: data.caption,
            date: data.exifDate,
          },
          this.placeDate
        ),
      ];
    } else {
      this.photoItems = [];
    }
  }

  private static generateTempId(): string {
    return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  private static parseDateValue(value: unknown): Date | null {
    if (!value) return null;
    if (typeof value === "number") {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d;
    }
    const str = String(value).trim();
    if (!str) return null;

    const parts = str.split(".");
    if (parts.length === 3) {
      let day = parseInt(parts[0], 10);
      let month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }

    const isoDate = new Date(str);
    if (!isNaN(isoDate.getTime())) return isoDate;

    return null;
  }

  private static resolveDate(data: RawPlace): Date {
    const fromExif = Place.parseDateValue(data.exifDate);
    if (fromExif) return fromExif;

    const fromTimestamp = Place.parseDateValue(data.timestamp);
    if (fromTimestamp) return fromTimestamp;

    if (Array.isArray(data.photos) && data.photos.length > 0) {
      for (const p of data.photos) {
        const fromPhoto = Place.parseDateValue(p.date);
        if (fromPhoto) return fromPhoto;
      }
    }

    const numId = Number(data.id);
    if (!isNaN(numId) && numId > 1600000000000) {
      const fromId = new Date(numId);
      if (!isNaN(fromId.getTime())) return fromId;
    }

    return new Date();
  }

  get id(): string {
    return this.placeId;
  }

  get coords(): [number, number] {
    return [this.placeCoords[0], this.placeCoords[1]];
  }

  get photos(): readonly PhotoItem[] {
    return Object.freeze([...this.photoItems]);
  }

  get photosCount(): number {
    return this.photoItems.length;
  }

  get primaryPhoto(): PhotoItem | null {
    return this.photoItems.length > 0 ? this.photoItems[0] : null;
  }

  get hasMultiplePhotos(): boolean {
    return this.photoItems.length > 1;
  }

  get description(): string {
    return this.placeDescription;
  }

  get date(): Date {
    return new Date(this.placeDate.getTime());
  }

  get time(): number {
    return this.placeDate.getTime();
  }

  get formattedRussianDate(): string {
    return this.primaryPhoto ? this.primaryPhoto.formattedRussianDate : "Без даты";
  }

  getCoordsKey(precision = 7): string {
    return `${this.placeCoords[0].toFixed(precision)},${this.placeCoords[1].toFixed(precision)}`;
  }

  addPhoto(photo: PhotoItem): void {
    this.photoItems.push(photo);
  }

  removePhoto(index: number): boolean {
    if (index >= 0 && index < this.photoItems.length) {
      this.photoItems.splice(index, 1);
      return true;
    }
    return false;
  }

  toJSON(): RawPlace {
    const d = this.placeDate;
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const year = d.getFullYear().toString().slice(-2);

    return {
      id: this.placeId,
      coords: [this.placeCoords[0], this.placeCoords[1]],
      photos: this.photoItems.map((p) => p.toJSON()),
      description: this.placeDescription,
      exifDate: `${day}.${month}.${year}`,
      timestamp: this.placeDate.getTime(),
    };
  }
}
