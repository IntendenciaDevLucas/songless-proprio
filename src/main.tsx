import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, ChevronRight, Clock3, Copy, Gamepad2, Link2, LogOut, Monitor, Music2, Play, RefreshCw, RotateCcw, Speaker, Trophy, Users, Wifi, X } from 'lucide-react'
import * as spotify from './spotify'
import type { Playlist, SpotifyPlayer, Track } from './types'
import type { SpotifyDevice } from './spotify'
import * as realtime from './realtime'
import type { GameEvent, RealtimeChannel } from './realtime'
import './styles.css'

type Screen = 'home' | 'setup' | 'game' | 'result' | 'join' | 'guest'
type OnlineRole = 'local' | 'host' | 'guest'
type Player = { name: string; score: number; color: string }
const ROUND_SECONDS = 30
const PLAYER_COLORS = ['green', 'violet', 'cyan', 'orange', 'pink', 'blue', 'yellow', 'red', 'mint', 'purple']

function shuffle<T>(input: T[]) {
  const arr = [...input]
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]] }
  return arr
}

function normalizeAnswer(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(feat|ft|featuring|remaster(ed)?|ao vivo|live|radio edit|version|versao)\b.*$/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function answerMatches(input: string, expected: string) {
  const answer = normalizeAnswer(input)
  const target = normalizeAnswer(expected)
  if (!answer || answer.length < 2) return false
  if (answer === target) return true
  return answer.length >= 5 && target.length >= 5 && (target.includes(answer) || answer.includes(target))
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [onlineRole, setOnlineRole] = useState<OnlineRole>('local')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [guestName, setGuestName] = useState('Jogador 2')
  const [roomStatus, setRoomStatus] = useState('')
  const [guestConnected, setGuestConnected] = useState(false)
  const [roomCapacity, setRoomCapacity] = useState(2)
  const [guestPlayerIndex, setGuestPlayerIndex] = useState(1)
  const [guestGame, setGuestGame] = useState<{ round: number; total: number; seconds: number; playing: boolean; revealed: boolean; scores: number[]; names: string[] } | null>(null)
  const [guestGranted, setGuestGranted] = useState(false)
  const [guestBuzzLocked, setGuestBuzzLocked] = useState<{ clientId: string; player: number } | null>(null)
  const [guestAnswer, setGuestAnswer] = useState('')
  const [guestResult, setGuestResult] = useState<GameEvent | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const clientIdRef = useRef(realtime.createClientId())
  const remoteBuzzRef = useRef<(clientId: string) => void>(() => undefined)
  const remoteAnswerRef = useRef<(text: string, clientId: string) => void>(() => undefined)
  const participantMapRef = useRef(new Map<string, number>())
  const buzzLockedRef = useRef(false)
  const capacityRef = useRef(2)
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selected, setSelected] = useState<Playlist[]>([])
  const [players, setPlayers] = useState<Player[]>([
    { name: 'Jogador 1', score: 0, color: 'green' }, { name: 'Jogador 2', score: 0, color: 'violet' },
  ])
  const [roundCount, setRoundCount] = useState(10)
  const [tracks, setTracks] = useState<Track[]>([])
  const [round, setRound] = useState(0)
  const [seconds, setSeconds] = useState(ROUND_SECONDS)
  const [playing, setPlaying] = useState(false)
  const [answering, setAnswering] = useState<number | null>(null)
  const [attempted, setAttempted] = useState<boolean[]>([false, false])
  const [revealed, setRevealed] = useState(false)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'song' | 'artist' | 'wrong'; points: number; player: number } | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [devices, setDevices] = useState<SpotifyDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState('browser')
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [playbackNotice, setPlaybackNotice] = useState('')
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const guestDeviceIdRef = useRef('')
  const deadlineRef = useRef(0)

  const current = tracks[round]
  useEffect(() => {
    ;(async () => {
      try {
        const returnedFromSpotify = await spotify.handleCallback()
        const token = await spotify.getToken()
        setConnected(Boolean(token))
        if (token) setPlaylists(await spotify.getPlaylists())
        if (returnedFromSpotify) {
          const pendingRoom = sessionStorage.getItem('songless_pending_room')
          const pendingName = sessionStorage.getItem('songless_pending_name')
          if (pendingRoom) {
            setJoinCode(pendingRoom)
            if (pendingName) setGuestName(pendingName)
            sessionStorage.removeItem('songless_pending_room')
            sessionStorage.removeItem('songless_pending_name')
            setScreen('join')
          }
        }
      } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao conectar.') }
      finally { setLoading(false) }
    })()
    const sharedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase()
    if (sharedRoom) { setJoinCode(sharedRoom); setScreen('join') }
    return () => { playerRef.current?.disconnect(); realtime.leaveRoom(channelRef.current) }
  }, [])

  async function broadcast(event: GameEvent) {
    if (channelRef.current) await realtime.sendEvent(channelRef.current, event).catch(e => setError(e.message))
  }

  function roomEvent(role: OnlineRole, code: string, event: GameEvent) {
    if (role === 'host') {
      if (event.type === 'join') {
        const existing = participantMapRef.current.get(event.clientId)
        const used = new Set(participantMapRef.current.values())
        const freeIndex = existing ?? Array.from({ length: capacityRef.current - 1 }, (_, index) => index + 1).find(index => !used.has(index))
        if (freeIndex === undefined) { broadcast({ type: 'room_full', clientId: event.clientId }); return }
        participantMapRef.current.set(event.clientId, freeIndex)
        setPlayers(old => {
          const next = [...old]
          while (next.length <= freeIndex) next.push({ name: `Jogador ${next.length + 1}`, score: 0, color: PLAYER_COLORS[next.length] })
          next[freeIndex] = { ...next[freeIndex], name: event.name }
          queueMicrotask(() => {
            broadcast({ type: 'joined', room: code, clientId: event.clientId, playerIndex: freeIndex, names: next.map(player => player.name) })
            broadcast({ type: 'lobby', names: next.map(player => player.name), connected: participantMapRef.current.size + 1, capacity: capacityRef.current })
          })
          return next
        })
        setGuestConnected(true)
      } else if (event.type === 'buzz') remoteBuzzRef.current(event.clientId)
      else if (event.type === 'answer') remoteAnswerRef.current(event.text, event.clientId)
      return
    }
    if (role === 'guest') {
      if (event.type === 'joined' && event.clientId === clientIdRef.current) { setGuestConnected(true); setGuestPlayerIndex(event.playerIndex); setPlayers(event.names.map((name, index) => ({ name, score: 0, color: PLAYER_COLORS[index] }))); setScreen('guest') }
      else if (event.type === 'lobby') setPlayers(event.names.map((name, index) => ({ name, score: 0, color: PLAYER_COLORS[index] })))
      else if (event.type === 'room_full' && event.clientId === clientIdRef.current) { setError('Esta sala já atingiu o limite de jogadores.'); setScreen('join') }
      else if (event.type === 'game') { setGuestGame(event); setScreen('guest'); setGuestResult(null); if (event.playing || event.revealed) setGuestBuzzLocked(null) }
      else if (event.type === 'playback') {
        if (event.action === 'play' && guestDeviceIdRef.current) {
          setPlaybackNotice('Iniciando áudio sincronizado…')
          spotify.playTrack(guestDeviceIdRef.current, event.uri, event.positionMs)
            .then(() => setPlaybackNotice('Áudio sincronizado neste aparelho'))
            .catch(e => setError(`Spotify deste aparelho: ${e.message}`))
        } else if (event.action === 'pause') playerRef.current?.pause().catch(e => setError(`Spotify deste aparelho: ${e.message}`))
        else if (event.action === 'resume') playerRef.current?.resume().catch(e => setError(`Spotify deste aparelho: ${e.message}`))
      }
      else if (event.type === 'buzz_locked') setGuestBuzzLocked({ clientId: event.clientId, player: event.player })
      else if (event.type === 'buzz_granted' && event.clientId === clientIdRef.current) { setGuestGranted(true); setGuestAnswer('') }
      else if (event.type === 'buzz_denied' && event.clientId === clientIdRef.current) { setGuestBuzzLocked(null); setError('Outro jogador apertou primeiro.') }
      else if (event.type === 'result') {
        setGuestGranted(false); setGuestResult(event)
        if (event.kind === 'wrong') setGuestBuzzLocked(null)
        setGuestGame(old => old ? { ...old, playing: event.kind === 'wrong', revealed: event.kind !== 'wrong', scores: old.scores.map((score, index) => index === event.player ? score + event.points : score) } : old)
      } else if (event.type === 'room_closed') { setError('O anfitrião encerrou a sala.'); setScreen('home') }
    }
  }

  async function connectOnline(role: 'host' | 'guest', code: string) {
    await realtime.leaveRoom(channelRef.current)
    setOnlineRole(role); setRoomCode(code.toUpperCase()); setRoomStatus('Conectando…')
    const channel = realtime.connectRoom(code, event => roomEvent(role, code, event), status => {
      setRoomStatus(status === 'SUBSCRIBED' ? 'Conectado' : status)
      if (status === 'SUBSCRIBED' && role === 'guest') realtime.sendEvent(channel, { type: 'join', name: guestName.trim(), clientId: clientIdRef.current })
    })
    channelRef.current = channel
  }

  async function createOnlineGame() {
    if (!realtime.isRealtimeConfigured()) { setError('Configure as variáveis do Supabase no arquivo .env.'); return }
    const code = realtime.generateRoomCode()
    capacityRef.current = roomCapacity
    participantMapRef.current.clear()
    setPlayers([{ ...players[0], score: 0, color: PLAYER_COLORS[0] }])
    setOnlineRole('host'); setRoomCode(code); setGuestConnected(false); setScreen('setup')
    await connectOnline('host', code)
  }

  async function enterRoom(event: React.FormEvent) {
    event.preventDefault()
    if (joinCode.trim().length < 6 || !guestName.trim()) return
    if (!connected) {
      sessionStorage.setItem('songless_pending_room', joinCode.trim().toUpperCase())
      sessionStorage.setItem('songless_pending_name', guestName.trim())
      await spotify.login()
      return
    }
    setLoading(true); setError('')
    try {
      let playback: { player: SpotifyPlayer; deviceId: string }
      try {
        playback = await spotify.createPlayer(setError)
        setPlaybackNotice('Áudio sincronizado neste navegador')
      } catch {
        const fallback = await spotify.createDesktopFallback()
        playback = fallback
        setPlaybackNotice(`Áudio sincronizado em: ${fallback.deviceName}`)
      }
      playerRef.current = playback.player
      guestDeviceIdRef.current = playback.deviceId
      setScreen('guest')
      await connectOnline('guest', joinCode.trim())
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível preparar o Spotify deste aparelho.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (screen === 'setup' && connected) refreshDevices()
  }, [screen, connected])

  async function refreshDevices() {
    setLoadingDevices(true)
    try {
      const available = await spotify.getDevices()
      setDevices(available)
      if (selectedDevice !== 'browser' && !available.some(device => device.id === selectedDevice)) setSelectedDevice('browser')
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível listar os dispositivos.') }
    finally { setLoadingDevices(false) }
  }

  useEffect(() => {
    if (!playing || revealed) return
    const tick = () => {
      const left = Math.max(0, (deadlineRef.current - performance.now()) / 1000)
      setSeconds(left)
      if (left <= 0) {
        setPlaying(false); setRevealed(true); playerRef.current?.pause()
        if (onlineRole === 'host') broadcast({ type: 'playback', action: 'pause' })
      }
    }
    tick(); const timer = window.setInterval(tick, 50)
    return () => clearInterval(timer)
  }, [playing, revealed])

  useEffect(() => {
    if (onlineRole !== 'guest' || !guestGame?.playing || guestGranted) return
    const timer = window.setInterval(() => setGuestGame(old => old ? { ...old, seconds: Math.max(0, old.seconds - .1) } : old), 100)
    return () => clearInterval(timer)
  }, [onlineRole, guestGame?.playing, guestGranted])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (screen !== 'game' || event.repeat || answering !== null || revealed || !playing) return
      if (event.key.toLowerCase() === 'a') buzz(0)
      if (event.key.toLowerCase() === 'l' && onlineRole === 'local') buzz(1)
    }
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey)
  }, [screen, answering, revealed, playing, attempted])

  async function connect() {
    setError('')
    try { await spotify.login() } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao conectar.') }
  }

  async function prepareGame() {
    if (!selected.length) return
    setLoading(true); setError('')
    try {
      const lists = await Promise.all(selected.map(list => spotify.getPlaylistTracks(list.id)))
      const all = [...new Map(lists.flat().map(track => [track.id, track])).values()]
      if (all.length < 4) throw new Error('As playlists selecionadas precisam ter pelo menos 4 músicas disponíveis.')
      const gameTracks = shuffle(all).slice(0, Math.min(roundCount, all.length))
      let playback: { player: SpotifyPlayer; deviceId: string }
      if (selectedDevice !== 'browser') {
        const fallback = await spotify.createDesktopFallback(selectedDevice)
        playback = fallback
        setPlaybackNotice(`Áudio reproduzido em: ${fallback.deviceName}`)
      } else {
        try {
          playback = await spotify.createPlayer(setError)
          setPlaybackNotice('Áudio reproduzido neste navegador')
        } catch (sdkError) {
          const fallback = await spotify.createDesktopFallback()
          playback = fallback
          setPlaybackNotice(`Player do navegador indisponível · áudio em: ${fallback.deviceName}`)
        }
      }
      const { player, deviceId: readyDeviceId } = playback
      playerRef.current = player
      setDeviceId(readyDeviceId)
      setTracks(gameTracks); setRound(0); setPlayers(p => p.map(x => ({ ...x, score: 0 })))
      setScreen('game'); resetRound()
      if (onlineRole === 'host') broadcast({ type: 'game', round: 0, total: gameTracks.length, seconds: ROUND_SECONDS, playing: false, revealed: false, scores: [0, 0], names: players.map(player => player.name) })
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível iniciar.') }
    finally { setLoading(false) }
  }

  function resetRound() {
    buzzLockedRef.current = false
    setSeconds(ROUND_SECONDS); setPlaying(false); setAnswering(null)
    setAttempted(players.map(() => false)); setRevealed(false); setFeedback(null); setAnswer('')
  }

  async function startMusic() {
    if (!current || !deviceId) { setError('O player ainda está conectando. Aguarde um instante.'); return }
    try {
      await spotify.playTrack(deviceId, current.uri)
      buzzLockedRef.current = false
      deadlineRef.current = performance.now() + seconds * 1000
      setPlaying(true)
      if (onlineRole === 'host') {
        await broadcast({ type: 'playback', action: 'play', uri: current.uri, positionMs: 0 })
        await broadcast({ type: 'game', round, total: tracks.length, seconds, playing: true, revealed: false, scores: players.map(player => player.score), names: players.map(player => player.name) })
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao tocar a música.') }
  }

  async function buzz(index: number) {
    if (attempted[index] || buzzLockedRef.current) return
    buzzLockedRef.current = true
    if (onlineRole === 'host') await broadcast({ type: 'buzz_locked', clientId: 'host', player: index })
    setPlaying(false); await playerRef.current?.pause()
    if (onlineRole === 'host') {
      await broadcast({ type: 'playback', action: 'pause' })
      await broadcast({ type: 'game', round, total: tracks.length, seconds, playing: false, revealed: false, scores: players.map(player => player.score), names: players.map(player => player.name) })
    }
    setAnswering(index); setAnswer('')
  }

  remoteBuzzRef.current = async clientId => {
    const playerIndex = participantMapRef.current.get(clientId)
    if (playerIndex === undefined || screen !== 'game' || !playing || revealed || answering !== null || attempted[playerIndex] || buzzLockedRef.current) { broadcast({ type: 'buzz_denied', clientId }); return }
    buzzLockedRef.current = true
    await broadcast({ type: 'buzz_locked', clientId, player: playerIndex })
    setPlaying(false); await playerRef.current?.pause()
    await broadcast({ type: 'playback', action: 'pause' })
    await broadcast({ type: 'game', round, total: tracks.length, seconds, playing: false, revealed: false, scores: players.map(player => player.score), names: players.map(player => player.name) })
    setAnswering(playerIndex); setAnswer('')
    await broadcast({ type: 'buzz_granted', clientId })
  }

  async function submitAnswer(event: React.FormEvent) {
    event.preventDefault()
    if (answering === null) return
    await submitAnswerValue(answer, answering)
  }

  async function submitAnswerValue(value: string, playerIndex: number) {
    if (!current) return
    const gotSong = answerMatches(value, current.name)
    const gotArtist = !gotSong && current.artists.some(artist => answerMatches(value, artist.name))
    const kind = gotSong ? 'song' : gotArtist ? 'artist' : 'wrong'
    const basePoints = Math.max(10, Math.round((seconds / ROUND_SECONDS) * 1000))
    const points = gotSong ? basePoints : gotArtist ? Math.round(basePoints / 2) : 0
    setAttempted(prev => prev.map((v, i) => i === playerIndex ? true : v))
    setFeedback({ kind, points, player: playerIndex })
    if (onlineRole === 'host') broadcast({ type: 'result', player: playerIndex, kind, points, ...(kind !== 'wrong' ? { song: current.name, artist: current.artists.map(item => item.name).join(', ') } : {}) })
    if (gotSong || gotArtist) {
      setPlayers(prev => prev.map((p, i) => i === playerIndex ? { ...p, score: p.score + points } : p))
      setRevealed(true); setAnswering(null)
    } else {
      setAnswering(null)
      const attemptsAfter = attempted.map((value, index) => index === playerIndex ? true : value)
      if (attemptsAfter.every(Boolean)) {
        setRevealed(true)
        if (onlineRole === 'host') broadcast({ type: 'game', round, total: tracks.length, seconds, playing: false, revealed: true, scores: players.map(player => player.score), names: players.map(player => player.name) })
      } else {
        buzzLockedRef.current = false
        deadlineRef.current = performance.now() + seconds * 1000; await playerRef.current?.resume(); setPlaying(true)
        if (onlineRole === 'host') {
          await broadcast({ type: 'playback', action: 'resume' })
          await broadcast({ type: 'game', round, total: tracks.length, seconds, playing: true, revealed: false, scores: players.map(player => player.score), names: players.map(player => player.name) })
        }
      }
    }
  }

  remoteAnswerRef.current = (text, clientId) => {
    const playerIndex = participantMapRef.current.get(clientId)
    if (playerIndex !== undefined) submitAnswerValue(text, playerIndex)
  }

  function nextRound() {
    if (round + 1 >= tracks.length) { setScreen('result'); playerRef.current?.pause(); return }
    const next = round + 1
    setRound(next); resetRound()
    if (onlineRole === 'host') broadcast({ type: 'game', round: next, total: tracks.length, seconds: ROUND_SECONDS, playing: false, revealed: false, scores: players.map(player => player.score), names: players.map(player => player.name) })
  }

  const bestScore = Math.max(...players.map(player => player.score))
  const leaders = players.map((player, index) => ({ ...player, index })).filter(player => player.score === bestScore)
  const winner = leaders.length === 1 ? leaders[0].index : null

  if (loading) return <main className="center"><div className="loader"/><p>Preparando o palco…</p></main>

  return <div className="app">
    <header><button className="brand" onClick={() => setScreen('home')}><span><Music2 size={21}/></span>SONGLESS</button>{connected && <button className="ghost small" onClick={() => { spotify.logout(); setConnected(false); setScreen('home') }}><LogOut size={16}/> Sair</button>}</header>
    {error && <div className="toast"><X size={18}/><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
    {playbackNotice && screen === 'game' && <div className="toast notice"><Music2 size={18}/><span>{playbackNotice}</span><button onClick={() => setPlaybackNotice('')}>×</button></div>}

    {screen === 'home' && <main className="hero">
      <div className="eyebrow"><span/> O DESAFIO MUSICAL</div>
      <h1>Você conhece<br/><em>essa música?</em></h1>
      <p>Desafie um amigo, dispute cada segundo e prove quem realmente conhece a playlist.</p>
      {!connected ? <button className="primary big" onClick={connect} disabled={!spotify.isConfigured()}><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm5.04 15.87a.69.69 0 0 1-.95.23c-2.6-1.59-5.87-1.95-9.72-1.07a.69.69 0 1 1-.31-1.35c4.21-.96 7.83-.55 10.75 1.23.33.2.43.63.23.96Zm1.35-3a.86.86 0 0 1-1.18.28c-2.97-1.83-7.5-2.36-11.01-1.29a.86.86 0 1 1-.5-1.65c4.02-1.22 9.01-.63 12.41 1.46.4.25.53.78.28 1.2Zm.11-3.12C14.94 8.63 9.06 8.43 5.66 9.46a1.03 1.03 0 1 1-.6-1.97c3.9-1.18 10.4-.94 14.5 1.5a1.03 1.03 0 0 1-1.06 1.76Z"/></svg>Conectar com Spotify</button> : <><div className="capacity-card"><div className="capacity-title"><span><Users size={17}/></span><div><b>Tamanho da sala</b><small>Até {roomCapacity} jogadores online</small></div></div><div className="capacity-options" role="group" aria-label="Máximo de jogadores">{Array.from({ length: 9 }, (_, index) => index + 2).map(value => <button key={value} className={roomCapacity === value ? 'active' : ''} aria-pressed={roomCapacity === value} onClick={() => setRoomCapacity(value)}>{value}</button>)}</div></div><div className="mode-actions"><button className="primary big" onClick={() => { setOnlineRole('local'); setPlayers([{ name: 'Jogador 1', score: 0, color: 'green' }, { name: 'Jogador 2', score: 0, color: 'violet' }]); setScreen('setup') }}><Users size={19}/> Jogar no mesmo PC</button><button className="ghost big online" onClick={createOnlineGame}><Wifi size={19}/> Criar sala online</button></div></>}
      <button className="join-link" onClick={() => setScreen('join')}><Link2 size={15}/> Entrar em uma sala</button>
      {!spotify.isConfigured() && <p className="config-note">Configure seu Client ID no arquivo <code>.env</code> para começar.</p>}
      <div className="features"><span><Users/> 2 jogadores</span><span><Clock3/> Pontos por velocidade</span><span><Trophy/> 10 rodadas</span></div>
    </main>}

    {screen === 'join' && <main className="join-page center"><div className="eyebrow"><span/> PARTIDA ONLINE</div><h2>Entrar na sala</h2><p>Cada jogador precisa conectar uma conta Spotify Premium para ouvir a música sincronizada no próprio aparelho.</p><form onSubmit={enterRoom}><label><small>SEU NOME</small><input value={guestName} maxLength={18} onChange={event => setGuestName(event.target.value)} /></label><label><small>CÓDIGO DA SALA</small><input className="room-input" value={joinCode} maxLength={6} placeholder="AB12CD" onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}/></label><button className="primary big" disabled={joinCode.length !== 6 || !guestName.trim()}><Wifi/> {connected ? 'Entrar e preparar áudio' : 'Conectar Spotify e entrar'}</button></form></main>}

    {screen === 'guest' && <main className="guest-page page center"><div className="room-pill"><Wifi size={14}/> SALA {roomCode} · {roomStatus}</div>{!guestConnected || !guestGame ? <><div className="loader small-loader"/><h2>Aguardando o anfitrião…</h2><p>Deixe esta página aberta. A partida começará quando ele terminar a configuração.</p></> : <><div className="scorebar guest-scores">{guestGame.names.map((name, index) => <div className={`score ${index ? 'violet' : 'green'}`} key={index}><span>{name}</span><b>{guestGame.scores[index].toLocaleString('pt-BR')}</b></div>)}</div><p className="guest-round">RODADA {guestGame.round + 1} DE {guestGame.total}</p><div className="vinyl"><div><Music2/></div></div><p className="device-help">Áudio sincronizado com o Spotify deste aparelho.</p><div className="timer"><b>{guestGame.seconds.toFixed(1)}</b><small>SEGUNDOS</small></div>{guestGranted ? <form className="type-answer guest-answer" onSubmit={event => { event.preventDefault(); broadcast({ type: 'answer', text: guestAnswer, clientId: clientIdRef.current }); setGuestGranted(false) }}><h3>Sua vez! Digite a música ou artista</h3><div><Music2/><input autoFocus value={guestAnswer} onChange={event => setGuestAnswer(event.target.value)} placeholder="Sua resposta…"/><button className="primary" disabled={guestAnswer.trim().length < 2}>Enviar</button></div></form> : guestGame.playing && !guestGame.revealed ? <button className="remote-buzzer" disabled={Boolean(guestBuzzLocked)} onClick={() => { setGuestBuzzLocked({ clientId: clientIdRef.current, player: guestPlayerIndex }); broadcast({ type: 'buzz', clientId: clientIdRef.current }) }}><span>{guestBuzzLocked ? guestBuzzLocked.clientId === clientIdRef.current ? 'VOCÊ APERTOU!' : 'BLOQUEADO' : 'EU SEI!'}</span><small>{guestBuzzLocked ? `${guestGame.names[guestBuzzLocked.player] ?? 'Outro jogador'} apertou primeiro` : 'Aperte para responder'}</small></button> : <p className="waiting-round">Aguardando a música…</p>}{guestResult?.type === 'result' && <div className={`guest-feedback ${guestResult.kind}`}>{guestResult.kind === 'song' ? `Música certa! +${guestResult.points}` : guestResult.kind === 'artist' ? `Artista certo! +${guestResult.points}` : 'Resposta incorreta'}{guestResult.song && <small>{guestResult.song} · {guestResult.artist}</small>}</div>}</>}</main>}

    {screen === 'setup' && <main className="setup page">
      {onlineRole === 'host' && <div className="online-room"><div><small>CÓDIGO DA SALA</small><strong>{roomCode}</strong><button onClick={() => navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${roomCode}`)}><Copy size={15}/> Copiar link</button></div><span className={guestConnected ? 'connected' : ''}><i/>{players.length}/{roomCapacity} jogadores · {guestConnected ? 'sala pronta' : 'aguardando'}</span></div>}
      <div className="page-title"><div className="eyebrow"><span/> NOVA PARTIDA</div><h2>Prepare o jogo</h2><p>Escolha quem joga e quais playlists vão comandar a noite.</p></div>
      <section className="panel"><h3><span>1</span> Jogadores</h3><div className={`player-inputs ${onlineRole === 'host' ? 'online-players' : ''}`}>{players.map((p, i) => <label key={i} className={p.color}><small>{onlineRole === 'host' ? i === 0 ? 'ANFITRIÃO · TECLA A' : `JOGADOR ONLINE ${i + 1}` : `JOGADOR ${i + 1} · TECLA ${i ? 'L' : 'A'}`}</small><input value={p.name} maxLength={18} disabled={onlineRole === 'host' && i > 0} onChange={e => setPlayers(old => old.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}/></label>)}</div></section>
      <section className="panel"><div className="panel-heading"><h3><span>2</span> Playlists</h3>{selected.length > 0 && <strong>{selected.length} selecionada{selected.length > 1 ? 's' : ''} · {selected.reduce((sum, list) => sum + (list.items?.total ?? list.tracks?.total ?? 0), 0)} faixas</strong>}</div><div className="playlist-grid">{playlists.map(list => { const isSelected = selected.some(item => item.id === list.id); return <button key={list.id} className={`playlist ${isSelected ? 'selected' : ''}`} onClick={() => setSelected(old => isSelected ? old.filter(item => item.id !== list.id) : [...old, list])}>{list.images?.[0] ? <img src={list.images[0].url} alt=""/> : <div className="cover"><Music2/></div>}<span><b>{list.name}</b><small>{list.items?.total ?? list.tracks?.total ?? 0} músicas</small></span>{isSelected && <i><Check size={14}/></i>}</button> })}</div></section>
      <section className="panel"><div className="panel-heading"><h3><span>3</span> Saída de áudio</h3><button className="refresh-devices" onClick={refreshDevices} disabled={loadingDevices}><RefreshCw className={loadingDevices ? 'spinning' : ''} size={14}/> Atualizar dispositivos</button></div><p className="device-help">Para usar o computador, abra o aplicativo Spotify nele e toque qualquer música por alguns segundos.</p><div className="device-options"><button className={selectedDevice === 'browser' ? 'selected' : ''} onClick={() => setSelectedDevice('browser')}><Monitor/><span><b>Este navegador</b><small>Pode exigir conteúdo protegido/DRM</small></span>{selectedDevice === 'browser' && <Check/>}</button>{devices.map(device => <button key={device.id} className={selectedDevice === device.id ? 'selected' : ''} onClick={() => setSelectedDevice(device.id!)}>{device.type.toLowerCase() === 'computer' ? <Monitor/> : <Speaker/>}<span><b>{device.name}</b><small>{device.type}{device.is_active ? ' · ativo agora' : ''}</small></span>{selectedDevice === device.id && <Check/>}</button>)}</div></section>
      <section className="panel compact"><h3><span>4</span> Rodadas</h3><div className="round-options">{[5, 10, 15].map(n => <button className={roundCount === n ? 'active' : ''} onClick={() => setRoundCount(n)} key={n}>{n}</button>)}</div></section>
      <button className="primary big start" disabled={!selected.length || players.some(p => !p.name.trim()) || (onlineRole === 'host' && !guestConnected)} onClick={prepareGame}><Gamepad2/> Começar partida</button>
    </main>}

    {screen === 'game' && current && <main className="game page">
      <div className="scorebar">{players.map((p, i) => <div className={`score ${p.color}`} key={i}><span>{p.name}<small>TECLA {i ? 'L' : 'A'}</small></span><b>{p.score.toLocaleString('pt-BR')}</b></div>)}</div>
      <div className="roundline"><span>RODADA {round + 1} DE {tracks.length}</span><div>{tracks.map((_, i) => <i className={i < round ? 'done' : i === round ? 'now' : ''} key={i}/>)}</div></div>
      <section className="stage">
        <div className="vinyl"><div><Music2/></div></div>
        <p className="listen">{playing ? 'OUÇA COM ATENÇÃO…' : revealed ? 'RESPOSTA' : 'PRONTO PARA OUVIR?'}</p>
        <div className="timer"><b>{seconds.toFixed(1)}</b><small>SEGUNDOS</small></div>
        <div className="timebar"><i style={{ width: `${seconds / ROUND_SECONDS * 100}%` }}/></div>
        {!playing && !revealed && answering === null && <button className="primary big" onClick={startMusic}><Play fill="currentColor"/> Tocar música</button>}
        {playing && <><p className="answer-instruction">Sabe a resposta? Aperte sua tecla ou clique abaixo para digitar.</p><div className={`buzzers ${players.length > 2 ? 'many' : ''}`}>{players.map((p, i) => <button key={i} className={p.color} disabled={attempted[i] || (onlineRole === 'host' && i > 0)} onClick={() => buzz(i)}><kbd>{onlineRole === 'host' && i > 0 ? <Wifi size={15}/> : i ? 'L' : 'A'}</kbd><span>{onlineRole === 'host' && i > 0 ? `${p.name}: remoto` : attempted[i] ? 'Sem tentativa' : `${p.name}: responder`}</span></button>)}</div></>}
        {answering !== null && !(onlineRole === 'host' && answering > 0) && <form className="type-answer" onSubmit={submitAnswer}><h3><span className={players[answering].color}>{players[answering].name}</span>, digite o nome da música ou do artista</h3><p>Nome da música = pontuação completa · artista/banda = metade</p><div><Music2/><input autoFocus value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Sua resposta…" autoComplete="off"/><button className="primary" disabled={answer.trim().length < 2}>Confirmar</button></div></form>}
        {onlineRole === 'host' && answering !== null && answering > 0 && <div className="remote-wait"><Wifi/><b>{players[answering].name} apertou primeiro</b><span>Aguardando a resposta no dispositivo remoto…</span></div>}
        {feedback?.kind === 'wrong' && !revealed && <div className="feedback wrong"><X/> Não foi dessa vez, {players[feedback.player].name}!</div>}
        {revealed && <div className="reveal">{current.album.images[0] && <img src={current.album.images[0].url} alt="Capa do álbum"/>}<div>{feedback?.kind === 'song' ? <span className="correct"><Check/> Música certa · +{feedback.points} pontos</span> : feedback?.kind === 'artist' ? <span className="half"><Check/> Artista certo · +{feedback.points} pontos (metade)</span> : <span className="wrong-text">Tempo esgotado</span>}<h2>{current.name}</h2><p>{current.artists.map(a => a.name).join(', ')}</p><a href={current.external_urls.spotify} target="_blank" rel="noreferrer">Abrir no Spotify</a></div><button className="primary" onClick={nextRound}>{round + 1 >= tracks.length ? 'Ver resultado' : 'Próxima música'} <ChevronRight/></button></div>}
      </section>
    </main>}

    {screen === 'result' && <main className="result center"><div className="trophy"><Trophy/></div><div className="eyebrow"><span/> FIM DE JOGO <span/></div><h1>{winner === null ? 'Empate!' : `${players[winner].name} venceu!`}</h1><p>{winner === null ? 'Vocês conhecem essa playlist igualmente bem.' : 'O ouvido mais rápido da rodada.'}</p><div className="final-scores">{[...players].sort((a,b) => b.score-a.score).map((p, i) => <div className={p.color} key={p.name}><b>#{i+1}</b><span>{p.name}<small>{p.score.toLocaleString('pt-BR')} pontos</small></span>{i === 0 && <Trophy/>}</div>)}</div><div className="result-actions"><button className="primary big" onClick={() => { setScreen('game'); setRound(0); setPlayers(p => p.map(x => ({...x, score: 0}))); setTracks(t => shuffle(t)); resetRound() }}><RotateCcw/> Revanche</button><button className="ghost big" onClick={() => setScreen('setup')}>Trocar playlist</button></div></main>}
    <footer>As músicas são reproduzidas pelo Spotify. Spotify é marca registrada de seus respectivos proprietários.</footer>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
