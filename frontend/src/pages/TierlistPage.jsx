import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import styles from './TierlistPage.module.css'

const TIERS = ['S', 'A', 'B', 'C', 'D', 'F']
const WEIGHTS = [1, 2, 3, 3, 2, 1]
const TIER_SCORE = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 }
const TIER_INDEX = Object.fromEntries(TIERS.map((t, i) => [t, i]))
const STORAGE_KEY = (userId) => `wooberg-tierlist-user-${userId}`

function computeCaps(n) {
  const weightSum = WEIGHTS.reduce((a, b) => a + b, 0)
  const raw = WEIGHTS.map(w => n * w / weightSum)
  const floors = raw.map(Math.floor)
  const remainder = n - floors.reduce((a, b) => a + b, 0)
  raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, remainder)
    .forEach(({ i }) => floors[i]++)
  return Object.fromEntries(TIERS.map((t, i) => [t, floors[i]]))
}

function initTiers(deckIds, saved) {
  const tiers = { S: [], A: [], B: [], C: [], D: [], F: [], unranked: [] }
  const placed = new Set()
  for (const tier of [...TIERS, 'unranked']) {
    if (saved?.[tier]) {
      tiers[tier] = saved[tier].filter(id => deckIds.includes(id))
      tiers[tier].forEach(id => placed.add(id))
    }
  }
  deckIds.forEach(id => { if (!placed.has(id)) tiers.unranked.push(id) })
  return tiers
}

export default function TierlistPage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['decks', { active: true }],
    queryFn: () => api.decks({ active: true, page_size: 100 }),
  })
  const { data: eloData } = useQuery({
    queryKey: ['elo'],
    queryFn: api.eloRatings,
  })
  const { data: players } = useQuery({
    queryKey: ['players'],
    queryFn: api.players,
  })
  const { data: allTierlists } = useQuery({
    queryKey: ['tierlists'],
    queryFn: api.tierlists,
  })

  const [viewId, setViewId] = useState(null) // user_id | 'elo' | 'composite' | null
  const [editing, setEditing] = useState(false)
  const [draftTiers, setDraftTiers] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [compareA, setCompareA] = useState(null)
  const [compareB, setCompareB] = useState(null)

  const decksById = Object.fromEntries((data?.decks ?? []).map(d => [d.id, d]))
  const eloById = Object.fromEntries((eloData ?? []).map(d => [d.deck_id, d.rating]))
  const totalDecks = data?.decks?.length ?? 0
  const caps = totalDecks > 0 ? computeCaps(totalDecks) : null

  const realPlayers = (players ?? []).filter(p => !['Random', 'Precon', 'Stranger'].includes(p.name))

  function getLabel(id) {
    if (id === 'elo') return 'Elo'
    if (id === 'composite') return 'All Users'
    return realPlayers.find(p => p.id === id)?.name ?? '…'
  }

  // Elo-suggested tiers
  const eloTiers = useMemo(() => {
    if (!data?.decks || !caps || !eloData) return null
    const sorted = data.decks.slice().sort((a, b) => (eloById[b.id] ?? 0) - (eloById[a.id] ?? 0))
    const result = { S: [], A: [], B: [], C: [], D: [], F: [], unranked: [] }
    for (const deck of sorted) {
      let placed = false
      for (const tier of TIERS) {
        if (result[tier].length < caps[tier]) { result[tier].push(deck.id); placed = true; break }
      }
      if (!placed) result.unranked.push(deck.id)
    }
    return result
  }, [data, caps, eloData])

  // Composite averaged tiers
  const compositeTiers = useMemo(() => {
    if (!data?.decks || !caps || !allTierlists?.length) return null
    const deckIds = data.decks.map(d => d.id)
    const scores = {}
    for (const tl of allTierlists) {
      for (const tier of TIERS) {
        const tierDecks = tl.tiers?.[tier] ?? []
        tierDecks.forEach((id, index) => {
          const score = TIER_SCORE[tier] + (tierDecks.length - index) / (tierDecks.length + 1)
          if (!scores[id]) scores[id] = []
          scores[id].push(score)
        })
      }
    }
    const ranked = deckIds
      .filter(id => scores[id]?.length)
      .map(id => ({ id, avg: scores[id].reduce((a, b) => a + b, 0) / scores[id].length }))
      .sort((a, b) => b.avg - a.avg)
    const unrankedIds = deckIds.filter(id => !scores[id]?.length)
    const result = { S: [], A: [], B: [], C: [], D: [], F: [], unranked: [] }
    let i = 0
    for (const tier of TIERS) {
      result[tier] = ranked.slice(i, i + caps[tier]).map(x => x.id)
      i += caps[tier]
    }
    result.unranked = [...unrankedIds, ...ranked.slice(i).map(x => x.id)]
    return result
  }, [data, caps, allTierlists])

  // Tiers to display in view mode
  const viewTiers = useMemo(() => {
    if (!data?.decks) return null
    if (viewId === 'elo') return eloTiers
    if (viewId === 'composite') return compositeTiers
    const published = allTierlists?.find(t => t.user_id === viewId)
    return published ? initTiers(data.decks.map(d => d.id), published.tiers) : null
  }, [viewId, allTierlists, eloTiers, compositeTiers, data])

  // Compare: top 5 biggest tier differences between two selections
  const compareDiffs = useMemo(() => {
    if (!compareA || !compareB || !data?.decks) return []
    function resolve(id) {
      if (id === 'elo') return eloTiers
      if (id === 'composite') return compositeTiers
      const pub = allTierlists?.find(t => t.user_id === id)
      return pub ? initTiers(data.decks.map(d => d.id), pub.tiers) : null
    }
    const tiersA = resolve(compareA)
    const tiersB = resolve(compareB)
    if (!tiersA || !tiersB) return []
    const diffs = []
    for (const deck of data.decks) {
      const tA = TIERS.find(t => tiersA[t]?.includes(deck.id))
      const tB = TIERS.find(t => tiersB[t]?.includes(deck.id))
      if (!tA || !tB) continue
      const diff = Math.abs(TIER_INDEX[tA] - TIER_INDEX[tB])
      if (diff > 0) diffs.push({ deck, tierA: tA, tierB: tB, diff })
    }
    return diffs.sort((a, b) => b.diff - a.diff).slice(0, 5)
  }, [compareA, compareB, data, allTierlists, eloTiers, compositeTiers])

  const viewingUser = realPlayers.find(p => p.id === viewId)

  // Enter edit mode: load from localStorage → published list → empty
  function startEditing() {
    const ids = data.decks.map(d => d.id)
    try {
      const local = JSON.parse(localStorage.getItem(STORAGE_KEY(viewId)))
      if (local) { setDraftTiers(initTiers(ids, local)); setEditing(true); return }
    } catch {}
    const published = allTierlists?.find(t => t.user_id === viewId)
    setDraftTiers(initTiers(ids, published?.tiers ?? null))
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setDraftTiers(null)
    setDragging(null)
    setDropTarget(null)
  }

  // Auto-save draft to localStorage while editing
  useEffect(() => {
    if (editing && draftTiers && viewId !== 'elo') {
      localStorage.setItem(STORAGE_KEY(viewId), JSON.stringify(draftTiers))
    }
  }, [draftTiers, editing, viewId])

  const saveMutation = useMutation({
    mutationFn: () => api.saveTierlist(viewId, draftTiers),
    onMutate: () => setSaveStatus('saving'),
    onSuccess: () => {
      setSaveStatus('saved')
      queryClient.invalidateQueries({ queryKey: ['tierlists'] })
      setTimeout(() => setSaveStatus(null), 2000)
    },
    onError: () => {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(null), 3000)
    },
  })

  // ── Drag handlers (edit mode only) ───────────────────────────────────────

  function handleDragStart(e, deckId, fromTier) {
    setDragging({ deckId, fromTier })
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() { setDragging(null); setDropTarget(null) }

  function handleCardDragOver(e, tier, beforeId) {
    e.preventDefault(); e.stopPropagation()
    setDropTarget(prev => prev?.tier === tier && prev?.beforeId === beforeId ? prev : { tier, beforeId })
  }

  function handleTierDragOver(e, tier) {
    e.preventDefault()
    setDropTarget(prev => prev?.tier === tier && prev?.beforeId == null ? prev : { tier, beforeId: null })
  }

  function handleDrop(e, tier) {
    e.preventDefault()
    if (!dragging) return
    const { deckId } = dragging
    const beforeId = dropTarget?.tier === tier ? (dropTarget?.beforeId ?? null) : null
    setDraftTiers(prev => {
      const next = {}
      for (const t of [...TIERS, 'unranked']) next[t] = (prev[t] || []).filter(id => id !== deckId)
      if (beforeId == null) {
        next[tier] = [...next[tier], deckId]
      } else {
        const idx = next[tier].indexOf(beforeId)
        next[tier].splice(idx >= 0 ? idx : next[tier].length, 0, deckId)
      }
      return next
    })
    setDragging(null); setDropTarget(null)
  }

  function handleReset() {
    if (!data?.decks) return
    const ids = data.decks.map(d => d.id)
    const published = allTierlists?.find(t => t.user_id === viewId)
    setDraftTiers(initTiers(ids, published?.tiers ?? null))
  }

  function handleEmpty() {
    if (!data?.decks) return
    setDraftTiers(initTiers(data.decks.map(d => d.id), null))
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (isLoading) return <div className={styles.loading}>Loading decks…</div>

  const displayTiers = editing ? draftTiers : viewTiers
  const canEdit = viewId !== null && viewId !== 'elo' && viewId !== 'composite'

  const compareOptions = (
    <>
      <option value="" disabled>— pick —</option>
      {realPlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value="elo">Elo</option>
      <option value="composite">All Users</option>
    </>
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <select
          className={styles.viewPicker}
          value={viewId ?? ''}
          onChange={e => {
            if (editing) cancelEditing()
            const val = e.target.value
            setViewId(val === 'elo' ? 'elo' : val === 'composite' ? 'composite' : val ? parseInt(val) : null)
          }}
        >
          <option value="" disabled>Select a list…</option>
          {realPlayers.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          <option value="elo">Elo (Suggested)</option>
          <option value="composite">All Users (Averaged)</option>
        </select>

        <div className={styles.headerActions}>
          {editing ? (
            <>
              <button
                className={styles.publishBtn}
                onClick={() => saveMutation.mutate()}
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Error' : 'Publish'}
              </button>
              <button className={styles.resetBtn} onClick={handleReset}>Reset</button>
              <button className={styles.emptyBtn} onClick={handleEmpty}>Empty</button>
              <button className={styles.cancelBtn} onClick={cancelEditing}>Cancel</button>
            </>
          ) : (
            canEdit && (
              <button className={styles.editBtn} onClick={startEditing}>
                Edit as {viewingUser?.name ?? '…'}
              </button>
            )
          )}
        </div>
      </div>

      {!displayTiers ? (
        <p className={styles.noList}>
          {viewId === null
            ? 'Select a player or Elo from the dropdown.'
            : viewId === 'elo'
              ? 'Loading Elo ratings…'
              : viewId === 'composite'
                ? 'No published tier lists yet.'
                : <>
                    {viewingUser?.name ?? 'This player'} hasn't published a tier list yet.
                    <button className={styles.editBtn} style={{ marginLeft: 12 }} onClick={startEditing}>
                      Create one
                    </button>
                  </>
          }
        </p>
      ) : (
        <TierGrid
          tiers={displayTiers}
          caps={caps}
          decksById={decksById}
          eloById={eloById}
          showRating={viewId === 'elo' && !editing}
          editing={editing}
          dragging={dragging}
          dropTarget={dropTarget}
          handleDragStart={handleDragStart}
          handleDragEnd={handleDragEnd}
          handleCardDragOver={handleCardDragOver}
          handleTierDragOver={handleTierDragOver}
          handleDrop={handleDrop}
        />
      )}

      {/* ── Compare section ── */}
      <div className={styles.compareSection}>
        <div className={styles.compareControls}>
          <span className={styles.compareLabel}>Compare</span>
          <select
            className={styles.comparePicker}
            value={compareA ?? ''}
            onChange={e => {
              const val = e.target.value
              setCompareA(val === 'elo' ? 'elo' : val === 'composite' ? 'composite' : val ? parseInt(val) : null)
            }}
          >
            {compareOptions}
          </select>
          <span className={styles.compareLabel}>to</span>
          <select
            className={styles.comparePicker}
            value={compareB ?? ''}
            onChange={e => {
              const val = e.target.value
              setCompareB(val === 'elo' ? 'elo' : val === 'composite' ? 'composite' : val ? parseInt(val) : null)
            }}
          >
            {compareOptions}
          </select>
        </div>

        {compareA && compareB && (
          compareDiffs.length > 0
            ? <ComparePanel diffs={compareDiffs} labelA={getLabel(compareA)} labelB={getLabel(compareB)} />
            : <p className={styles.noList} style={{ paddingTop: 16, paddingBottom: 0 }}>No ranked differences found.</p>
        )}
      </div>
    </div>
  )
}

// ── Tier Grid ─────────────────────────────────────────────────────────────────

function TierGrid({ tiers, caps, decksById, eloById, showRating, editing,
  dragging, dropTarget, handleDragStart, handleDragEnd,
  handleCardDragOver, handleTierDragOver, handleDrop }) {
  return (
    <>
      <div className={styles.tiers}>
        {TIERS.map(tier => {
          const filled = tiers[tier].length
          const cap = caps?.[tier] ?? '?'
          const over = caps && filled > caps[tier]
          return (
            <div
              key={tier}
              className={[
                styles.tierRow,
                styles[`tier${tier}`],
                editing && dropTarget?.tier === tier ? styles.tierRowOver : '',
              ].join(' ')}
              onDragOver={editing ? e => handleTierDragOver(e, tier) : undefined}
              onDrop={editing ? e => handleDrop(e, tier) : undefined}
            >
              <div className={styles.tierLabel}>
                <span className={styles.tierLetter}>{tier}</span>
                <span className={`${styles.tierCap} ${over ? styles.tierCapOver : ''}`}>{filled}/{cap}</span>
              </div>
              <div className={styles.tierCards}>
                {tiers[tier].map(id => (
                  <DeckCard
                    key={id}
                    deck={decksById[id]}
                    rating={showRating ? eloById[id] : undefined}
                    fromTier={tier}
                    isDragging={dragging?.deckId === id}
                    isDropBefore={editing && dropTarget?.tier === tier && dropTarget?.beforeId === id}
                    onDragStart={editing ? handleDragStart : null}
                    onDragEnd={editing ? handleDragEnd : null}
                    onCardDragOver={editing ? handleCardDragOver : null}
                  />
                ))}
                {tiers[tier].length === 0 && (
                  <span className={styles.emptyHint}>{editing ? 'Drop here' : '—'}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <div
          className={styles.unranked}
          onDragOver={e => handleTierDragOver(e, 'unranked')}
          onDrop={e => handleDrop(e, 'unranked')}
        >
          <div className={styles.unrankedHeader}>
            Unranked
            {tiers.unranked.length > 0 && (
              <span className={styles.unrankedCount}>{tiers.unranked.length}</span>
            )}
          </div>
          <div className={styles.unrankedCards}>
            {tiers.unranked.length === 0 ? (
              <p className={styles.allRanked}>All decks ranked.</p>
            ) : (
              tiers.unranked.map(id => (
                <DeckCard
                  key={id}
                  deck={decksById[id]}
                  rating={undefined}
                  fromTier="unranked"
                  isDragging={dragging?.deckId === id}
                  isDropBefore={dropTarget?.tier === 'unranked' && dropTarget?.beforeId === id}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onCardDragOver={handleCardDragOver}
                />
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Deck Card ─────────────────────────────────────────────────────────────────

function DeckCard({ deck, rating, fromTier, isDragging, isDropBefore,
  onDragStart, onDragEnd, onCardDragOver }) {
  if (!deck) return null
  const interactive = !!onDragStart
  return (
    <div className={styles.cardWrap}>
      {isDropBefore && <div className={styles.dropLine} />}
      <div
        className={`${styles.card} ${isDragging ? styles.cardDragging : ''}`}
        draggable={interactive}
        onDragStart={interactive ? e => onDragStart(e, deck.id, fromTier) : undefined}
        onDragEnd={interactive ? onDragEnd : undefined}
        onDragOver={interactive ? e => onCardDragOver(e, fromTier, deck.id) : undefined}
        title={`${deck.name} — ${deck.commander}${rating != null ? ` · ${Math.round(rating)} Elo` : ''}`}
      >
        {deck.image_uri
          ? <img src={deck.image_uri} className={styles.cardArt} alt="" draggable={false} />
          : <div className={styles.cardNoArt} />
        }
        {rating != null && (
          <div className={styles.ratingBadge}>{Math.round(rating)}</div>
        )}
        <div className={styles.cardOverlay}>
          <span className={styles.cardName}>{deck.name}</span>
          <span className={styles.cardCommander}>{deck.commander}</span>
        </div>
      </div>
    </div>
  )
}

// ── Compare Panel ─────────────────────────────────────────────────────────────

const TIER_COLOURS = {
  S: { color: '#f0c040', bg: 'rgba(240,192,64,0.12)' },
  A: { color: '#4ecba8', bg: 'rgba(78,203,168,0.12)' },
  B: { color: '#5a9ee8', bg: 'rgba(90,158,232,0.12)' },
  C: { color: '#9b6dd6', bg: 'rgba(155,109,214,0.12)' },
  D: { color: '#e08c3a', bg: 'rgba(224,140,58,0.12)' },
  F: { color: '#d95f5f', bg: 'rgba(217,95,95,0.12)' },
}

function ComparePanel({ diffs, labelA, labelB }) {
  return (
    <div className={styles.comparePanel}>
      <div className={styles.comparePanelTitle}>Biggest differences</div>
      {diffs.map(({ deck, tierA, tierB }) => (
        <div key={deck.id} className={styles.compareDiffRow}>
          <div className={styles.compareThumb}>
            {deck.image_uri
              ? <img src={deck.image_uri} className={styles.compareThumbImg} alt="" />
              : <div className={styles.compareThumbBlank} />
            }
          </div>
          <div className={styles.compareDeckInfo}>
            <span className={styles.compareDeckName}>{deck.name}</span>
            <span className={styles.compareDeckCmd}>{deck.commander}</span>
          </div>
          <div className={styles.compareTiers}>
            <div
              className={styles.compareBadge}
              style={{ color: TIER_COLOURS[tierA].color, background: TIER_COLOURS[tierA].bg, borderColor: TIER_COLOURS[tierA].color }}
            >
              <span className={styles.compareBadgeTier}>{tierA}</span>
              <span className={styles.compareBadgeLabel}>{labelA}</span>
            </div>
            <span className={styles.compareArrow}>→</span>
            <div
              className={styles.compareBadge}
              style={{ color: TIER_COLOURS[tierB].color, background: TIER_COLOURS[tierB].bg, borderColor: TIER_COLOURS[tierB].color }}
            >
              <span className={styles.compareBadgeTier}>{tierB}</span>
              <span className={styles.compareBadgeLabel}>{labelB}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
