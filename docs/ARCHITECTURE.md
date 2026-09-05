# Architecture

Goal: a browser OSRS Inferno simulator (waves 1-69 and TzKal-Zuk) that looks and behaves like scim.gg. Everything runs client-side; there is no backend in v1.

## Layers

```
src/cache     JS5 cache reader + decoders (configs, models, animations, maps, sprites, textures)
src/scene     Terrain geometry, collision map, pathfinding, line of sight (from cache data)
src/engine    Deterministic 600 ms tick simulation: world, actors, combat, prayers, Inferno AI
src/render    WebGL2 renderer, camera, model/terrain meshes, animation playback
src/ui        React: loading, client chrome (fixed / resizable layouts), tabs, plugins, overlays
src/data      Static game data tables (waves, monsters, items, prayers, presets)
src/app       Wiring: cache -> scene -> engine -> render -> ui
```

Dependency direction is top-down in that list: `engine` never imports from `render` or `ui`. The renderer reads engine state each frame and interpolates by the clock's tick alpha. The UI dispatches inputs (clicks on tiles/NPCs, prayer toggles, inventory clicks) into the engine as queued actions that apply on the next tick, the way the real client does.

## Cache

- `DiskStore` reads the OpenRS2 `disk.zip` layout (`main_file_cache.dat2` + `idx*`). `CacheSystem` exposes `index -> archive -> file` with lazy, memoised decoding; containers handle bzip2 (own decoder), gzip (fflate) and XTEA (unused since build 237).
- In the browser `loadCacheFromUrl` streams `/osrs-cache/disk.zip`, keeps it in Cache Storage, and unzips in memory. Later: a build-time trim (scim.gg does this: 189 MB -> 9.85 MB) that keeps only the groups the Inferno needs.
- Decoders are ported from rs-map-viewer (BSD-2) and kept in `src/cache/{config,model,anim,map,sprite,texture}`.

## Scene

One region (9043) at a time. Terrain tiles become triangle soup with per-vertex baked lighting; locs are placed models. The collision map uses the client's flag scheme; the pathfinder and line-of-sight follow RuneLite's implementations so safespots behave.

## Engine

- `Clock`: fixed 600 ms ticks with playback speed, pause and step; exposes `alpha` for rendering.
- `World.tick()` order (matches the SDK research): prayer pre-tick, entities (pillars), NPC timers / movement / attacks, spawn queue, delayed actions, projectiles, player timers / movement / attacks, food, regen, death cleanup.
- Actors carry tile position, size, facing, animation state, hitpoints, prayer, combat timers and a hitsplat queue. NPC behaviour is per-monster AI modules in `engine/inferno`.
- Randomness goes through an injectable seeded RNG so a wave can be replayed exactly (scim.gg-style replays and "re-play this spawn").
- Combat math lives in pure functions (`engine/combat/formulas.ts`) with unit tests against wiki values.

## Render

- `Renderer` owns WebGL2 state and a drawable list (VAO + model matrix). Terrain is static; actor models are re-skinned per animation frame on the CPU and re-uploaded (positions only), like the client.
- Camera is client-like: yaw/pitch/zoom with arrows, middle-drag and wheel; compass angle feeds the minimap.
- Picking: ray-cast against the tile heightmap and actor bounding boxes for click-to-move / attack; the UI shows a client-style right-click menu.

## UI

React 19. The client chrome (side panel tabs, minimap, orbs, chatbox, hitsplats, overheads, tile markers) is HTML/CSS over the canvas, styled by resource packs (PNG sprites from the cache plus RuneLite-style packs). Plugins are toggleable modules that draw overlays into a 2D canvas layer or React components.

## Milestones

1. Cache + renderer foundation (done): cache loads in browser, WebGL2 draws geometry, camera.
2. Inferno arena renders from the cache: terrain, locs, textures; Zuk idle animation; player model.
3. Playable core: click-to-move with pathfinding, camera, tick engine, prayers, HUD, one monster type attacking.
4. Waves 1-66 with full monster AI (nibblers/pillars, bat drain, blob prayer check + bloblets, meleer dig, ranger/mager LOS, mager revive), gear/loadouts, hiscores-free stat profiles.
5. Jad waves (healers, cues) and Zuk (shield, sets, set timer, Jad, healers, enrage).
6. scim.gg parity: RuneLite-style layouts and plugins, resource packs, settings, encounter configure screen, mechanics toggles, replays, training drills.
