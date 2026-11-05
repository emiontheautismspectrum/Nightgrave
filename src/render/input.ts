/**
 * Collects mouse / pen / touch (one Pointer Events path), keyboard and gamepad input and turns it into one sanitized
 * InputFrame per sim tick. Presses are latched until the next sampled tick so a click between two ticks is never lost.
 * Touch is converted by the TouchModel into the SAME cursor-target frame the mouse produces, before it reaches the sim.
 */
import Phaser from 'phaser';
import { AXIS_MAX, BTN_DASH, BTN_PARRY, sanitizeInput, type InputFrame } from '../sim/input';
import { fieldFocused } from './SubmitPanel';
import { TouchModel } from './touch';

const PARRY_KEYS = new Set(['KeyJ', 'KeyZ']);
const DASH_KEYS = new Set(['KeyK', 'ShiftLeft', 'ShiftRight', 'Space']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);
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
const PAD_START = 9;

export type InputSource = 'mouse' | 'keyboard' | 'gamepad' | 'touch';

export interface InputHooks {
  /** Is (x, y) on a UI control (pause button, menu)? Such presses never reach the game. */
  uiHit: (x: number, y: number) => boolean;
  hero: () => { x: number; y: number };
  onPause: () => void;
  /** First touch seen (switch the UI to touch mode). */
  onTouch: () => void;
  /** A menu is open: it handles Esc/B/Start itself (P still toggles the pause). */
  menuOpen: () => boolean;
}

export class InputCollector {
  /** Cursor-follow (mouse/touch) or axis (keyboard / stick) movement. Mouse is the default. */
  mode: 'cursor' | 'axis' = 'cursor';
  /** Every input source used during the current run (replay metadata only). */
  readonly sources = new Set<InputSource>();
  private last: InputSource = 'mouse';
  private pending = 0;
  private held = new Set<string>();
  private padPrev = { a: false, b: false, rt: false, start: false };
  private padPrimed = false;
  private confirm = false;
  private pointerSeen = false;
  private mouse = { x: 0, y: 0 };
  private axisAnchor = { x: 0, y: 0 };
  private dom: [string, (e: PointerEvent) => void][] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    readonly touch: TouchModel,
    private readonly hooks: InputHooks,
  ) {
    scene.input.mouse?.disableContextMenu();
    const canvas = scene.game.canvas;
    const toGame = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      // clamped to the screen: a drag past the canvas edge must never produce an off-screen cursor in the replay
      const gx = ((e.clientX - r.left) * scene.scale.width) / (r.width || 1);
      const gy = ((e.clientY - r.top) * scene.scale.height) / (r.height || 1);
      return [Math.max(0, Math.min(scene.scale.width, gx)), Math.max(0, Math.min(scene.scale.height, gy))];
    };
    const on = (type: string, fn: (e: PointerEvent) => void) => {
      canvas.addEventListener(type, fn as EventListener);
      this.dom.push([type, fn]);
    };
    on('pointerdown', (e) => {
      const [x, y] = toGame(e);
      if (this.hooks.uiHit(x, y)) return;
      this.confirm = true;
      if (e.pointerType === 'touch') {
        e.preventDefault();
        this.use('touch');
        this.hooks.onTouch();
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable */
        }
        this.touch.down(e.pointerId, x, y, e.timeStamp, this.hooks.hero());
        return;
      }
      this.use('mouse');
      this.mode = 'cursor';
      this.pointerSeen = true;
      this.mouse = { x, y };
      if (e.button === 2) this.pending |= BTN_DASH;
      else if (e.button === 0) this.pending |= BTN_PARRY;
    });
    on('pointermove', (e) => {
      const [x, y] = toGame(e);
      if (e.pointerType === 'touch') {
        this.touch.move(e.pointerId, x, y);
        return;
      }
      this.pointerSeen = true;
      this.mouse = { x, y };
      // a deliberate mouse move (not a bump) hands control back to the cursor, never while keys / the stick are held
      const [ax, ay] = this.axis();
      if (ax !== 0 || ay !== 0) {
        this.axisAnchor = { x, y };
        return;
      }
      if (this.mode === 'axis' || this.last === 'touch') {
        const dx = x - this.axisAnchor.x;
        const dy = y - this.axisAnchor.y;
        if (dx * dx + dy * dy < MOUSE_TAKEOVER_PX * MOUSE_TAKEOVER_PX) return;
        this.use('mouse');
      }
      this.mode = 'cursor';
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType === 'touch') this.touch.up(e.pointerId, e.timeStamp);
    };
    on('pointerup', end);
    on('pointercancel', (e) => this.touch.cancel(e.pointerId));
    const kb = scene.input.keyboard;
    const down = (e: KeyboardEvent) => {
      if (fieldFocused()) return; // typing a name: keys only type
      if (MOVE_KEYS[e.code] || PARRY_KEYS.has(e.code) || DASH_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (PAUSE_KEYS.has(e.code)) {
        if (!this.hooks.menuOpen() || e.code === 'KeyP') this.hooks.onPause();
        return;
      }
      if (this.hooks.menuOpen()) return;
      this.held.add(e.code);
      if (MOVE_KEYS[e.code] || PARRY_KEYS.has(e.code) || DASH_KEYS.has(e.code)) this.use('keyboard');
      if (PARRY_KEYS.has(e.code)) this.pending |= BTN_PARRY;
      if (DASH_KEYS.has(e.code)) this.pending |= BTN_DASH;
      if (PARRY_KEYS.has(e.code) || e.code === 'Space' || e.code === 'Enter') this.confirm = true;
    };
    const up = (e: KeyboardEvent) => this.held.delete(e.code);
    kb?.on('keydown', down);
    kb?.on('keyup', up);
    const blur = () => this.held.clear(); // losing focus must not leave keys stuck "held"
    scene.game.events.on(Phaser.Core.Events.BLUR, blur);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const [type, fn] of this.dom) canvas.removeEventListener(type, fn as EventListener);
      kb?.off('keydown', down);
      kb?.off('keyup', up);
      scene.game.events.off(Phaser.Core.Events.BLUR, blur);
    });
  }

  private use(s: InputSource): void {
    this.last = s;
    this.sources.add(s);
  }

  get lastSource(): InputSource {
    return this.last;
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
    const start = pad.isButtonDown(PAD_START);
    if (!this.padPrimed) {
      // buttons still held from the menu (A on PLAY) are not fresh presses in the run
      this.padPrimed = true;
      this.padPrev = { a, b, rt, start };
      return;
    }
    if (a && !this.padPrev.a) {
      this.pending |= BTN_PARRY;
      this.confirm = true;
      this.use('gamepad');
    }
    if ((b && !this.padPrev.b) || (rt && !this.padPrev.rt)) {
      this.pending |= BTN_DASH;
      this.use('gamepad');
    }
    if (start && !this.padPrev.start && !this.hooks.menuOpen()) this.hooks.onPause();
    this.padPrev = { a, b, rt, start };
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
        this.use('gamepad');
      }
    }
    return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
  }

  /** Where the reticle should be drawn (mouse cursor or the touch virtual cursor), or null. */
  cursorPos(): { x: number; y: number } | null {
    if (this.mode !== 'cursor') return null;
    if (this.last === 'touch') return this.touch.cursor;
    return this.pointerSeen ? this.mouse : null;
  }

  /** One frame for one sim tick. Consumes latched presses. */
  sample(): InputFrame {
    const [ax, ay] = this.axis();
    if (ax !== 0 || ay !== 0) {
      if (this.mode !== 'axis') this.axisAnchor = { ...this.mouse };
      this.mode = 'axis';
    }
    const buttons = this.pending | this.touch.take();
    this.pending = 0;
    if (this.mode === 'axis') {
      return sanitizeInput({ cursor: false, mx: Math.round(ax * AXIS_MAX), my: Math.round(ay * AXIS_MAX), buttons });
    }
    const c = this.last === 'touch' ? this.touch.cursor : this.pointerSeen ? this.mouse : null;
    if (!c) return sanitizeInput({ cursor: false, mx: 0, my: 0, buttons });
    return sanitizeInput({ cursor: true, mx: Math.round(c.x), my: Math.round(c.y), buttons });
  }

  /** Drop latched presses (e.g. the click that restarted a run must not parry in the new one). */
  clear(): void {
    this.pending = 0;
    this.touch.take();
    this.confirm = false;
  }

  /** A new run: the touch virtual cursor restarts at the hero; sources are counted afresh. */
  newRun(): void {
    this.clear();
    this.touch.reset();
    this.sources.clear();
    this.sources.add(this.last);
  }

  takeConfirm(): boolean {
    const c = this.confirm;
    this.confirm = false;
    return c;
  }
}
