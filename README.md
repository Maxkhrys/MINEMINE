# MINEMINE — Adventure update

Working furnaces, persistent storage, fish and birds, villages and survival progression. See the Adventure update controls and systems below. Existing saves remain compatible.

## Previous: The Workshop Update

MINEMINE now has a cohesive stone-and-moss interface, a live-world title screen,
a searchable Creative inventory, and a station-aware recipe book. Existing saves
and settings continue to work.

- **Inventory:** press **E**. Search the catalog, filter Blocks / Tools / Food /
  Materials, then click or Shift-click items into your hotbar. Survival retains
  left-click pickup, right-click splitting, Shift-click transfer and 1–9 swapping.
- **Crafting:** choose By hand, Crafting table or Furnace. Select a recipe to see
  its ingredient layout and available counts. **Craft** makes one recipe;
  **Craft max** or Shift-clicking Craft makes up to 64, limited by ingredients and
  space. Place a held cursor stack before crafting. Stations must be nearby in
  Survival. Recipes remain automatically assembled from your inventory.
- **Hands and items:** a visible sleeved arm swings even when empty or aimed at
  the sky. Pickaxes, axes, shovels, swords, food and materials use new original
  32px sprites, shared with their extruded first-person models.
- **Extra polish:** target names and tool hints with mining progress, compass and
  coordinates, stackable pickup notifications, a rebuilt hotbar, keyboard focus
  navigation, reduced-motion UI, and loading progress with a gameplay tip.
- Crafting is atomic: failed crafts do not consume or shuffle ingredients.
  Returning a held tool preserves its remaining durability, and autosaves include
  the item on your cursor while the workshop is open.

# Hearthvale Update

A handcrafted tutorial village for MINEMINE, with flowing water and a longer crafting progression.

## Play and record

Existing browser saves still load normally. To explore the showcase, open **Create a world**, choose **HEARTHVALE**, then **Create world**. Creating a new world replaces the current browser save, as the menu warns. Fresh installations start in Hearthvale Creative.

- **V** cycles village panorama, bridge, keep, diamond cavern, and square (Hearthvale Creative).
- **F1** hides the HUD, selection outline and held item for recording.
- **L** cycles daylight, golden hour and moonlight (Creative).
- **F** toggles Creative flight; **Space / Shift** ascend / descend; **Ctrl** accelerates flight.
- **C** sneaks and prevents walking off unsupported edges.
- **E** opens the full building palette, tools and crafting recipes.

## Added systems

- Seven persisted water flow levels: falls before spreading, recedes when sources are removed, respects solid obstacles, and resumes after chunks reload. Creative palette includes water sources.
- Falling sand and gravel with a bounded 10 Hz simulation and collision protection around the player.
- Animated impact and swimming ripples, translucent shallow water, animated waterfall highlights, and exposed faces between different flow heights.
- Campfire flames, rising smoke, heat damage in Survival, and water extinguishing. Fire does not spread to buildings.
- Twelve nearby warm light emitters plus a held glow lamp; local lighting uses distance attenuation, not shadow-casting voxel light propagation.
- Original stone-brick, diamond-ore and campfire textures. Diamond tools have crafting recipes, tier-four harvesting, 1,561 durability, and fully extruded pixel-art held models.
- Timber cottages with accessible interiors and crafting stations, a keep, bridge, windmill, orchard, garden, spring waterfall and timber-supported mine descending into a diamond cavern.

This remains a standalone voxel sandbox, not a complete Minecraft implementation. Fluids are discrete voxel levels; falling blocks move in simulation steps. Redstone, multiplayer, hostile mobs, full fire spread, buckets and modern Minecraft's complete block set are not implemented.

## Validation

`npm run build` checks TypeScript and builds the Vite bundle. `npm test` covers terrain, meshing, raycasting, fluid drainage and waterfalls, cross-chunk flow, sand collision, sneak protection, showcase geometry and diamond crafting.

`npm run verify` runs the existing browser regression suite with Playwright. `node e2e/showcase.cjs` captures the showcase in three lighting presets. Install Chromium through `npx playwright install chromium` first. Set `URL` to a deployment URL with `?debug` to test it remotely.

---

# MINEMINE

A first-person voxel sandbox that runs in the browser. Explore a generated world,
mine blocks, and build with them. Built with **Vite**, **TypeScript** and **Three.js**
(WebGL 2). All textures, sounds and UI are original and generated in code.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build a static site into `dist/` |
| `npm run preview` | Serve the production build (http://localhost:4173) |
| `npm test` | Unit tests (raycast, world storage, meshing, terrain generation) |
| `npm run verify` | 28 end-to-end checks in headless Chromium against a running `npm run dev` (run `npx playwright install chromium` once) |
| `npm run typecheck` | TypeScript only |

Add `?safe` to the URL to start with every optional graphics effect disabled.
Add `?debug` to expose `window.__minemine` for automated testing.

## Controls

| Input | Action |
| --- | --- |
| Click **Play** | Capture the mouse and start playing |
| `W` `A` `S` `D` | Move |
| `Space` | Jump (swim up in water, fly up in Creative) |
| `Shift` | Sprint (fly down in Creative) |
| Mouse | Look |
| Left click / hold | Mine the outlined block |
| Right click | Place the selected block, eat the held food, or open a crafting table / furnace (hold `Shift` to place against one instead) |
| Left click an animal | Attack it (swords hit hardest) |
| Middle click | Pick the targeted block into the hotbar |
| `1`–`9` / mouse wheel | Select hotbar slot |
| `E` | Open / close the inventory |
| `F` or double-tap `Space` | Toggle flying (Creative) |
| `F3` | Debug overlay (position, target block and face, chunk stats) |
| `Esc` | Release the mouse and open the pause menu |

The pause menu has **Settings**, **Controls**, **Create a world** (choose a seed and
Survival or Creative) and **Reset world** (same seed, all changes undone).

## What's in the game

- **World**: a repeatable seeded world 128 blocks tall that extends without limit in
  x and z. It has plains, forests, birch forests, desert, snowy tundra and peaks,
  beaches and lakes, oak and birch trees, grass and flowers, winding caves, coal and
  iron veins, and a bedrock floor. Every seed has a flat, tree-free spawn area.
  The same seed always generates the same world, in any chunk order.
- **Survival**: 10 hearts, a hunger bar and an air meter. Hunger drains as you
  move, sprint, mine and fight. A full stomach slowly heals you, and an empty one
  hurts. You take fall damage beyond three blocks, and you drown when your air
  runs out. When you die, a death screen explains why and **Respawn** returns you
  to the world spawn with your inventory. You start with a wooden pickaxe and
  axe, some planks, apples and a crafting table.
- **Tools**: wooden, stone and iron pickaxes, axes, shovels and swords. Each
  block mines fastest with its tool, and tools wear out (durability bar). Stone,
  cobblestone, bricks and ores need a pickaxe to drop anything, and iron ore
  needs stone or better. Coal ore drops coal, and leaves sometimes drop apples.
- **Crafting** (inventory, `E`): a searchable recipe book shows ingredient layouts and
  missing counts. **Craft max** or **Shift-click Craft** crafts in bulk. Some recipes work by
  hand (planks, sticks, crafting table). Tools, the furnace, sandstone and glow
  lamps need a **crafting table** nearby. A **furnace** smelts iron, glass,
  bricks and stone, cooks meat, and bakes bread from tall grass. Smelting and meat recipes consume coal.
- **Animals**: pigs, cows and chickens spawn in small groups on grass, wander,
  avoid cliffs, and panic and run when hit. Killing one gives raw meat; cook it
  in a furnace for much more food.
- **Creative**: every block, tool and food in the palette, instant mining, flying,
  no damage or hunger.
- **Precise targeting**: one camera-centred **3D DDA voxel raycast**
  (Amanatides & Woo) runs each frame. The outline, mining and placement all use
  that same hit. The ray visits voxels in the order it enters them, so it always
  stops at the first solid one. Reach is **4.5 blocks**, measured from the eye
  to the entry point. Placement uses the hit face's normal to choose the
  adjacent voxel and is refused when that voxel would overlap the player's
  collision box. Plants use their own smaller hit box, and water is ignored by
  the ray. The raycast works on integer world coordinates, so negative
  coordinates, chunk borders and rays past corners need no special cases.
  All of this is covered by `tests/raycast.test.ts`.
- **Persistence**: the seed, every player-made block change, the player's position
  and the inventory are saved to `localStorage` (autosave plus on tab hide/close).
  Reloading the page restores the world exactly.
- **Water** fills blocks you open next to it and spreads a few blocks (falling
  first), so lakes don't leave holes behind.

## Graphics

- Sun with soft PCF shadows (the shadow map follows the player and snaps to
  texels to avoid shimmering) and a sky/ground hemisphere light for ambient light.
- Baked per-vertex **ambient occlusion** and **sky visibility** on every face,
  so caves and overhangs stay dark even with every effect disabled.
- **SSAO** reconstructed from the depth buffer, a dual-filter **bloom** chain, and
  a final pass with exposure, **ACES filmic tone mapping**, gentle colour grading,
  vignette and dithering.
- A sky dome with gradient, sun disc and halo and soft procedural clouds. Distance
  **fog** samples the sky colour, so terrain fades into the horizon.
- **Water** shader: animated normals, fresnel sky reflection, sun glints (which
  respect shadows), depth-based colour, shore foam and a faint voxel grid up
  close so block edges stay readable.
- **Wind** sway for leaves, grass and flowers (also applied in the shadow pass).
- Crisp 16×16 textures in a texture array (nearest filtering up close,
  mipmaps and anisotropic filtering in the distance). Leaves, glass and plants
  are alpha-tested.

**Settings** (pause menu → Settings): quality presets Low / Medium / High / Ultra,
render distance, resolution scale, shadows (Off/Low/High/Ultra),
post-processing, SSAO, bloom, MSAA, wind and water animation, clouds, field of view,
mouse sensitivity, invert Y, view bobbing, volume and an FPS counter. Settings are
remembered. Software renderers and mobile devices start on **Low**, which skips
post-processing and shadows.

**Fallbacks**: without WebGL 2 the page explains what's missing instead of showing
a black screen. If a shader fails to compile, the game switches itself to safe
graphics and says so. If half-float render targets aren't supported,
post-processing is disabled. An exception in the effect chain falls back to
direct rendering, and a lost WebGL context is restored.

## Performance design

- Worlds are streamed as 16×128×16 columns. Terrain is generated in a pool of
  Web Workers (main-thread fallback). Meshes are built per 16³ section within a
  per-frame time budget, nearest and in-view first.
- At most three draw calls per section (opaque, cut-out, water). There's never
  one mesh per block, and faces between opaque neighbours are never emitted.
- A block edit rebuilds only the affected sections, including neighbouring chunks
  when the block is on a border, in the same frame as the click.
- Empty and fully buried sections are skipped cheaply.

## Project layout

```
src/
  main.ts              boot, WebGL 2 check, fatal-error screen
  game/                Game loop and states, Player physics, Input, Inventory, save, settings
  world/               blocks, noise, generator (+ worker), World store, mesher, raycast, ChunkManager
  render/              Renderer, materials/shaders, PostFX, textures, chunk meshes, outline, particles, held item
  ui/                  HUD, menus, settings, inventory (plain DOM)
  audio/               synthesised sound effects (Web Audio)
tests/                 Vitest unit tests
```

## Adventure update

- Right-click furnaces for input, fuel and output. Coal burns for 80 seconds; wood and sticks also work. Each batch takes 5 seconds. Furnaces, chests and backpacks save their contents and partial progress.
- Press **B** for a crafted travel backpack, **O** for armour/shield equipment, **J** for discoveries, village requests, milestones and the Keep Inventory option. In storage, click a stack to transfer it or right-click for one.
- Hold right-click to eat. Hold and release right-click with a bow to shoot; arrows follow gravity and stop at blocks. Hold **R** with a shield equipped; raising it just before impact parries. **Q** drops an item.
- Hoe dirt or grass, plant seeds, and supply water within four blocks. Craft a bucket from three iron ingots to move water. Wheat matures over 72 seconds in loaded, irrigated fields; harvest for wheat and seeds.
- Feed two nearby adult cows/pigs wheat, or chickens seeds, to breed. Babies grow in 90 seconds. Parents have a three-minute cooldown.
- Right-click beds to set respawn. At night, beds skip to morning if enemies are not nearby. A day lasts 20 minutes. Zombies and skeleton archers spawn at night.
- Village noticeboards and traders offer trades plus gathering, building and scout rescue requests. New settlements generate in suitable dry terrain across seeded worlds. Hearthvale has furnished homes and a public wheat farm.
- Death can place inventory, backpack contents and equipped gear into a recoverable world backpack. Coordinates appear in the journal. Existing saves retain their prior Keep Inventory behaviour; change it in the journal.
- Doors, gates and ladders work; beds and chests use their actual collision shapes. Fish swim in water and birds fly around terrain. Mining and creatures drop physical, collectible items.

## Persistence and limits

Saves stay in this browser's `localStorage`, including container contents, equipment, farming progress, world drops and animals. Existing version-1 saves load without conversion. Simulation pauses at the menu; loaded furnaces and farms continue while an inventory screen is open. There is no offline progress or multiplayer server.

Crafting uses an ingredient recipe book with grid previews. Light uses sun/sky lighting and a limited set of local effects rather than full block-light propagation. Water spread has bounded flowing levels. Browser storage has a quota; the game reports save failures. New villages appear through terrain generation, while saved block edits retain priority.
