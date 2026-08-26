// Shared type definitions for the survival game engine. GameState is the
// single bag of mutable simulation state that every other module reads and
// writes — modules take it as a parameter instead of closing over local
// variables, so each file's dependencies are explicit and it stays
// independently readable.
import type { Rng } from '../worldgen/worldgen';

export type Dir = 'up' | 'down' | 'left' | 'right';

// which mouse button a click-driven action came from — left-click and
// right-click each operate their own independent held-item slot (see
// Player.heldLeft/heldRight below)
export type Hand = 'left' | 'right';

// three occupancy layers, bottom to top: floor (walkable ground material,
// see FLOOR_DEFS in constants.ts), obstacles (solid, atlas-baked, see
// OBSTACLE_DEFS), and items (loose, drawn per-frame, sit on top of an
// obstacle that opts in via allowItem — see ITEM_DEFS). Floor and obstacles
// are independent maps, so an obstacle can sit on top of a floor tile
// without the two ever conflicting. 'soil' is a floor type rather than an
// obstacle on purpose — it's plantable ground, not a solid thing to walk
// around, so it doesn't need `solid`/occupant-combine semantics.
export type FloorType = 'dirt' | 'soil';
export type ObstacleType =
  | 'stone'
  | 'furnace'
  | 'campfire'
  | 'wood'
  | 'berryBush'
  | 'tree'
  | 'cactus'
  | 'reed';
export type ItemType =
  | 'rawMeat'
  | 'meat'
  | 'coal'
  | 'ingot'
  | 'ore'
  | 'sword'
  | 'bow'
  | 'cactusFruit'
  | 'berry'
  | 'poop'
  | 'rope'
  | 'fishingRod'
  | 'rawFish'
  | 'fish';
export type CarryType = ObstacleType | ItemType | FloorType;

// 'jerboa' is a small skittish desert rodent (and the training dummy's base
// shape) that roams the whole map searching for loose food items, steals one
// when it finds it, and flees rather than ever fighting back (see
// systems/ai.ts's updateEnemy); 'boulderGuardian' lives in and defends a
// specific boulder-cluster structure (see planGuardianClusters in
// worldgen.ts) rather than roaming freely; 'fish' is confined to the oasis's
// water (see game.ts's water-filtered walkable passed to updateEnemy only
// for this type) and, like jerboa, flees rather than fighting — but unlike
// either other type it's never a valid attack target at all (see
// game.ts's handleClick, which excludes it from the click-to-attack lookup),
// since it's ambient wildlife rather than something to fight: the only way
// to get a rawFish is the fishingRod's timed catch (see systems/fishing.ts),
// not combat — see ENEMY_DEFS in constants.ts for per-type stats.
export type EnemyType = 'jerboa' | 'boulderGuardian' | 'fish';

export interface Point {
  x: number;
  y: number;
}

// entry in the item layer; needs its own x/y since it's stored in a
// position-keyed map alongside its key, for convenient per-frame iteration
export interface Item extends Point {
  type: ItemType;
}

// a berryBush obstacle (see OBSTACLE_DEFS in constants.ts) — kept in sync
// by setObstacle/buildWorldLayers in state/state.ts, same pattern as
// Tree/Cactus below, except a bush is never attacked/destroyed, just
// harvested. readyAt gates when it next produces a berry, but only while
// standing on soil floor (see updateBerryBushes in systems/farming.ts) — a
// bush moved off soil just sits idle rather than losing its progress.
export interface BerryBush extends Point {
  readyAt: number;
}

// an item dumped on a furnace tile, tracked separately from state.items so
// an in-progress job and the furnace obstacle can coexist without
// conflicting with the normal item layer — see systems/smelting.ts (and its
// CampfireJob counterpart below). The player can pick the original `item`
// back up any time before readyAt; once it passes, the job resolves
// (smelts, survives, or is destroyed) and the entry is removed either way —
// no re-arming. readyAt is a tick count (state.tick), not a millisecond
// timestamp.
export interface Smelter extends Point {
  item: ItemType;
  readyAt: number;
}

// an item (or, unlike a furnace job, an obstacle — wood burns to coal too)
// dumped on a campfire tile, tracked separately from state.items for the
// same reason as Smelter above — see systems/cooking.ts. `item` is a
// CarryType rather than ItemType since wood (an ObstacleType) can be
// dumped in. The player can pick the original `item` back up any time
// before readyAt; once it passes, the job resolves (cooks, burns, or is
// destroyed) and the entry is removed either way — no re-arming.
export interface CampfireJob extends Point {
  item: CarryType;
  readyAt: number;
}

// a fishingRod job in progress at (x,y) on oasis water — see
// systems/fishing.ts and doPlace's fishing branch in
// systems/player-actions.ts. Unlike Smelter/CampfireJob above, nothing is
// consumed into the job: the rod is a tool, never consumed by using it
// (same convention as sword/bow), so there's no `item` field to track —
// just a bare timer keyed to a position, the same shape as BerryBush.readyAt
// above. readyAt is a tick count (state.tick), same convention as every
// other job timer.
export interface FishingJob extends Point {
  readyAt: number;
}

export interface ZoomLevel {
  vpw: number;
  vph: number;
}

// common movement/animation fields shared by the player and enemies
export interface Actor {
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  dir: Dir;
  moving: boolean;
  moveStart: number;
  moveDur: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  path: Point[];
}

export type PendingAction =
  | { type: 'pickup'; x: number; y: number; hand: Hand }
  | { type: 'place'; x: number; y: number; hand: Hand };

export interface Player extends Actor {
  heldLeft: CarryType | null;
  heldRight: CarryType | null;
  pendingAction: PendingAction | null;
  // set by the "Use item" buttons; resolved on the next simulation tick
  // (see game.ts's simulateTick) rather than instantly on click, same
  // deferred-resolution convention as pendingAction above. Kept separate
  // from pendingAction/attackTarget rather than folded into the same
  // movement/attack priority chain, since using an item (e.g. healing)
  // needs to work even while chasing or mid-attack, not get starved by
  // them. Two independent flags (rather than one nullable Hand) so a
  // same-tick left-then-right use doesn't clobber itself.
  pendingUseLeft: boolean;
  pendingUseRight: boolean;
  attacked: boolean;
  attackTarget: Enemy | Tree | Cactus | null;
  // which hand initiated the current attackTarget — read by
  // attemptPlayerAttack (systems/player-actions.ts) to pick that hand's
  // weapon stats. Kept on Player rather than passed as a call argument
  // because attackTarget persists across many ticks while the player
  // walks into range, long after the click that set it. Always set/cleared
  // together with attackTarget via setAttackTarget/clearAttackTarget
  // (state/state.ts) — the one exception is damagePlayer's retaliation in
  // combat.ts, which isn't click-initiated and deliberately leaves this
  // field alone.
  attackHand: Hand | null;
  // tick count (state.tick) at which the next attack becomes allowed, same
  // readyAt-style pattern as Seed/SmeltJob above — gated against state.tick
  // rather than a ms timestamp so attack cadence stays exact regardless of
  // frame timing (see attemptPlayerAttack in systems/player-actions.ts)
  nextAttackAt: number;
  // tick count (state.tick) at which the next step becomes allowed — same
  // readyAt-style gating as nextAttackAt above, set by tryPlayerStep
  // (systems/player-actions.ts) to state.tick + 1 normally, or further out
  // while wading through the oasis's water (see PLAYER_WATER_MOVE_TICKS in
  // constants.ts), so movement through water takes proportionally longer in
  // real time without changing the fixed-tick simulation itself. Checked in
  // game.ts's simulateTick before a step is issued.
  nextMoveAt: number;
  hp: number;
  maxHp: number;
  flashUntil: number;
}

export interface Enemy extends Actor {
  // discriminant shared with Tree below, so code that can target either
  // (Player.attackTarget, Projectile.target) can branch to the right
  // damage-application function without the two types otherwise needing
  // anything in common beyond position/hp/flash
  kind: 'enemy';
  type: EnemyType;
  hp: number;
  maxHp: number;
  state: 'wander' | 'chase' | 'flee';
  target: Player | null;
  // the tile this enemy is tethered to for wander-anchoring and the chase
  // leash (see systems/ai.ts's updateEnemy) — null for a jerboa, which
  // wanders unanchored across the whole map; set to a tile near its home
  // boulder-cluster structure for a boulderGuardian (see spawnEnemies in
  // entities/entities.ts)
  home: Point | null;
  // the food item type a jerboa has stolen off the ground, or null if it
  // isn't carrying anything (see ENEMY_DEFS.jerboa's foodSenseRadius/
  // fleesOnSight and updateEnemy in systems/ai.ts) — cleared either by
  // eating it (flee-end heal, see resolveEat) or by taking any hit (see
  // damageEnemy in systems/combat.ts). Always null for a boulderGuardian,
  // which never forages (foodSenseRadius: 0).
  carrying: ItemType | null;
  nextWanderAt: number;
  nextRepathAt: number;
  // tick count (state.tick), same as Player.nextAttackAt above
  nextAttackAt: number;
  aggroUntil: number;
  flashUntil: number;
  // true for the fixed training dummy near spawn: never wanders/chases and
  // ignores hp loss (see systems/ai.ts's updateEnemy and entities.ts's
  // makeDummyEnemy)
  stationary: boolean;
}

// a choppable tree — see OBSTACLE_DEFS.tree in constants.ts for the
// 2-tall/trunk-only-collides visual, and state.trees for how this is
// tracked. Deliberately not folded into Enemy/state.enemies: a tree is
// stationary and has no AI, so it only carries the fields the shared
// combat code (attemptPlayerAttack, updateProjectiles, the y-sorted render
// pass) actually needs — px/py are static since a tree never moves,
// computed once as tileX/tileY * TILE.
export interface Tree {
  kind: 'tree';
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  flashUntil: number;
}

// a choppable cactus — same "stationary, no AI, only the fields shared
// combat code needs" shape as Tree above, but a single tile (no separate
// canopy visual) that's cleared entirely and drops a cactusFruit item on
// death instead of swapping to a leftover obstacle (see destroyCactus in
// systems/combat.ts) — the reward is the fruit, not the plant itself.
export interface Cactus {
  kind: 'cactus';
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  flashUntil: number;
}

// a darkened patch left on a tile the player has walked off of (see
// leaveFootprint in state/state.ts and its render.ts draw loop) — purely
// cosmetic, so it's not persisted (see state/persistence.ts) and rebuilt
// empty on load, same as floatingTexts/projectiles below.
export interface Footprint extends Point {
  born: number;
}

export interface FloatingText {
  worldX: number;
  worldY: number;
  text: string;
  color: string;
  born: number;
}

// an in-flight ranged shot. Damage is rolled and committed at fire time
// (see fireProjectile in systems/combat.ts) — the same OSRS-style "hit
// decided immediately, hitsplat delayed" convention — only the application
// (the damageEnemy call and its flash/floating-text/death handling) and the
// cosmetic travel animation are deferred until landTick. from/to px/py are
// snapshotted once at fire time purely for the travel-line render (see
// render.ts); they don't track the target's later movement, matching the
// same "hit already decided" convention.
export interface Projectile {
  target: Enemy | Tree | Cactus;
  damage: number;
  fromPx: number;
  fromPy: number;
  toPx: number;
  toPy: number;
  spawnAt: number; // ms (rAF/performance.now() timestamp) — for render lerp
  landAt: number; // ms — for render lerp
  landTick: number; // state.tick count at which damage applies
}

export interface GameRefs {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  worldCanvas: HTMLCanvasElement;
  worldCtx: CanvasRenderingContext2D;
  groundAtlas: HTMLCanvasElement;
  groundAtlasCtx: CanvasRenderingContext2D;
  worldAtlas: HTMLCanvasElement;
  worldAtlasCtx: CanvasRenderingContext2D;
}

// DOM element refs for the HUD stat bar and the world-map overlay
export interface HudRefs {
  statHp: HTMLElement;
  statCarryLeft: HTMLElement;
  statCarryRight: HTMLElement;
  toastEl: HTMLElement;
  useItemLeftBtn: HTMLElement;
  useItemRightBtn: HTMLElement;

  worldMapOverlay: HTMLElement;
  worldMapCloseBtn: HTMLElement;
  mapToggleBtn: HTMLElement;
  worldMapScroll: HTMLElement;

  seedInput: HTMLInputElement;
  seedLoadBtn: HTMLElement;
  seedRandomBtn: HTMLElement;
  zoomInBtn: HTMLElement;
  zoomOutBtn: HTMLElement;
}

export interface GameState {
  refs: GameRefs;

  // count of simulation ticks elapsed (see game.ts's simulateTick) — the
  // clock that smelters/campfireJobs/berryBushes readyAt (and nothing else)
  // is measured against, instead of a wall-clock timestamp
  tick: number;

  seed: number;
  rng: Rng;
  map: number[][];
  floor: Map<string, FloorType>;
  obstacles: Map<string, ObstacleType>;
  items: Map<string, Item>;
  smelters: Map<string, Smelter>;
  // positions of every furnace obstacle, kept in sync by setObstacle — lets
  // the per-frame render loop draw the flickering firebox glow (render.ts)
  // without scanning the whole state.obstacles map every frame
  furnaces: Map<string, Point>;
  // campfire counterparts of smelters/furnaces above — see systems/cooking.ts
  campfireJobs: Map<string, CampfireJob>;
  campfires: Map<string, Point>;
  // in-progress fishingRod catches, keyed by the water tile fished — see
  // systems/fishing.ts
  fishingJobs: Map<string, FishingJob>;
  // every tree obstacle (the trunk cell), same kept-in-sync-by-setObstacle
  // pattern as furnaces above — lets the per-frame y-sorted render pass
  // draw each tree's canopy, and attemptPlayerAttack/updateProjectiles
  // apply damage to one, without scanning the whole state.obstacles map
  // every frame
  trees: Map<string, Tree>;
  cacti: Map<string, Cactus>;
  // every berryBush obstacle, same kept-in-sync-by-setObstacle pattern as
  // furnaces/trees/cacti above — lets updateBerryBushes (systems/farming.ts)
  // grow berries without scanning the whole state.obstacles map every tick
  berryBushes: Map<string, BerryBush>;
  enemies: Enemy[];
  player: Player;
  floatingTexts: FloatingText[];
  projectiles: Projectile[];
  footprints: Footprint[];

  zoomIndex: number;
  VP_W: number;
  VP_H: number;
  mapOpen: boolean;
  hoveredTile: Point | null;
}
