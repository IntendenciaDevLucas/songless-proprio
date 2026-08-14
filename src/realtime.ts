import { createClient, type RealtimeChannel } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const client = url && key ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } },
}) : null

export type GameEvent =
  | { type: 'join'; name: string; clientId: string }
  | { type: 'joined'; room: string; clientId: string; playerIndex: number; names: string[] }
  | { type: 'lobby'; names: string[]; connected: number; capacity: number }
  | { type: 'room_full'; clientId: string }
  | { type: 'game'; round: number; total: number; seconds: number; playing: boolean; revealed: boolean; scores: number[]; names: string[] }
  | { type: 'buzz'; clientId: string }
  | { type: 'buzz_granted'; clientId: string }
  | { type: 'buzz_denied'; clientId: string }
  | { type: 'answer'; text: string; clientId: string }
  | { type: 'result'; player: number; kind: 'song' | 'artist' | 'wrong'; points: number; song?: string; artist?: string }
  | { type: 'room_closed' }

export function isRealtimeConfigured() { return Boolean(client) }

export function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), value => alphabet[value % alphabet.length]).join('')
}

export function createClientId() { return crypto.randomUUID() }

export function connectRoom(room: string, onEvent: (event: GameEvent) => void, onStatus: (status: string) => void) {
  if (!client) throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.')
  const channel = client.channel(`songless:${room.toUpperCase()}`, {
    config: { broadcast: { self: false, ack: true }, presence: { key: crypto.randomUUID() } },
  })
  channel.on('broadcast', { event: 'game-event' }, ({ payload }) => onEvent(payload as GameEvent))
  channel.subscribe(status => onStatus(status))
  return channel
}

export async function sendEvent(channel: RealtimeChannel, event: GameEvent) {
  const result = await channel.send({ type: 'broadcast', event: 'game-event', payload: event })
  if (result !== 'ok') throw new Error('Falha de comunicação com a sala. Tente novamente.')
}

export async function leaveRoom(channel: RealtimeChannel | null) {
  if (channel && client) await client.removeChannel(channel)
}

export type { RealtimeChannel }
