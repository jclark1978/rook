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

const teamSeatGroups: Array<{
  id: 'team1' | 'team2'
  label: string
  className: 'team-one' | 'team-two'
  seats: SeatId[]
}> = [
  { id: 'team1', label: 'Team 1', className: 'team-one', seats: ['T1P1', 'T1P2'] },
  { id: 'team2', label: 'Team 2', className: 'team-two', seats: ['T2P1', 'T2P2'] },
]

type RoomState = {
  roomCode: string
  seats: Record<SeatId, string | null>
  players: string[]
  ready: Record<string, boolean>
  playerNames: Record<string, string>
  ownerId: string
  targetScore: number
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
  targetScore?: number
  winnerTeam?: 0 | 1 | null
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
  handSizes?: Record<string, number>
  trickCards?: unknown[]
  handPoints?: [number, number] | null
  biddersSet?: boolean | null
  gameScores?: [number, number]
  undoAvailableForSeat?: SeatId | null
  targetScore?: number
  winnerTeam?: 0 | 1 | null
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
  highlightKeys?: Set<string>
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
  const [entryGameId, setEntryGameId] = useState('')
  const [playerHandle, setPlayerHandle] = useState('')
  const [entryTargetScore, setEntryTargetScore] = useState('700')
  const [entryMode, setEntryMode] = useState<'create' | 'join' | null>(null)
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
  const [selectedDealRookRankMode, setSelectedDealRookRankMode] =
    useState<RookRankMode>('rookHigh')
  const [infoNotice, setInfoNotice] = useState<{
    id: number
    text: string
  } | null>(null)
  const [playNotice, setPlayNotice] = useState<{
    id: number
    text: string
  } | null>(null)
  const [previousTurnSummary, setPreviousTurnSummary] = useState<{
    signature: string
    winnerName: string
    plays: Array<{ seat: SeatId; playerName: string; card: Card; isWinner: boolean }>
  } | null>(null)
  const [isPreviousTurnCollapsed, setIsPreviousTurnCollapsed] = useState(false)
  const [scoresRevealed, setScoresRevealed] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const scorePhaseRef = useRef<string | null>(null)
  const ROOM_CODE_REGEX = /^[A-Z0-9]{4}$/

  useEffect(() => {
    // If you open the web UI from another device, `localhost` would point at *that* device.
    // So we connect back to the same host serving this page.
    const serverUrl = import.meta.env.PROD
      ? window.location.origin
      : `${window.location.protocol}//${window.location.hostname}:3001`

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
    try {
      const storedName = window.localStorage.getItem('rook:playerName')
      if (storedName && storedName.trim()) {
        setPlayerHandle(storedName.trim().slice(0, 24))
      }
    } catch {
      // ignore
    }

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
      const incomingPhase = state.phase ?? null
      const isScorePhase = incomingPhase === 'score' || incomingPhase === 'gameOver'
      const wasScorePhase =
        scorePhaseRef.current === 'score' || scorePhaseRef.current === 'gameOver'
      if (isScorePhase && !wasScorePhase) {
        setScoresRevealed(false)
      } else if (!isScorePhase) {
        setScoresRevealed(false)
      }
      scorePhaseRef.current = incomingPhase
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
        if (payload.message.toLowerCase().includes('illegal play')) {
          setPlayNotice({
            id: Date.now(),
            text: 'Illegal Move: You must play a card matching the suite that lead',
          })
          return
        }
        setErrorMessage(payload.message)
      }
    }
    const handleInfoNotice = (payload: { text?: string }) => {
      if (payload?.text) {
        setInfoNotice({ id: Date.now(), text: payload.text })
      }
    }
    const handleScoreView = (_payload: { roomCode?: string }) => {
      setScoresRevealed(true)
      setView('hand')
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
    socket.on('score:view', handleScoreView)

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
      socket.off('score:view', handleScoreView)
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!playerHandle.trim()) return
    try {
      window.localStorage.setItem('rook:playerName', playerHandle.trim().slice(0, 24))
    } catch {
      // ignore
    }
  }, [playerHandle])

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

  const handleCreateRoom = (
    requestedCode?: string,
    requestedName?: string,
    requestedTargetScore?: number,
  ) => {
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    const trimmedName = requestedName?.trim()
    if (!trimmedName) {
      setErrorMessage('Enter your name before creating a room.')
      return
    }
    const trimmedCode = requestedCode?.trim().toUpperCase()
    if (trimmedCode && !ROOM_CODE_REGEX.test(trimmedCode)) {
      setErrorMessage('Game ID must be 4 characters.')
      return
    }
    setErrorMessage('')
    socket.emit(
      'room:create',
      {
        playerId: stablePlayerIdRef.current,
        playerName: trimmedName.slice(0, 24),
        roomCode: trimmedCode || undefined,
        targetScore: requestedTargetScore,
      },
      (response: RoomAck) => {
        if (response?.ok) {
          setRoomCode(response.roomCode)
          setPlayerId(response.playerId)
          setRoomState(response.state)
          setView('lobby')
          setEntryMode(null)
          setEntryGameId('')
        } else if (response?.message) {
          setErrorMessage(response.message)
        }
      },
    )
  }

  const handleJoinRoom = (requestedCode: string, requestedName: string) => {
    const trimmed = requestedCode.trim().toUpperCase()
    const trimmedName = requestedName.trim()
    if (!ROOM_CODE_REGEX.test(trimmed)) {
      setErrorMessage('Game ID must be 4 characters.')
      return
    }
    if (!trimmedName) {
      setErrorMessage('Enter your name before joining.')
      return
    }
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit(
      'room:join',
      {
        roomCode: trimmed,
        playerId: stablePlayerIdRef.current,
        playerName: trimmedName.slice(0, 24),
      },
      (response: RoomAck) => {
      if (response?.ok) {
        setRoomCode(response.roomCode)
        setPlayerId(response.playerId)
        setRoomState(response.state)
        setView('lobby')
        setEntryMode(null)
        setEntryGameId('')
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

  const emitDealHand = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('game:deal', { roomCode, rookRankMode: selectedDealRookRankMode })
  }

  const handleCopyRoomCode = async () => {
    if (!roomCode) return
    const fallbackCopy = () => {
      const el = document.createElement('textarea')
      el.value = roomCode
      el.setAttribute('readonly', '')
      el.style.position = 'absolute'
      el.style.left = '-9999px'
      document.body.appendChild(el)
      el.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(el)
      return copied
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(roomCode)
        setInfoNotice({ id: Date.now(), text: `Copied room code ${roomCode}` })
        return
      }
      const copied = fallbackCopy()
      setInfoNotice({
        id: Date.now(),
        text: copied
          ? `Copied room code ${roomCode}`
          : `Could not copy. Room code is ${roomCode}`,
      })
    } catch {
      const copied = fallbackCopy()
      setInfoNotice({
        id: Date.now(),
        text: copied
          ? `Copied room code ${roomCode}`
          : `Could not copy. Room code is ${roomCode}`,
      })
    }
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

  const bidderPartnerSeat = useMemo(() => {
    if (!bidderSeat) return null
    const bidderIndex = seatOrder.indexOf(bidderSeat)
    if (bidderIndex < 0) return null
    return seatOrder[(bidderIndex + 2) % 4] ?? null
  }, [bidderSeat])

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

  const kittyCardKeys = useMemo(() => {
    const set = new Set<string>()
    for (const card of kittyCards) set.add(cardKey(card))
    return set
  }, [kittyCards])

  const trickPlays = useMemo(() => {
    const raw = handState?.trickCards
    if (!Array.isArray(raw)) return [] as Array<{ seat: SeatId; card: Card }>

    const plays: Array<{ seat: SeatId; card: Card }> = []
    for (const entry of raw) {
      if (entry && typeof entry === 'object' && 'card' in (entry as any) && 'seat' in (entry as any)) {
        const seat = String((entry as any).seat) as SeatId
        const card = normalizeCard((entry as any).card)
        if (card) plays.push({ seat, card })
      } else {
        const card = normalizeCard(entry)
        if (card) {
          // fallback shape: no seat info
          plays.push({ seat: 'T1P1', card })
        }
      }
    }
    return plays
  }, [handState])

  const trickCards = useMemo(() => trickPlays.map((p) => p.card), [trickPlays])

  const selectedDiscardCards = useMemo(() => {
    if (!selectedDiscards.length) return []
    const selected = new Set(selectedDiscards)
    return handCards.filter((card) => selected.has(cardKey(card)))
  }, [handCards, selectedDiscards])

  const canDiscard = selectedDiscardCards.length === 5
  const shouldShowScoreOverlay =
    (activePhase === 'score' || activePhase === 'gameOver') && !scoresRevealed

  useEffect(() => {
    setSelectedDiscards([])
  }, [handCards, activePhase])

  const dealerSeat = handState?.dealerSeat ?? gameState?.dealerSeat ?? null

  const phaseTitle = useMemo(() => {
    switch (activePhase) {
      case 'preDeal':
        return 'Dealer Setup'
      case 'kitty':
        return 'Kitty Pickup'
      case 'declareTrump':
        return 'Declare Trump'
      case 'trick':
        return 'Trick Play'
      case 'score':
        return 'Scoring'
      case 'gameOver':
        return 'Game Over'
      default:
        return 'Bidding'
    }
  }, [activePhase])

  const phaseStatus = useMemo(() => {
    if (activePhase === 'preDeal') {
      return mySeat?.id === dealerSeat
        ? 'Choose Rook High/Low and press Deal to start bidding.'
        : 'Waiting for dealer to choose rules and deal.'
    }
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
      return scoresRevealed
        ? 'Hand complete. Review the summary below.'
        : 'Hand complete. Waiting for scores to be revealed.'
    }
    if (activePhase === 'gameOver') {
      return scoresRevealed
        ? 'Target score reached. Final results below.'
        : 'Target score reached. Waiting for final scores to be revealed.'
    }
    return 'Bidding in progress.'
  }, [activePhase, isBidder, mySeat, dealerSeat, scoresRevealed])

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
  const targetScore =
    handState?.targetScore ?? gameState?.targetScore ?? roomState?.targetScore ?? 700
  const houseRuleLabel = rookRankMode === 'rookLow' ? 'Rook Low' : 'Rook High'

  useEffect(() => {
    if (activePhase !== 'preDeal') return
    setSelectedDealRookRankMode(rookRankMode)
  }, [activePhase, rookRankMode])

  const gameScores = handState?.gameScores ?? gameState?.gameScores ?? null
  const gameWinnerTeam = handState?.winnerTeam ?? gameState?.winnerTeam ?? null
  const gameWinnerLabel =
    gameWinnerTeam === 0 ? 'Team 1' : gameWinnerTeam === 1 ? 'Team 2' : null

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

  const emitLeaveSeat = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('room:leave', { roomCode })
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

  // Kitty is auto-added to the bidder hand when bidding completes.

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

  const emitViewScores = () => {
    if (!roomCode) return
    const socket = socketRef.current
    if (!socket) {
      setErrorMessage('Unable to connect to the lobby server.')
      return
    }
    setErrorMessage('')
    socket.emit('score:view', { roomCode })
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
    highlight?: boolean,
  ) => {
    const key = cardKey(card)
    const selected = selectedDiscards.includes(key)
    const rookTrumpClass =
      card.kind === 'rook' && currentTrump ? ` rook-trump-${currentTrump}` : ''
    const baseClass = `card-pill card-${card.kind === 'rook' ? 'rook' : card.color}${rookTrumpClass}`
    const highlightClass = highlight ? ' card-kitty' : ''
    const className = selectable
      ? `${baseClass} card-select${selected ? ' selected' : ''}${highlightClass}`
      : clickable
        ? `${baseClass} card-click${highlightClass}`
        : `${baseClass}${highlightClass}`
    const content =
      card.kind === 'rook' ? (
        <>
          <div className="card-corner card-corner-rook">
            <span
              className={`card-rank card-rank-rook${
                currentTrump ? ` rook-trump-${currentTrump}` : ''
              }`}
            >
              ROOK
            </span>
          </div>
          <div className="card-center">
            <img src={rookCard} alt="Rook" className="card-rook" />
          </div>
        </>
      ) : (
        <>
          <div className="card-corner">
            <span className="card-rank">{card.rank}</span>
            <span className="card-color-name">{COLOR_LABELS[card.color].toUpperCase()}</span>
          </div>
          <div className="card-center">
            <div className="card-center-frame">
              <span className="card-center-rank">{card.rank}</span>
            </div>
          </div>
          <div className="card-corner card-corner-bottom">
            <span className="card-rank">{card.rank}</span>
            <span className="card-color-name">{COLOR_LABELS[card.color].toUpperCase()}</span>
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
                  options?.highlightKeys?.has(cardKey(card)),
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
                      options?.highlightKeys?.has(cardKey(card)),
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

  const getPlayerName = (id: string) => {
    const fromState = roomState?.playerNames?.[id]?.trim()
    if (fromState) return fromState
    const shortId = id.slice(0, 6).toUpperCase()
    return shortId ? `Guest ${shortId}` : 'Guest'
  }

  const getSeatDisplayName = (seatId: SeatId) => {
    const owner = roomState?.seats?.[seatId]
    if (!owner) return 'Open Seat'
    if (owner === playerId) return 'You'
    return getPlayerName(owner)
  }

  const getOpenSeatPlaceholder = (seatId: SeatId) =>
    seatId.endsWith('P1') ? 'Player 1' : 'Player 2'

  const formatTrumpLabel = (trump: string | null) => {
    if (!trump) return null
    return trump.charAt(0).toUpperCase() + trump.slice(1)
  }

  const winningBidAmount = handState?.winningBid?.amount ?? biddingState?.highBid?.amount ?? null
  const bidLabelForSeat = (seat: SeatId) => {
    if (seat === bidderSeat) {
      return winningBidAmount ? `★ Bid: ${winningBidAmount}` : '★ Bid'
    }
    if (seat === bidderPartnerSeat) {
      return winningBidAmount ? `Bid: ${winningBidAmount}` : 'Bid'
    }
    return null
  }

  const getTeamSeatLabel = (seatId: SeatId) => {
    const teamNumber = seatId.startsWith('T1') ? '1' : '2'
    return `Team ${teamNumber}: ${getSeatDisplayName(seatId)}`
  }

  useEffect(() => {
    if (activePhase !== 'trick') {
      setPreviousTurnSummary(null)
      return
    }
    if (trickPlays.length !== 4) return
    const winnerSeat = handState?.whoseTurnSeat
    if (!winnerSeat) return
    const signature = `${winnerSeat}:${trickPlays.map((play) => cardKey(play.card)).join('|')}`
    setPreviousTurnSummary((current) => {
      if (current?.signature === signature) return current
      return {
        signature,
        winnerName: getSeatDisplayName(winnerSeat),
        plays: trickPlays.map((play) => ({
          seat: play.seat,
          playerName: getSeatDisplayName(play.seat),
          card: play.card,
          isWinner: play.seat === winnerSeat,
        })),
      }
    })
    setIsPreviousTurnCollapsed(false)
  }, [activePhase, trickPlays, handState, roomState, playerId])

  const renderSeatStrip = () => {
    const allowSeatPick = Boolean(roomState) && !mySeat

    return (
      <div className="seat-strip" aria-label="Table seats">
        {seats.map((seat) => {
          const owner = roomState?.seats?.[seat.id] ?? null
          const isMine = owner === playerId
          const isOpen = !owner
          const isDealer = dealerSeat === seat.id
          const isTurnSeat = activePhase === 'trick' && handState?.whoseTurnSeat === seat.id
          const className = `seat-pill${isMine ? ' is-mine' : ''}${
            allowSeatPick && isOpen ? ' is-clickable' : ''
          }`

          const content = (
            <>
              <div className="seat-pill-head">
                {!isOpen && !isMine ? (
                  <details className="seat-pill-menu">
                    <summary className="seat-pill-name seat-pill-name-button">
                      {getSeatDisplayName(seat.id)}
                    </summary>
                    <div className="seat-pill-menu-popover">
                      <button
                        type="button"
                        className="ghost seat-clear"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (
                            window.confirm(
                              `Mark ${getSeatDisplayName(seat.id)} as dropped? This only works if they are truly disconnected.`,
                            )
                          ) {
                            emitClearSeat(seat.id)
                          }
                        }}
                      >
                        Drop
                      </button>
                    </div>
                  </details>
                ) : (
                  <span className="seat-pill-name">{getSeatDisplayName(seat.id)}</span>
                )}
                <div className="seat-pill-flags">
                  {isTurnSeat ? <span className="seat-flag turn">Turn</span> : null}
                  {isDealer ? <span className="dealer-badge">D</span> : null}
                </div>
              </div>
              {isOpen ? <span className="seat-status">OPEN</span> : null}
              {activePhase === 'trick' && bidLabelForSeat(seat.id) ? (
                <span className="seat-flag bid-winner">{bidLabelForSeat(seat.id)}</span>
              ) : null}
              {activePhase === 'trick' && bidderSeat === seat.id && currentTrump ? (
                <span className={`seat-flag trump trump-${currentTrump}`}>
                  Trump: {formatTrumpLabel(currentTrump)}
                </span>
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

  const normalizedEntryGameId = entryGameId.trim().toUpperCase()
  const normalizedHandle = playerHandle.trim()
  const parsedTargetScore = Number(entryTargetScore)
  const normalizedTargetScore = Number.isFinite(parsedTargetScore)
    ? Math.min(2000, Math.max(100, Math.round(parsedTargetScore)))
    : 700
  const isEntryGameIdValid = ROOM_CODE_REGEX.test(normalizedEntryGameId)
  const canJoinFromEntry = isEntryGameIdValid && normalizedHandle.length > 0
  const canCreateFromEntry =
    normalizedHandle.length > 0 &&
    (normalizedEntryGameId.length === 0 || isEntryGameIdValid)

  const openEntryModal = (mode: 'create' | 'join') => {
    setEntryMode(mode)
    setErrorMessage('')
  }

  const closeEntryModal = () => {
    setEntryMode(null)
    setErrorMessage('')
  }

  const submitEntry = () => {
    if (entryMode === 'join') {
      if (!canJoinFromEntry) return
      handleJoinRoom(normalizedEntryGameId, normalizedHandle)
      return
    }
    if (!canCreateFromEntry) return
    handleCreateRoom(normalizedEntryGameId || undefined, normalizedHandle, normalizedTargetScore)
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src={rookCard} alt="" />
          </span>
          <div>
            <p className="brand-title">The Rook Room</p>
            <p className="brand-subtitle">Good friends, bad bids, great memories.</p>
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
      {activePhase === 'trick' && playNotice ? (
        <div className="play-popover" role="alert">
          <span>{playNotice.text}</span>
          <button
            type="button"
            className="ghost play-popover-dismiss"
            onClick={() => setPlayNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {entryMode ? (
        <div className="entry-overlay" role="dialog" aria-modal="true">
          <section className="entry-modal">
            <p className="eyebrow">{entryMode === 'join' ? 'Join Game' : 'Create Game'}</p>
            <h2>{entryMode === 'join' ? 'Enter Lobby' : 'Start a Lobby'}</h2>
            <p className="muted">
              Set your handle and game key before entering the lobby.
            </p>
            <div className="entry-form">
              <label htmlFor="entry-game-id" className="meta-label">Game ID</label>
              <input
                id="entry-game-id"
                value={entryGameId}
                onChange={(event) => setEntryGameId(event.target.value.toUpperCase())}
                placeholder={entryMode === 'join' ? 'AB12' : 'Optional (AB12)'}
                maxLength={4}
                className="entry-code-input"
              />
              <label htmlFor="entry-player-name" className="meta-label">What's your name?</label>
              <input
                id="entry-player-name"
                value={playerHandle}
                onChange={(event) => setPlayerHandle(event.target.value)}
                placeholder="Your handle"
                maxLength={24}
              />
              {entryMode === 'create' ? (
                <>
                  <label htmlFor="entry-target-score" className="meta-label">Game Winning Score</label>
                  <input
                    id="entry-target-score"
                    type="number"
                    min={100}
                    max={2000}
                    step={5}
                    value={entryTargetScore}
                    onChange={(event) => setEntryTargetScore(event.target.value)}
                    placeholder="700"
                  />
                </>
              ) : null}
            </div>
            <div className="entry-actions">
              <button type="button" className="ghost" onClick={closeEntryModal}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={submitEntry}
                disabled={entryMode === 'join' ? !canJoinFromEntry : !canCreateFromEntry}
              >
                {entryMode === 'join' ? 'Join Game' : 'Create Game'}
              </button>
            </div>
          </section>
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
              <h1>The Rook Room</h1>
              <p>
                The Rook Room is a connected space where friends and family can create or join a
                table, take their seats, and enjoy classic partner-based Rook. Form your teams,
                play your hands, and compete for bragging rights in a fast, simple, and social
                multiplayer experience built around the game you know and love.
              </p>
            </div>
            <div className="hero-actions">
              <button className="primary" onClick={() => openEntryModal('create')}>
                Create Room
              </button>
              <div className="join-block">
                <label>Join room</label>
                <button className="ghost" onClick={() => openEntryModal('join')}>
                  Join with Code
                </button>
              </div>
            </div>
          </section>

        </main>
      ) : view === 'lobby' ? (
        <main className="lobby lobby-modern">
          {errorMessage ? (
            <div className="error-banner" role="alert">
              {errorMessage}
            </div>
          ) : null}
          <section className="lobby-grid">
            <aside className="lobby-config-card">
              <div>
                <p className="eyebrow">Game Configuration</p>
                <h1>{roomCode || 'ROOM'}</h1>
                <p className="muted">Share this room code with your players.</p>
              </div>

              <div className="lobby-code-block">
                <p className="meta-label">Game ID</p>
                <div className="lobby-code-row">
                  <code>{roomCode || 'ROOM'}</code>
                  <button
                    type="button"
                    className="ghost icon-button"
                    onClick={handleCopyRoomCode}
                    aria-label="Copy room code"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 9h11v11H9z" />
                      <path d="M4 4h11v2H6v9H4z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="lobby-config-actions">
                <button
                  className="primary"
                  onClick={handleStartGame}
                  disabled={!(mySeat && roomState?.ready?.[playerId])}
                >
                  Start Game
                </button>
                <button className="ghost" onClick={() => setView('home')}>
                  Back to Home
                </button>
              </div>
            </aside>

            <div className="lobby-teams">
              {teamSeatGroups.map((team) => (
                <section key={team.id} className={`team-card ${team.className}`}>
                  <div className="team-card-header">
                    <p className="eyebrow">{team.label}</p>
                  </div>
                  <div className="team-seat-grid">
                    {team.seats.map((seatId) => {
                      const seatOwner = roomState?.seats[seatId] ?? null
                      const isMine = seatOwner === playerId
                      const isDealer = dealerSeat === seatId

                      return (
                        <article
                          key={seatId}
                          className={`team-seat-card${isMine ? ' is-mine' : ''}`}
                        >
                          <div className="team-seat-top">
                            <p className="seat-id">
                              {isMine
                                ? 'You'
                                : getOpenSeatPlaceholder(seatId)}
                            </p>
                            {isDealer ? <span className="dealer-badge">D</span> : null}
                          </div>
                          <p className="seat-team">
                            {seatOwner ? getPlayerName(seatOwner) : 'Open Seat'}
                          </p>

                          {seatOwner ? (
                            <>
                              <p className="team-seat-status">
                                <span
                                  className="ready-dot is-ready"
                                  aria-hidden="true"
                                />
                                Ready
                              </p>
                              <div className="team-seat-actions">
                                {isMine ? (
                                  <button
                                    className="ghost"
                                    onClick={emitLeaveSeat}
                                  >
                                    Leave
                                  </button>
                                ) : (
                                  <button className="ghost" disabled>
                                    Occupied
                                  </button>
                                )}
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="team-seat-status">
                                <span className="ready-dot" aria-hidden="true" />
                                Waiting
                              </p>
                              <button
                                className="ghost"
                                onClick={() => handleSeat(seatId)}
                              >
                                Join Team
                              </button>
                            </>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
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
            <div className="gameplay-header-actions">
              <div className="house-rules-panel">
                <p className="meta-label">House Rules</p>
                <p className="meta-value">{houseRuleLabel}</p>
                <p className="meta-value">Game Winning Score: {targetScore}</p>
              </div>
              <button className="ghost compact-button" onClick={() => setView('lobby')}>
                Back to Lobby
              </button>
            </div>
          </section>
          {renderSeatStrip()}

          <section className="bidding-grid">
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

                <div className="bidding-history-inline">
                  <p className="meta-label">Bid History</p>
                  <ul className="history-list">
                    {(biddingState?.history?.length ?? 0) > 0 ? (
                      biddingState?.history?.map((entry, index) => {
                        const seatLabel = seatOrder[entry.player] ?? null
                        const actionLabel =
                          entry.type === 'bid'
                            ? `Bid ${entry.amount}`
                            : entry.type === 'pass'
                              ? 'Pass'
                              : 'Pass-Partner'
                        return (
                          <li key={`${entry.type}-${index}`}>
                            <span>{seatLabel ? getSeatDisplayName(seatLabel) : 'Unknown seat'}</span>
                            <span>{actionLabel}</span>
                          </li>
                        )
                      })
                    ) : (
                      <li className="history-empty">No bids yet.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>

            <div className="bidding-card hand-card">
              <div className="hand-header">
                <p className="eyebrow">Your Hand</p>
                {activePhase === 'trick' &&
                mySeat?.id &&
                handState?.undoAvailableForSeat === mySeat.id ? (
                  <button type="button" className="ghost hand-undo" onClick={emitUndoPlay}>
                    Undo Last Play
                  </button>
                ) : null}
              </div>
              {handCards.length ? (
                renderHandBySuit(handCards, undefined, trumpColorForHand, rookRankMode)
              ) : (
                <p className="empty-state">Waiting for deal...</p>
              )}
            </div>

            {/* Bid History moved into Your Action */}

          </section>
        </main>
      ) : (
        <main className="hand">
          {shouldShowScoreOverlay ? (
            <div className="score-overlay" role="dialog" aria-modal="true">
              <div className="score-overlay-modal">
                <p className="eyebrow">Game Over</p>
                <h2>Game Over</h2>
                <p className="muted">Any player can reveal scores for everyone.</p>
                <div className="entry-actions">
                  <button className="primary" onClick={emitViewScores}>
                    View Scores
                  </button>
                </div>
              </div>
            </div>
          ) : null}
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
            <div className="gameplay-header-actions">
              <div className="house-rules-panel">
                <p className="meta-label">House Rules</p>
                <p className="meta-value">{houseRuleLabel}</p>
                <p className="meta-value">Game Winning Score: {targetScore}</p>
              </div>
              <button className="ghost compact-button" onClick={() => setView('lobby')}>
                Back to Lobby
              </button>
            </div>
          </section>
          {renderSeatStrip()}

          <section
            className={`postbid-grid${activePhase === 'trick' ? ' is-trick' : ''}${
              activePhase === 'kitty' ? ' is-kitty' : ''
            }${
              activePhase === 'declareTrump' ? ' is-declare' : ''
            }`}
          >
            {(activePhase === 'score' || activePhase === 'gameOver') && scoresRevealed ? (
              <div className="bidding-card summary-card">
                <p className="eyebrow">{activePhase === 'gameOver' ? 'Final Summary' : 'Hand Summary'}</p>
                <div className="summary-grid">
                  <div>
                    <p className="meta-label">Winning bid</p>
                    <p className="meta-value">
                      {handState?.winningBid
                        ? `${handState.winningBid.amount}`
                        : '—'}{' '}
                      {bidderSeat ? `(${getSeatDisplayName(bidderSeat)})` : ''}
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
                {activePhase === 'gameOver' && gameWinnerLabel ? (
                  <div className={`victory-banner team-${gameWinnerTeam === 0 ? 'one' : 'two'}`}>
                    <div className="victory-fireworks" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <p className="victory-eyebrow">Game Over</p>
                    <h2>{`${gameWinnerLabel.toUpperCase()} WON!`}</h2>
                  </div>
                ) : null}
                {activePhase === 'score' ? (
                  <button
                    className="primary"
                    onClick={emitNextHand}
                    disabled={activePhase !== 'score'}
                  >
                    Next Hand
                  </button>
                ) : (
                  <p className="meta-value">
                    Winner: {gameWinnerLabel ?? '—'}
                  </p>
                )}
              </div>
            ) : null}
            {/* Phase Info panel removed; key info now shown in the top header row. */}

            {activePhase === 'trick' ? (
              <div className="bidding-card trick-card">
                <p className="eyebrow">Table</p>

                {(() => {
                  const bySeat = new Map<SeatId, Card>()
                  for (const play of trickPlays) {
                    bySeat.set(play.seat, play.card)
                  }
                  const awaitingNextLead = trickPlays.length === 4
                  const waitingWinnerSeat =
                    previousTurnSummary?.plays.find((play) => play.isWinner)?.seat ??
                    handState?.whoseTurnSeat ??
                    null
                  const waitingWinnerLabel = waitingWinnerSeat
                    ? getTeamSeatLabel(waitingWinnerSeat)
                    : null
                  const trickSpots: Array<{ seat: SeatId; className: string }> = [
                    { seat: 'T2P1', className: 'top' },
                    { seat: 'T1P1', className: 'left' },
                    { seat: 'T1P2', className: 'right' },
                    { seat: 'T2P2', className: 'bottom' },
                  ]

                  return (
                    <div className="table-grid">
                      <div className={`table-seat table-top${handState?.whoseTurnSeat === 'T2P1' ? ' is-turn' : ''}`}>
                        <div className="table-seat-head">
                          <p className="table-seat-label">
                            <span className="table-seat-team-inline">Team 2</span> - {getSeatDisplayName('T2P1')}
                          </p>
                          <div className="table-seat-flags">
                            {bidLabelForSeat('T2P1') ? (
                              <span className="seat-flag bid-winner">{bidLabelForSeat('T2P1')}</span>
                            ) : null}
                            {bidderSeat === 'T2P1' && currentTrump ? (
                              <span className={`seat-flag trump trump-${currentTrump}`}>
                                Trump: {formatTrumpLabel(currentTrump)}
                              </span>
                            ) : null}
                            {dealerSeat === 'T2P1' ? <span className="dealer-badge">D</span> : null}
                          </div>
                        </div>
                      </div>

                      <div className={`table-seat table-left${handState?.whoseTurnSeat === 'T1P1' ? ' is-turn' : ''}`}>
                        <div className="table-seat-head">
                          <div className="table-seat-head-left">
                            <p className="table-seat-team">Team 1</p>
                            <div className="table-seat-name-row">
                              <p className="table-seat-label">{getSeatDisplayName('T1P1')}</p>
                              {dealerSeat === 'T1P1' ? <span className="dealer-badge">D</span> : null}
                            </div>
                            <div className="table-seat-flags">
                              {bidLabelForSeat('T1P1') ? (
                                <span className="seat-flag bid-winner">{bidLabelForSeat('T1P1')}</span>
                              ) : null}
                              {bidderSeat === 'T1P1' && currentTrump ? (
                                <span className={`seat-flag trump trump-${currentTrump}`}>
                                  Trump: {formatTrumpLabel(currentTrump)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="table-center">
                        <div className="table-trick-area">
                          {trickSpots.map((spot) => {
                            const card = bySeat.get(spot.seat)
                            return (
                              <div
                                key={spot.seat}
                                className={`table-trick-spot ${spot.className}`}
                                aria-label={`${spot.seat} played card`}
                              >
                                {!awaitingNextLead && card ? renderCardPill(card, false) : null}
                              </div>
                            )
                          })}
                        </div>
                        {awaitingNextLead && waitingWinnerLabel ? (
                          <p className="table-winner-banner">
                            <span className="table-winner-title">WINNER</span>
                            <span className="table-winner-name">{waitingWinnerLabel}</span>
                          </p>
                        ) : null}
                        {trickCards.length === 0 ? (
                          <p className="empty-state">No cards played yet.</p>
                        ) : null}
                      </div>

                      <div className={`table-seat table-right${handState?.whoseTurnSeat === 'T1P2' ? ' is-turn' : ''}`}>
                        <div className="table-seat-head">
                          <div className="table-seat-head-left">
                            <p className="table-seat-team">Team 1</p>
                            <div className="table-seat-name-row">
                              <p className="table-seat-label">{getSeatDisplayName('T1P2')}</p>
                              {dealerSeat === 'T1P2' ? <span className="dealer-badge">D</span> : null}
                            </div>
                            <div className="table-seat-flags">
                              {bidLabelForSeat('T1P2') ? (
                                <span className="seat-flag bid-winner">{bidLabelForSeat('T1P2')}</span>
                              ) : null}
                              {bidderSeat === 'T1P2' && currentTrump ? (
                                <span className={`seat-flag trump trump-${currentTrump}`}>
                                  Trump: {formatTrumpLabel(currentTrump)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className={`table-seat table-bottom${handState?.whoseTurnSeat === 'T2P2' ? ' is-turn' : ''}`}>
                        <div className="table-seat-head">
                          <p className="table-seat-label">
                            <span className="table-seat-team-inline">Team 2</span> - {getSeatDisplayName('T2P2')}
                          </p>
                          <div className="table-seat-flags">
                            {bidLabelForSeat('T2P2') ? (
                              <span className="seat-flag bid-winner">{bidLabelForSeat('T2P2')}</span>
                            ) : null}
                            {bidderSeat === 'T2P2' && currentTrump ? (
                              <span className={`seat-flag trump trump-${currentTrump}`}>
                                Trump: {formatTrumpLabel(currentTrump)}
                              </span>
                            ) : null}
                            {dealerSeat === 'T2P2' ? <span className="dealer-badge">D</span> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {previousTurnSummary ? (
                  <div className="trick-result">
                    <div className="trick-result-head">
                      <button
                        type="button"
                        className="ghost trick-collapse"
                        onClick={() => setIsPreviousTurnCollapsed((current) => !current)}
                      >
                        {isPreviousTurnCollapsed ? 'Show Previous Hand' : 'Hide Previous Hand'}
                      </button>
                    </div>
                    {!isPreviousTurnCollapsed ? (
                      <div className="trick-result-cards">
                        {previousTurnSummary.plays.map((play, index) => (
                          <div key={`${play.seat}-${index}`} className="trick-result-play">
                            {renderCardPill(play.card, false)}
                            <p className="trick-play-name">{play.playerName}</p>
                            {play.isWinner ? <p className="trick-play-winner">WINNER!</p> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activePhase !== 'score' && activePhase !== 'gameOver' ? (
              activePhase === 'preDeal' ? (
                <div className="bidding-card action-card">
                  <p className="eyebrow">Deal Setup</p>
                  {mySeat?.id === dealerSeat ? (
                    <>
                      <p className="muted">Choose the rook mode for this hand, then deal.</p>
                      <div className="trump-options">
                        <button
                          type="button"
                          className={selectedDealRookRankMode === 'rookHigh' ? 'primary' : 'ghost'}
                          onClick={() => setSelectedDealRookRankMode('rookHigh')}
                        >
                          Rook High
                        </button>
                        <button
                          type="button"
                          className={selectedDealRookRankMode === 'rookLow' ? 'primary' : 'ghost'}
                          onClick={() => setSelectedDealRookRankMode('rookLow')}
                        >
                          Rook Low
                        </button>
                      </div>
                      <button className="primary" onClick={emitDealHand}>
                        Deal
                      </button>
                    </>
                  ) : (
                    <p className="muted">{phaseStatus}</p>
                  )}
                </div>
              ) : activePhase === 'kitty' && isBidder ? (
                <div className="bidding-card action-card">
                  <p className="eyebrow">Kitty</p>
                  <p className="muted">The kitty has been added to your hand. Discard five cards back to the kitty.</p>
                  <div className="discard-row">
                    <span className="discard-count">{selectedDiscards.length}/5 selected</span>
                    <button className="ghost" onClick={emitDiscardKitty} disabled={!canDiscard}>
                      Discard 5
                    </button>
                  </div>
                </div>
              ) : activePhase === 'trick' ? null : activePhase === 'declareTrump' && isBidder ? null : (
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
                  {(['red', 'black', 'yellow', 'green'] as TrumpColor[]).map((color) => (
                    <button
                      key={color}
                      className={`trump-choice trump-${color}${
                        selectedTrump === color ? ' is-selected' : ''
                      }`}
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
              <div className="hand-header">
                <p className="eyebrow">Your Hand</p>
                {activePhase === 'trick' &&
                mySeat?.id &&
                handState?.undoAvailableForSeat === mySeat.id ? (
                  <button type="button" className="ghost hand-undo" onClick={emitUndoPlay}>
                    Undo Last Play
                  </button>
                ) : null}
              </div>
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
                      highlightKeys:
                        isBidder && activePhase === 'kitty' ? kittyCardKeys : undefined,
                    },
                    trumpColorForHand,
                    rookRankMode,
                  )
                })()
              ) : (
                <p className="empty-state">No cards yet.</p>
              )}
            </div>

            {/* Kitty is folded into the bidder hand; highlight kitty cards during kitty phase. */}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
