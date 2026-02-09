import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import rookCard from './assets/rook-card.jpg'
import './App.css'

type View = 'home' | 'lobby' | 'bidding'

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

type BiddingHistoryEntry = {
  type: 'bid' | 'pass' | 'passPartner'
  player: number
  amount?: number
}

type BiddingState = {
  currentPlayer?: number
  minBid?: number
  step?: number
  highBid?: { player: number; amount: number } | null
  history?: BiddingHistoryEntry[]
  passPartnerAllowed?: boolean
  passPartnerUsed?: [boolean, boolean]
}

type GameState = {
  roomCode?: string
  phase?: string
  bidding?: BiddingState
  currentPlayer?: number
  minBid?: number
  step?: number
  highBid?: { player: number; amount: number } | null
  history?: BiddingHistoryEntry[]
  passPartnerAllowed?: boolean
  passPartnerUsed?: [boolean, boolean]
}

const seatOrder: SeatId[] = seats.map((seat) => seat.id)

function App() {
  const [view, setView] = useState<View>('home')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [playerId, setPlayerId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [customBid, setCustomBid] = useState('')
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    // If you open the web UI from another device, `localhost` would point at *that* device.
    // So we connect back to the same host serving this page.
    const serverUrl = `${window.location.protocol}//${window.location.hostname}:3001`

    const socket: Socket = io(serverUrl, {
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
      setView((current) => (current === 'home' ? 'lobby' : current))
      setErrorMessage('')
    }
    const handleGameState = (state: GameState) => {
      setGameState(state)
      if (state.roomCode) {
        setRoomCode(state.roomCode)
      }
      setView('bidding')
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
    socket.on('game:state', handleGameState)
    socket.on('room:error', handleRoomError)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleError)
      socket.off('room:state', handleRoomState)
      socket.off('game:state', handleGameState)
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

  const handleStartGame = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('game:start', { roomCode })
  }

  const biddingState: BiddingState | null = useMemo(() => {
    if (!gameState) return null
    if (gameState.bidding) return gameState.bidding
    const hasBiddingShape =
      typeof gameState.currentPlayer === 'number' ||
      Boolean(gameState.highBid) ||
      Boolean(gameState.history?.length)
    if (!hasBiddingShape) return null
    return {
      currentPlayer: gameState.currentPlayer,
      minBid: gameState.minBid,
      step: gameState.step,
      highBid: gameState.highBid ?? null,
      history: gameState.history ?? [],
      passPartnerAllowed: gameState.passPartnerAllowed,
      passPartnerUsed: gameState.passPartnerUsed,
    }
  }, [gameState])

  const minBid = biddingState?.minBid ?? 100
  const bidStep = biddingState?.step ?? 5
  const highBidAmount = biddingState?.highBid?.amount ?? 0
  const bidIncrement = Math.max(bidStep, 5)
  const quickBidAmount = Math.max(minBid, highBidAmount + bidIncrement)

  const mySeat = useMemo(
    () => seats.find((seat) => roomState?.seats?.[seat.id] === playerId),
    [roomState, playerId],
  )

  const currentPlayerSeat = useMemo(() => {
    if (typeof biddingState?.currentPlayer !== 'number') return null
    return seatOrder[biddingState.currentPlayer] ?? null
  }, [biddingState])

  const isMyTurn = Boolean(
    currentPlayerSeat && roomState?.seats?.[currentPlayerSeat] === playerId,
  )

  const passPartnerAllowed =
    biddingState?.passPartnerAllowed ??
    (() => {
      if (!biddingState?.highBid) return false
      if (typeof biddingState.currentPlayer !== 'number') return false
      if (!biddingState.passPartnerUsed) return false
      const partner = (biddingState.currentPlayer + 2) % 4
      if (biddingState.highBid.player !== partner) return false
      const team = biddingState.currentPlayer % 2
      return !biddingState.passPartnerUsed[team]
    })()

  const emitBid = (amount: number) => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('game:bid', { roomCode, amount })
  }

  const emitPass = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('game:pass', { roomCode })
  }

  const emitPassPartner = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('game:passPartner', { roomCode })
  }

  const handleCustomBid = () => {
    const amount = Number(customBid)
    if (!Number.isFinite(amount)) return
    emitBid(amount)
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
      ) : view === 'lobby' ? (
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
            <div className="lobby-actions">
              {mySeat && roomState?.ready?.[playerId] ? (
                <button className="primary" onClick={handleStartGame}>
                  Start Game
                </button>
              ) : null}
              <button className="ghost" onClick={() => setView('home')}>
                Back to Home
              </button>
            </div>
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
      ) : (
        <main className="bidding">
          {errorMessage ? (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          ) : null}
          <section className="lobby-header">
            <div>
              <p className="eyebrow">Bidding</p>
              <h1>{roomCode || 'ROOM'}</h1>
              <p className="muted">Open bids are visible to everyone.</p>
            </div>
            <div className="lobby-actions">
              <button className="ghost" onClick={() => setView('lobby')}>
                Back to Lobby
              </button>
            </div>
          </section>

          <section className="bidding-grid">
            <div className="bidding-card">
              <p className="eyebrow">High Bid</p>
              <div className="bidding-highlight">
                <p className="bidding-amount">
                  {biddingState?.highBid ? biddingState.highBid.amount : '—'}
                </p>
                <p className="bidding-seat">
                  {biddingState?.highBid
                    ? seatOrder[biddingState.highBid.player] ?? 'Unknown seat'
                    : 'No bids yet'}
                </p>
              </div>
              <div className="bidding-meta">
                <div>
                  <p className="meta-label">Whose turn</p>
                  <p className="meta-value">
                    {currentPlayerSeat ?? 'Waiting'}{' '}
                    {isMyTurn ? '(You)' : ''}
                  </p>
                </div>
                <div>
                  <p className="meta-label">Bid step</p>
                  <p className="meta-value">{bidStep}</p>
                </div>
              </div>
            </div>

            <div className="bidding-card">
              <p className="eyebrow">Your Action</p>
              <div className="bidding-actions">
                <button
                  className="primary"
                  onClick={() => emitBid(quickBidAmount)}
                  disabled={!isMyTurn}
                >
                  Bid +{bidIncrement} ({quickBidAmount})
                </button>
                <div className="bid-input-row">
                  <input
                    type="number"
                    min={minBid}
                    step={bidStep}
                    value={customBid}
                    onChange={(event) => setCustomBid(event.target.value)}
                    placeholder={`Custom (min ${minBid})`}
                  />
                  <button
                    className="ghost"
                    onClick={handleCustomBid}
                    disabled={!isMyTurn || !customBid}
                  >
                    Bid
                  </button>
                </div>
                <div className="bidding-secondary">
                  <button className="ghost" onClick={emitPass} disabled={!isMyTurn}>
                    Pass
                  </button>
                  <button
                    className="ghost"
                    onClick={emitPassPartner}
                    disabled={!isMyTurn || !passPartnerAllowed}
                  >
                    Pass-Partner
                  </button>
                </div>
              </div>
            </div>

            <div className="bidding-card bidding-history">
              <p className="eyebrow">Bid History</p>
              <ul className="history-list">
                {(biddingState?.history?.length ?? 0) > 0 ? (
                  biddingState?.history?.map((entry, index) => {
                    const seatLabel = seatOrder[entry.player] ?? 'Unknown seat'
                    const actionLabel =
                      entry.type === 'bid'
                        ? `Bid ${entry.amount}`
                        : entry.type === 'pass'
                          ? 'Pass'
                          : 'Pass-Partner'
                    return (
                      <li key={`${entry.type}-${index}`}>
                        <span>{seatLabel}</span>
                        <span>{actionLabel}</span>
                      </li>
                    )
                  })
                ) : (
                  <li className="history-empty">No bids yet.</li>
                )}
              </ul>
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

export default App
