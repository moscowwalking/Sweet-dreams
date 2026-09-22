// =========================================================================
// memories.js - Интерактивная карта воспоминаний Sweet Dreams
// =========================================================================

const CONFIG = {
  SERVER_URL: "https://sweet-dreams-f8nc.onrender.com",
  MAP: {
    center: [55.75, 37.61],
    zoom: 5,
    maxZoom: 19,
  },
  CACHE: {
    PLACES_KEY: "places_cache_v3",
  },
  RELATIONSHIP: {
    startDate: new Date(2025, 7, 23), // 23 августа 2025
  },
  MARKER: {
    size: 56,
    tempSize: 40,
  },
  UPLOAD: {
    maxSize: 15 * 1024 * 1024, // 15MB
  },
};

// =========================================================================
// MAP INITIALIZATION
// =========================================================================
const map = L.map("map", { zoomControl: false }).setView(
  CONFIG.MAP.center,
  CONFIG.MAP.zoom,
);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: CONFIG.MAP.maxZoom,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

const markers = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  zoomToBoundsOnClick: true,
  spiderfyDistanceMultiplier: 2.5,
});
map.addLayer(markers);

window.addEventListener("resize", () => {
  if (map) map.invalidateSize();
});
window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);
});

const placesStore = new Map();

// =========================================================================
// UTILITY FUNCTIONS
// =========================================================================
const Utils = {
  coordsKey(lat, lon, precision = 7) {
    return `${lat.toFixed(precision)},${lon.toFixed(precision)}`;
  },

  async waitForMapClick(timeout = 30000) {
    return new Promise((resolve) => {
      const onClick = (e) => {
        map.off("click", onClick);
        resolve([e.latlng.lat, e.latlng.lng]);
      };
      map.on("click", onClick);
      setTimeout(() => {
        map.off("click", onClick);
        resolve(null);
      }, timeout);
    });
  },

  formatDate(date) {
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear().toString().slice(-2);
    return `${day}.${month}.${year}`;
  },

  getPlaceDate(place) {
    if (!place) return new Date();
    // 1. Проверяем exifDate
    if (place.exifDate) {
      const parts = place.exifDate.split(".");
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
      const d = new Date(place.exifDate);
      if (!isNaN(d.getTime())) return d;
    }
    // 2. Проверяем дату первого фото
    if (place.photos && place.photos[0]?.date) {
      const pDate = place.photos[0].date;
      const parts = pDate.split(".");
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
    }
    // 3. Проверяем timestamp
    if (place.timestamp) {
      const d = new Date(place.timestamp);
      if (!isNaN(d.getTime())) return d;
    }
    // 4. Проверяем ID как таймстемп
    const num = Number(place.id);
    if (!isNaN(num) && num > 1600000000000) {
      return new Date(num);
    }
    return new Date();
  },

  getPlaceTime(place) {
    return this.getPlaceDate(place).getTime();
  },

  formatRussianDate(date) {
    if (!date || isNaN(date.getTime())) return "Без даты";
    const months = [
      "янв",
      "фев",
      "мар",
      "апр",
      "мая",
      "июн",
      "июл",
      "авг",
      "сен",
      "окт",
      "ноя",
      "дек",
    ];
    const d = date.getDate();
    const m = months[date.getMonth()];
    const y = date.getFullYear();
    return `${d} ${m} ${y}`;
  },

  urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  },
};

// =========================================================================
// MARKER HANDLING
// =========================================================================
const MarkerManager = {
  create(place, isTemp = false) {
    const [lat, lon] = place.coords;
    const size = isTemp ? CONFIG.MARKER.tempSize : CONFIG.MARKER.size;
    const opacity = isTemp ? 0.5 : 1;
    const pulseClass = isTemp ? "pulsing-marker" : "";
    const thumbSrc =
      place.photos[0]?.thumbUrl || place.photos[0]?.origUrl || "";

    const hasMultiple = place.photos.length > 1;
    const countBadgeHtml = hasMultiple
      ? `<div style="background:rgba(255,255,255,0.95);padding:4px 8px;border-radius:8px;font-weight:700;color:#222;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">${place.photos.length}</div>`
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
    const marker = L.marker([lat, lon], { icon });
    marker.on("click", () => Gallery.open(place));

    return marker;
  },

  updateSizes() {
    const zoom = map.getZoom();
    const scale = Math.pow(2, zoom - 13);
    const size = Math.max(20, Math.min(56, 40 * scale));

    placesStore.forEach((place) => {
      if (!place.marker) return;
      const thumbSrc =
        place.photos[0]?.thumbUrl || place.photos[0]?.origUrl || "";
      const hasMultiple = place.photos.length > 1;
      const countBadgeHtml = hasMultiple
        ? `<div style="background:rgba(255,255,255,0.95);padding:4px 8px;border-radius:8px;font-weight:700;color:#222;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">${place.photos.length}</div>`
        : "";

      const iconHtml = `
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:${size}px;height:${size}px;border-radius:10px;background:#ffd1dc;position:relative;overflow:hidden;box-shadow:0 6px 16px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;">
            <span style="font-size:12px;">💖</span>
            <img src="${thumbSrc}"
                 loading="lazy"
                 decoding="async"
                 onload="this.style.opacity='1';"
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
      place.marker.setIcon(icon);
    });
  },
};

// =========================================================================
// GALLERY
// =========================================================================
const Gallery = {
  overlay: document.getElementById("overlay"),
  main: document.getElementById("galleryMain"),
  thumbs: document.getElementById("thumbs"),
  placeTitle: document.getElementById("placeTitle"),
  closeBtn: document.getElementById("closeGallery"),

  currentPlace: null,
  currentIndex: 0,
  scale: 1,
  translateX: 0,
  translateY: 0,

  applyTransform(animate = false) {
    if (!this.main) return;
    if (animate) {
      this.main.style.transition =
        "transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)";
    } else {
      this.main.style.transition = "none";
    }
    this.main.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  },

  resetZoom(animate = false) {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform(animate);
  },

  clampBounds(container) {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const maxPanX = Math.max(0, (rect.width * this.scale - rect.width) / 2);
    const maxPanY = Math.max(0, (rect.height * this.scale - rect.height) / 2);
    this.translateX = Math.max(-maxPanX, Math.min(maxPanX, this.translateX));
    this.translateY = Math.max(-maxPanY, Math.min(maxPanY, this.translateY));
  },

  init() {
    this.closeBtn.onclick = () => this.close();

    const photoContainer = this.main.parentElement;
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

    // --- TOUCH START ---
    photoContainer.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          // Pinch-to-zoom (2 пальца)
          isPinching = true;
          isPanning = false;
          initialDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          );
          startScale = this.scale;
        } else if (e.touches.length === 1) {
          isPinching = false;
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          startTranslateX = this.translateX;
          startTranslateY = this.translateY;

          // Проверка Double Tap (двойной быстрый тап для зума как на iPhone)
          const now = Date.now();
          if (now - lastTapTime < 300) {
            lastTapTime = 0;
            if (this.scale > 1.2) {
              this.resetZoom(true);
            } else {
              const rect = this.main.getBoundingClientRect();
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
      { passive: false },
    );

    // --- TOUCH MOVE ---
    photoContainer.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2 && isPinching) {
          // Активный Pinch двумя пальцами (блокируем зум всей страницы браузера)
          e.preventDefault();
          const currentDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          );
          if (initialDistance > 0) {
            const factor = currentDistance / initialDistance;
            let newScale = startScale * factor;
            // Мягкое ограничение от 0.75x до 4.5x
            newScale = Math.max(0.75, Math.min(newScale, 4.5));
            this.scale = newScale;
            this.applyTransform(false);
          }
        } else if (e.touches.length === 1 && isPanning && this.scale > 1.05) {
          // Перемещение увеличенного фото (Pan одним пальцем)
          e.preventDefault();
          const dx = e.touches[0].clientX - touchStartX;
          const dy = e.touches[0].clientY - touchStartY;
          this.translateX = startTranslateX + dx;
          this.translateY = startTranslateY + dy;
          this.clampBounds(photoContainer);
          this.applyTransform(false);
        } else if (e.touches.length === 1 && this.scale <= 1.05) {
          // Обычный масштаб: потягивание вниз для закрытия модалки
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
      { passive: false },
    );

    // --- TOUCH END ---
    photoContainer.addEventListener(
      "touchend",
      (e) => {
        if (isPinching) {
          isPinching = false;
          if (this.scale < 1.05) {
            this.resetZoom(true);
          } else if (this.scale > 4) {
            this.scale = 4;
            this.clampBounds(photoContainer);
            this.applyTransform(true);
          } else {
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

        // Если фото в обычном масштабе — обрабатываем свайпы
        if (this.scale <= 1.05 && touchStartX) {
          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

          // Свайп вниз (Swipe to close)
          if (diffY > 80 && Math.abs(diffY) > Math.abs(diffX)) {
            this.close();
          } else if (
            Math.abs(diffX) > 40 &&
            Math.abs(diffX) > Math.abs(diffY)
          ) {
            // Свайп влево/вправо (Next/Prev)
            if (diffX < 0) {
              this.nextPhoto();
            } else {
              this.prevPhoto();
            }
          } else {
            // Если не дотянули свайп вниз — плавно пружиним на место
            this.resetZoom(true);
          }
        }
        touchStartX = 0;
        touchStartY = 0;
      },
      { passive: true },
    );

    // Desktop: зум колесиком мыши
    photoContainer.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.25 : -0.25;
        let newScale = this.scale + delta;
        newScale = Math.max(1, Math.min(newScale, 4));
        this.scale = newScale;
        if (this.scale === 1) {
          this.translateX = 0;
          this.translateY = 0;
        } else {
          this.clampBounds(photoContainer);
        }
        this.applyTransform(true);
      },
      { passive: false },
    );

    // Клавиатура: Escape для закрытия, стрелки влево/вправо
    document.addEventListener("keydown", (e) => {
      if (this.overlay.style.display !== "flex") return;
      if (e.key === "Escape") this.close();
      if (e.key === "ArrowRight") this.nextPhoto();
      if (e.key === "ArrowLeft") this.prevPhoto();
    });
  },

  nextPhoto() {
    this.resetZoom(false);
    if (!this.photoList || this.photoList.length <= 1) return;
    const nextIdx = (this.currentIndex + 1) % this.photoList.length;
    this.showPhoto(nextIdx);
  },

  prevPhoto() {
    this.resetZoom(false);
    if (!this.photoList || this.photoList.length <= 1) return;
    const prevIdx =
      (this.currentIndex - 1 + this.photoList.length) % this.photoList.length;
    this.showPhoto(prevIdx);
  },

  open(place, initialIndex = 0) {
    this.currentPlace = place;
    this.currentIndex = initialIndex;
    this.thumbs.innerHTML = "";

    const photoList =
      Array.isArray(place.photos) && place.photos.length
        ? place.photos
        : [
            {
              origUrl: place.origUrl,
              thumbUrl: place.thumbUrl,
              date:
                place.date ||
                (place.timestamp
                  ? new Date(place.timestamp).toLocaleDateString("ru-RU")
                  : ""),
              caption: place.caption || "",
            },
          ];

    this.photoList = photoList;

    if (photoList.length > 1) {
      this.thumbs.style.display = "flex";
      photoList.forEach((photo, idx) => {
        const thumb = document.createElement("img");
        thumb.src = photo.origUrl || photo.thumbUrl || "";
        thumb.onerror = function () {
          this.style.display = "none";
        };
        thumb.className = idx === initialIndex ? "active" : "";
        thumb.onclick = () => this.showPhoto(idx);
        this.thumbs.appendChild(thumb);
      });
    } else {
      this.thumbs.style.display = "none";
    }

    this.resetZoom(false);
    this.showPhoto(initialIndex);
    this.overlay.style.display = "flex";
  },

  showPhoto(index) {
    this.resetZoom(false);
    this.currentIndex = index;
    const photo = this.photoList[index];
    if (!photo) return;

    const photoSrc = photo.origUrl || photo.thumbUrl || "";
    this.main.onerror = () => {
      this.main.alt = "Не удалось загрузить фото";
    };
    this.main.src = photoSrc;
    this.placeTitle.textContent = photo.date || "Без даты";

    this.createCaptionElement(photo.caption);

    const allThumbs = this.thumbs.querySelectorAll("img");
    allThumbs.forEach((t, i) => {
      t.className = i === index ? "active" : "";
    });
  },

  close() {
    this.resetZoom(false);
    this.overlay.style.display = "none";
    this.main.src = "";
  },

  createCaptionElement(initialCaption) {
    let captionEl = document.getElementById("photoCaption");
    if (captionEl) captionEl.remove();

    captionEl = document.createElement("div");
    captionEl.id = "photoCaption";
    captionEl.textContent = initialCaption || "Добавь подпись ✍️";
    captionEl.onclick = () => this.editCaption(captionEl);

    const photoContainer = this.main.parentElement;
    photoContainer.parentNode.insertBefore(
      captionEl,
      photoContainer.nextSibling,
    );
  },

  async editCaption(captionEl) {
    const oldText =
      captionEl.textContent === "Добавь подпись ✍️"
        ? ""
        : captionEl.textContent;
    const input = document.createElement("input");
    input.type = "text";
    input.value = oldText;
    Object.assign(input.style, {
      display: "block",
      margin: "10px auto",
      width: "80%",
      textAlign: "center",
      fontSize: "15px",
      padding: "6px",
      borderRadius: "10px",
      border: "1px solid #ccc",
    });

    captionEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newCaption = input.value.trim();
      const photoList = Array.isArray(this.currentPlace.photos)
        ? this.currentPlace.photos
        : [this.currentPlace];

      photoList[this.currentIndex].caption = newCaption;

      input.replaceWith(captionEl);
      captionEl.textContent = newCaption || "Добавь подпись ✍️";

      try {
        await fetch(`${CONFIG.SERVER_URL}/update-caption`, {
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
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish();
      if (e.key === "Escape") {
        input.replaceWith(captionEl);
        captionEl.textContent = oldText || "Добавь подпись ✍️";
      }
    });
  },
};

// =========================================================================
// LOVE COUNTER
// =========================================================================
const LoveCounter = {
  memoriesEl: document.getElementById("totalMemories"),
  daysEl: document.getElementById("totalDays"),
  counterEl: document.getElementById("loveCounter"),

  init() {
    this.update();
  },

  update(customTotal = null) {
    const totalMemories = customTotal !== null ? customTotal : placesStore.size;
    const oldValue = parseInt(this.memoriesEl.textContent) || 0;

    if (totalMemories !== oldValue) {
      this.memoriesEl.classList.add("updated");
      setTimeout(() => this.memoriesEl.classList.remove("updated"), 300);
    }

    this.memoriesEl.textContent = totalMemories;

    const startDate = CONFIG.RELATIONSHIP.startDate;
    const today = new Date();
    const diffTime = Math.abs(today - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    this.daysEl.textContent = diffDays;

    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    const days = diffDays % 30;
    this.counterEl.title = `Вместе уже ${years} лет, ${months} месяцев и ${days} дней ❤️`;
  },
};

// =========================================================================
// RANDOM MEMORY
// =========================================================================
const RandomMemory = {
  btn: document.getElementById("randomMemoryBtn"),
  mobileBtn: document.getElementById("mobileRandomBtn"),

  init() {
    this.btn?.addEventListener("click", () => this.show());
    this.mobileBtn?.addEventListener("click", () => this.show());
  },

  show() {
    const allPlaces = Array.from(placesStore.values());

    if (allPlaces.length === 0) {
      alert("😢 Пока нет воспоминаний...");
      return;
    }

    const randomPlace = allPlaces[Math.floor(Math.random() * allPlaces.length)];

    map.flyTo(randomPlace.coords, 16, {
      duration: 2,
      easeLinearity: 0.5,
    });

    setTimeout(() => Gallery.open(randomPlace), 1500);

    const activeBtn = [this.mobileBtn, this.btn].find(
      (b) => b && window.getComputedStyle(b).display !== "none",
    );
    if (activeBtn) {
      activeBtn.style.transform = "scale(1.2)";
      setTimeout(() => (activeBtn.style.transform = ""), 300);
    }
  },
};

// =========================================================================
// UPLOAD MANAGER
// =========================================================================
const UploadManager = {
  dropArea: document.getElementById("dropArea"),
  fileInput: document.getElementById("fileInput"),

  init() {
    ["dragenter", "dragover"].forEach((ev) => {
      this.dropArea.addEventListener(ev, (e) => {
        e.preventDefault();
        this.dropArea.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((ev) => {
      this.dropArea.addEventListener(ev, (e) => {
        e.preventDefault();
        this.dropArea.classList.remove("dragover");
      });
    });

    this.dropArea.addEventListener("drop", (e) =>
      this.handleFiles(Array.from(e.dataTransfer.files)),
    );
    this.fileInput.addEventListener("change", (e) => {
      this.handleFiles(Array.from(e.target.files));
      this.fileInput.value = "";
    });
  },

  async handleFiles(files) {
    for (const file of files) {
      await this.processFile(file);
    }
  },

  async processFile(file) {
    let gps = null;
    let exifDate = null;

    try {
      const exifData = await exifr.parse(file);
      if (exifData?.DateTimeOriginal) {
        const date = new Date(exifData.DateTimeOriginal);
        exifDate = Utils.formatDate(date);
      }
    } catch (exifErr) {
      console.log("No EXIF date found");
    }

    try {
      gps = await exifr.gps(file);
    } catch {}

    const coords =
      gps?.latitude && gps?.longitude
        ? [gps.latitude, gps.longitude]
        : await Utils.waitForMapClick();

    if (!coords) return;

    let previewUrl = "";
    try {
      previewUrl = URL.createObjectURL(file);
    } catch {}

    const tempPlace = {
      id: "tmp-" + Date.now(),
      coords,
      photos: [
        {
          thumbUrl: previewUrl,
          origUrl: previewUrl,
          date: exifDate || Utils.formatDate(new Date()),
          caption: "",
        },
      ],
    };

    const tmpMarker = MarkerManager.create(tempPlace, true);
    markers.addLayer(tmpMarker);

    await this.uploadToServer(file, gps, tempPlace, tmpMarker, exifDate);
  },

  async uploadToServer(file, gps, tmpPlace, tmpMarker, exifDate) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("coords", JSON.stringify(tmpPlace.coords));
      fd.append("placeTitle", "Новое место");
      if (exifDate) fd.append("exifDate", exifDate);

      const r = await fetch(`${CONFIG.SERVER_URL}/upload`, {
        method: "POST",
        body: fd,
      });
      const res = await r.json().catch(() => ({ success: false }));

      if (!res.success) throw new Error("Upload failed");

      markers.removeLayer(tmpMarker);

      const placeId = res.id
        ? String(res.id)
        : Utils.coordsKey(...tmpPlace.coords);

      // Ищем место только по ID нового загруженного фото (каждая фотка — отдельный маркер на карте)
      let place = Array.from(placesStore.values()).find((p) => {
        return res.id && String(p.id) === String(res.id);
      });

      if (!place) {
        place = {
          id: placeId,
          coords: [...tmpPlace.coords],
          photos: [],
          exifDate,
        };
        placesStore.set(place.id, place);
      } else if (res.id) {
        place.id = String(res.id);
      }

      // Если Firestore уже успел добавить это фото по вебсокету — не дублируем его второй раз
      const photoUrl = res.thumbUrl || res.fileUrl;
      const alreadyExists = place.photos.some(
        (p) =>
          p.thumbUrl === photoUrl ||
          p.origUrl === photoUrl ||
          p.url === photoUrl,
      );

      if (!alreadyExists) {
        place.photos.push({
          thumbUrl: photoUrl,
          origUrl: photoUrl,
          url: photoUrl,
          date: exifDate || Utils.formatDate(new Date()),
          caption: "",
        });
      }

      if (place.marker) markers.removeLayer(place.marker);
      place.marker = MarkerManager.create(place);
      markers.addLayer(place.marker);

      LoveCounter.update();
    } catch (e) {
      console.error("Upload error:", e);
      markers.removeLayer(tmpMarker);
      const isNetworkError =
        !navigator.onLine ||
        (e.message &&
          (e.message.includes("Failed to fetch") ||
            e.message.includes("NetworkError")));
      if (isNetworkError) {
        alert(
          "❌ Ошибка соединения с сервером.\n\nВ России сервер Render.com блокируется провайдерами без VPN.\nПожалуйста, включите VPN и попробуйте загрузить фото снова!",
        );
      } else {
        alert("Ошибка при загрузке: " + e.message);
      }
    }
  },
};

// =========================================================================
// NOSTALGIA MANAGER (В этот день)
// =========================================================================
const NostalgiaManager = {
  card: document.getElementById("nostalgiaCard"),
  btn: document.getElementById("nostalgiaBtn"),
  badge: document.getElementById("nostalgiaBadge"),
  mobileBtn: document.getElementById("mobileNostalgiaBtn"),
  mobileBadge: document.getElementById("mobileNostalgiaBadge"),
  closeBtn: document.getElementById("nostalgiaCloseBtn"),
  actionBtn: document.getElementById("nostalgiaActionBtn"),
  imgContainer: document.getElementById("nostalgiaImgContainer"),
  imgEl: document.getElementById("nostalgiaImg"),
  dateEl: document.getElementById("nostalgiaDate"),
  captionEl: document.getElementById("nostalgiaCaption"),
  tagEl: document.getElementById("nostalgiaTag"),
  navEl: document.getElementById("nostalgiaNav"),
  counterEl: document.getElementById("nostalgiaCounter"),
  prevBtn: document.getElementById("nostalgiaPrevBtn"),
  nextBtn: document.getElementById("nostalgiaNextBtn"),
  places: [],
  items: [],
  currentIndex: 0,
  initialized: false,

  init(places) {
    this.places = places || [];
    if (this.places.length === 0) return;

    // Поддержка URL-параметра ?testDate=ДД.ММ для быстрой проверки в Live Server
    const urlParams = new URLSearchParams(window.location.search);
    const testDateStr = urlParams.get("testDate") || urlParams.get("onthisday");
    let dateToCheck = new Date();
    if (testDateStr) {
      const parts = testDateStr.split(".");
      if (parts.length >= 2) {
        dateToCheck = new Date(
          dateToCheck.getFullYear(),
          parseInt(parts[1], 10) - 1,
          parseInt(parts[0], 10),
        );
      }
    }

    this.checkMemories(dateToCheck);

    if (!this.initialized) {
      this.initialized = true;

      this.btn?.addEventListener("click", () => {
        this.showCard();
      });

      this.mobileBtn?.addEventListener("click", () => {
        if (this.items.length > 0) {
          this.showCard();
        }
      });

      this.closeBtn?.addEventListener("click", () => {
        this.hideCard();
      });

      if (this.prevBtn) {
        this.prevBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.prev();
        });
      }

      if (this.nextBtn) {
        this.nextBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.next();
        });
      }

      this.actionBtn.addEventListener("click", () => {
        this.flyCurrent();
      });

      if (this.imgContainer) {
        this.imgContainer.addEventListener("click", () => {
          this.flyCurrent();
        });
      }

      // Функция тестирования в консоли: testOnThisDay('22.10') или testOnThisDay('13.09')
      window.testOnThisDay = (dayMonthStr) => {
        const p = dayMonthStr.split(".");
        const d = new Date(
          new Date().getFullYear(),
          parseInt(p[1], 10) - 1,
          parseInt(p[0], 10),
        );
        this.checkMemories(d);
        if (this.items.length > 0) {
          this.btn.style.display = "flex";
          if (this.items.length > 1) {
            this.badge.style.display = "flex";
            this.badge.textContent = String(this.items.length);
          } else {
            this.badge.style.display = "none";
          }
          if (this.mobileBadge) {
            this.mobileBadge.style.display = "inline-block";
            this.mobileBadge.textContent = String(this.items.length);
          }
          if (this.mobileBtn) this.mobileBtn.style.opacity = "1";
          this.showCard();
          console.log(
            `✅ Найдено ${this.items.length} фото для даты ${dayMonthStr}`,
          );
        } else {
          console.log(`ℹ️ Нет воспоминаний для даты ${dayMonthStr}`);
          this.btn.style.display = "none";
          if (this.mobileBadge) this.mobileBadge.style.display = "none";
          if (this.mobileBtn) this.mobileBtn.style.opacity = "0.7";
          this.hideCard();
        }
      };
    }

    // Если сегодня есть совпадение даты — показываем бейдж с количеством воспоминаний
    if (this.items.length > 0) {
      this.btn.style.display = "flex";
      if (this.mobileBtn) {
        this.mobileBtn.style.display = "flex";
        this.mobileBtn.style.opacity = "1";
      }

      if (this.mobileBadge) {
        this.mobileBadge.style.display = "inline-block";
        this.mobileBadge.textContent = String(this.items.length);
      }

      if (this.items.length > 1) {
        this.badge.style.display = "flex";
        this.badge.textContent = String(this.items.length);
      } else {
        this.badge.style.display = "none";
      }

      // При переходе из push-уведомления программно нажимаем кнопку fab-btn nostalgia-btn-fab
      if (urlParams.get("autoOpenNostalgia") === "true") {
        setTimeout(() => {
          if (this.btn) this.btn.click();
        }, 400);
      }
    } else {
      this.btn.style.display = "none";
      this.badge.style.display = "none";
      if (this.mobileBtn) {
        this.mobileBtn.style.display = "flex";
        this.mobileBtn.style.opacity = "0.7";
      }
      if (this.mobileBadge) this.mobileBadge.style.display = "none";
      this.hideCard();
    }
  },

  checkMemories(targetDate) {
    const curDay = targetDate.getDate();
    const curMonth = targetDate.getMonth();
    const curYear = targetDate.getFullYear();

    this.items = [];

    for (const place of this.places) {
      const pDate = Utils.getPlaceDate(place);
      if (!pDate || isNaN(pDate.getTime())) continue;

      const pDay = pDate.getDate();
      const pMonth = pDate.getMonth();
      const pYear = pDate.getFullYear();

      // Строгое совпадение дня и месяца из прошлых лет
      if (pDay === curDay && pMonth === curMonth && pYear < curYear) {
        const yearsAgo = curYear - pYear;
        let yearWord = "лет";
        if (yearsAgo === 1) yearWord = "год";
        else if (yearsAgo >= 2 && yearsAgo <= 4) yearWord = "года";

        const photos =
          place.photos && place.photos.length > 0
            ? place.photos
            : [
                {
                  url: place.origUrl || place.thumbUrl || "",
                  origUrl: place.origUrl || place.thumbUrl || "",
                  caption: place.caption || place.placeTitle || "",
                },
              ];

        photos.forEach((photo, pIdx) => {
          this.items.push({
            place,
            photoIndex: pIdx,
            photoUrl: photo.origUrl || photo.thumbUrl || photo.url || "",
            date: pDate,
            caption: photo.caption || place.placeTitle || "Особенное место",
            tag: `${yearsAgo} ${yearWord} назад`,
          });
        });
      }
    }

    this.currentIndex = 0;
  },

  renderCurrent() {
    if (this.items.length === 0) return;
    const item = this.items[this.currentIndex];

    this.imgEl.src = item.photoUrl;
    this.tagEl.textContent = item.tag?.startsWith("Новое")
      ? item.tag
      : `В этот день • ${item.tag}`;
    this.dateEl.textContent = Utils.formatRussianDate(item.date);
    this.captionEl.textContent = item.caption
      ? `«${item.caption}»`
      : item.place?.placeTitle || "";

    if (this.items.length > 1) {
      this.navEl.style.display = "flex";
      this.counterEl.textContent = `${this.currentIndex + 1} из ${this.items.length}`;
    } else {
      this.navEl.style.display = "none";
    }
  },

  next() {
    if (this.items.length <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    this.renderCurrent();
  },

  prev() {
    if (this.items.length <= 1) return;
    this.currentIndex =
      (this.currentIndex - 1 + this.items.length) % this.items.length;
    this.renderCurrent();
  },

  showCard() {
    if (this.items.length === 0) return;
    this.renderCurrent();
    this.card.classList.add("visible");
  },

  hideCard() {
    this.card.classList.remove("visible");
  },

  flyCurrent() {
    if (this.items.length === 0) return;
    const item = this.items[this.currentIndex];
    if (!item.place || !item.place.coords) return;

    this.hideCard();
    map.flyTo(item.place.coords, 16, {
      duration: 1.8,
      easeLinearity: 0.4,
    });

    setTimeout(() => {
      Gallery.open(item.place, item.photoIndex);
    }, 1400);
  },

  showRecentUploads(recentIds = []) {
    const matchedPlaces = [];
    if (Array.isArray(recentIds) && recentIds.length > 0) {
      for (const id of recentIds) {
        const place =
          placesStore.get(String(id)) ||
          this.places.find((p) => String(p.id) === String(id));
        if (place && !matchedPlaces.includes(place)) {
          matchedPlaces.push(place);
        }
      }
    }

    // Если по ID не нашли или передан true, берём самые последние загруженные места
    const placesToUse =
      matchedPlaces.length > 0
        ? matchedPlaces
        : [...this.places]
            .sort(
              (a, b) =>
                (Utils.getPlaceTime(b) || 0) - (Utils.getPlaceTime(a) || 0),
            )
            .slice(0, 5);

    if (placesToUse.length === 0) return;

    this.items = [];
    for (const place of placesToUse) {
      const pDate = Utils.getPlaceDate(place);
      const photos =
        place.photos && place.photos.length > 0
          ? place.photos
          : [
              {
                url: place.origUrl || place.thumbUrl || "",
                origUrl: place.origUrl || place.thumbUrl || "",
                caption: place.caption || place.placeTitle || "",
              },
            ];

      photos.forEach((photo, pIdx) => {
        this.items.push({
          place,
          photoIndex: pIdx,
          photoUrl: photo.origUrl || photo.thumbUrl || photo.url || "",
          date: pDate,
          caption: photo.caption || place.placeTitle || "Новое воспоминание",
          tag: "Новое фото ✨",
        });
      });
    }

    if (this.items.length === 0) return;
    this.currentIndex = 0;
    this.showCard();
  },
};

// =========================================================================
// MAP OVERVIEW (Обзор всех меток на карте)
// =========================================================================
const MapOverview = {
  btn: document.getElementById("mobileOverviewBtn"),

  init() {
    this.btn?.addEventListener("click", () => {
      this.fitAll();
    });
  },

  fitAll() {
    if (typeof markers !== "undefined" && markers.getLayers().length > 0) {
      const bounds = markers.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 15,
          animate: true,
          duration: 1.2,
        });
        return;
      }
    }
    map.flyTo(CONFIG.MAP.center, CONFIG.MAP.zoom, {
      duration: 1.2,
    });
  },
};

// =========================================================================
// DATA LOADING
// =========================================================================
const DataLoader = {
  isLoading: false,
  allPlaces: [],

  async load() {
    if (this.isLoading) return;
    this.isLoading = true;

    // 1. Если Firebase SDK уже загружен
    if (window.FirebaseFirestore) {
      this.subscribeFirestore();
      return;
    }

    // 2. Ждем события готовности Firebase SDK
    let firebaseInitialized = false;
    window.addEventListener(
      "firebase-ready",
      () => {
        firebaseInitialized = true;
        this.subscribeFirestore();
      },
      { once: true },
    );

    // 3. Страховочный таймаут: если Firebase не ответил за 3 сек, грузим fallback
    setTimeout(() => {
      if (
        !firebaseInitialized &&
        (!this.allPlaces || this.allPlaces.length === 0)
      ) {
        this.loadFallback();
      }
    }, 3000);
  },

  subscribeFirestore() {
    if (!window.FirebaseFirestore) return this.loadFallback();
    const { db, collection, onSnapshot } = window.FirebaseFirestore;
    console.log("🔥 Подключение Realtime Firestore...");

    try {
      onSnapshot(
        collection(db, "places"),
        (snapshot) => {
          const places = [];
          snapshot.forEach((doc) => places.push(doc.data()));
          if (places.length > 0) {
            console.log(
              `🔥 Получено ${places.length} мест из Firestore в реальном времени!`,
            );
            localStorage.setItem(
              CONFIG.CACHE.PLACES_KEY,
              JSON.stringify(places),
            );
            this.processData(places);
          }
          this.isLoading = false;
        },
        (error) => {
          console.warn(
            "⚠️ Ошибка подписки Firestore, используем fallback:",
            error,
          );
          this.loadFallback();
        },
      );
    } catch (e) {
      console.warn("⚠️ Исключение при подписке Firestore:", e);
      this.loadFallback();
    }
  },

  async loadFallback() {
    console.log("📥 Loading places (fallback from server)...");
    try {
      const res = await fetch(`${CONFIG.SERVER_URL}/places`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      localStorage.setItem(CONFIG.CACHE.PLACES_KEY, JSON.stringify(data));
      this.processData(data);
      console.log("✅ Fresh data loaded from server");
    } catch (err) {
      console.warn("⚠️ Failed to load from server, using cache:", err);
      const cached = localStorage.getItem(CONFIG.CACHE.PLACES_KEY);
      if (cached) {
        this.processData(JSON.parse(cached));
      } else {
        console.error("❌ No data available");
      }
    } finally {
      this.isLoading = false;
    }
  },

  processData(data) {
    if (!Array.isArray(data)) return;

    const validData = data.filter(
      (p) => p.origUrl?.startsWith("http") || p.thumbUrl?.startsWith("http"),
    );

    const placesList = validData.map((p) => {
      const photoUrl = p.origUrl || p.thumbUrl || "";
      return {
        id: p.id,
        coords: p.coords,
        exifDate: p.exifDate,
        timestamp: p.timestamp,
        filename: p.filename,
        photos: [
          {
            url: photoUrl,
            thumbUrl: photoUrl,
            origUrl: photoUrl,
            date:
              p.exifDate ||
              (p.timestamp
                ? new Date(p.timestamp).toLocaleDateString("ru-RU")
                : ""),
            caption: p.caption || "",
          },
        ],
      };
    });

    this.renderPlaces(placesList);
  },

  renderPlaces(placesList) {
    // Сортируем воспоминания строго в хронологическом порядке
    this.allPlaces = [...placesList].sort(
      (a, b) => Utils.getPlaceTime(a) - Utils.getPlaceTime(b),
    );

    markers.clearLayers();
    placesStore.clear();

    const markerList = [];
    for (const place of this.allPlaces) {
      if (
        !place.coords ||
        !Array.isArray(place.coords) ||
        place.coords.length < 2
      )
        continue;
      const marker = MarkerManager.create(place);
      markerList.push(marker);
      placesStore.set(place.id, { ...place, marker });
    }

    if (markerList.length > 0) {
      markers.addLayers(markerList);
    }

    console.log(`✅ Мгновенно отображено ${markerList.length} мест на карте`);
    LoveCounter.update();

    // Инициализация "В этот день..."
    NostalgiaManager.init(this.allPlaces);

    // Поддержка перехода из пуша "Случайное тёплое воспоминание"
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("randomMemory") === "true") {
      setTimeout(() => {
        RandomMemory.show();
      }, 600);
    }

    // Поддержка перехода из пуша о новых загруженных фото (карусель новых воспоминаний)
    const recentUploadsParam = urlParams.get("recentUploads");
    if (recentUploadsParam) {
      setTimeout(() => {
        const ids =
          recentUploadsParam !== "true"
            ? recentUploadsParam
                .split(",")
                .map((id) => decodeURIComponent(id.trim()))
                .filter(Boolean)
            : [];
        NostalgiaManager.showRecentUploads(ids);
      }, 500);
    }
  },
};

// =========================================================================
// PUSH NOTIFICATION MANAGER
// =========================================================================
const PushNotificationManager = {
  bellBtn: document.getElementById("notificationBellBtn"),
  isSubscribed: false,
  swRegistration: null,

  async init() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.log("ℹ️ Push notifications не поддерживаются данным браузером");
      return;
    }

    try {
      this.swRegistration = await navigator.serviceWorker.ready;
      const subscription =
        await this.swRegistration.pushManager.getSubscription();

      if (subscription) {
        this.isSubscribed = true;
        // Фоновая синхронизация: гарантируем актуальность токена в Firestore
        this.syncToServer(subscription);
      } else {
        this.isSubscribed = false;
        // Если разрешение уже выдано (например, при переустановке PWA),
        // автоматически подписываемся в фоне без необходимости нажимать кнопки!
        if (Notification.permission === "granted") {
          this.subscribe({ silent: true }).catch((err) =>
            console.log("ℹ️ Auto-resubscribe background:", err),
          );
        }
      }

      // Проверка параметра URL ?testPush=true для быстрой проверки пушей
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("testPush") === "true") {
        setTimeout(() => {
          this.sendTestNotification();
        }, 1500);
      }
    } catch (err) {
      console.warn("⚠️ PushNotificationManager init error:", err);
    }

    if (this.bellBtn) {
      this.bellBtn.addEventListener("click", () => {
        this.handleClick();
      });
    }
  },

  updateUI(active) {
    if (!this.bellBtn) return;
    this.isSubscribed = !!active;
    if (active) {
      this.bellBtn.classList.add("is-active");
      this.bellBtn.classList.remove("is-inactive");
      this.bellBtn.title = "Уведомления включены (нажми для проверки связи)";
    } else {
      this.bellBtn.classList.remove("is-active");
      this.bellBtn.classList.add("is-inactive");
      this.bellBtn.title = "Включить push-уведомления";
    }
  },

  async handleClick() {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone =
      window.navigator.standalone ||
      window.matchMedia("(display-mode: standalone)").matches;

    // На iOS push-уведомления работают только если сайт добавлен на экран «Домой»
    if (isIOS && !isStandalone) {
      alert(
        "На iPhone уведомления работают только из приложения с экрана «Домой».\n\nНажми в Safari кнопку «Поделиться» (квадрат со стрелкой вверх) ➔ «На экран Домой» и открой приложение оттуда! 📲",
      );
      return;
    }

    if (this.isSubscribed) {
      const wantTest = confirm(
        "Уведомления на этом устройстве уже включены! ❤️\n\nОтправить тестовое пуш-уведомление прямо сейчас для проверки?",
      );
      if (wantTest) {
        await this.sendTestNotification();
      }
    } else {
      await this.subscribe({ silent: false });
    }
  },

  async syncToServer(subscription) {
    try {
      await fetch(`${CONFIG.SERVER_URL}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });
      console.log("🔄 Push subscription синхронизирована с сервером");
    } catch (e) {
      console.warn("⚠️ Не удалось синхронизировать подписку:", e);
    }
  },

  async subscribe(options = {}) {
    const silent = !!options.silent;
    try {
      if (!this.swRegistration) {
        this.swRegistration = await navigator.serviceWorker.ready;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (!silent) {
          alert("Разрешение на отправку уведомлений не было предоставлено.");
        }
        this.updateUI(false);
        return;
      }

      const res = await fetch(`${CONFIG.SERVER_URL}/vapid-public-key`);
      if (!res.ok) throw new Error("Не удалось получить VAPID ключ с сервера");
      const data = await res.json();
      const convertedVapidKey = Utils.urlBase64ToUint8Array(data.publicKey);

      const subscription = await this.swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      await this.syncToServer(subscription);

      this.updateUI(true);
      console.log("✅ Успешно подписались на push-уведомления");

      if (!silent) {
        alert("Уведомления успешно включены! 🎉 Сейчас придет тестовый пуш.");
        await this.sendTestNotification();
      }
    } catch (err) {
      console.error("❌ Ошибка при подписке на push:", err);
      this.updateUI(false);
      if (!silent) {
        alert("Не удалось включить уведомления: " + (err.message || err));
      }
    }
  },

  async sendTestNotification() {
    try {
      const res = await fetch(`${CONFIG.SERVER_URL}/send-test-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Sweet Dreams ❤️",
          body: "Проверка связи! Пуш-уведомления работают отлично 💌",
        }),
      });
      const data = await res.json();
      if (data.success) {
        console.log("✅ Тестовый пуш отправлен сервером:", data);
      } else {
        alert("Ошибка сервера: " + (data.error || "Неизвестная ошибка"));
      }
    } catch (err) {
      console.error("❌ Ошибка отправки теста:", err);
      alert("Ошибка отправки тестового уведомления: " + err.message);
    }
  },
};

// =========================================================================
// INITIALIZATION
// =========================================================================
function init() {
  fetch(`${CONFIG.SERVER_URL}/update-caption`, {
    method: "HEAD",
    cache: "no-store",
  }).catch(() => {});
  Gallery.init();
  RandomMemory.init();
  UploadManager.init();
  LoveCounter.init();
  MapOverview.init();
  PushNotificationManager.init();

  if ("clearAppBadge" in navigator) {
    navigator.clearAppBadge().catch(() => {});
  }

  DataLoader.load();

  map.on("zoom", MarkerManager.updateSizes.bind(MarkerManager));
}

// Start everything
init();

// Service Worker registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        reg.update();
        console.log("✅ Service Worker зарегистрирован");
      })
      .catch((err) => console.log("❌ Ошибка SW:", err));
  });
}
