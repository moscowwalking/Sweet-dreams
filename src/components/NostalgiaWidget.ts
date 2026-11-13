import { NostalgiaItem } from "../types/memories";

export class NostalgiaWidget {
  private card: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private imgEl: HTMLImageElement | null = null;
  private navEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private prevBtn: HTMLElement | null = null;
  private nextBtn: HTMLElement | null = null;
  private dateEl: HTMLElement | null = null;
  private captionEl: HTMLElement | null = null;
  private actionBtn: HTMLElement | null = null;
  private btnFab: HTMLElement | null = null;
  private badgeFab: HTMLElement | null = null;
  private mobileBtn: HTMLElement | null = null;
  private mobileBadge: HTMLElement | null = null;

  private nostalgiaItems: NostalgiaItem[] = [];
  private recentItems: NostalgiaItem[] = [];
  private activeItems: NostalgiaItem[] = [];
  private activeMode: "nostalgia" | "recent" = "nostalgia";
  private currentIndex: number = 0;
  private onFlyTo?: (item: NostalgiaItem) => void;

  init(onFlyTo: (item: NostalgiaItem) => void): void {
    this.onFlyTo = onFlyTo;

    this.card = document.getElementById("nostalgiaCard");
    this.tagEl = document.getElementById("nostalgiaTag");
    this.closeBtn = document.getElementById("nostalgiaCloseBtn");
    this.imgEl = document.getElementById("nostalgiaImg") as HTMLImageElement;
    this.navEl = document.getElementById("nostalgiaNav");
    this.counterEl = document.getElementById("nostalgiaCounter");
    this.prevBtn = document.getElementById("nostalgiaPrevBtn");
    this.nextBtn = document.getElementById("nostalgiaNextBtn");
    this.dateEl = document.getElementById("nostalgiaDate");
    this.captionEl = document.getElementById("nostalgiaCaption");
    this.actionBtn = document.getElementById("nostalgiaActionBtn");

    this.btnFab = document.getElementById("nostalgiaBtn");
    this.badgeFab = document.getElementById("nostalgiaBadge");
    this.mobileBtn = document.getElementById("mobileNostalgiaBtn");
    this.mobileBadge = document.getElementById("mobileNostalgiaBadge");

    this.closeBtn?.addEventListener("click", () => this.hideCard());
    this.btnFab?.addEventListener("click", () => this.showCard());
    this.mobileBtn?.addEventListener("click", () => this.showCard());
    this.prevBtn?.addEventListener("click", () => this.prev());
    this.nextBtn?.addEventListener("click", () => this.next());

    this.actionBtn?.addEventListener("click", () => {
      if (this.activeItems.length === 0) return;
      const targetItem = this.activeItems[this.currentIndex];
      this.hideCard();
      if (this.onFlyTo && targetItem) {
        this.onFlyTo(targetItem);
      }
    });
  }

  updateItems(items: NostalgiaItem[]): void {
    this.nostalgiaItems = [...items];

    if (!this.isCardVisible()) {
      this.activeItems = [...items];
      this.currentIndex = 0;
    }

    const count = this.nostalgiaItems.length;

    if (count > 0) {
      if (this.btnFab) this.btnFab.style.display = "flex";
      if (this.mobileBtn) {
        this.mobileBtn.style.display = "flex";
        this.mobileBtn.style.opacity = "1";
      }

      if (this.mobileBadge) {
        this.mobileBadge.style.display = "inline-block";
        this.mobileBadge.textContent = String(count);
      }

      if (this.badgeFab) {
        this.badgeFab.style.display = count > 1 ? "flex" : "none";
        this.badgeFab.textContent = String(count);
      }
    } else {
      if (this.btnFab) this.btnFab.style.display = "none";
      if (this.badgeFab) this.badgeFab.style.display = "none";
      if (this.mobileBtn) {
        this.mobileBtn.style.display = "flex";
        this.mobileBtn.style.opacity = "0.7";
      }
      if (this.mobileBadge) this.mobileBadge.style.display = "none";
      if (this.activeMode === "nostalgia") {
        this.hideCard();
      }
    }
  }

  showCard(): void {
    this.activeMode = "nostalgia";
    this.activeItems = [...this.nostalgiaItems];
    if (this.activeItems.length === 0) {
      alert("В этот день прошлых лет пока нет воспоминаний ✨");
      return;
    }
    this.currentIndex = 0;
    this.renderCurrent();
    this.card?.classList.add("visible");
  }

  showRecentUploads(recentItems: NostalgiaItem[]): void {
    if (recentItems.length === 0) return;
    this.activeMode = "recent";
    this.recentItems = [...recentItems];
    this.activeItems = [...recentItems];
    this.currentIndex = 0;
    this.renderCurrent();
    this.card?.classList.add("visible");
  }

  hideCard(): void {
    this.card?.classList.remove("visible");
    this.activeMode = "nostalgia";
    this.activeItems = [...this.nostalgiaItems];
    this.currentIndex = 0;
  }

  next(): void {
    if (this.activeItems.length <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % this.activeItems.length;
    this.renderCurrent();
  }

  prev(): void {
    if (this.activeItems.length <= 1) return;
    this.currentIndex = (this.currentIndex - 1 + this.activeItems.length) % this.activeItems.length;
    this.renderCurrent();
  }

  private isCardVisible(): boolean {
    return this.card?.classList.contains("visible") ?? false;
  }

  private renderCurrent(): void {
    if (this.activeItems.length === 0) return;
    const item = this.activeItems[this.currentIndex];

    if (this.imgEl) this.imgEl.src = item.photoUrl;
    if (this.tagEl) {
      this.tagEl.textContent = item.tag.startsWith("Новое")
        ? item.tag
        : `В этот день • ${item.tag}`;
    }

    if (this.dateEl) {
      const months = [
        "янв", "фев", "мар", "апр", "мая", "июн",
        "июл", "авг", "сен", "окт", "ноя", "дек"
      ];
      this.dateEl.textContent = `${item.date.getDate()} ${months[item.date.getMonth()]} ${item.date.getFullYear()}`;
    }

    if (this.captionEl) {
      this.captionEl.textContent = item.caption ? `«${item.caption}»` : "";
    }

    if (this.activeItems.length > 1) {
      if (this.navEl) this.navEl.style.display = "flex";
      if (this.counterEl) {
        this.counterEl.textContent = `${this.currentIndex + 1} из ${this.activeItems.length}`;
      }
    } else {
      if (this.navEl) this.navEl.style.display = "none";
    }
  }
}
