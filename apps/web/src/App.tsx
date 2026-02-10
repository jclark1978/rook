import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import rookCard from './assets/rook-card.jpg'
import './App.css'

type View = 'home' | 'lobby' | 'bidding' | 'hand'

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

type TrumpColor = 'red' | 'yellow' | 'green' | 'black'

type Card =
  | { kind: 'suit'; color: TrumpColor; rank: number }
  | { kind: 'rook' }

type BiddingState = {
  currentPlayer?: number
  minBid?: number
  step?: number
  highBid?: { player: number; amount: number } | null
  history?: BiddingHistoryEntry[]
  passPartnerAllowed?: boolean
  passPartnerUsed?: [boolean, boolean]
}

type RookRankMode = 'rookHigh' | 'rookLow'

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
  dealerSeat?: SeatId | null
  rookRankMode?: RookRankMode
  gameScores?: [number, number]
}

type HandPublicState = {
  roomCode?: string
  phase?: string
  winningBid?: { player: number; amount: number } | null
  bidderSeat?: SeatId | null
  dealerSeat?: SeatId | null
  trump?: string | null
  rookRankMode?: RookRankMode
  kittyCount?: number
  whoseTurnSeat?: SeatId | null
  trickCards?: unknown[]
  handPoints?: [number, number] | null
  biddersSet?: boolean | null
  gameScores?: [number, number]
  undoAvailableForSeat?: SeatId | null
}

type HandPrivateState = {
  roomCode?: string
  seat?: SeatId
  hand?: unknown[]
  kitty?: unknown[]
  cards?: unknown[]
  handCards?: unknown[]
  kittyCards?: unknown[]
}

const seatOrder: SeatId[] = seats.map((seat) => seat.id)

const COLOR_LABELS: Record<TrumpColor, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  black: 'Black',
}

const normalizeCard = (raw: unknown): Card | null => {
  if (!raw) return null
  if (typeof raw === 'string') {
    const upper = raw.toUpperCase()
    if (upper === 'ROOK') return { kind: 'rook' }
    const match = upper.match(/^(RED|YELLOW|GREEN|BLACK)[-_ ]?(\d{1,2})$/)
    if (match) {
      return {
        kind: 'suit',
        color: match[1].toLowerCase() as TrumpColor,
        rank: Number(match[2]),
      }
    }
    return null
  }
  if (typeof raw === 'object') {
    const candidate = raw as { kind?: string; color?: string; rank?: number }
    if (candidate.kind === 'rook') return { kind: 'rook' }
    if (
      candidate.kind === 'suit' &&
      typeof candidate.color === 'string' &&
      typeof candidate.rank === 'number'
    ) {
      const color = candidate.color.toLowerCase() as TrumpColor
      if (color in COLOR_LABELS) {
        return { kind: 'suit', color, rank: candidate.rank }
      }
    }
    if (typeof candidate.color === 'string' && typeof candidate.rank === 'number') {
      const color = candidate.color.toLowerCase() as TrumpColor
      if (color in COLOR_LABELS) {
        return { kind: 'suit', color, rank: candidate.rank }
      }
    }
  }
  return null
}

const normalizeCards = (raw: unknown): Card[] => {
  if (!Array.isArray(raw)) return []
  return raw.map((card) => normalizeCard(card)).filter(Boolean) as Card[]
}

const cardKey = (card: Card): string =>
  card.kind === 'rook' ? 'ROOK' : `${card.color}_${card.rank}`

const SUIT_SYMBOL: Record<TrumpColor, string> = {
  red: 'R',
  black: 'B',
  yellow: 'Y',
  green: 'G',
}

// cardLabel retained previously; no longer used with the more realistic card layout.

const sortRankValue = (card: Card, rookRankMode: 'rookHigh' | 'rookLow' = 'rookHigh'): number => {
  if (card.kind === 'rook') return rookRankMode === 'rookHigh' ? 999 : -1
  // 1 is highest, then 14..2
  if (card.rank === 1) return 998
  return card.rank
}

const sortCardsHighToLow = (
  cards: Card[],
  rookRankMode: 'rookHigh' | 'rookLow' = 'rookHigh',
): Card[] =>
  cards
    .slice()
    .sort((a, b) => {
      const av = sortRankValue(a, rookRankMode)
      const bv = sortRankValue(b, rookRankMode)
      return bv - av
    })

type RenderCardOptions = {
  selectable?: boolean
  clickable?: boolean
  onClick?: (card: Card) => void
}

type HandColumns = {
  rookCards: Card[]
  columns: Array<{ color: TrumpColor; label: string; cards: Card[] }>
}

const buildHandColumns = (
  cards: Card[],
  trumpColor?: TrumpColor,
  rookRankMode: 'rookHigh' | 'rookLow' = 'rookHigh',
): HandColumns => {
  const rookCards = cards.filter((card) => card.kind === 'rook')
  const suited = cards.filter((card) => card.kind === 'suit') as Extract<Card, { kind: 'suit' }>[]

  const byColor: Record<TrumpColor, Card[]> = {
    red: [],
    black: [],
    yellow: [],
    green: [],
  }

  for (const card of suited) {
    byColor[card.color].push(card)
  }

  if (trumpColor && rookCards.length) {
    // Once trump is declared, the Rook should appear in the trump column.
    // Placement (top/bottom) is handled by the sorter via rookRankMode.
    byColor[trumpColor].push(...rookCards)
  }

  const columns: Array<{ color: TrumpColor; label: string; cards: Card[] }> = [
    { color: 'red', label: 'Red', cards: sortCardsHighToLow(byColor.red, rookRankMode) },
    { color: 'black', label: 'Black', cards: sortCardsHighToLow(byColor.black, rookRankMode) },
    { color: 'yellow', label: 'Yellow', cards: sortCardsHighToLow(byColor.yellow, rookRankMode) },
    { color: 'green', label: 'Green', cards: sortCardsHighToLow(byColor.green, rookRankMode) },
  ]

  return { rookCards, columns }
}

function App() {
  const [view, setView] = useState<View>('home')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [handState, setHandState] = useState<HandPublicState | null>(null)
  const [handPrivate, setHandPrivate] = useState<HandPrivateState | null>(null)
  const [playerId, setPlayerId] = useState('')
  const stablePlayerIdRef = useRef<string>('')
  const [errorMessage, setErrorMessage] = useState('')
  const [customBid, setCustomBid] = useState('')
  const [selectedDiscards, setSelectedDiscards] = useState<string[]>([])
  const [selectedTrump, setSelectedTrump] = useState<TrumpColor>('red')
  const [startRookRankMode, setStartRookRankMode] = useState<RookRankMode>('rookHigh')
  const [infoNotice, setInfoNotice] = useState<{
    id: number
    text: string
  } | null>(null)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    // If you open the web UI from another device, `localhost` would point at *that* device.
    // So we connect back to the same host serving this page.
    const serverUrl = `${window.location.protocol}//${window.location.hostname}:3001`

    const getStablePlayerId = () => {
      try {
        const stored = window.localStorage.getItem('rook:playerId')
        if (stored && stored.trim()) return stored
      } catch {
        // ignore
      }

      // Some mobile browsers (older iOS Safari) may not support crypto.randomUUID.
      const generated =
        (typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (crypto as any).randomUUID()
          : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`)

      try {
        window.localStorage.setItem('rook:playerId', generated)
      } catch {
        // ignore
      }
      return generated
    }

    const stablePlayerId = getStablePlayerId()
    stablePlayerIdRef.current = stablePlayerId

    const socket: Socket = io(serverUrl, {
      autoConnect: true,
      auth: { playerId: stablePlayerId },
    })

    socketRef.current = socket
    setConnectionStatus(socket.connected ? 'connected' : 'connecting')

    const handleConnect = () => {
      setConnectionStatus('connected')
      // Use a stable player id so a server restart / reconnect does not "unseat" you.
      if (stablePlayerIdRef.current) {
        setPlayerId(stablePlayerIdRef.current)
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
      setView(state.phase && state.phase !== 'bidding' ? 'hand' : 'bidding')
      setErrorMessage('')
    }
    const handleHandState = (state: HandPublicState) => {
      setHandState(state)
      if (state.roomCode) {
        setRoomCode(state.roomCode)
      }
      // Server may emit hand:state even during bidding (for private-hand plumbing).
      // Don't force the UI out of the bidding screen until the phase actually advances.
      if (state.phase && state.phase !== 'bidding') {
        setView('hand')
      }
      setErrorMessage('')
    }
    const handleHandPrivate = (state: HandPrivateState) => {
      setHandPrivate(state)
      if (state.roomCode) {
        setRoomCode(state.roomCode)
      }
      // Don't auto-switch out of bidding just because we received a private hand payload.
      setView((current) => current)
    }
    const handleRoomError = (payload: { message?: string }) => {
      if (payload?.message) {
        setErrorMessage(payload.message)
      }
    }
    const handleGameError = (payload: { message?: string }) => {
      if (payload?.message) {
        setErrorMessage(payload.message)
      }
    }
    const handleInfoNotice = (payload: { text?: string }) => {
      if (payload?.text) {
        setInfoNotice({ id: Date.now(), text: payload.text })
      }
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleError)
    socket.on('room:state', handleRoomState)
    socket.on('game:state', handleGameState)
    socket.on('hand:state', handleHandState)
    socket.on('hand:private', handleHandPrivate)
    socket.on('room:error', handleRoomError)
    socket.on('game:error', handleGameError)
    socket.on('info:notice', handleInfoNotice)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleError)
      socket.off('room:state', handleRoomState)
      socket.off('game:state', handleGameState)
      socket.off('hand:state', handleHandState)
      socket.off('hand:private', handleHandPrivate)
      socket.off('room:error', handleRoomError)
      socket.off('game:error', handleGameError)
      socket.off('info:notice', handleInfoNotice)
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!infoNotice) return
    const timeout = window.setTimeout(() => {
      setInfoNotice(null)
    }, 6000)
    return () => window.clearTimeout(timeout)
  }, [infoNotice])

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
    socket.emit(
      'room:create',
      { playerId: stablePlayerIdRef.current },
      (response: RoomAck) => {
        if (response?.ok) {
          setRoomCode(response.roomCode)
          setPlayerId(response.playerId)
          setRoomState(response.state)
          setView('lobby')
        } else if (response?.message) {
          setErrorMessage(response.message)
        }
      },
    )
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
    socket.emit(
      'room:join',
      { roomCode: trimmed, playerId: stablePlayerIdRef.current },
      (response: RoomAck) => {
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
    socket.emit('game:start', { roomCode, settings: { rookRankMode: startRookRankMode } })
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

  const activePhase = handState?.phase ?? gameState?.phase ?? 'bidding'

  const bidderSeat =
    handState?.bidderSeat ??
    (biddingState?.highBid
      ? seatOrder[biddingState.highBid.player]
      : null)

  const isBidder = Boolean(mySeat && bidderSeat === mySeat.id)

  const handCards = useMemo(
    () =>
      normalizeCards(
        handPrivate?.hand ?? handPrivate?.cards ?? handPrivate?.handCards,
      ),
    [handPrivate],
  )

  const kittyCards = useMemo(
    () => normalizeCards(handPrivate?.kitty ?? handPrivate?.kittyCards),
    [handPrivate],
  )

  const trickCards = useMemo(() => {
    const raw = handState?.trickCards
    if (!Array.isArray(raw)) return []
    // Server sends trickCards as [{seat, card}...]. Accept either that shape or raw Card[]
    const cardsOnly = raw
      .map((entry) => {
        if (entry && typeof entry === 'object' && 'card' in (entry as any)) {
          return (entry as any).card
        }
        return entry
      })
    return normalizeCards(cardsOnly)
  }, [handState])

  const selectedDiscardCards = useMemo(() => {
    if (!selectedDiscards.length) return []
    const selected = new Set(selectedDiscards)
    return handCards.filter((card) => selected.has(cardKey(card)))
  }, [handCards, selectedDiscards])

  const canDiscard = selectedDiscardCards.length === 5

  useEffect(() => {
    setSelectedDiscards([])
  }, [handCards, activePhase])

  const [trickLog, setTrickLog] = useState<string | null>(null)

  useEffect(() => {
    if (activePhase !== 'trick') {
      setTrickLog(null)
      return
    }
    if (trickCards.length === 4) {
      setTrickLog('Trick complete. Clearing for the next lead.')
      return
    }
    if (trickCards.length === 0) {
      setTrickLog(null)
    }
  }, [activePhase, trickCards.length])

  const phaseTitle = useMemo(() => {
    switch (activePhase) {
      case 'kitty':
        return 'Kitty Pickup'
      case 'declareTrump':
        return 'Declare Trump'
      case 'trick':
        return 'Trick Play'
      case 'score':
        return 'Scoring'
      default:
        return 'Bidding'
    }
  }, [activePhase])

  const phaseStatus = useMemo(() => {
    if (activePhase === 'kitty') {
      return isBidder
        ? 'Pick up the kitty, then discard five cards.'
        : 'Waiting on the bidder to pick up the kitty.'
    }
    if (activePhase === 'declareTrump') {
      return isBidder
        ? 'Declare a trump color for the hand.'
        : 'Waiting on the bidder to declare trump.'
    }
    if (activePhase === 'trick') {
      return 'Trick play underway.'
    }
    if (activePhase === 'score') {
      return 'Hand complete. Review the summary below.'
    }
    return 'Bidding in progress.'
  }, [activePhase, isBidder])

  const currentTrump = useMemo((): TrumpColor | null => {
    if (!handState) return null
    const trumpFromState =
      (handState.trump as TrumpColor | undefined) ??
      ((handState as { trumpColor?: string }).trumpColor as TrumpColor | undefined) ??
      null
    return trumpFromState
  }, [handState])

  const trumpColorForHand = currentTrump ?? undefined

  const rookRankMode: RookRankMode =
    handState?.rookRankMode ?? gameState?.rookRankMode ?? 'rookHigh'

  const kittyCount = handState?.kittyCount ?? kittyCards.length

  const dealerSeat = handState?.dealerSeat ?? gameState?.dealerSeat ?? null

  const gameScores = handState?.gameScores ?? gameState?.gameScores ?? null

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

  const emitClearSeat = (seat: SeatId) => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('room:clearSeat', { roomCode, seat })
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

  const emitPickupKitty = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('kitty:pickup', { roomCode })
  }

  const emitDiscardKitty = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('kitty:discard', { roomCode, cards: selectedDiscardCards })
  }

  const emitDeclareTrump = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('trump:declare', { roomCode, trump: selectedTrump })
  }

  const emitPlayCard = (card: Card) => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    // Helps diagnose click-to-play issues in trick phase.
    console.info('[client] play:card', { roomCode, card })
    socket.emit('play:card', { roomCode, card })
  }

  const emitUndoPlay = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('play:undo', { roomCode })
  }

  const emitNextHand = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('next:hand', { roomCode })
  }

  const toggleDiscardSelection = (card: Card) => {
    const key = cardKey(card)
    setSelectedDiscards((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key)
      }
      if (current.length >= 5) return current
      return [...current, key]
    })
  }

  const handleCustomBid = () => {
    const amount = Number(customBid)
    if (!Number.isFinite(amount)) return
    emitBid(amount)
  }

  const renderCardPill = (
    card: Card,
    selectable: boolean,
    clickable = false,
    onClick?: (card: Card) => void,
  ) => {
    const key = cardKey(card)
    const selected = selectedDiscards.includes(key)
    const baseClass = `card-pill card-${card.kind === 'rook' ? 'rook' : card.color}`
    const className = selectable
      ? `${baseClass} card-select${selected ? ' selected' : ''}`
      : clickable
        ? `${baseClass} card-click`
        : baseClass
    const content =
      card.kind === 'rook' ? (
        <>
          <div className="card-corner">
            <span className="card-rank">ROOK</span>
          </div>
          <div className="card-center">
            <img src={rookCard} alt="Rook" className="card-rook" />
          </div>
        </>
      ) : (
        <>
          <div className="card-corner">
            <span className="card-rank">{card.rank}</span>
            <span className="card-suit">{SUIT_SYMBOL[card.color]}</span>
          </div>
          <div className="card-center">
            <span className="card-suit-big">{SUIT_SYMBOL[card.color]}</span>
          </div>
          <div className="card-corner card-corner-bottom">
            <span className="card-rank">{card.rank}</span>
            <span className="card-suit">{SUIT_SYMBOL[card.color]}</span>
          </div>
        </>
      )

    if (selectable) {
      return (
        <label key={key} className={className}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleDiscardSelection(card)}
          />
          {content}
        </label>
      )
    }

    if (clickable) {
      return (
        <button
          key={key}
          type="button"
          className={className}
          onClick={() => onClick?.(card)}
        >
          {content}
        </button>
      )
    }

    return (
      <div key={key} className={className}>
        {content}
      </div>
    )
  }

  const renderHandBySuit = (
    cards: Card[],
    options?: RenderCardOptions,
    trumpColor?: TrumpColor,
    rookRankMode: 'rookHigh' | 'rookLow' = 'rookHigh',
  ) => {
    const { rookCards, columns } = buildHandColumns(cards, trumpColor, rookRankMode)

    return (
      <div className="hand-sorted">
        {!trumpColor && rookCards.length ? (
          <div className="hand-rook-row">
            <p className="meta-label">Rook</p>
            <div className="hand-rook-cards">
              {rookCards.map((card) =>
                renderCardPill(
                  card,
                  options?.selectable ?? false,
                  options?.clickable ?? false,
                  options?.onClick,
                ),
              )}
            </div>
          </div>
        ) : null}

        <div className="hand-columns" role="list">
          {columns.map((col) => (
            <div
              key={col.color}
              className={`hand-column hand-${col.color}`}
              role="listitem"
            >
              <p className="hand-column-title">{col.label}</p>
              <div className="hand-column-cards">
                {col.cards.length ? (
                  col.cards.map((card) =>
                    renderCardPill(
                      card,
                      options?.selectable ?? false,
                      options?.clickable ?? false,
                      options?.onClick,
                    ),
                  )
                ) : (
                  <p className="empty-state">—</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderSeatStrip = () => {
    const allowSeatPick = Boolean(roomState) && !mySeat

    return (
      <div className="seat-strip" aria-label="Table seats">
        {seats.map((seat) => {
          const owner = roomState?.seats?.[seat.id] ?? null
          const isMine = owner === playerId
          const isOpen = !owner
          const isDealer = dealerSeat === seat.id
          const className = `seat-pill${isMine ? ' is-mine' : ''}${
            allowSeatPick && isOpen ? ' is-clickable' : ''
          }`

          const content = (
            <>
              <span>{seat.label}</span>
              {isDealer ? <span className="dealer-badge">D</span> : null}
              <span className="seat-status">{isOpen ? 'OPEN' : 'TAKEN'}</span>
              {!isOpen && !isMine ? (
                <button
                  type="button"
                  className="ghost seat-clear"
                  onClick={(event) => {
                    event.stopPropagation()
                    if (
                      window.confirm(
                        `Mark ${seat.label} as dropped? This only works if they are truly disconnected.`,
                      )
                    ) {
                      emitClearSeat(seat.id)
                    }
                  }}
                >
                  Drop
                </button>
              ) : null}
            </>
          )

          if (allowSeatPick && isOpen) {
            return (
              <button
                key={seat.id}
                type="button"
                className={className}
                onClick={() => handleSeat(seat.id)}
              >
                {content}
              </button>
            )
          }

          return (
            <div key={seat.id} className={className}>
              {content}
            </div>
          )
        })}
      </div>
    )
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
      {infoNotice ? (
        <div
          key={infoNotice.id}
          className="info-banner"
          role="status"
          aria-live="polite"
        >
          <span>{infoNotice.text}</span>
          <button
            type="button"
            className="ghost info-dismiss"
            onClick={() => setInfoNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

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
              <div className="lobby-setting">
                <p className="meta-label">Rook</p>
                <div className="lobby-setting-buttons">
                  <button
                    type="button"
                    className={startRookRankMode === 'rookHigh' ? 'primary' : 'ghost'}
                    onClick={() => setStartRookRankMode('rookHigh')}
                  >
                    High
                  </button>
                  <button
                    type="button"
                    className={startRookRankMode === 'rookLow' ? 'primary' : 'ghost'}
                    onClick={() => setStartRookRankMode('rookLow')}
                  >
                    Low
                  </button>
                </div>
              </div>

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
              const isDealer = dealerSeat === seat.id
              return (
                <div key={seat.id} className="seat-card">
                  <div>
                    <div className="seat-id-row">
                      <p className="seat-id">{seat.label}</p>
                      {isDealer ? <span className="dealer-badge">D</span> : null}
                    </div>
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
      ) : view === 'bidding' ? (
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
          {renderSeatStrip()}

          <section className="bidding-grid">
            <div className="bidding-card high-bid">
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

            <div className="bidding-card hand-card">
              <p className="eyebrow">Your Hand</p>
              {handCards.length ? (
                renderHandBySuit(handCards, undefined, trumpColorForHand, rookRankMode)
              ) : (
                <p className="empty-state">Waiting for deal...</p>
              )}
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
      ) : (
        <main className="hand">
          {errorMessage ? (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          ) : null}
          <section className="lobby-header">
            <div>
              <p className="eyebrow">{phaseTitle}</p>
              <h1>{roomCode || 'ROOM'}</h1>
              <p className="muted">{phaseStatus}</p>
            </div>
            <div className="lobby-actions">
              <button className="ghost" onClick={() => setView('lobby')}>
                Back to Lobby
              </button>
            </div>
          </section>
          {renderSeatStrip()}

          <section className="postbid-grid">
            {activePhase === 'score' ? (
              <div className="bidding-card summary-card">
                <p className="eyebrow">Hand Summary</p>
                <div className="summary-grid">
                  <div>
                    <p className="meta-label">Winning bid</p>
                    <p className="meta-value">
                      {handState?.winningBid
                        ? `${handState.winningBid.amount}`
                        : '—'}{' '}
                      {bidderSeat ? `(${bidderSeat})` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="meta-label">Points captured</p>
                    <p className="meta-value">
                      Team One: {handState?.handPoints?.[0] ?? '—'}
                    </p>
                    <p className="meta-value">
                      Team Two: {handState?.handPoints?.[1] ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="meta-label">Bidders set</p>
                    <p className="meta-value">
                      {handState?.biddersSet == null
                        ? '—'
                        : handState.biddersSet
                          ? 'Yes'
                          : 'No'}
                    </p>
                  </div>
                  <div>
                    <p className="meta-label">Game score</p>
                    <p className="meta-value">
                      Team One: {gameScores?.[0] ?? '—'}
                    </p>
                    <p className="meta-value">
                      Team Two: {gameScores?.[1] ?? '—'}
                    </p>
                  </div>
                </div>
                <button
                  className="primary"
                  onClick={emitNextHand}
                  disabled={activePhase !== 'score'}
                >
                  Next Hand
                </button>
              </div>
            ) : null}
            <div className="bidding-card phase-card">
              <p className="eyebrow">Phase Info</p>
              <div className="phase-meta">
                <div>
                  <p className="meta-label">Phase</p>
                  <p className="meta-value">{phaseTitle}</p>
                </div>
                <div>
                  <p className="meta-label">Bidder</p>
                  <p className="meta-value">{bidderSeat ?? '—'}</p>
                </div>
                <div>
                  <p className="meta-label">Dealer</p>
                  <p className="meta-value">{dealerSeat ?? '—'}</p>
                </div>
                <div>
                  <p className="meta-label">Trump</p>
                  <p className="meta-value">{currentTrump ?? '—'}</p>
                </div>
                <div>
                  <p className="meta-label">Kitty</p>
                  <p className="meta-value">
                    {kittyCount ? `${kittyCount} cards` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {activePhase === 'trick' ? (
              <div className="bidding-card trick-card">
                <p className="eyebrow">Trick Pile</p>
                <div className="phase-meta">
                  <div>
                    <p className="meta-label">Whose turn</p>
                    <p className="meta-value">{handState?.whoseTurnSeat ?? '—'}</p>
                  </div>
                  <div>
                    <p className="meta-label">Cards in trick</p>
                    <p className="meta-value">{trickCards.length}</p>
                  </div>
                </div>
                <div className="card-grid">
                  {trickCards.length ? (
                    trickCards.map((card) => renderCardPill(card, false))
                  ) : (
                    <p className="empty-state">No cards played yet.</p>
                  )}
                </div>
                {trickLog ? <p className="trick-log">{trickLog}</p> : null}
              </div>
            ) : null}

            {activePhase !== 'score' ? (
              activePhase === 'trick' &&
              mySeat?.id &&
              handState?.undoAvailableForSeat === mySeat.id ? (
                <div className="bidding-card action-card">
                  <p className="eyebrow">Misclick Takeback</p>
                  <p className="muted">You can undo your last play until the next player acts.</p>
                  <button className="ghost" onClick={emitUndoPlay}>
                    Undo Last Play
                  </button>
                </div>
              ) : activePhase === 'kitty' && isBidder ? (
                <div className="bidding-card action-card">
                  <p className="eyebrow">Kitty Actions</p>
                  <p className="muted">Pickup the kitty and discard five cards.</p>
                  <div className="postbid-actions">
                    <button className="primary" onClick={emitPickupKitty}>
                      Pickup Kitty
                    </button>
                    <div className="discard-row">
                      <span className="discard-count">
                        {selectedDiscards.length}/5 selected
                      </span>
                      <button className="ghost" onClick={emitDiscardKitty} disabled={!canDiscard}>
                        Discard 5
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bidding-card action-card">
                  <p className="eyebrow">Waiting</p>
                  <p className="muted">{phaseStatus}</p>
                </div>
              )
            ) : null}

            {activePhase === 'declareTrump' && isBidder ? (
              <div className="bidding-card action-card">
                <p className="eyebrow">Declare Trump</p>
                <p className="muted">Choose the trump color for this hand.</p>
                <div className="trump-options">
                  {(Object.keys(COLOR_LABELS) as TrumpColor[]).map((color) => (
                    <button
                      key={color}
                      className={selectedTrump === color ? 'primary' : 'ghost'}
                      onClick={() => setSelectedTrump(color)}
                    >
                      {COLOR_LABELS[color]}
                    </button>
                  ))}
                </div>
                <button className="primary" onClick={emitDeclareTrump}>
                  Declare Trump
                </button>
              </div>
            ) : null}

            <div className="bidding-card hand-card">
              <p className="eyebrow">Your Hand</p>
              {handCards.length ? (
                (() => {
                  const isTrickTurn =
                    activePhase === 'trick' &&
                    mySeat?.id &&
                    handState?.whoseTurnSeat === mySeat.id

                  return renderHandBySuit(
                    handCards,
                    {
                      selectable: isBidder && activePhase === 'kitty',
                      clickable: Boolean(isTrickTurn),
                      onClick: isTrickTurn ? emitPlayCard : undefined,
                    },
                    trumpColorForHand,
                    rookRankMode,
                  )
                })()
              ) : (
                <p className="empty-state">No cards yet.</p>
              )}
            </div>

            {(isBidder && activePhase === 'kitty') || kittyCards.length > 0 ? (
              <div className="bidding-card kitty-card">
                <p className="eyebrow">Kitty</p>
                {activePhase === 'kitty' ? (
                  <p className="muted">
                    Kitty cards are now in your hand. Select 5 cards above to discard back to the kitty.
                  </p>
                ) : kittyCards.length ? (
                  <div className="card-grid">
                    {kittyCards.map((card) => renderCardPill(card, false))}
                  </div>
                ) : (
                  <p className="muted">Kitty will appear here after you discard.</p>
                )}
              </div>
            ) : null}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
