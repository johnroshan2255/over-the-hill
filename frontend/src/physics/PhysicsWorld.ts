import RAPIER from '@dimforge/rapier3d-compat'

export type Rapier = typeof RAPIER

/** Collision groups: (membership << 16) | filter. See skills/physics. */
export const Groups = {
  Terrain: 0x0001,
  Static: 0x0002,
  Player: 0x0004,
  Monster: 0x0008,
  Vehicle: 0x0010,
  /** Pieces of broken props (gameplay/destruction): collide with everything but each other's tiny shards. */
  Debris: 0x0020,
  /** A car's EXACT body (its render mesh as a trimesh): rocks, trees, props, debris, monsters, the bike — never a
   *  static TRIMESH (terrain, road ribbon, formations, map ramps / bridges): two hollow shells have no inside, a ground
   *  triangle that slips into the body is pushed on from both sides and clamps the car (2026-10-21, "the car gets stuck
   *  all the time"). Those meet the car's convex hulls instead (VehicleSim). */
  VehicleMesh: 0x0040,
  /** Static trimeshes (rock formations, map ramps / bridges; also members of Static, so queries on Static still find
   *  them). Their filter leaves out VehicleMesh (STATIC_MESH_FILTER). */
  StaticMesh: 0x0080,
  /** The road ribbon (a trimesh over the heightfield, also a member of Terrain). */
  TerrainMesh: 0x0100,
  /** The desert's SLAB STACKS (a convex hull per slab, also members of Static and StaticMesh): the only thing a car's
   *  TYRE GUARDS meet (VehicleSim) — a tyre pushes off a slab's face instead of its ray starting inside the rock. */
  Slab: 0x0200,
} as const
export const group = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff)
/** What a static trimesh meets: everything but a car's body mesh (see Groups.VehicleMesh). */
export const STATIC_MESH_FILTER = 0xffff & ~Groups.VehicleMesh

export const FIXED_DT = 1 / 60

const MAX_SUBSTEPS = 4

/**
 * Thin owner of the Rapier world. Fixed 60 Hz step driven by an accumulator. (overhill: the world's colliders are
 * built by oth/Physics.ts — DARK's chunk / prop colliders are not part of this game.)
 */
export class PhysicsWorld {
  static rapier: Rapier | null = null

  static async load(): Promise<Rapier> {
    if (!PhysicsWorld.rapier) {
      await RAPIER.init()
      PhysicsWorld.rapier = RAPIER
    }
    return PhysicsWorld.rapier
  }

  readonly R: Rapier
  readonly world: RAPIER.World
  private accumulator = 0
  /** 0..1 blend between previous and current fixed step, for render interpolation. */
  alpha = 0
  stepMs = 0
  private readonly events: RAPIER.EventQueue
  /** Contact-force events of each step (collider handles, total force N). */
  onContactForce: ((h1: number, h2: number, force: number) => void) | null = null
  /** After every fixed step (and its events) — e.g. apply breaks before the next substep sees the collider. */
  afterStep: (() => void) | null = null

  constructor(R: Rapier) {
    this.R = R
    this.world = new R.World({ x: 0, y: -20, z: 0 })
    this.world.timestep = FIXED_DT
    this.events = new R.EventQueue(true)
  }

  /** Runs `fixedUpdate` 0..MAX_SUBSTEPS times, stepping the world after each. */
  advance(dt: number, fixedUpdate: (fdt: number) => void): void {
    this.accumulator = Math.min(this.accumulator + dt, FIXED_DT * MAX_SUBSTEPS)
    const t0 = performance.now()
    while (this.accumulator >= FIXED_DT) {
      fixedUpdate(FIXED_DT)
      this.world.step(this.events)
      if (this.onContactForce) this.events.drainContactForceEvents((e) => this.onContactForce!(e.collider1(), e.collider2(), e.totalForceMagnitude()))
      this.afterStep?.()
      this.accumulator -= FIXED_DT
    }
    this.alpha = this.accumulator / FIXED_DT
    this.stepMs = performance.now() - t0
  }

  private groundRay: RAPIER.Ray | null = null
  /**
   * The SOLID ground under (x, z) as the colliders see it — terrain heightfield AND static rock (cave floors, arches,
   * outcrops) — by a ray cast down from `fromY` (≤ 8 m). Use it to put things ON the ground: under a hillside cave
   * the terrain is carved 2+ m below the rock floor (`WorldFields.surface` / `groundAt` are that carved hole), so
   * anything placed by the height field sinks into the cave's floor. Start the ray below any roof (a cave tunnel
   * is ≥ 2 m tall: player feet + ~0.6 m). Vehicles and the player are ignored. `fallback` where nothing is hit
   * (no collider streamed in there). One ray: ~1–3 µs.
   */
  groundBelow(x: number, z: number, fromY: number, fallback: number): number {
    const ray = (this.groundRay ??= new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }))
    ray.origin.x = x
    ray.origin.y = fromY
    ray.origin.z = z
    const hit = this.world.castRay(ray, 8, true, undefined, group(0xffff, Groups.Terrain | Groups.Static))
    return hit ? fromY - hit.timeOfImpact : fallback
  }

  get bodyCount(): number {
    return this.world.bodies.len()
  }
  get colliderCount(): number {
    return this.world.colliders.len()
  }

  dispose(): void {
    this.world.free()
  }
}
