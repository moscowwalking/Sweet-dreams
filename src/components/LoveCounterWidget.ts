export class LoveCounterWidget {
  private memoriesEl: HTMLElement | null = null;
  private daysEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private startDate: Date;

  constructor(startDate: Date = new Date(2025, 7, 23)) {
    this.startDate = startDate;
  }

  init(): void {
    this.memoriesEl = document.getElementById("totalMemories");
    this.daysEl = document.getElementById("totalDays");
    this.counterEl = document.getElementById("loveCounter");
    this.update(0);
  }

  update(totalMemories: number): void {
    if (this.memoriesEl) {
      const oldValue = parseInt(this.memoriesEl.textContent || "0", 10) || 0;
      if (totalMemories !== oldValue) {
        this.memoriesEl.classList.add("updated");
        setTimeout(() => this.memoriesEl?.classList.remove("updated"), 300);
      }
      this.memoriesEl.textContent = String(totalMemories);
    }

    const today = new Date();
    const startUtc = Date.UTC(
      this.startDate.getFullYear(),
      this.startDate.getMonth(),
      this.startDate.getDate()
    );
    const todayUtc = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const diffDays = Math.round((todayUtc - startUtc) / (1000 * 60 * 60 * 24)) + 1;

    if (this.daysEl) {
      this.daysEl.textContent = String(diffDays);
    }

    if (this.counterEl) {
      const years = Math.floor(diffDays / 365);
      const months = Math.floor((diffDays % 365) / 30);
      const days = diffDays % 30;
      this.counterEl.title = `Вместе уже ${years} лет, ${months} месяцев и ${days} дней ❤️`;
    }
  }
}
