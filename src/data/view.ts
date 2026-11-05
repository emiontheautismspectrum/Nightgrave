/**
 * Phone-portrait view (render-only, never read by the simulation). The screen is PORTRAIT.w x PORTRAIT.h game px
 * (9:16): a HUD band on top, the zoomed world window in the middle and a strip for the boss bar and the touch buttons
 * at the bottom. At zoom 1 the world window shows 216 x 292 world px: the whole arena height and ~56% of its width.
 */
export const PORTRAIT = {
  w: 216,
  h: 384,
  hudH: 30,
  bottomH: 62,
  /** Camera zoom of the world window (1 = one world px per game px). */
  zoom: 1,
  /** Dead zone around the camera centre (world px) and the lead ahead of a moving hero. */
  deadZone: 12,
  lead: 24,
  /** Follow rate (1/s, exponential); reduced motion snaps faster and drops the lead. */
  follow: 8,
  followReduced: 30,
  /** Off-view threats get an edge marker when they can reach the hero within this many ticks. */
  horizonTicks: 90,
} as const;

/** The world window on the portrait screen (game px). */
export const portraitViewport = (): { x: number; y: number; w: number; h: number } => ({
  x: 0,
  y: PORTRAIT.hudH,
  w: PORTRAIT.w,
  h: PORTRAIT.h - PORTRAIT.hudH - PORTRAIT.bottomH,
});
