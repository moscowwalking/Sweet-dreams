import { Place } from "../models/Place";
import { NostalgiaItem } from "../types/memories";

export class NostalgiaEngine {
  private places: Place[] = [];

  constructor(places: Place[] = []) {
    this.places = [...places];
  }

  setPlaces(places: Place[]): void {
    this.places = [...places];
  }

  findOnThisDay(targetDate: Date = new Date()): NostalgiaItem[] {
    const curDay = targetDate.getDate();
    const curMonth = targetDate.getMonth();
    const curYear = targetDate.getFullYear();

    const items: NostalgiaItem[] = [];

    for (const place of this.places) {
      const pDate = place.date;
      const pDay = pDate.getDate();
      const pMonth = pDate.getMonth();
      const pYear = pDate.getFullYear();

      if (pDay === curDay && pMonth === curMonth && pYear < curYear) {
        const yearsAgo = curYear - pYear;
        let yearWord = "лет";
        if (yearsAgo === 1) yearWord = "год";
        else if (yearsAgo >= 2 && yearsAgo <= 4) yearWord = "года";

        place.photos.forEach((photo, idx) => {
          items.push({
            placeId: place.id,
            photoUrl: photo.origUrl,
            thumbUrl: photo.thumbUrl,
            caption: photo.caption || place.description,
            date: photo.date,
            tag: `${yearsAgo} ${yearWord} назад ✨ (${idx + 1}/${place.photosCount})`,
            coords: place.coords,
            yearsAgo,
          });
        });
      }
    }

    return items;
  }

  findRecentUploads(recentIds: string[] = []): NostalgiaItem[] {
    const matchedPlaces: Place[] = [];

    for (const id of recentIds) {
      const place = this.places.find((p) => p.id === id);
      if (place && !matchedPlaces.includes(place)) {
        matchedPlaces.push(place);
      }
    }

    const placesToUse =
      matchedPlaces.length > 0
        ? matchedPlaces
        : [...this.places].sort((a, b) => b.time - a.time).slice(0, 5);

    const items: NostalgiaItem[] = [];
    for (const place of placesToUse) {
      place.photos.forEach((photo, idx) => {
        items.push({
          placeId: place.id,
          photoUrl: photo.origUrl,
          thumbUrl: photo.thumbUrl,
          caption: photo.caption || place.description,
          date: photo.date,
          tag: `Новое фото (${idx + 1}/${place.photosCount})`,
          coords: place.coords,
        });
      });
    }

    return items;
  }

  getRandomMemory(): { place: Place; photoIdx: number } | null {
    if (this.places.length === 0) return null;
    const randomPlace = this.places[Math.floor(Math.random() * this.places.length)];
    const photoIdx =
      randomPlace.photosCount > 0
        ? Math.floor(Math.random() * randomPlace.photosCount)
        : 0;

    return { place: randomPlace, photoIdx };
  }
}
