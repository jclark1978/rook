import { useEffect, useMemo, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import rookCard from './assets/rook-card.jpg'
import './App.css'

type View = 'home' | 'lobby'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting'

type SeatId = 'T1P1' | 'T2P1' | 'T1P2' | 'T2P2'

type Seat = {
  id: SeatId
  label: string
  team: string
}

const seats: Seat[] = [
  { id: 'T1P1', label: 'T1P1', team: 'Team One' },
  { id: 'T2P1', label: 'T2P1', team: 'Team Two' },
  { id: 'T1P2', label: 'T1P2', team: 'Team One' },
  { id: 'T2P2', label: 'T2P2', team: 'Team Two' },
]

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const generateRoomCode = (length = 4) => {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

function App() {
  const [view, setView] = useState<View>('home')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [readyMap, setReadyMap] = useState<Record<SeatId, boolean>>(() => ({
    T1P1: false,
    T2P1: false,
    T1P2: false,
    T2P2: false,
  }))

  useEffect(() => {
    const socket: Socket = io('http://localhost:3001', {
      autoConnect: true,
    })

    setConnectionStatus(socket.connected ? 'connected' : 'connecting')

    const handleConnect = () => setConnectionStatus('connected')
    const handleDisconnect = () => setConnectionStatus('disconnected')
    const handleError = () => setConnectionStatus('disconnected')

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleError)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleError)
      socket.disconnect()
    }
  }, [])

  const statusLabel = useMemo(() => {
    if (connectionStatus === 'connected') return 'Connected'
    if (connectionStatus === 'connecting') return 'Connecting'
    return 'Disconnected'
  }, [connectionStatus])

  const handleCreateRoom = () => {
    const code = generateRoomCode()
    setRoomCode(code)
    setView('lobby')
  }

  const handleJoinRoom = () => {
    const trimmed = joinCode.trim().toUpperCase()
    if (!trimmed) return
    setRoomCode(trimmed)
    setView('lobby')
  }

  const toggleReady = (id: SeatId) => {
    setReadyMap((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src={rookCard} alt="" />
          </span>
          <div>
            <p className="brand-title">Rook Online</p>
            <p className="brand-subtitle">Table lobby prototype</p>
          </div>
        </div>
        <div className={`status-pill status-${connectionStatus}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      </header>

      {view === 'home' ? (
        <main className="home">
          <section className="hero">
            <div>
              <h1>Rook Online</h1>
              <p>
                Spin up a room, grab a seat, and get ready for partner play.
                This is the shell UI while the game logic comes online.
              </p>
            </div>
            <div className="hero-actions">
              <button className="primary" onClick={handleCreateRoom}>
                Create Room
              </button>
              <div className="join-block">
                <label htmlFor="joinCode">Join room</label>
                <div className="join-row">
                  <input
                    id="joinCode"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    placeholder="ROOM"
                    maxLength={6}
                  />
                  <button className="ghost" onClick={handleJoinRoom}>
                    Join
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="info-grid">
            <div className="info-card">
              <h2>Fast room flow</h2>
              <p>
                Create a room or jump into one with a short code. The lobby view
                below is the staging ground for the full multiplayer experience.
              </p>
            </div>
            <div className="info-card">
              <h2>Seat-ready layout</h2>
              <p>
                Two teams, four seats, and ready toggles. Hook these into the
                server later to unlock coordinated starts.
              </p>
            </div>
          </section>
        </main>
      ) : (
        <main className="lobby">
          <section className="lobby-header">
            <div>
              <p className="eyebrow">Lobby</p>
              <h1>{roomCode || 'ROOM'}</h1>
              <p className="muted">Share this code to bring players in.</p>
            </div>
            <button className="ghost" onClick={() => setView('home')}>
              Back to Home
            </button>
          </section>

          <section className="seat-grid">
            {seats.map((seat) => (
              <div key={seat.id} className="seat-card">
                <div>
                  <p className="seat-id">{seat.label}</p>
                  <p className="seat-team">{seat.team}</p>
                </div>
                <button
                  className={readyMap[seat.id] ? 'ready' : 'not-ready'}
                  onClick={() => toggleReady(seat.id)}
                >
                  {readyMap[seat.id] ? 'Ready' : 'Not Ready'}
                </button>
              </div>
            ))}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
