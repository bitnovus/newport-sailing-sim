export interface ControlState {
  /** −1..1, + = tiller pushed to starboard (boat turns to port — real tiller). */
  tiller: number;
  /** Mainsheet outward boom-angle limit, deg. */
  sheetTargetDeg: number;
  /** Jib-sheet outward club-boom angle limit, deg. */
  jibTargetDeg: number;
  /** Crew/winger is holding the jib boom to weather on a deep run. */
  jibWinged: boolean;
  auxOn: boolean;
}

export interface JibTrimConfig {
  min: number;
  max: number;
  initial: number;
}

/**
 * Keyboard + touch controls. The tiller ramps while held and springs back to
 * center on release (C or ↓ centers immediately). The mainsheet eases in/out
 * with S/W; the jib slider limits its wind-driven club boom independently.
 * Casual steering mode flips the tiller sign (right key = turn right).
 */
export class Controls {
  state: ControlState = {
    tiller: 0,
    sheetTargetDeg: 15,
    jibTargetDeg: 15,
    jibWinged: false,
    auxOn: false,
  };
  realisticTiller = true;
  private keys = new Set<string>();
  private touchTiller = 0;
  private readonly maxTillerDeg: number;
  private readonly minJibDeg: number;
  private readonly maxJibDeg: number;
  private tillerSlider: HTMLInputElement | null = null;
  private tillerOutput: HTMLOutputElement | null = null;
  private jibSlider: HTMLInputElement | null = null;
  private jibOutput: HTMLOutputElement | null = null;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.key.toLowerCase());
    if (e.key === " ") e.preventDefault();
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  constructor(
    maxTillerDeg = 35,
    jibTrim: JibTrimConfig = { min: 8, max: 75, initial: 15 },
  ) {
    this.maxTillerDeg = Math.max(1, Math.abs(maxTillerDeg));
    this.minJibDeg = Math.max(0, Math.min(jibTrim.min, jibTrim.max));
    this.maxJibDeg = Math.max(this.minJibDeg, Math.max(jibTrim.min, jibTrim.max));
    this.state.jibTargetDeg = Math.min(
      this.maxJibDeg,
      Math.max(this.minJibDeg, jibTrim.initial),
    );
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /** Wire the persistent tiller/jib sliders and hold-to-adjust mainsheet buttons. */
  bindHoldButtons(root: HTMLElement): void {
    this.tillerSlider = root.querySelector<HTMLInputElement>("[data-tiller-slider]");
    this.tillerOutput = root.querySelector<HTMLOutputElement>("[data-tiller-output]");
    this.jibSlider = root.querySelector<HTMLInputElement>("[data-jib-slider]");
    this.jibOutput = root.querySelector<HTMLOutputElement>("[data-jib-output]");

    if (this.tillerSlider) {
      this.tillerSlider.min = String(-this.maxTillerDeg);
      this.tillerSlider.max = String(this.maxTillerDeg);
      this.tillerSlider.value = "0";
      this.tillerSlider.addEventListener("input", () => {
        this.setTouchTillerDegrees(Number(this.tillerSlider?.value ?? 0));
      });
    }
    if (this.jibSlider) {
      this.jibSlider.min = String(this.minJibDeg);
      this.jibSlider.max = String(this.maxJibDeg);
      this.jibSlider.value = String(this.state.jibTargetDeg);
      this.jibSlider.addEventListener("input", () => {
        this.setJibTrimDegrees(Number(this.jibSlider?.value ?? this.state.jibTargetDeg));
      });
    }
    root.querySelector<HTMLElement>("[data-tiller-center]")?.addEventListener("click", () => {
      this.setTouchTillerDegrees(0);
    });
    this.setTouchTillerDegrees(0);
    this.setJibTrimDegrees(this.state.jibTargetDeg);

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

  private setJibTrimDegrees(degrees: number): void {
    const bounded = Math.max(this.minJibDeg, Math.min(this.maxJibDeg, degrees));
    this.state.jibTargetDeg = bounded;

    if (this.jibSlider && Number(this.jibSlider.value) !== bounded) {
      this.jibSlider.value = String(bounded);
    }

    const position = `${Math.round(bounded)}°`;
    if (this.jibOutput) this.jibOutput.textContent = position;
    this.jibSlider?.setAttribute("aria-valuetext", `${position} from centerline`);
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
    if (k.has("s")) sheet += 1;
    if (k.has("w")) sheet -= 1;
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
