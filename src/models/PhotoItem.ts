import { RawPhoto } from "../types/memories";

export class PhotoItem {
  private origPhotoUrl: string;
  private thumbPhotoUrl: string;
  private photoCaption: string;
  private photoDate: Date;

  constructor(data: RawPhoto, fallbackDate?: Date) {
    this.origPhotoUrl = (data.origUrl || data.thumbUrl || "").trim();
    this.thumbPhotoUrl = (data.thumbUrl || data.origUrl || "").trim();
    this.photoCaption = (data.caption || "").trim();
    this.photoDate = PhotoItem.parseDate(data.date, fallbackDate);
  }

  private static parseDate(raw?: string, fallbackDate?: Date): Date {
    if (!raw) {
      return fallbackDate ? new Date(fallbackDate.getTime()) : new Date();
    }

    const parts = raw.split(".");
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      const parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    const isoDate = new Date(raw);
    if (!isNaN(isoDate.getTime())) return isoDate;

    return fallbackDate ? new Date(fallbackDate.getTime()) : new Date();
  }

  get origUrl(): string {
    return this.origPhotoUrl;
  }

  get thumbUrl(): string {
    return this.thumbPhotoUrl;
  }

  get caption(): string {
    return this.photoCaption;
  }

  get date(): Date {
    return new Date(this.photoDate.getTime());
  }

  get formattedRussianDate(): string {
    const months = [
      "янв", "фев", "мар", "апр", "мая", "июн",
      "июл", "авг", "сен", "окт", "ноя", "дек"
    ];
    const d = this.photoDate.getDate();
    const m = months[this.photoDate.getMonth()];
    const y = this.photoDate.getFullYear();
    return `${d} ${m} ${y}`;
  }

  updateCaption(newCaption: string): void {
    if (typeof newCaption !== "string") {
      throw new TypeError("Подпись должна быть строкой");
    }
    this.photoCaption = newCaption.trim();
  }

  toJSON(): RawPhoto {
    const d = this.photoDate;
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const year = d.getFullYear().toString().slice(-2);

    return {
      origUrl: this.origPhotoUrl,
      thumbUrl: this.thumbPhotoUrl,
      caption: this.photoCaption,
      date: `${day}.${month}.${year}`,
    };
  }
}
