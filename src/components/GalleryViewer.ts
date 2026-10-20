import { Place } from "../models/Place";

export class GalleryViewer {
  private overlay: HTMLElement | null = null;
  private mainImg: HTMLImageElement | null = null;
  private thumbsContainer: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private captionEl: HTMLElement | null = null;

  private currentPlace: Place | null = null;
  private currentIndex: number = 0;
  private scale: number = 1;
  private translateX: number = 0;
  private translateY: number = 0;
  private isInitialized: boolean = false;
  private serverUrl: string;
  private onCaptionUpdate?: (place: Place) => void;

  constructor(
    serverUrl: string = "https://sweet-dreams-f8nc.onrender.com",
    onCaptionUpdate?: (place: Place) => void
  ) {
    this.serverUrl = serverUrl;
    this.onCaptionUpdate = onCaptionUpdate;
  }

  init(): void {
    if (this.isInitialized) return;

    this.overlay = document.getElementById("overlay");
    this.mainImg = document.getElementById("galleryMain") as HTMLImageElement;
    this.thumbsContainer = document.getElementById("thumbs");
    this.titleEl = document.getElementById("placeTitle");
    this.closeBtn = document.getElementById("closeGallery");
    this.captionEl = document.getElementById("photoCaption");

    if (!this.captionEl && this.mainImg?.parentElement) {
      this.captionEl = document.createElement("div");
      this.captionEl.id = "photoCaption";
      this.mainImg.parentElement.insertAdjacentElement("afterend", this.captionEl);
    }

    if (this.captionEl) {
      this.captionEl.onclick = () => this.editCaption();
    }

    if (!this.overlay || !this.mainImg) {
      console.warn("Gallery elements not found in DOM");
      return;
    }

    if (this.closeBtn) {
      this.closeBtn.onclick = () => this.close();
    }

    this.setupGestures();
    this.setupKeyboard();
    this.isInitialized = true;
  }

  open(place: Place, initialIndex: number = 0): void {
    if (!this.isInitialized) {
      this.init();
    }

    if (!this.overlay || !this.mainImg || !this.thumbsContainer) return;

    this.currentPlace = place;
    this.currentIndex = initialIndex;
    this.thumbsContainer.innerHTML = "";

    const photos = place.photos;

    if (photos.length > 1) {
      this.thumbsContainer.style.display = "flex";
      photos.forEach((photo, idx) => {
        const thumb = document.createElement("img");
        thumb.src = photo.thumbUrl || photo.origUrl;
        thumb.onerror = () => {
          thumb.style.display = "none";
        };
        thumb.className = idx === initialIndex ? "active" : "";
        thumb.onclick = () => this.showPhoto(idx);
        this.thumbsContainer!.appendChild(thumb);
      });
    } else {
      this.thumbsContainer.style.display = "none";
    }

    this.resetZoom(false);
    this.showPhoto(initialIndex);
    this.overlay.style.display = "flex";
  }

  showPhoto(index: number): void {
    if (!this.currentPlace || !this.mainImg) return;
    const photos = this.currentPlace.photos;
    if (index < 0 || index >= photos.length) return;

    this.resetZoom(false);
    this.currentIndex = index;
    const photo = photos[index];
    const photoSrc = photo.origUrl || photo.thumbUrl;

    this.mainImg.onerror = () => {
      if (this.mainImg) {
        this.mainImg.alt = "Failed to load photo";
        this.mainImg.style.opacity = "1";
      }
    };

    if (this.mainImg.src !== photoSrc) {
      this.mainImg.style.opacity = "0";
      this.mainImg.onload = () => {
        if (this.mainImg) this.mainImg.style.opacity = "1";
      };
      this.mainImg.src = photoSrc;
    } else {
      this.mainImg.style.opacity = "1";
    }

    if (this.titleEl) {
      this.titleEl.textContent = photo.formattedRussianDate;
    }

    if (this.captionEl) {
      this.captionEl.textContent = photo.caption || "Добавь подпись ✍️";
    }

    if (this.thumbsContainer) {
      const allThumbs = this.thumbsContainer.querySelectorAll("img");
      allThumbs.forEach((t, i) => {
        t.className = i === index ? "active" : "";
      });
    }
  }

  nextPhoto(): void {
    if (!this.currentPlace || this.currentPlace.photosCount <= 1) return;
    this.resetZoom(false);
    const nextIdx = (this.currentIndex + 1) % this.currentPlace.photosCount;
    this.showPhoto(nextIdx);
  }

  prevPhoto(): void {
    if (!this.currentPlace || this.currentPlace.photosCount <= 1) return;
    this.resetZoom(false);
    const count = this.currentPlace.photosCount;
    const prevIdx = (this.currentIndex - 1 + count) % count;
    this.showPhoto(prevIdx);
  }

  close(): void {
    this.resetZoom(false);
    if (this.overlay) {
      this.overlay.style.display = "none";
    }
    if (this.mainImg) {
      this.mainImg.src = "";
      this.mainImg.style.opacity = "1";
    }
  }

  private applyTransform(animate = false): void {
    if (!this.mainImg) return;
    if (animate) {
      this.mainImg.style.transition =
        "transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)";
    } else {
      this.mainImg.style.transition = "none";
    }
    this.mainImg.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  }

  private resetZoom(animate = false): void {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform(animate);
  }

  private clampBounds(container: HTMLElement): void {
    const rect = container.getBoundingClientRect();
    const maxPanX = Math.max(0, (rect.width * this.scale - rect.width) / 2);
    const maxPanY = Math.max(0, (rect.height * this.scale - rect.height) / 2);
    this.translateX = Math.max(-maxPanX, Math.min(maxPanX, this.translateX));
    this.translateY = Math.max(-maxPanY, Math.min(maxPanY, this.translateY));
  }

  private setupGestures(): void {
    const photoContainer = this.mainImg?.parentElement;
    if (!photoContainer) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let startTranslateX = 0;
    let startTranslateY = 0;
    let initialDistance = 0;
    let startScale = 1;
    let isPinching = false;
    let isPanning = false;
    let lastTapTime = 0;

    photoContainer.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        if (e.touches.length === 2) {
          isPinching = true;
          isPanning = false;
          initialDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          startScale = this.scale;
        } else if (e.touches.length === 1) {
          isPinching = false;
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          startTranslateX = this.translateX;
          startTranslateY = this.translateY;

          const now = Date.now();
          if (now - lastTapTime < 300) {
            lastTapTime = 0;
            if (this.scale > 1.2) {
              this.resetZoom(true);
            } else {
              const rect = this.mainImg!.getBoundingClientRect();
              const tapX = e.touches[0].clientX - rect.left - rect.width / 2;
              const tapY = e.touches[0].clientY - rect.top - rect.height / 2;
              this.scale = 2.5;
              this.translateX = -tapX * 1.5;
              this.translateY = -tapY * 1.5;
              this.clampBounds(photoContainer);
              this.applyTransform(true);
            }
            return;
          }
          lastTapTime = now;

          if (this.scale > 1.05) {
            isPanning = true;
          }
        }
      },
      { passive: false }
    );

    photoContainer.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        if (e.touches.length === 2 && isPinching) {
          e.preventDefault();
          const currentDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          if (initialDistance > 0) {
            const factor = currentDistance / initialDistance;
            let newScale = Math.max(0.75, Math.min(startScale * factor, 4.5));
            this.scale = newScale;
            this.applyTransform(false);
          }
        } else if (e.touches.length === 1 && isPanning && this.scale > 1.05) {
          e.preventDefault();
          const dx = e.touches[0].clientX - touchStartX;
          const dy = e.touches[0].clientY - touchStartY;
          this.translateX = startTranslateX + dx;
          this.translateY = startTranslateY + dy;
          this.clampBounds(photoContainer);
          this.applyTransform(false);
        } else if (e.touches.length === 1 && this.scale <= 1.05) {
          const dy = e.touches[0].clientY - touchStartY;
          const dx = e.touches[0].clientX - touchStartX;
          if (dy > 15 && Math.abs(dy) > Math.abs(dx)) {
            e.preventDefault();
            this.translateY = dy * 0.75;
            this.scale = Math.max(0.85, 1 - dy / 800);
            this.applyTransform(false);
          }
        }
      },
      { passive: false }
    );

    photoContainer.addEventListener(
      "touchend",
      (e: TouchEvent) => {
        if (isPinching) {
          isPinching = false;
          if (this.scale < 1.05) {
            this.resetZoom(true);
          } else {
            this.scale = Math.min(this.scale, 4);
            this.clampBounds(photoContainer);
            this.applyTransform(true);
          }
          return;
        }

        if (isPanning) {
          isPanning = false;
          this.clampBounds(photoContainer);
          this.applyTransform(true);
          return;
        }

        if (this.scale <= 1.05 && touchStartX) {
          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

          if (diffY > 80 && Math.abs(diffY) > Math.abs(diffX)) {
            this.close();
          } else if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX < 0) this.nextPhoto();
            else this.prevPhoto();
          } else {
            this.resetZoom(true);
          }
        }
        touchStartX = 0;
        touchStartY = 0;
      },
      { passive: true }
    );

    photoContainer.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.25 : -0.25;
        this.scale = Math.max(1, Math.min(this.scale + delta, 4));
        if (this.scale === 1) {
          this.translateX = 0;
          this.translateY = 0;
        } else {
          this.clampBounds(photoContainer);
        }
        this.applyTransform(true);
      },
      { passive: false }
    );
  }

  private setupKeyboard(): void {
    document.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this.overlay?.style.display !== "flex") return;
      if (e.key === "Escape") this.close();
      if (e.key === "ArrowRight") this.nextPhoto();
      if (e.key === "ArrowLeft") this.prevPhoto();
    });
  }

  private editCaption(): void {
    if (!this.captionEl || !this.currentPlace) return;
    const photo = this.currentPlace.photos[this.currentIndex];
    if (!photo) return;

    const oldText = photo.caption;
    const input = document.createElement("input");
    input.type = "text";
    input.value = oldText;
    input.style.display = "block";
    input.style.margin = "10px auto";
    input.style.width = "80%";
    input.style.textAlign = "center";
    input.style.fontSize = "15px";
    input.style.padding = "6px";
    input.style.borderRadius = "10px";
    input.style.border = "1px solid #ccc";

    this.captionEl.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;

      const newCaption = input.value.trim();
      photo.updateCaption(newCaption);

      if (this.captionEl) {
        input.replaceWith(this.captionEl);
        this.captionEl.textContent = newCaption || "Добавь подпись ✍️";
      }

      if (this.currentPlace) {
        this.onCaptionUpdate?.(this.currentPlace);
        try {
          await fetch(`${this.serverUrl}/update-caption`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: this.currentPlace.id,
              photoIndex: this.currentIndex,
              caption: newCaption,
            }),
          });
        } catch (err) {
          console.error("Failed to save caption:", err);
        }
      }
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        input.blur();
      } else if (e.key === "Escape") {
        finished = true;
        if (this.captionEl) {
          input.replaceWith(this.captionEl);
          this.captionEl.textContent = oldText || "Добавь подпись ✍️";
        }
      }
    });
  }
}
