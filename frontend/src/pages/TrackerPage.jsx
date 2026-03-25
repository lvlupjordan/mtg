import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import styles from './TrackerPage.module.css'

const LIFE_START = 40

const PALETTE = [
  { accent: '#c8953a', glow: 'rgba(200,149,58,0.10)'   },
  { accent: '#4ecba8', glow: 'rgba(78,203,168,0.08)'   },
  { accent: '#5b9bd5', glow: 'rgba(91,155,213,0.08)'   },
  { accent: '#d95f5f', glow: 'rgba(217,95,95,0.08)'    },
  { accent: '#3aaa6a', glow: 'rgba(58,170,106,0.08)'   },
  { accent: '#a87fc1', glow: 'rgba(168,127,193,0.08)'  },
]

function formatTime(ms) {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

const emptySeat = () => ({ pilot_id: '', deck_id: '', is_stranger: false, stranger_name: '', stranger_commander: '' })

function initPlayers(seats, playersData, decksData) {
  return seats.map((seat, i) => {
    const pilot = playersData?.find(p => String(p.id) === String(seat.pilot_id))
    const deck  = decksData?.find(d => String(d.id) === String(seat.deck_id))
    return {
      id: i,
      pilot_id:    seat.is_stranger ? null : (pilot?.id ?? null),
      deck_id:     seat.is_stranger ? null : (deck?.id ?? null),
      name:        seat.is_stranger ? (seat.stranger_name || 'Stranger') : (pilot?.name ?? `Player ${i + 1}`),
      commander:   seat.is_stranger ? (seat.stranger_commander || '') : (deck?.commander ?? ''),
      image_uri:   seat.is_stranger ? null : (deck?.image_uri ?? null),
      is_stranger: seat.is_stranger,
      life:        LIFE_START,
      poison:      0,
      cmdDamage:   Object.fromEntries(seats.map((_, j) => [j, 0])),
    }
  })
}

// ── PlayerPanel ───────────────────────────────────────────────
function PlayerPanel({ player, allPlayers, onLife, onPoison, onCmdDmg, delta, isActive, playerTime, clockEnabled }) {
  const [mode, setMode] = useState(null)
  const color = PALETTE[player.id % PALETTE.length]
  const cmdMax = allPlayers.length > 0
    ? Math.max(...allPlayers.map(p => player.cmdDamage[p.id] || 0))
    : 0
  const isDead = player.life <= 0 || player.poison >= 10 || cmdMax >= 21

  const toggleMode = m => setMode(cur => cur === m ? null : m)

  return (
    <div
      className={`${styles.panel} ${isDead ? styles.panelDead : ''} ${isActive ? styles.panelActive : ''}`}
      style={{ '--accent': color.accent, '--glow': color.glow }}
    >
      {/* Header */}
      <div className={styles.panelHead}>
        <div className={styles.pnameBlock}>
          <span className={styles.pname}>{player.name}</span>
          {player.commander && <span className={styles.pcommander}>{player.commander}</span>}
        </div>
        <div className={styles.picons}>
          {clockEnabled && playerTime != null && (
            <span className={`${styles.statbadge} ${isActive ? styles.clockActive : ''}`}>
              {formatTime(playerTime)}
            </span>
          )}
          {player.poison > 0 && (
            <span className={styles.statbadge} style={{ color: '#7bc67b' }}>☠{player.poison}</span>
          )}
          {cmdMax > 0 && (
            <span className={styles.statbadge} style={{ color: '#d9a060' }}>⚔{cmdMax}</span>
          )}
          <button className={`${styles.iconbtn} ${mode === 'poison' ? styles.iconon : ''}`} onClick={() => toggleMode('poison')}>☠</button>
          <button className={`${styles.iconbtn} ${mode === 'cmd'    ? styles.iconon : ''}`} onClick={() => toggleMode('cmd')}>⚔</button>
        </div>
      </div>

      {/* Life area */}
      <div className={styles.lifeArea}>
        {player.image_uri && <img src={player.image_uri} className={styles.cmdArt} alt="" />}
        <div className={styles.zonePlus} onClick={() => onLife(player.id, 1)}>
          <span className={styles.chevron}>▲</span>
          <button className={styles.fivebtn} onClick={e => { e.stopPropagation(); onLife(player.id, 5) }}>+5</button>
        </div>

        <div className={styles.lifeCenter}>
          <span className={`${styles.lifenum} ${isDead ? styles.lifenumDead : ''}`}>{player.life}</span>
          {delta != null && (
            <span className={`${styles.delta} ${delta > 0 ? styles.deltapos : styles.deltaneg}`}>
              {delta > 0 ? '+' : ''}{delta}
            </span>
          )}
        </div>

        <div className={styles.zoneMinus} onClick={() => onLife(player.id, -1)}>
          <button className={styles.fivebtn} onClick={e => { e.stopPropagation(); onLife(player.id, -5) }}>−5</button>
          <span className={styles.chevron}>▼</span>
        </div>
      </div>

      {/* Expanded overlay */}
      {mode !== null && createPortal(
        <div className={styles.expanded} onClick={() => setMode(null)}>
          <div className={styles.expCard} onClick={e => e.stopPropagation()}>
            <button className={styles.expClose} onClick={() => setMode(null)}>✕</button>

            {mode === 'poison' && (
              <div className={styles.expSection}>
                <span className={styles.explabel}>☠ Poison / Toxic</span>
                <div className={styles.ctrrow}>
                  <button className={styles.ctrbtn} onClick={() => onPoison(player.id, -1)}>−</button>
                  <span className={`${styles.ctrval} ${player.poison >= 10 ? styles.deadval : player.poison > 0 ? styles.warnval : ''}`}>
                    {player.poison}
                  </span>
                  <button className={styles.ctrbtn} onClick={() => onPoison(player.id, 1)}>+</button>
                </div>
              </div>
            )}

            {mode === 'cmd' && (
              <div className={styles.expSection}>
                <span className={styles.explabel}>⚔ Commander Damage</span>
                {allPlayers.map(opp => {
                  const dmg = player.cmdDamage[opp.id] || 0
                  const oppColor = PALETTE[opp.id % PALETTE.length]
                  return (
                    <div key={opp.id} className={styles.cmdrow}>
                      <div className={styles.cmdnameBlock}>
                        <span className={styles.cmdname} style={{ color: oppColor.accent }}>{opp.name}</span>
                        {opp.commander && <span className={styles.cmdcommander}>{opp.commander}</span>}
                      </div>
                      <div className={styles.ctrrow}>
                        <button className={styles.ctrbtn} onClick={() => onCmdDmg(player.id, opp.id, -1)}>−</button>
                        <span className={`${styles.ctrval} ${dmg >= 21 ? styles.deadval : dmg >= 15 ? styles.warnval : ''}`}>{dmg}</span>
                        <button className={styles.ctrbtn} onClick={() => onCmdDmg(player.id, opp.id, 1)}>+</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Dead overlay */}
      {isDead && (
        <div className={styles.deadOverlay}>
          <span className={styles.deadSym}>☠</span>
        </div>
      )}
    </div>
  )
}

// ── ColumnSlot ────────────────────────────────────────────────
// Rotates a player panel 90° to sit in a left or right column.
function ColumnSlot({ side, children }) {
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setDims({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = dims
  let innerStyle
  if (w > 0 && h > 0) {
    if (side === 'right') {
      innerStyle = { position: 'absolute', width: h, height: w, top: h, left: 0, transformOrigin: 'top left', transform: 'rotate(-90deg)' }
    } else {
      innerStyle = { position: 'absolute', width: h, height: w, top: 0, left: w, transformOrigin: 'top left', transform: 'rotate(90deg)' }
    }
  } else {
    innerStyle = { visibility: 'hidden', position: 'absolute', width: '100%', height: '100%' }
  }

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
      <div style={innerStyle}>{children}</div>
    </div>
  )
}

// Splits player indices into left and right columns
function getColumns(count) {
  const leftCount = Math.ceil(count / 2)
  return {
    left:  Array.from({ length: leftCount },         (_, i) => i),
    right: Array.from({ length: count - leftCount }, (_, i) => leftCount + i),
  }
}

function computePlacements(players, deathOrder) {
  const allDead = deathOrder.flat()
  const placements = {}
  players.forEach(p => { if (!allDead.includes(p.id)) placements[p.id] = 1 })
  let pos = players.length
  for (const group of deathOrder) {
    const avg = group.length > 1 ? (pos + pos - group.length + 1) / 2 : pos
    group.forEach(id => { placements[id] = avg })
    pos -= group.length
  }
  return placements
}

// ── SaveGameOverlay ───────────────────────────────────────────
function SaveGameOverlay({ players, deathOrder, turnCount, totalGameTime, turnCounts, playerTimes, onClose, onSaved }) {
  const qc = useQueryClient()
  const computed = computePlacements(players, deathOrder)
  const [placements, setPlacements] = useState(
    Object.fromEntries(players.map(p => [p.id, String(computed[p.id] ?? '')]))
  )
  const [error, setError] = useState(null)

  const mutation = useMutation({
    mutationFn: api.createGame,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['games'] }); onSaved() },
    onError: e => setError(e.message),
  })

  function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const vals = players.map(p => parseFloat(placements[p.id]))
    if (vals.some(isNaN)) return setError('All players need a placement')
    if (!vals.includes(1)) return setError('At least one player must be 1st')
    mutation.mutate({
      played_at: new Date().toISOString().slice(0, 10),
      variant: 'Commander',
      turn_count: turnCount ?? null,
      total_game_time: totalGameTime ?? null,
      seats: players.map(p => ({
        is_stranger:       p.is_stranger,
        deck_id:           p.is_stranger ? null : p.deck_id,
        pilot_id:          p.is_stranger ? null : p.pilot_id,
        placement:         parseFloat(placements[p.id]),
        victory_condition: null,
        is_archenemy:      false,
        turns:             turnCounts[p.id] ?? null,
        time_spent:        playerTimes[p.id] != null ? Math.round(playerTimes[p.id] / 1000) : null,
      })),
    })
  }

  return (
    <div className={styles.saveOverlay} onClick={onClose}>
      <div className={styles.saveModal} onClick={e => e.stopPropagation()}>
        <div className={styles.saveHeader}>
          <h2 className={styles.saveTitle}>Save Game</h2>
          <button className={styles.saveClose} onClick={onClose}>✕</button>
        </div>
        <form className={styles.saveForm} onSubmit={handleSubmit}>
          <div className={styles.savePlacementsBlock}>
            <span className={styles.saveLabel}>Placements</span>
            {players.map(p => {
              const color = PALETTE[p.id % PALETTE.length]
              return (
                <div key={p.id} className={styles.savePlacementRow}>
                  <span className={styles.savePname} style={{ color: color.accent }}>{p.name}</span>
                  {p.commander && <span className={styles.savePcommander}>{p.commander}</span>}
                  <input
                    type="number" min="1" max="6" step="1"
                    placeholder="—"
                    value={placements[p.id]}
                    onChange={e => setPlacements(prev => ({ ...prev, [p.id]: e.target.value }))}
                    className={styles.savePlaceInput}
                  />
                </div>
              )
            })}
          </div>
          {error && <p className={styles.saveError}>{error}</p>}
          <div className={styles.saveActions}>
            <button type="button" className={styles.saveCancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.saveSubmitBtn} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Record Game'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── DeckPickerModal ───────────────────────────────────────────
function DeckPickerModal({ pilotId, allDecks, onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const searchRef = useRef(null)
  useEffect(() => { if (window.innerWidth > 640) searchRef.current?.focus() }, [])

  const term = search.toLowerCase()
  const filtered = allDecks.filter(d =>
    !term || d.commander.toLowerCase().includes(term) || (d.name && d.name.toLowerCase().includes(term))
  )
  const myDecks    = filtered.filter(d => pilotId && String(d.builder?.id) === String(pilotId)).sort((a, b) => a.commander.localeCompare(b.commander))
  const otherDecks = filtered.filter(d => !pilotId || String(d.builder?.id) !== String(pilotId)).sort((a, b) => a.commander.localeCompare(b.commander))

  return (
    <div className={styles.pickerOverlay} onClick={onClose}>
      <div className={styles.pickerModal} onClick={e => e.stopPropagation()}>
        <div className={styles.pickerHeader}>
          <input ref={searchRef} className={styles.pickerSearch} placeholder="Search commanders…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className={styles.pickerClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.pickerScroll}>
          {myDecks.length > 0 && (
            <>
              <div className={styles.pickerGroupLabel}>Your Decks</div>
              <div className={styles.pickerGrid}>
                {myDecks.map(d => (
                  <button key={d.id} className={styles.pickerCard} onClick={() => onSelect(d)}>
                    {d.image_uri ? <img src={d.image_uri} alt={d.commander} className={styles.pickerCardImg} /> : <div className={styles.pickerCardImgPlaceholder} />}
                    <div className={styles.pickerCardInfo}>
                      <span className={styles.pickerCardName}>{d.commander}</span>
                      <span className={styles.pickerCardBuilder}>{d.builder?.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {otherDecks.length > 0 && (
            <>
              {myDecks.length > 0 && <div className={styles.pickerGroupLabel}>All Decks</div>}
              <div className={styles.pickerGrid}>
                {otherDecks.map(d => (
                  <button key={d.id} className={styles.pickerCard} onClick={() => onSelect(d)}>
                    {d.image_uri ? <img src={d.image_uri} alt={d.commander} className={styles.pickerCardImg} /> : <div className={styles.pickerCardImgPlaceholder} />}
                    <div className={styles.pickerCardInfo}>
                      <span className={styles.pickerCardName}>{d.commander}</span>
                      <span className={styles.pickerCardBuilder}>{d.builder?.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {filtered.length === 0 && <div className={styles.pickerEmpty}>No decks match "{search}"</div>}
        </div>
      </div>
    </div>
  )
}

// ── TrackerPage ───────────────────────────────────────────────
export default function TrackerPage() {
  const navigate = useNavigate()

  const [isLandscape, setIsLandscape] = useState(
    () => window.matchMedia('(orientation: landscape)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)')
    const handler = e => setIsLandscape(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // ── Persistent state ──
  const [phase, setPhase] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_phase')) ?? 'setup' } catch { return 'setup' }
  })
  const [seats, setSeats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_seats')) ?? [emptySeat(), emptySeat(), emptySeat(), emptySeat()] } catch { return [emptySeat(), emptySeat(), emptySeat(), emptySeat()] }
  })
  const [players, setPlayers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_players')) ?? [] } catch { return [] }
  })
  const [activeTurnId, setActiveTurnId] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_activeTurnId')) ?? null } catch { return null }
  })
  const [playerTimes, setPlayerTimes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_playerTimes')) ?? {} } catch { return {} }
  })
  const [turnStart, setTurnStart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_turnStart')) ?? null } catch { return null }
  })
  const [clockEnabled, setClockEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_clockEnabled')) ?? false } catch { return false }
  })
  const [turnCounts, setTurnCounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_turnCounts')) ?? {} } catch { return {} }
  })
  const [deathOrder, setDeathOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_deathOrder')) ?? [] } catch { return [] }
  })
  const [gameEndTime, setGameEndTime] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_gameEndTime')) ?? null } catch { return null }
  })

  const [gameStarted, setGameStarted] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tracker_gameStarted')) ?? false } catch { return false }
  })

  const [pickerSeat, setPickerSeat] = useState(null)
  const [deltas, setDeltas] = useState({})
  const [showSave, setShowSave] = useState(false)
  const [gameSaved, setGameSaved] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [rollDisplay, setRollDisplay] = useState(null)
  const [tick, setTick] = useState(0)

  const deltaTimers  = useRef({})
  const startTimeRef = useRef(() => {
    try { return JSON.parse(localStorage.getItem('tracker_startTime')) ?? null } catch { return null }
  })

  useEffect(() => { localStorage.setItem('tracker_gameStarted', JSON.stringify(gameStarted)) }, [gameStarted])

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('tracker_phase',        JSON.stringify(phase))        }, [phase])
  useEffect(() => { localStorage.setItem('tracker_seats',        JSON.stringify(seats))        }, [seats])
  useEffect(() => { localStorage.setItem('tracker_players',      JSON.stringify(players))      }, [players])
  useEffect(() => { localStorage.setItem('tracker_activeTurnId', JSON.stringify(activeTurnId)) }, [activeTurnId])
  useEffect(() => { localStorage.setItem('tracker_playerTimes',  JSON.stringify(playerTimes))  }, [playerTimes])
  useEffect(() => { localStorage.setItem('tracker_turnStart',    JSON.stringify(turnStart))    }, [turnStart])
  useEffect(() => { localStorage.setItem('tracker_clockEnabled', JSON.stringify(clockEnabled)) }, [clockEnabled])
  useEffect(() => { localStorage.setItem('tracker_turnCounts',   JSON.stringify(turnCounts))   }, [turnCounts])
  useEffect(() => { localStorage.setItem('tracker_deathOrder',   JSON.stringify(deathOrder))   }, [deathOrder])
  useEffect(() => { localStorage.setItem('tracker_gameEndTime',  JSON.stringify(gameEndTime))  }, [gameEndTime])

  // Detect deaths
  useEffect(() => {
    if (!players.length) return
    const allDead = deathOrder.flat()
    const newDead = players.filter(p => {
      const cmdMax = Math.max(0, ...players.map(opp => p.cmdDamage[opp.id] || 0))
      return (p.life <= 0 || p.poison >= 10 || cmdMax >= 21) && !allDead.includes(p.id)
    })
    if (newDead.length > 0) {
      const updatedDead = [...allDead, ...newDead.map(p => p.id)]
      setDeathOrder(prev => [...prev, newDead.map(p => p.id)])
      const aliveCount = players.length - updatedDead.length
      if (aliveCount <= 1 && !gameEndTime) {
        const endTime = Date.now()
        setGameEndTime(endTime)
        if (activeTurnId != null && turnStart != null) {
          setPlayerTimes(prev => ({ ...prev, [activeTurnId]: (prev[activeTurnId] || 0) + (endTime - turnStart) }))
          setTurnStart(null)
        }
      }
    }
  }, [players])

  // 1-second tick for clock display
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()
  void tick

  // ── Data ──
  const { data: playersData } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const { data: decksData }   = useQuery({
    queryKey: ['decks-all'],
    queryFn:  () => api.decks({ page_size: 100, sort: 'games' }),
  })

  const activePlayers = playersData?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? []
  const allDecks      = decksData?.decks ?? []

  // ── Seat management ──
  const updateSeat = (i, field, value) =>
    setSeats(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  const addSeat    = () => { if (seats.length < 6) setSeats(prev => [...prev, emptySeat()]) }
  const removeSeat = i  => { if (seats.length > 2) setSeats(prev => prev.filter((_, idx) => idx !== i)) }

  // ── Life / poison / cmd damage ──
  const changeLife = useCallback((id, amount) => {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, life: p.life + amount } : p))
    setDeltas(prev => ({ ...prev, [id]: (prev[id] ?? 0) + amount }))
    clearTimeout(deltaTimers.current[id])
    deltaTimers.current[id] = setTimeout(() => {
      setDeltas(prev => { const n = { ...prev }; delete n[id]; return n })
    }, 1500)
  }, [])

  const changePoison = useCallback((id, amount) => {
    setPlayers(prev => prev.map(p =>
      p.id === id ? { ...p, poison: Math.max(0, p.poison + amount) } : p
    ))
  }, [])

  const changeCmdDmg = useCallback((playerId, fromId, amount) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p
      const cur    = p.cmdDamage[fromId] || 0
      const newVal = Math.max(0, cur + amount)
      return { ...p, cmdDamage: { ...p.cmdDamage, [fromId]: newVal }, life: p.life - (newVal - cur) }
    }))
    setDeltas(prev => ({ ...prev, [playerId]: (prev[playerId] ?? 0) - amount }))
    clearTimeout(deltaTimers.current[playerId])
    deltaTimers.current[playerId] = setTimeout(() => {
      setDeltas(prev => { const n = { ...prev }; delete n[playerId]; return n })
    }, 1500)
  }, [])

  // ── Roll for first ──
  function rollForFirst() {
    if (rolling || !players.length) return
    setRolling(true)
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const winner = players[buf[0] % players.length]
    let step = 0
    function next() {
      const rnd = new Uint32Array(1)
      crypto.getRandomValues(rnd)
      setRollDisplay(players[rnd[0] % players.length].name)
      step++
      if (step >= 22) {
        setActiveTurnId(winner.id)
        setRollDisplay(winner.name)
        setRolling(false)
        localStorage.setItem('tracker_activeTurnId', JSON.stringify(winner.id))
      } else {
        setTimeout(next, step < 10 ? 55 : step < 17 ? 90 : 140)
      }
    }
    setTimeout(next, 55)
  }

  // ── Hub main button ──
  function hubMainBtnClick() {
    if (activeTurnId == null) {
      rollForFirst()
    } else if (!gameStarted) {
      setGameStarted(true)
      setTurnStart(Date.now())
    } else {
      endTurn()
    }
  }

  // ── End turn ──
  function isPlayerDead(p) {
    const cmdMax = players.length > 0 ? Math.max(...players.map(opp => p.cmdDamage[opp.id] || 0)) : 0
    return p.life <= 0 || p.poison >= 10 || cmdMax >= 21
  }

  function endTurn() {
    if (activeTurnId == null) return
    const now2 = Date.now()
    if (clockEnabled && turnStart != null) {
      setPlayerTimes(prev => ({ ...prev, [activeTurnId]: (prev[activeTurnId] || 0) + (now2 - turnStart) }))
    }
    setTurnCounts(prev => ({ ...prev, [activeTurnId]: (prev[activeTurnId] || 0) + 1 }))
    const n   = players.length
    const idx = players.findIndex(p => p.id === activeTurnId)
    let next
    for (let i = 1; i < n; i++) {
      const candidate = players[(idx + i) % n]
      if (!isPlayerDead(candidate)) { next = candidate; break }
    }
    if (!next) return
    setActiveTurnId(next.id)
    setTurnStart(clockEnabled ? now2 : null)
  }

  // ── Start game (reinitialises everything) ──
  function startGame() {
    const newPlayers = initPlayers(seats, activePlayers, allDecks)
    const st = Date.now()
    startTimeRef.current = st
    localStorage.setItem('tracker_startTime', JSON.stringify(st))
    setPlayers(newPlayers)
    setDeltas({})
    setDeathOrder([])
    setGameEndTime(null)
    setActiveTurnId(null)
    setPlayerTimes({})
    setTurnCounts({})
    setTurnStart(null)
    setRollDisplay(null)
    setGameSaved(false)
    setGameStarted(false)
    setPhase('game')
  }

  function resetGame() {
    if (!window.confirm('Reset all life totals?')) return
    const newPlayers = initPlayers(seats, activePlayers, allDecks)
    const st = Date.now()
    startTimeRef.current = st
    localStorage.setItem('tracker_startTime', JSON.stringify(st))
    setPlayers(newPlayers)
    setDeltas({})
    setDeathOrder([])
    setGameEndTime(null)
    setActiveTurnId(null)
    setPlayerTimes({})
    setTurnCounts({})
    setTurnStart(null)
    setRollDisplay(null)
    setGameSaved(false)
    setGameStarted(false)
  }

  // ════════════════════════════════════════════════════════════
  // SETUP PHASE
  // ════════════════════════════════════════════════════════════
  if (phase === 'setup') {
    const hasActiveGame = players.length > 0
    return (
      <div className={styles.setup}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>Life Tracker</h1>
          <p className={styles.setupSub}>Commander · {LIFE_START} starting life</p>

          <div className={styles.setupSeats}>
            {seats.map((seat, i) => {
              const selectedDeck = allDecks.find(d => String(d.id) === String(seat.deck_id))
              return (
                <div key={i} className={styles.seatRow}>
                  <span className={styles.seatNum} style={{ color: PALETTE[i % PALETTE.length].accent }}>{i + 1}</span>

                  {seat.is_stranger ? (
                    <>
                      <input className={styles.seatSelect} placeholder="Name…"      value={seat.stranger_name}      onChange={e => updateSeat(i, 'stranger_name', e.target.value)}      maxLength={20} />
                      <input className={styles.seatSelect} placeholder="Commander…" value={seat.stranger_commander} onChange={e => updateSeat(i, 'stranger_commander', e.target.value)} maxLength={60} />
                    </>
                  ) : (
                    <>
                      <select className={styles.seatSelect} value={seat.pilot_id} onChange={e => updateSeat(i, 'pilot_id', e.target.value)}>
                        <option value="">Player…</option>
                        {activePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>

                      <button
                        className={`${styles.deckPickerBtn} ${selectedDeck ? styles.deckPickerBtnFilled : ''}`}
                        onClick={() => setPickerSeat(i)}
                      >
                        {selectedDeck ? (
                          <>
                            {selectedDeck.image_uri && <img src={selectedDeck.image_uri} className={styles.deckPickerBtnThumb} alt="" />}
                            <span className={styles.deckPickerBtnName}>{selectedDeck.commander}</span>
                          </>
                        ) : (
                          <span className={styles.deckPickerBtnPlaceholder}>Choose Deck…</span>
                        )}
                      </button>
                    </>
                  )}

                  <button className={`${styles.strangerBtn} ${seat.is_stranger ? styles.strangerBtnOn : ''}`} onClick={() => updateSeat(i, 'is_stranger', !seat.is_stranger)}>
                    Stranger
                  </button>
                  <button className={styles.removeBtn} onClick={() => removeSeat(i)} disabled={seats.length <= 2}>✕</button>
                </div>
              )
            })}
          </div>

          {hasActiveGame && (
            <div className={styles.setupGameActions}>
              {gameSaved
                ? <span className={styles.setupSavedBadge}>✓ Saved</span>
                : <button className={styles.setupSecondaryBtn} onClick={() => setShowSave(true)}>Save Game</button>
              }
              <button className={styles.setupSecondaryBtn} onClick={resetGame}>Reset Totals</button>
            </div>
          )}

          <div className={styles.setupFooter}>
            <button className={styles.addSeatBtn} onClick={addSeat} disabled={seats.length >= 6}>+ Add Seat</button>
            {hasActiveGame && (
              <button className={styles.resumeBtn} onClick={() => setPhase('game')}>Resume</button>
            )}
            <button className={styles.startBtn} onClick={startGame}>
              {hasActiveGame ? 'New Game' : 'Begin'}
            </button>
          </div>
        </div>

        {pickerSeat !== null && (
          <DeckPickerModal
            pilotId={seats[pickerSeat]?.pilot_id}
            allDecks={allDecks}
            onSelect={d => { updateSeat(pickerSeat, 'deck_id', String(d.id)); setPickerSeat(null) }}
            onClose={() => setPickerSeat(null)}
          />
        )}
        {showSave && (
          <SaveGameOverlay
            players={players}
            deathOrder={deathOrder}
            turnCount={Object.values(turnCounts).length > 0 ? Math.max(...Object.values(turnCounts)) : null}
            totalGameTime={startTimeRef.current ? Math.round(((gameEndTime ?? Date.now()) - startTimeRef.current) / 1000) : null}
            turnCounts={turnCounts}
            playerTimes={playerTimes}
            onClose={() => setShowSave(false)}
            onSaved={() => { setShowSave(false); setGameSaved(true) }}
          />
        )}
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════
  // GAME PHASE
  // ════════════════════════════════════════════════════════════
  const count = players.length
  const { left: leftIndices, right: rightIndices } = getColumns(count)

  const gameOver = gameEndTime != null
  const liveTimes = Object.fromEntries(players.map(p => [
    p.id,
    (playerTimes[p.id] || 0) + (!gameOver && clockEnabled && activeTurnId === p.id && turnStart ? now - turnStart : 0),
  ]))

  const activePlayer = players.find(p => p.id === activeTurnId)
  const activeColor  = activePlayer ? PALETTE[activePlayer.id % PALETTE.length].accent : null

  function renderPanel(p, flip = false) {
    return (
      <PlayerPanel
        player={p}
        allPlayers={players}
        onLife={changeLife}
        onPoison={changePoison}
        onCmdDmg={changeCmdDmg}
        delta={deltas[p.id] ?? null}
        isActive={activeTurnId === p.id}
        playerTime={liveTimes[p.id]}
        clockEnabled={clockEnabled}
        flipped={flip}
      />
    )
  }

  return (
    <div className={styles.game}>
      {/* First half: left col (portrait) or top row (landscape) */}
      <div className={styles.half}>
        {leftIndices.map(i => {
          const p = players[i]
          if (isLandscape) {
            return (
              <div key={p.id} className={styles.flatPanel} style={{ transform: 'rotate(180deg)' }}>
                {renderPanel(p, true)}
              </div>
            )
          }
          return <ColumnSlot key={p.id} side="left">{renderPanel(p)}</ColumnSlot>
        })}
      </div>

      {/* Hub — floats at center cross-point */}
      <div className={styles.hub}>
        <button className={styles.hubBtn} onClick={() => navigate('/decks')} title="Home">⌂</button>
        <button className={styles.hubBtn} onClick={() => setPhase('setup')} title="Setup">⚙</button>
        <div className={styles.hubCenter}>
          {activeColor && (
            <div className={styles.turnRing} style={{ borderColor: activeColor, boxShadow: `0 0 16px ${activeColor}66` }} />
          )}
          <button
            className={styles.endTurnBtn}
            onClick={hubMainBtnClick}
            disabled={rolling}
          >
            {rolling ? (
              <span className={styles.endTurnSingle}>···</span>
            ) : activeTurnId == null ? (
              <><span>PICK</span><span>FIRST</span></>
            ) : !gameStarted ? (
              <><span>START</span><span>GAME</span></>
            ) : (
              <><span>END</span><span>TURN</span></>
            )}
          </button>
        </div>
      </div>

      {/* Second half: right col (portrait) or bottom row (landscape) */}
      <div className={styles.half}>
        {rightIndices.map(i => {
          const p = players[i]
          if (isLandscape) {
            return (
              <div key={p.id} className={styles.flatPanel}>{renderPanel(p)}</div>
            )
          }
          return <ColumnSlot key={p.id} side="right">{renderPanel(p)}</ColumnSlot>
        })}
      </div>

      {showSave && (
        <SaveGameOverlay
          players={players}
          deathOrder={deathOrder}
          turnCount={Object.values(turnCounts).length > 0 ? Math.max(...Object.values(turnCounts)) : null}
          totalGameTime={startTimeRef.current ? Math.round(((gameEndTime ?? Date.now()) - startTimeRef.current) / 1000) : null}
          turnCounts={turnCounts}
          playerTimes={playerTimes}
          onClose={() => setShowSave(false)}
          onSaved={() => { setShowSave(false); setGameSaved(true) }}
        />
      )}
    </div>
  )
}
