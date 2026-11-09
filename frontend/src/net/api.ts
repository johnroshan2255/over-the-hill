import type { Bag } from './wire'
import type { Rules, WorldInfo } from './wire'

/**
 * THE SERVER'S API (backend/README.md) — the player's account and their worlds. The server is reached on the page's
 * own origin (`/v1`: the Vite dev / preview server passes it through — vite.config.ts), so a phone on the Wi-Fi gets it
 * the same way. The account is a name and a token kept in this browser (no passwords yet).
 */
export interface Account { id: string; name: string; token: string }
export interface WorldRow extends WorldInfo { online: number }

const KEY = 'overhill.player.v1'

export class ApiError extends Error {
  constructor(readonly status: number, msg: string) { super(msg) }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, "Can't reach the server")
  }
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* (not JSON: a proxy's error page) */ }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? (res.status >= 500 ? "The server isn't running" : `Error ${res.status}`))
  return data as T
}

export function loadAccount(): Account | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Account | null
    return a && a.id && a.token ? a : null
  } catch {
    return null
  }
}

function keep(a: Account): Account {
  try { localStorage.setItem(KEY, JSON.stringify(a)) } catch { /* (not kept) */ }
  return a
}

/** Signed in as `name`: the account kept here (renamed if the name changed), or a new one. */
export async function signIn(name: string): Promise<Account> {
  const have = loadAccount()
  if (have) {
    try {
      if (have.name !== name) {
        const me = await call<{ id: string; name: string }>('PATCH', '/v1/me', { name }, have.token)
        return keep({ ...have, name: me.name })
      }
      await call('GET', '/v1/me', undefined, have.token)
      return have
    } catch (e) {
      // (the server forgot us — a fresh database: a new account; anything else is the server's trouble)
      if (!(e instanceof ApiError) || e.status !== 401) throw e
    }
  }
  return keep(await call<Account>('POST', '/v1/players', { name }))
}

/** THE BOT's account (oth/Bot.ts): its own name and token, kept beside ours — never ours (the server would see one
 *  player twice). Named after its owner ("Asha · bot", ≤ 20 characters: the server's limit); a fresh one if the
 *  server forgot it. */
const BOT_KEY = 'overhill.bot.v1'
export async function botAccount(owner: string): Promise<Account> {
  const name = `${owner.trim().slice(0, 14) || 'Player'} · bot`
  let have: Account | null = null
  try { have = JSON.parse(localStorage.getItem(BOT_KEY) ?? 'null') as Account | null } catch { /* (none) */ }
  if (have?.token) {
    try {
      if (have.name !== name) have = { ...have, name: (await call<{ id: string; name: string }>('PATCH', '/v1/me', { name }, have.token)).name }
      else await call('GET', '/v1/me', undefined, have.token)
      try { localStorage.setItem(BOT_KEY, JSON.stringify(have)) } catch { /* (not kept) */ }
      return have
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e
    }
  }
  const a = await call<Account>('POST', '/v1/players', { name })
  try { localStorage.setItem(BOT_KEY, JSON.stringify(a)) } catch { /* (not kept) */ }
  return a
}

/** The build catalogue (backend catalog.rs): every piece, its name, its group, what it costs. */
export interface PieceInfo { kind: string; name: string; group: string; cost: Bag }
export const getCatalog = () => call<{ pieces: PieceInfo[]; carry: number }>('GET', '/v1/catalog')
export const listWorlds = (a: Account) => call<WorldRow[]>('GET', '/v1/worlds', undefined, a.token)
export const createWorld = (a: Account, name: string, map = 'valley', rules?: Partial<Rules>) => call<WorldRow>('POST', '/v1/worlds', { name, map, rules }, a.token)
export const joinWorld = (a: Account, code: string) => call<WorldRow>('POST', '/v1/worlds/join', { code }, a.token)

/** The world's WebSocket address (ws / wss as the page is). */
export function socketUrl(world: string, a: Account): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/v1/worlds/${encodeURIComponent(world)}/ws?token=${encodeURIComponent(a.token)}`
}

/** The co-op world to start in (the title screen's CO-OP → the game, across the module load). */
const COOP = 'overhill.coop'
export function requestCoop(world: string | null): void {
  try { if (world) sessionStorage.setItem(COOP, world); else sessionStorage.removeItem(COOP) } catch { /* (not kept) */ }
}
export function coopRequested(): string | null {
  try { return new URLSearchParams(location.search).get('coop') ?? sessionStorage.getItem(COOP) } catch { return null }
}
