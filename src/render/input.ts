/**
 * Collects mouse / keyboard / gamepad input and turns it into one sanitized InputFrame per sim tick.
 * Presses are latched until the next sampled tick so a click between two ticks is never lost.
 */
import Phaser from 'phaser';
import { AXIS_MAX, BTN_DASH, BTN_PARRY, sanitizeInput, type InputFrame } from '../sim/input';

const PARRY_KEYS = new Set(['KeyJ', 'KeyZ']);
const DASH_KEYS = new Set(['KeyK', 'ShiftLeft', 'ShiftRight', 'Space']);
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const STICK_DEADZONE = 0.25;
/** Internal pixels the mouse must travel to take control back from keyboard / gamepad. */
const MOUSE_TAKEOVER_PX = 12;
const PAD_A = 0;
const PAD_B = 1;
const PAD_RT = 7;

export class InputCollector {
  /** Cursor-follow (mouse) or axis (keyboard / stick) movement. Mouse is the default. */
  mode: 'cursor' | 'axis' = 'cursor';
  private pending = 0;
  private held = new Set<string>();
  private padPrev = { a: false, b: false, rt: false };
  /** Any "confirm" press since the last call to takeConfirm() (used for instant restart). */
  private confirm = false;
  /** Until the pointer has moved over the canvas its position is meaningless (Phaser starts at 0,0). */
  private pointerSeen = false;
  private axisAnchor = { x: 0, y: 0 };

  constructor(private readonly scene: Phaser.Scene) {
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.mode = 'cursor';
      this.pointerSeen = true;
      this.confirm = true;
      if (p.button === 2) this.pending |= BTN_DASH;
      else if (p.button === 0) this.pending |= BTN_PARRY;
    });
    // Moving the mouse hands control back to the cursor, but only a deliberate move (not a bump)
    // and never while movement keys / the stick are held.
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.pointerSeen = true;
      const [ax, ay] = this.axis();
      if (ax !== 0 || ay !== 0) {
        this.axisAnchor = { x: p.worldX, y: p.worldY };
        return;
      }
      if (this.mode === 'axis') {
        const dx = p.worldX - this.axisAnchor.x;
        const dy = p.worldY - this.axisAnchor.y;
        if (dx * dx + dy * dy < MOUSE_TAKEOVER_PX * MOUSE_TAKEOVER_PX) return;
      }
      this.mode = 'cursor';
    });
    const kb = scene.input.keyboard;
    kb?.on('keydown', (e: KeyboardEvent) => {
      if (MOVE_KEYS[e.code] || PARRY_KEYS.has(e.code) || DASH_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      if (PARRY_KEYS.has(e.code)) this.pending |= BTN_PARRY;
      if (DASH_KEYS.has(e.code)) this.pending |= BTN_DASH;
      if (PARRY_KEYS.has(e.code) || e.code === 'Space' || e.code === 'Enter') this.confirm = true;
    });
    kb?.on('keyup', (e: KeyboardEvent) => this.held.delete(e.code));
    // Losing focus must not leave keys stuck "held".
    scene.game.events.on(Phaser.Core.Events.BLUR, () => this.held.clear());
  }

  private pad(): Phaser.Input.Gamepad.Gamepad | undefined {
    const gp = this.scene.input.gamepad;
    return gp && gp.total > 0 ? (gp.pad1 ?? undefined) : undefined;
  }

  /** Poll the gamepad once per rendered frame (rising-edge detection for buttons). */
  pollPad(): void {
    const pad = this.pad();
    if (!pad) return;
    const a = pad.isButtonDown(PAD_A);
    const b = pad.isButtonDown(PAD_B);
    const rt = pad.getButtonValue(PAD_RT) > 0.5;
    if (a && !this.padPrev.a) {
      this.pending |= BTN_PARRY;
      this.confirm = true;
    }
    if ((b && !this.padPrev.b) || (rt && !this.padPrev.rt)) this.pending |= BTN_DASH;
    this.padPrev = { a, b, rt };
  }

  private axis(): [number, number] {
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      const m = MOVE_KEYS[code];
      if (m) {
        x += m[0];
        y += m[1];
      }
    }
    const pad = this.pad();
    if (pad) {
      const sx = pad.leftStick.x;
      const sy = pad.leftStick.y;
      if (Math.sqrt(sx * sx + sy * sy) > STICK_DEADZONE) {
        x += sx;
        y += sy;
      }
    }
    return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
  }

  /** One frame for one sim tick. Consumes latched presses. */
  sample(): InputFrame {
    const [ax, ay] = this.axis();
    if (ax !== 0 || ay !== 0) {
      if (this.mode !== 'axis') {
        const ptr = this.scene.input.activePointer;
        this.axisAnchor = { x: ptr.worldX, y: ptr.worldY };
      }
      this.mode = 'axis';
    }
    const buttons = this.pending;
    this.pending = 0;
    if (this.mode === 'axis' || !this.pointerSeen) {
      return sanitizeInput({ cursor: false, mx: Math.round(ax * AXIS_MAX), my: Math.round(ay * AXIS_MAX), buttons });
    }
    const p = this.scene.input.activePointer;
    return sanitizeInput({ cursor: true, mx: Math.round(p.worldX), my: Math.round(p.worldY), buttons });
  }

  /** Drop latched presses (e.g. the click that restarted a run must not parry in the new one). */
  clear(): void {
    this.pending = 0;
    this.confirm = false;
  }

  takeConfirm(): boolean {
    const c = this.confirm;
    this.confirm = false;
    return c;
  }
}
