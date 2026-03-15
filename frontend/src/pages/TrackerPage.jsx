import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import styles from './TrackerPage.module.css'

const LIFE_START = 40

const PALETTE = [
  { accent: '#c8953a', glow: 'rgba(200,149,58,0.12)'   },
  { accent: '#4ecba8', glow: 'rgba(78,203,168,0.10)'   },
  { accent: '#5b9bd5', glow: 'rgba(91,155,213,0.10)'   },
  { accent: '#d95f5f', glow: 'rgba(217,95,95,0.10)'    },
  { accent: '#3aaa6a', glow: 'rgba(58,170,106,0.10)'   },
  { accent: '#a87fc1', glow: 'rgba(168,127,193,0.10)'  },
]

const emptySeat = () => ({ pilot_id: '', deck_id: '', is_stranger: false })

function initPlayers(seats, playersData, decksData) {
  return seats.map((seat, i) => {
    const pilot = playersData?.find(p => String(p.id) === String(seat.pilot_id))
    const deck  = decksData?.find(d => String(d.id) === String(seat.deck_id))
    return {
      id: i,
      pilot_id:   seat.is_stranger ? null : (pilot?.id ?? null),
      deck_id:    seat.is_stranger ? null : (deck?.id ?? null),
      name:       seat.is_stranger ? 'Stranger' : (pilot?.name ?? `Player ${i + 1}`),
      commander:  seat.is_stranger ? '—' : (deck?.commander ?? ''),
      is_stranger: seat.is_stranger,
      life:       LIFE_START,
      poison:     0,
      cmdDamage:  Object.fromEntries(
        seats.map((_, j) => j).filter(j => j !== i).map(j => [j, 0])
      ),
    }
  })
}

// ── PlayerPanel ───────────────────────────────────────────────
function PlayerPanel({ player, allPlayers, onLife, onPoison, onCmdDmg, rotated, delta }) {
  const [mode, setMode] = useState(null)
  const color  = PALETTE[player.id % PALETTE.length]
  const cmdMax = allPlayers.length > 1
    ? Math.max(...allPlayers.filter(p => p.id !== player.id).map(p => player.cmdDamage[p.id] || 0))
    : 0
  const isDead = player.life <= 0 || player.poison >= 10 || cmdMax >= 21

  const toggleMode = (m) => setMode(cur => cur === m ? null : m)

  return (
    <div
      className={`${styles.panel} ${rotated ? styles.rotated : ''} ${isDead ? styles.panelDead : ''}`}
      style={{ '--accent': color.accent, '--glow': color.glow }}
    >
      {/* ── Header strip ── */}
      <div className={styles.panelHead}>
        <div className={styles.pnameBlock}>
          <span className={styles.pname}>{player.name}</span>
          {player.commander && <span className={styles.pcommander}>{player.commander}</span>}
        </div>
        <div className={styles.picons}>
          {player.poison > 0 && (
            <span className={styles.statbadge} style={{ color: '#7bc67b' }}>☠{player.poison}</span>
          )}
          {cmdMax > 0 && (
            <span className={styles.statbadge} style={{ color: '#d9a060' }}>⚔{cmdMax}</span>
          )}
          <button
            className={`${styles.iconbtn} ${mode === 'poison' ? styles.iconon : ''}`}
            onClick={() => toggleMode('poison')}
            title="Poison / Toxic"
          >☠</button>
          <button
            className={`${styles.iconbtn} ${mode === 'cmd' ? styles.iconon : ''}`}
            onClick={() => toggleMode('cmd')}
            title="Commander damage"
          >⚔</button>
        </div>
      </div>

      {/* ── Life area ── */}
      <div className={styles.lifeArea}>
        <div className={styles.zonePlus} onClick={() => onLife(player.id, 1)}>
          <span className={styles.chevron}>▲</span>
          <button
            className={styles.fivebtn}
            onClick={e => { e.stopPropagation(); onLife(player.id, 5) }}
          >+5</button>
        </div>

        <div className={styles.lifeCenter}>
          <span className={`${styles.lifenum} ${isDead ? styles.lifenumDead : ''}`}>
            {player.life}
          </span>
          {delta != null && (
            <span className={`${styles.delta} ${delta > 0 ? styles.deltapos : styles.deltaneg}`}>
              {delta > 0 ? '+' : ''}{delta}
            </span>
          )}
        </div>

        <div className={styles.zoneMinus} onClick={() => onLife(player.id, -1)}>
          <button
            className={styles.fivebtn}
            onClick={e => { e.stopPropagation(); onLife(player.id, -5) }}
          >−5</button>
          <span className={styles.chevron}>▼</span>
        </div>
      </div>

      {/* ── Expanded overlay ── */}
      {mode !== null && (
        <div className={styles.expanded}>
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
              {allPlayers.filter(p => p.id !== player.id).map(opp => {
                const dmg = player.cmdDamage[opp.id] || 0
                const oppColor = PALETTE[opp.id % PALETTE.length]
                return (
                  <div key={opp.id} className={styles.cmdrow}>
                    <span className={styles.cmdname} style={{ color: oppColor.accent }}>
                      {opp.name}
                    </span>
                    <div className={styles.ctrrow}>
                      <button className={styles.ctrbtn} onClick={() => onCmdDmg(player.id, opp.id, -1)}>−</button>
                      <span className={`${styles.ctrval} ${dmg >= 21 ? styles.deadval : dmg >= 15 ? styles.warnval : ''}`}>
                        {dmg}
                      </span>
                      <button className={styles.ctrbtn} onClick={() => onCmdDmg(player.id, opp.id, 1)}>+</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Death overlay ── */}
      {isDead && (
        <div className={styles.deadOverlay}>
          <span className={styles.deadSym}>☠</span>
        </div>
      )}
    </div>
  )
}

// ── Save Game overlay ─────────────────────────────────────────
function SaveGameOverlay({ players, onClose, onSaved }) {
  const qc = useQueryClient()
  const [placements, setPlacements] = useState(
    Object.fromEntries(players.map(p => [p.id, '']))
  )
  const [error, setError] = useState(null)

  const mutation = useMutation({
    mutationFn: api.createGame,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['games'] })
      onSaved()
    },
    onError: (e) => setError(e.message),
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
      seats: players.map(p => ({
        is_stranger: p.is_stranger,
        deck_id:     p.is_stranger ? null : p.deck_id,
        pilot_id:    p.is_stranger ? null : p.pilot_id,
        placement:   parseFloat(placements[p.id]),
        victory_condition: null,
        is_archenemy: false,
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
                    type="number"
                    min="1"
                    max="6"
                    step="1"
                    placeholder="Place"
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
  useEffect(() => { searchRef.current?.focus() }, [])

  const term = search.toLowerCase()
  const filtered = allDecks.filter(d =>
    !term ||
    d.commander.toLowerCase().includes(term) ||
    (d.name && d.name.toLowerCase().includes(term))
  )

  const myDecks    = filtered.filter(d => pilotId && String(d.builder?.id) === String(pilotId))
                             .sort((a, b) => a.commander.localeCompare(b.commander))
  const otherDecks = filtered.filter(d => !pilotId || String(d.builder?.id) !== String(pilotId))
                             .sort((a, b) => a.commander.localeCompare(b.commander))

  return (
    <div className={styles.pickerOverlay} onClick={onClose}>
      <div className={styles.pickerModal} onClick={e => e.stopPropagation()}>
        <div className={styles.pickerHeader}>
          <input
            ref={searchRef}
            className={styles.pickerSearch}
            placeholder="Search commanders…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className={styles.pickerClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.pickerScroll}>
          {myDecks.length > 0 && (
            <>
              <div className={styles.pickerGroupLabel}>Your Decks</div>
              <div className={styles.pickerGrid}>
                {myDecks.map(d => (
                  <button key={d.id} className={styles.pickerCard} onClick={() => onSelect(d)}>
                    {d.image_uri
                      ? <img src={d.image_uri} alt={d.commander} className={styles.pickerCardImg} />
                      : <div className={styles.pickerCardImgPlaceholder} />
                    }
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
                    {d.image_uri
                      ? <img src={d.image_uri} alt={d.commander} className={styles.pickerCardImg} />
                      : <div className={styles.pickerCardImgPlaceholder} />
                    }
                    <div className={styles.pickerCardInfo}>
                      <span className={styles.pickerCardName}>{d.commander}</span>
                      <span className={styles.pickerCardBuilder}>{d.builder?.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {filtered.length === 0 && (
            <div className={styles.pickerEmpty}>No decks match "{search}"</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── TrackerPage ───────────────────────────────────────────────
export default function TrackerPage() {
  const [phase, setPhase] = useState('setup')
  const [seats, setSeats] = useState([emptySeat(), emptySeat(), emptySeat(), emptySeat()])
  const [pickerSeat, setPickerSeat] = useState(null) // index of seat whose picker is open
  const [players, setPlayers] = useState([])
  const [deltas, setDeltas] = useState({})
  const [showSave, setShowSave] = useState(false)
  const [gameSaved, setGameSaved] = useState(false)
  const deltaTimers = useRef({})

  const { data: playersData } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const { data: decksData }   = useQuery({
    queryKey: ['decks-all'],
    queryFn: () => api.decks({ page_size: 100, sort: 'games' }),
  })

  const activePlayers = playersData?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? []
  const allDecks      = decksData?.decks ?? []

  function updateSeat(i, field, value) {
    setSeats(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  function addSeat() {
    if (seats.length < 6) setSeats(prev => [...prev, emptySeat()])
  }

  function removeSeat(i) {
    if (seats.length > 2) setSeats(prev => prev.filter((_, idx) => idx !== i))
  }

  // ── Lifecycle callbacks ──
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
      const cur = p.cmdDamage[fromId] || 0
      return { ...p, cmdDamage: { ...p.cmdDamage, [fromId]: Math.max(0, cur + amount) } }
    }))
  }, [])

  function startGame() {
    setPlayers(initPlayers(seats, activePlayers, allDecks))
    setDeltas({})
    setGameSaved(false)
    setPhase('game')
  }

  function resetGame() {
    if (window.confirm('Reset all life totals?')) {
      setPlayers(initPlayers(seats, activePlayers, allDecks))
      setDeltas({})
      setGameSaved(false)
    }
  }

  // ── Setup ──────────────────────────────────────────────────
  if (phase === 'setup') {
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
                  <span className={styles.seatNum} style={{ color: PALETTE[i % PALETTE.length].accent }}>
                    {i + 1}
                  </span>

                  {seat.is_stranger ? (
                    <span className={styles.strangerLabel}>Stranger</span>
                  ) : (
                    <>
                      <select
                        className={styles.seatSelect}
                        value={seat.pilot_id}
                        onChange={e => updateSeat(i, 'pilot_id', e.target.value)}
                      >
                        <option value="">Player…</option>
                        {activePlayers.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>

                      <button
                        className={`${styles.deckPickerBtn} ${selectedDeck ? styles.deckPickerBtnFilled : ''}`}
                        onClick={() => setPickerSeat(i)}
                      >
                        {selectedDeck ? (
                          <>
                            {selectedDeck.image_uri && (
                              <img src={selectedDeck.image_uri} className={styles.deckPickerBtnThumb} alt="" />
                            )}
                            <span className={styles.deckPickerBtnName}>{selectedDeck.commander}</span>
                          </>
                        ) : (
                          <span className={styles.deckPickerBtnPlaceholder}>Choose Deck…</span>
                        )}
                      </button>
                    </>
                  )}

                  <button
                    className={`${styles.strangerBtn} ${seat.is_stranger ? styles.strangerBtnOn : ''}`}
                    onClick={() => updateSeat(i, 'is_stranger', !seat.is_stranger)}
                  >Stranger</button>

                  <button
                    className={styles.removeBtn}
                    onClick={() => removeSeat(i)}
                    disabled={seats.length <= 2}
                  >✕</button>
                </div>
              )
            })}
          </div>

          <div className={styles.setupFooter}>
            <button
              className={styles.addSeatBtn}
              onClick={addSeat}
              disabled={seats.length >= 6}
            >+ Add Seat</button>
            <button className={styles.startBtn} onClick={startGame}>
              Begin
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
      </div>
    )
  }

  // ── Game ───────────────────────────────────────────────────
  const count       = players.length
  const bottomCount = Math.ceil(count / 2)
  const bottomPlayers = players.slice(0, bottomCount)
  const topPlayers    = [...players.slice(bottomCount)].reverse()

  return (
    <div className={styles.game}>
      {topPlayers.length > 0 && (
        <div className={styles.row}>
          {topPlayers.map(p => (
            <PlayerPanel
              key={p.id}
              player={p}
              allPlayers={players}
              onLife={changeLife}
              onPoison={changePoison}
              onCmdDmg={changeCmdDmg}
              rotated
              delta={deltas[p.id] ?? null}
            />
          ))}
        </div>
      )}

      <div className={styles.row}>
        {bottomPlayers.map(p => (
          <PlayerPanel
            key={p.id}
            player={p}
            allPlayers={players}
            onLife={changeLife}
            onPoison={changePoison}
            onCmdDmg={changeCmdDmg}
            rotated={false}
            delta={deltas[p.id] ?? null}
          />
        ))}
      </div>

      <div className={styles.gamebar}>
        <button className={styles.barbtn} onClick={() => setPhase('setup')}>← Setup</button>
        <button className={styles.barbtn} onClick={resetGame}>Reset</button>
        {gameSaved ? (
          <span className={styles.savedBadge}>✓ Saved</span>
        ) : (
          <button className={`${styles.barbtn} ${styles.barbtnSave}`} onClick={() => setShowSave(true)}>
            Save Game
          </button>
        )}
      </div>

      {showSave && (
        <SaveGameOverlay
          players={players}
          onClose={() => setShowSave(false)}
          onSaved={() => { setShowSave(false); setGameSaved(true) }}
        />
      )}
    </div>
  )
}
