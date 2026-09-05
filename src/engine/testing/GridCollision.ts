import type { CollisionQuery, PathFinder, Tile } from '../Collision'

/**
 * Simple open grid with a set of blocked tiles, for engine unit tests. The
 * pathfinder is a BFS over 8 directions with corner cutting disallowed, which
 * is close enough to the client for behavioural tests.
 */
export class GridCollision implements CollisionQuery, PathFinder {
  readonly width: number
  readonly height: number
  private readonly blocked = new Set<number>()

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  block(x: number, y: number): void {
    this.blocked.add(this.key(x, y))
  }

  private key(x: number, y: number): number {
    return y * this.width + x
  }

  private isBlocked(x: number, y: number): boolean {
    return x < 0 || y < 0 || x >= this.width || y >= this.height || this.blocked.has(this.key(x, y))
  }

  canStand(x: number, y: number, size: number): boolean {
    for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) if (this.isBlocked(x + dx, y + dy)) return false
    return true
  }

  canStep(x: number, y: number, size: number, dx: number, dy: number): boolean {
    if (!this.canStand(x + dx, y + dy, size)) return false
    if (dx !== 0 && dy !== 0) {
      // No corner cutting.
      if (!this.canStand(x + dx, y, size) || !this.canStand(x, y + dy, size)) return false
    }
    return true
  }

  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    // Bresenham through blocked tiles.
    let x = fromX
    let y = fromY
    const dx = Math.abs(toX - fromX)
    const dy = Math.abs(toY - fromY)
    const sx = fromX < toX ? 1 : -1
    const sy = fromY < toY ? 1 : -1
    let err = dx - dy
    while (x !== toX || y !== toY) {
      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x += sx
      }
      if (e2 < dx) {
        err += dx
        y += sy
      }
      if ((x !== toX || y !== toY) && this.isBlocked(x, y)) return false
    }
    return true
  }

  findPath(fromX: number, fromY: number, size: number, destX: number, destY: number): Tile[] {
    const start = this.key(fromX, fromY)
    const goal = this.key(destX, destY)
    if (start === goal) return []
    const prev = new Map<number, number>()
    const queue: number[] = [start]
    prev.set(start, -1)
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    ] as const
    let found = false
    while (queue.length) {
      const k = queue.shift()!
      const x = k % this.width
      const y = Math.floor(k / this.width)
      if (k === goal) {
        found = true
        break
      }
      for (const [dx, dy] of dirs) {
        if (!this.canStep(x, y, size, dx, dy)) continue
        const nk = this.key(x + dx, y + dy)
        if (prev.has(nk)) continue
        prev.set(nk, k)
        queue.push(nk)
      }
    }
    if (!found) return []
    const path: Tile[] = []
    for (let k = goal; k !== start; k = prev.get(k)!) {
      path.push({ x: k % this.width, y: Math.floor(k / this.width) })
    }
    return path.reverse()
  }
}
