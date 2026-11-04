Read CLAUDE.md and ASSETS_SPEC.md first and follow them strictly.

Task: Stage 0 (art pipeline + style board) for Nightgrave, then Stage 1 (core).

Stage 0
1. Create `tools/` with a Python + Pillow/numpy asset generator driven by the 16-color palette in ASSETS_SPEC.md.
2. Generate at least: knight and wisp (idle, parry, dash, death), orb_small, orb_large, rune_shard, blade, wraith,
   parry_pulse, dash_trail, ground_ritual with glowing runes, 3 gravestones, dead trees, fog overlay, vignette.
3. Write `tools/validate_palette.py` and make it pass.
4. Render `assets/preview/style_board.png` (all sprites on the arena at 3x, nearest-neighbor) and commit it.
   Then STOP and summarize so the user can look at the style board before continuing. Do not wait for approval
   to continue with Stage 1 unless the style board fails your own validation.

Stage 1
5. Scaffold Vite + TypeScript + Phaser 3 + Vitest (scripts: dev, build, test). Put the title in `src/config.ts` as TITLE.
6. Implement `src/sim/`: fixed 60 Hz tick, seeded mulberry32, hero following the cursor with max speed, parry pulse
   (radius, duration, cooldown from `src/data/tuning.ts`), dash with invulnerability and cooldown, one-hit death,
   orb projectiles, score and multiplier, input log + replay playback.
7. Implement `src/render/` with a Phaser scene using the generated atlas; rendering only reads sim state.
8. Vitest: same seed + same input log => identical final state and score (several seeds); parry and dash boundary
   cases; no Math.random/Date.now in `src/sim/`. `npm run build` and `npm test` must pass. Commit.
9. Run an adversarial review (fresh read-only reviewer trying to break determinism, parry/dash edge cases, input
   handling). Fix real findings and commit.

Finish with a short summary: what works, how to run it, what is next (Stage 2).
