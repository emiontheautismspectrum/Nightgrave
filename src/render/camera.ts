/**
 * The zoomed phone-portrait camera as pure logic (no Phaser): smooth follow with a dead zone and a lead in the
 * direction the hero moves. Render-only: it reads the hero position, never writes sim state, and the replay never
 * contains anything from it.
 */
export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CamConfig {
  /** Visible world size (world px). */
  viewW: number;
  viewH: number;
  worldW: number;
  worldH: number;
  deadZone: number;
  lead: number;
  follow: number;
  followReduced: number;
}

export class FollowCam {
  /** Camera centre in world px. */
  x = 0;
  y = 0;
  constructor(readonly cfg: CamConfig) {}

  private clampAxis(c: number, view: number, world: number): number {
    if (view >= world) return world / 2;
    return Math.min(world - view / 2, Math.max(view / 2, c));
  }

  /** Jump straight to the hero (a new run, a re-layout). */
  reset(hx: number, hy: number): void {
    this.x = this.clampAxis(hx, this.cfg.viewW, this.cfg.worldW);
    this.y = this.clampAxis(hy, this.cfg.viewH, this.cfg.worldH);
  }

  /**
   * One render frame. `dir` is the hero's move direction (unit vector) or null when it stands still.
   * Reduced motion: no lead and a much faster follow.
   */
  step(dtMs: number, hx: number, hy: number, dir: { x: number; y: number } | null, reduced: boolean): void {
    const c = this.cfg;
    const lead = reduced || !dir ? 0 : c.lead;
    const tx = hx + (dir ? dir.x : 0) * lead;
    const ty = hy + (dir ? dir.y : 0) * lead;
    const k = 1 - Math.exp((-Math.max(0, Math.min(100, dtMs)) / 1000) * (reduced ? c.followReduced : c.follow));
    const axis = (cur: number, t: number): number => {
      const d = t - cur;
      if (Math.abs(d) <= c.deadZone) return cur;
      return cur + (d - Math.sign(d) * c.deadZone) * k;
    };
    this.x = this.clampAxis(axis(this.x, tx), c.viewW, c.worldW);
    this.y = this.clampAxis(axis(this.y, ty), c.viewH, c.worldH);
    // the hero itself never leaves the window (a fast dash cannot outrun the camera)
    const mx = Math.max(0, c.viewW / 2 - 24);
    const my = Math.max(0, c.viewH / 2 - 24);
    this.x = this.clampAxis(Math.min(hx + mx, Math.max(hx - mx, this.x)), c.viewW, c.worldW);
    this.y = this.clampAxis(Math.min(hy + my, Math.max(hy - my, this.y)), c.viewH, c.worldH);
  }

  rect(): ViewRect {
    const { viewW: w, viewH: h } = this.cfg;
    return { x0: this.x - w / 2, y0: this.y - h / 2, x1: this.x + w / 2, y1: this.y + h / 2 };
  }
}
