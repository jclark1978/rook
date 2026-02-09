import { useEffect, useMemo, useRef, useState } from 'react'
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

type RoomState = {
  roomCode: string
  seats: Record<SeatId, string | null>
  players: string[]
  ready: Record<string, boolean>
}

type RoomAck =
  | { ok: true; roomCode: string; playerId: string; state: RoomState }
  | { ok: false; message: string }

function App() {
  const [view, setView] = useState<View>('home')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [playerId, setPlayerId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket: Socket = io('http://localhost:3001', {
      autoConnect: true,
    })

    socketRef.current = socket
    setConnectionStatus(socket.connected ? 'connected' : 'connecting')

    const handleConnect = () => {
      setConnectionStatus('connected')
      if (socket.id) {
        setPlayerId(socket.id)
      }
    }
    const handleDisconnect = () => setConnectionStatus('disconnected')
    const handleError = () => setConnectionStatus('disconnected')
    const handleRoomState = (state: RoomState) => {
      setRoomState(state)
      setRoomCode(state.roomCode)
      setView('lobby')
      setErrorMessage('')
    }
    const handleRoomError = (payload: { message?: string }) => {
      if (payload?.message) {
        setErrorMessage(payload.message)
      }
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleError)
    socket.on('room:state', handleRoomState)
    socket.on('room:error', handleRoomError)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleError)
      socket.off('room:state', handleRoomState)
      socket.off('room:error', handleRoomError)
      socket.disconnect()
    }
  }, [])

  const statusLabel = useMemo(() => {
    if (connectionStatus === 'connected') return 'Connected'
    if (connectionStatus === 'connecting') return 'Connecting'
    return 'Disconnected'
  }, [connectionStatus])

  const handleCreateRoom = () => {
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('room:create', {}, (response: RoomAck) => {
      if (response?.ok) {
        setRoomCode(response.roomCode)
        setPlayerId(response.playerId)
        setRoomState(response.state)
        setView('lobby')
      } else if (response?.message) {
        setErrorMessage(response.message)
      }
    })
  }

  const handleJoinRoom = () => {
    const trimmed = joinCode.trim().toUpperCase()
    if (!trimmed) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('room:join', { roomCode: trimmed }, (response: RoomAck) => {
      if (response?.ok) {
        setRoomCode(response.roomCode)
        setPlayerId(response.playerId)
        setRoomState(response.state)
        setView('lobby')
      } else if (response?.message) {
        setErrorMessage(response.message)
      }
    })
  }

  const handleSeat = (id: SeatId) => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('room:sit', { roomCode, seat: id })
  }

  const toggleReady = (ready: boolean) => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('room:ready', { roomCode, ready })
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
          {errorMessage ? (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          ) : null}
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
          {errorMessage ? (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          ) : null}
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
            {seats.map((seat) => {
              const seatOwner = roomState?.seats[seat.id] ?? null
              const isMine = seatOwner === playerId
              const seatReady = seatOwner
                ? Boolean(roomState?.ready?.[seatOwner])
                : false
              return (
                <div key={seat.id} className="seat-card">
                  <div>
                    <p className="seat-id">{seat.label}</p>
                    <p className="seat-team">{seat.team}</p>
                    <p className="seat-occupant">
                      {seatOwner
                        ? isMine
                          ? 'You are seated'
                          : 'Occupied'
                        : 'Open seat'}
                    </p>
                  </div>
                  <div className="seat-actions">
                    <button
                      className="ghost"
                      onClick={() => handleSeat(seat.id)}
                      disabled={Boolean(seatOwner && !isMine)}
                    >
                      {seatOwner ? (isMine ? 'Your Seat' : 'Taken') : 'Sit Here'}
                    </button>
                    <button
                      className={seatReady ? 'ready' : 'not-ready'}
                      onClick={() => toggleReady(!seatReady)}
                      disabled={!isMine}
                    >
                      {seatOwner ? (seatReady ? 'Ready' : 'Not Ready') : 'Empty'}
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
