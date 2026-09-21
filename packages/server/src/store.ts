/**
 * Where a table lives between sessions.
 *
 * One SQLite file for state, a directory of content-addressed files for map
 * images. Both under `DATA_DIR`, so a backup is a copy of one directory and a
 * restore is the reverse — which is the whole reason images are not blobs in
 * the database.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { RoomState } from '@vtt/core'
import { migrateRoom } from '@vtt/core'

export interface StoredRoom {
  code: string
  gmKey: string
  state: RoomState
  createdAt: number
}

export class Store {
  #db: Database.Database
  #assetDir: string

  constructor(dbPath: string, assetDir: string) {
    this.#assetDir = assetDir
    mkdirSync(dirname(dbPath), { recursive: true })
    mkdirSync(assetDir, { recursive: true })

    this.#db = new Database(dbPath)
    // Write-ahead logging: a reader never blocks the writer, which matters
    // when an export streams while the table is being played on.
    this.#db.pragma('journal_mode = WAL')
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS room (
        code TEXT PRIMARY KEY,
        gm_key TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset (
        id TEXT PRIMARY KEY,
        room TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS asset_by_room ON asset (room);
    `)
  }

  close(): void {
    this.#db.close()
  }

  // --- Rooms -----------------------------------------------------------------

  createRoom(code: string, gmKey: string, state: RoomState): void {
    this.#db
      .prepare('INSERT INTO room (code, gm_key, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(code, gmKey, JSON.stringify(state), Date.now(), Date.now())
  }

  roomExists(code: string): boolean {
    return this.#db.prepare('SELECT 1 FROM room WHERE code = ?').get(code) !== undefined
  }

  loadRoom(code: string): StoredRoom | null {
    const row = this.#db.prepare('SELECT code, gm_key, state, created_at FROM room WHERE code = ?').get(code) as
      { code: string; gm_key: string; state: string; created_at: number } | undefined
    if (!row) return null

    // Anything read off disk may predate the current shape.
    return {
      code: row.code,
      gmKey: row.gm_key,
      state: migrateRoom(JSON.parse(row.state)),
      createdAt: row.created_at,
    }
  }

  saveRoom(code: string, state: RoomState): void {
    this.#db
      .prepare('UPDATE room SET state = ?, updated_at = ? WHERE code = ?')
      .run(JSON.stringify(state), Date.now(), code)
  }

  // --- Assets ----------------------------------------------------------------

  /**
   * Stores an image by the hash of its bytes, so the same map uploaded twice
   * costs one file, and an id can never point at something it did not name.
   */
  putAsset(room: string, bytes: Uint8Array, type: string): string {
    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    const path = this.#assetPath(id)
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, bytes)
    }
    this.#db
      .prepare('INSERT OR REPLACE INTO asset (id, room, type, size, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, room, type, bytes.byteLength, Date.now())
    return id
  }

  getAsset(id: string): { bytes: Buffer; type: string } | null {
    const row = this.#db.prepare('SELECT type FROM asset WHERE id = ?').get(id) as { type: string } | undefined
    if (!row) return null
    const path = this.#assetPath(id)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return { bytes: readFileSync(path), type: row.type }
  }

  assetType(id: string): string | null {
    const row = this.#db.prepare('SELECT type FROM asset WHERE id = ?').get(id) as { type: string } | undefined
    return row?.type ?? null
  }

  /** Fanned out two levels, so a campaign's worth of maps is not one flat directory. */
  #assetPath(id: string): string {
    return join(this.#assetDir, id.slice(0, 2), id.slice(2, 4), id)
  }
}
