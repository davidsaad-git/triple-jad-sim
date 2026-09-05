# Zuk Simulator

A browser-based Old School RuneScape Inferno simulator (waves 1-69 and TzKal-Zuk), built to match the feel of scim.gg: the real game cache is loaded in the browser, so the arena, NPCs, player and animations are the genuine models.

Unofficial fan project. Old School RuneScape and all game assets are the property of Jagex Limited. See NOTICE.md for third-party code credits.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first load downloads the 189 MB game cache from `public/osrs-cache/disk.zip` (mirrored from OpenRS2 cache 2671) and keeps it in browser storage.

If `public/osrs-cache/disk.zip` is missing, download it:

```bash
curl -L -o public/osrs-cache/disk.zip https://archive.openrs2.org/caches/runescape/2671/disk.zip
```

## Controls

- Left click a tile to walk, left click a monster to attack.
- Arrow keys, middle-mouse drag and the wheel move the camera.
- Prayer tab: click prayers; the orb toggles quick prayers. Run orb toggles running.
- Ctrl+K opens the Encounters menu (any wave, loadout preset, infinite health/prayer). Ctrl+R restarts the wave.

## Development

```bash
npm test          # engine unit tests (vitest)
npx tsc -b        # type check
npm run build     # production build
npx tsx scripts/inspect-cache.ts     # cache smoke test
npx tsx scripts/inspect-region.ts    # arena decode + collision + pathing
npx tsx scripts/inspect-model.ts     # models + animations
```

Docs: `docs/ARCHITECTURE.md`, `docs/RESEARCH.md`, `docs/INFERNO_DATA.md`.
