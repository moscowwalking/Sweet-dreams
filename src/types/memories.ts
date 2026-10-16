export interface RawPhoto {
  origUrl?: string;
  thumbUrl?: string;
  caption?: string;
  date?: string;
}

export interface RawPlace {
  id: string | number;
  coords: [number, number];
  photos?: RawPhoto[];
  origUrl?: string;
  thumbUrl?: string;
  caption?: string;
  description?: string;
  exifDate?: string;
  timestamp?: number | string;
  createdAt?: string | number;
}

export interface NostalgiaItem {
  placeId: string;
  photoUrl: string;
  thumbUrl: string;
  caption: string;
  date: Date;
  tag: string;
  coords: [number, number];
  yearsAgo?: number;
}
