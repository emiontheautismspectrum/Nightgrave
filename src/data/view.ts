/**
 * Phone-portrait view (render-only, never read by the simulation). The real screen size comes from the viewport
 * (src/web/screen.ts) and src/render/portraitLayout.ts places the HUD band, the world window and the control strip;
 * w / h below are only a fallback (tests, a missing layout). The camera zoom is raised above `zoom` (the floor,
 * tunable) until the window shows at most the world height, at a whole number of device px per world px.
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
