export interface ControlState {
  /** −1..1, + = tiller pushed to starboard (boat turns to port — real tiller). */
  tiller: number;
  /** Commanded mainsheet boom angle, deg. */
  sheetTargetDeg: number;
  auxOn: boolean;
}

/**
 * Keyboard + touch controls. The tiller ramps while held and springs back to
 * center on release (C or ↓ centers immediately). The mainsheet eases in/out
 * with W/S. Casual steering mode flips the tiller sign (right key = turn right).
 */
export class Controls {
  state: ControlState = { tiller: 0, sheetTargetDeg: 25, auxOn: false };
  realisticTiller = true;
  private keys = new Set<string>();
  private touchTiller = 0;
  private readonly maxTillerDeg: number;
  private tillerSlider: HTMLInputElement | null = null;
  private tillerOutput: HTMLOutputElement | null = null;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.key.toLowerCase());
    if (e.key === " ") e.preventDefault();
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  constructor(maxTillerDeg = 35) {
    this.maxTillerDeg = Math.max(1, Math.abs(maxTillerDeg));
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /** Wire the persistent tiller slider and the hold-to-adjust sheet buttons. */
  bindHoldButtons(root: HTMLElement): void {
    this.tillerSlider = root.querySelector<HTMLInputElement>("[data-tiller-slider]");
    this.tillerOutput = root.querySelector<HTMLOutputElement>("[data-tiller-output]");

    if (this.tillerSlider) {
      this.tillerSlider.min = String(-this.maxTillerDeg);
      this.tillerSlider.max = String(this.maxTillerDeg);
      this.tillerSlider.value = "0";
      this.tillerSlider.addEventListener("input", () => {
        this.setTouchTillerDegrees(Number(this.tillerSlider?.value ?? 0));
      });
    }
    root.querySelector<HTMLElement>("[data-tiller-center]")?.addEventListener("click", () => {
      this.setTouchTillerDegrees(0);
    });
    this.setTouchTillerDegrees(0);

    root.querySelectorAll<HTMLElement>("[data-tiller], [data-sheet]").forEach((el) => {
      const start = (e: Event) => {
        e.preventDefault();
        if (el.dataset.tiller) this.touchTiller = Number(el.dataset.tiller);
        if (el.dataset.sheet) this.sheetAdjust(Number(el.dataset.sheet), 1);
      };
      const end = () => {
        if (el.dataset.tiller) this.touchTiller = 0;
        if (el.dataset.sheet) this.sheetAdjust(Number(el.dataset.sheet), 0);
      };
      el.addEventListener("pointerdown", start);
      el.addEventListener("pointerup", end);
      el.addEventListener("pointerleave", end);
      el.addEventListener("pointercancel", end);
    });
  }

  private setTouchTillerDegrees(degrees: number): void {
    const bounded = Math.max(-this.maxTillerDeg, Math.min(this.maxTillerDeg, degrees));
    this.touchTiller = bounded / this.maxTillerDeg;

    if (this.tillerSlider && Number(this.tillerSlider.value) !== bounded) {
      this.tillerSlider.value = String(bounded);
    }

    const rounded = Math.round(Math.abs(bounded));
    const position =
      rounded === 0 ? "0° CENTER" : `${rounded}° ${bounded < 0 ? "PORT" : "STBD"}`;
    if (this.tillerOutput) this.tillerOutput.textContent = position;
    this.tillerSlider?.setAttribute("aria-valuetext", position);
  }

  private sheetDir = 0;
  private sheetAdjust(_dir: number, _active: number): void {
    this.sheetDir = _dir * _active;
  }

  update(dt: number): ControlState {
    const k = this.keys;
    let t = this.touchTiller;
    let dir = 0;
    if (k.has("arrowleft") || k.has("a")) dir -= 1;
    if (k.has("arrowright") || k.has("d")) dir += 1;
    if (dir !== 0) t = dir;

    // ramp toward target, spring back when released
    const rate = 3.2;
    const target = t;
    this.state.tiller += (target - this.state.tiller) * (1 - Math.exp(-dt * rate));

    if (k.has("arrowdown") || k.has("c")) {
      this.setTouchTillerDegrees(0);
      this.state.tiller *= Math.exp(-dt * 8);
    }

    // sheet: +1 = trim IN (boom toward centerline, smaller angle)
    let sheet = 0;
    if (k.has("w")) sheet += 1;
    if (k.has("s")) sheet -= 1;
    if (sheet === 0) sheet = this.sheetDir;
    this.state.sheetTargetDeg = Math.min(85, Math.max(5, this.state.sheetTargetDeg - sheet * dt * 40));

    const s = this.state;
    // flip for casual mode so right key = starboard turn
    const helm = this.realisticTiller ? s.tiller : -s.tiller;
    return { ...s, tiller: helm };
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
