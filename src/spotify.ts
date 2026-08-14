import type { Playlist, SpotifyPlayer, Track } from './types'

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim()
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI || `${location.origin}/`
const TOKEN_KEY = 'songless_spotify_token'
const VERIFIER_KEY = 'songless_pkce_verifier'
const STATE_KEY = 'songless_oauth_state'

type TokenData = { access_token: string; refresh_token?: string; expires_at: number }

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

function randomString(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return base64url(bytes)
}

async function sha256(value: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
}

function storedToken(): TokenData | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') } catch { return null }
}

async function exchangeToken(body: URLSearchParams) {
  if (!CLIENT_ID) throw new Error('Client ID do Spotify não configurado.')
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  if (!response.ok) throw new Error('Não foi possível concluir o login no Spotify.')
  const token = await response.json()
  const previous = storedToken()
  const data: TokenData = {
    access_token: token.access_token,
    refresh_token: token.refresh_token || previous?.refresh_token,
    expires_at: Date.now() + token.expires_in * 1000,
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(data))
  return data.access_token
}

export async function login() {
  if (!CLIENT_ID) throw new Error('Crie o arquivo .env com VITE_SPOTIFY_CLIENT_ID.')
  const verifier = randomString(64)
  const state = randomString(24)
  localStorage.setItem(VERIFIER_KEY, verifier)
  localStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'playlist-read-private playlist-read-collaborative streaming user-read-private user-read-email user-modify-playback-state user-read-playback-state',
    code_challenge_method: 'S256',
    code_challenge: base64url(await sha256(verifier)),
    state,
  })
  location.href = `https://accounts.spotify.com/authorize?${params}`
}

export async function handleCallback() {
  const query = new URLSearchParams(location.search)
  const code = query.get('code')
  if (!code) return false
  if (query.get('state') !== localStorage.getItem(STATE_KEY)) throw new Error('Falha na validação de segurança do login.')
  const verifier = localStorage.getItem(VERIFIER_KEY)
  if (!verifier || !CLIENT_ID) throw new Error('Sessão de login expirada. Tente novamente.')
  await exchangeToken(new URLSearchParams({
    client_id: CLIENT_ID, grant_type: 'authorization_code', code,
    redirect_uri: REDIRECT_URI, code_verifier: verifier,
  }))
  localStorage.removeItem(VERIFIER_KEY)
  localStorage.removeItem(STATE_KEY)
  history.replaceState({}, '', location.pathname)
  return true
}

export async function getToken() {
  const token = storedToken()
  if (!token) return null
  if (token.expires_at > Date.now() + 60_000) return token.access_token
  if (!token.refresh_token || !CLIENT_ID) return null
  return exchangeToken(new URLSearchParams({
    client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: token.refresh_token,
  }))
}

export function logout() { localStorage.removeItem(TOKEN_KEY) }
export function isConfigured() { return Boolean(CLIENT_ID) }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken()
  if (!token) throw new Error('Sua sessão expirou. Conecte o Spotify novamente.')
  const response = await fetch(path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.error?.message || `Erro do Spotify (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export async function getPlaylists() {
  const profile = await api<{ id: string }>('/me')
  const first = await api<{ items: Playlist[]; next: string | null }>('/me/playlists?limit=50')
  const all = [...first.items]
  let next = first.next
  while (next && all.length < 200) {
    const page = await api<{ items: Playlist[]; next: string | null }>(next)
    all.push(...page.items); next = page.next
  }
  // Apps no modo Development do Spotify podem receber 403 ao consultar os itens
  // de playlists seguidas/editoriais. Playlists pertencentes ao usuário continuam
  // disponíveis para o fluxo do jogo.
  return all.filter(playlist => playlist.owner?.id === profile.id)
}

export async function getPlaylistTracks(id: string) {
  let next: string | null = `/playlists/${id}/items?limit=50&additional_types=track`
  const tracks: Track[] = []
  while (next) {
    // O endpoint atual usa `item`; `track` mantém compatibilidade com o formato antigo.
    let page: { items: { item?: Track; track?: Track }[]; next: string | null }
    try {
      page = await api(next)
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('forbidden')) {
        throw new Error('O Spotify bloqueou esta playlist. Use uma playlist criada pela sua própria conta e tente novamente.')
      }
      throw error
    }
    tracks.push(...page.items.map(entry => entry.item ?? entry.track).filter((track): track is Track =>
      Boolean(track?.id && track.uri && track.album && track.artists?.length && track.is_playable !== false)))
    next = page.next
  }
  return tracks
}

export async function createPlayer(onError: (message: string) => void) {
  const token = await getToken()
  if (!token) throw new Error('Faça login novamente.')
  let sdkReady: (() => void) | undefined
  const sdkPromise = new Promise<void>((resolve) => { sdkReady = resolve })
  // Registra o callback antes de inserir o script para não perder o evento em conexões rápidas.
  if (!window.Spotify) window.onSpotifyWebPlaybackSDKReady = () => sdkReady?.()
  if (!document.querySelector('#spotify-player-sdk')) {
    const script = document.createElement('script')
    script.id = 'spotify-player-sdk'; script.src = 'https://sdk.scdn.co/spotify-player.js'; script.async = true
    document.body.appendChild(script)
  }
  if (!window.Spotify) await Promise.race([
    sdkPromise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('O SDK do Spotify não carregou. Desative bloqueadores de conteúdo para 127.0.0.1 e tente novamente.')), 15_000)),
  ])
  const player: SpotifyPlayer = new window.Spotify!.Player({
    name: 'Songless', volume: 0.75, getOAuthToken: async cb => cb((await getToken()) || token),
  })
  let resolveDevice!: (deviceId: string) => void
  let rejectDevice!: (error: Error) => void
  const devicePromise = new Promise<string>((resolve, reject) => { resolveDevice = resolve; rejectDevice = reject })
  player.addListener('ready', ({ device_id }) => resolveDevice(device_id))
  player.addListener('initialization_error', ({ message }) => rejectDevice(new Error(`Falha ao iniciar o player: ${message}`)))
  player.addListener('authentication_error', ({ message }) => rejectDevice(new Error(`Falha de autenticação do player: ${message}`)))
  player.addListener('account_error', () => rejectDevice(new Error('O perfil conectado precisa ter Spotify Premium ativo.')))
  player.addListener('playback_error', ({ message }) => onError(message))
  const connected = await player.connect()
  if (!connected) throw new Error('Não foi possível iniciar o player do Spotify.')
  try {
    const deviceId = await Promise.race([
      devicePromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('O Spotify não criou o dispositivo de reprodução em 20 segundos. Verifique se a reprodução de conteúdo protegido está permitida no navegador.')), 20_000)),
    ])
    return { player, deviceId }
  } catch (error) {
    player.disconnect()
    throw error
  }
}

export type SpotifyDevice = {
  id: string | null
  is_active: boolean
  is_restricted: boolean
  name: string
  type: string
}

export async function getDevices() {
  return (await api<{ devices: SpotifyDevice[] }>('/me/player/devices')).devices
    .filter(device => !device.is_restricted && device.id)
}

export async function createDesktopFallback(preferredDeviceId?: string): Promise<{ player: SpotifyPlayer; deviceId: string; deviceName: string }> {
  const response = await api<{ devices: SpotifyDevice[] }>('/me/player/devices')
  const device = response.devices.find(item => item.id === preferredDeviceId && !item.is_restricted)
    ?? response.devices.find(item => item.type.toLowerCase() === 'computer' && !item.is_restricted && item.id)
    ?? response.devices.find(item => item.is_active && !item.is_restricted && item.id)
    ?? response.devices.find(item => !item.is_restricted && item.id)

  if (!device?.id) {
    throw new Error('Nenhum dispositivo disponível. Abra o Spotify no computador, toque uma música por alguns segundos e clique em Atualizar dispositivos.')
  }

  const deviceId = device.id
  const remotePlayer: SpotifyPlayer = {
    connect: async () => true,
    disconnect: () => undefined,
    pause: async () => api<void>(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' }),
    resume: async () => api<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' }),
    addListener: () => true,
  }

  return { player: remotePlayer, deviceId, deviceName: device.name }
}

export async function playTrack(deviceId: string, uri: string, positionMs = 0) {
  try {
    await api<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT', body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
    })
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('forbidden')) {
      throw new Error('Reprodução recusada (403). Esta conta precisa ser Premium e estar autorizada no User Management do aplicativo Spotify.')
    }
    throw error
  }
}
