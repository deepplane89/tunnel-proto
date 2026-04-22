# Code Cleanup TODO

Low-priority cleanup items that shouldn't be touched mid-feature. Only tackle when things are stable.

## Dead code (safe to delete, holding off to avoid rabbit holes)

- **RadialBlurShader + _radialBlurPass** in `src/20-main-early.js:1410-1455` — was for wormhole mode. Wormhole was nixed. Pass is `enabled = false` forever and never toggled. ~46 lines. Zero perf cost currently (disabled passes are skipped by EffectComposer), pure cleanup.

