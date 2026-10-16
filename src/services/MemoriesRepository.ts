import { Place } from "../models/Place";
import { RawPlace } from "../types/memories";

export type PlacesChangeListener = (places: readonly Place[]) => void;

export interface IKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class InMemoryStorage implements IKeyValueStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

export class MemoriesRepository {
  private placesMap = new Map<string, Place>();
  private cacheKey: string;
  private serverUrl: string;
  private storage: IKeyValueStorage;
  private listeners: Set<PlacesChangeListener> = new Set();

  constructor(options: {
    cacheKey?: string;
    serverUrl?: string;
    storage?: IKeyValueStorage;
  } = {}) {
    this.cacheKey = options.cacheKey || "places_cache_v3";
    this.serverUrl = options.serverUrl || "https://sweet-dreams-f8nc.onrender.com";

    if (options.storage) {
      this.storage = options.storage;
    } else if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
      this.storage = window.localStorage;
    } else if (typeof localStorage !== "undefined") {
      this.storage = localStorage;
    } else {
      this.storage = new InMemoryStorage();
    }
  }

  getAll(): readonly Place[] {
    return Object.freeze(
      Array.from(this.placesMap.values()).sort((a, b) => a.time - b.time)
    );
  }

  getById(id: string): Place | undefined {
    return this.placesMap.get(id);
  }

  savePlace(place: Place): void {
    this.placesMap.set(place.id, place);
    this.persistCache();
    this.notifyListeners();
  }

  loadFromLocalCache(): readonly Place[] {
    try {
      const cached = this.storage.getItem(this.cacheKey);
      if (!cached) return [];

      const rawList: RawPlace[] = JSON.parse(cached);
      if (Array.isArray(rawList)) {
        this.populate(rawList);
      }
    } catch (err) {
      console.warn("Error reading cache:", err);
    }
    return this.getAll();
  }

  syncExternalData(rawList: RawPlace[]): void {
    if (!Array.isArray(rawList)) return;
    this.populate(rawList);
    this.persistCache();
    this.notifyListeners();
  }

  async fetchFromRender(timeoutMs = 8000): Promise<readonly Place[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.serverUrl}/places`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const rawList: RawPlace[] = await res.json();
      this.syncExternalData(rawList);
      return this.getAll();
    } catch (err) {
      clearTimeout(timer);
      console.warn("Error loading from Render:", err);
      return this.getAll();
    }
  }

  subscribe(listener: PlacesChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.getAll());

    return () => {
      this.listeners.delete(listener);
    };
  }

  initRealtimeSync(): void {
    const attachFirestore = () => {
      const f = (typeof window !== "undefined" && (window as any).FirebaseFirestore);
      if (f && f.db && f.collection && f.onSnapshot) {
        try {
          f.onSnapshot(f.collection(f.db, "places"), (snapshot: any) => {
            const places: RawPlace[] = [];
            snapshot.forEach((doc: any) => places.push(doc.data()));
            this.syncExternalData(places);
          });
        } catch (e) {
          console.warn("Firestore sync error:", e);
        }
      }
    };

    if (typeof window !== "undefined") {
      if ((window as any).FirebaseFirestore) {
        attachFirestore();
      } else {
        window.addEventListener("firebase-ready", attachFirestore, { once: true });
      }
    }
  }

  private populate(rawList: RawPlace[]): void {
    this.placesMap.clear();
    for (const raw of rawList) {
      try {
        const place = new Place(raw);
        if (place.photosCount > 0) {
          this.placesMap.set(place.id, place);
        }
      } catch (e) {
      }
    }
  }

  private persistCache(): void {
    try {
      const serialized = Array.from(this.placesMap.values()).map((p) => p.toJSON());
      this.storage.setItem(this.cacheKey, JSON.stringify(serialized));
    } catch (err) {
      console.warn("Failed to persist cache:", err);
    }
  }

  private notifyListeners(): void {
    const places = this.getAll();
    for (const listener of this.listeners) {
      listener(places);
    }
  }
}
