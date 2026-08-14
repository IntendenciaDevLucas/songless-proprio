export type SpotifyImage = { url: string; width?: number; height?: number }

export type Playlist = {
  id: string
  name: string
  description: string
  images: SpotifyImage[]
  owner: { id: string; display_name: string }
  items?: { total: number }
  tracks?: { total: number }
}

export type Track = {
  id: string
  uri: string
  name: string
  duration_ms: number
  external_urls: { spotify: string }
  artists: { name: string }[]
  album: { name: string; images: SpotifyImage[]; external_urls: { spotify: string } }
  is_playable?: boolean
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (config: {
        name: string
        getOAuthToken: (callback: (token: string) => void) => void
        volume: number
      }) => SpotifyPlayer
    }
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

export interface SpotifyPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  pause(): Promise<void>
  resume(): Promise<void>
  addListener(event: string, cb: (data: any) => void): boolean
}
