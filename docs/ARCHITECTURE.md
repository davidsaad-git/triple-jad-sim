# Architecture

A browser simulator of Old School RuneScape's Inferno wave 68 (three JalTok-Jads). Everything runs client-side from the real game cache; there is no backend.

```
src/cache    JS5 cache reader and decoders (configs, models, animations, maps, textures, sounds)
src/sim      Deterministic 600 ms tick engine: world, input band, movement/pathing, combat,
             items/prayers, NPC definitions, the triple-Jad encounter, loadout presets
src/render   WebGL2 renderer: arena scene, camera, actors and animations, projectiles and
             graphics, hitsplats/health bars/prayer icons, world-space plugin overlays, picking
src/audio    Web Audio engine, sound rules per tick event, cache sound synthesis
src/input    Pointer/keyboard handling, right-click menus, hotkeys, dialogs
src/app      Runtime (real-time tick clock, input lag queue, pause), session wiring, settings
src/ui       Client chrome (layouts, side panel, minimap, orbs), menus, HUD, plugins, screens
```

Contracts between layers live in `src/sim/api.ts` (engine state snapshot, tick events, commands), `src/app/runtime/types.ts` (the runtime every layer talks to) and `src/render/api.ts` (picking, overlay anchors, frame sounds).

## Tick flow

The runtime advances the engine once every 600 ms / playback speed on animation frames. UI commands are queued with the configured input lag and applied right before the next tick boundary. Each tick the engine processes inputs, hazards, NPC hits, NPC movement and attacks, player hits, timers, player movement and the player's attack, then publishes a state snapshot and the tick's events. The renderer and audio consume those events on an interpolated clock (30 client cycles of 20 ms per tick).

## Cache

`public/osrs-cache/trimmed/disk.zip` holds only the archives the app reads (built by `scripts/trim-cache.ts` from OpenRS2 cache 2720). It is cached in the browser's Cache Storage after the first load.
