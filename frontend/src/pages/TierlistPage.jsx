import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import styles from './TierlistPage.module.css'

const TIERS = ['S', 'A', 'B', 'C', 'D', 'F']
const WEIGHTS = [1, 2, 3, 3, 2, 1] // bell curve — sums to 12
const STORAGE_KEY = 'wooberg-tierlist-v1'

// Distribute n slots across tiers using the bell curve weights.
// Uses largest-remainder method so caps always sum exactly to n.
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
  const { data, isLoading } = useQuery({
    queryKey: ['decks', { active: true }],
    queryFn: () => api.decks({ active: true, page_size: 100 }),
  })

  const { data: eloData } = useQuery({
    queryKey: ['elo'],
    queryFn: api.eloRatings,
  })

  const [tiers, setTiers] = useState(null)
  const [dragging, setDragging] = useState(null)    // { deckId, fromTier }
  const [dropTarget, setDropTarget] = useState(null) // { tier, beforeId }

  useEffect(() => {
    if (!data?.decks) return
    const ids = data.decks.map(d => d.id)
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
      setTiers(initTiers(ids, saved))
    } catch {
      setTiers(initTiers(ids, null))
    }
  }, [data])

  useEffect(() => {
    if (tiers) localStorage.setItem(STORAGE_KEY, JSON.stringify(tiers))
  }, [tiers])

  const decksById = Object.fromEntries((data?.decks ?? []).map(d => [d.id, d]))
  const eloById = Object.fromEntries((eloData ?? []).map(d => [d.deck_id, d.rating]))
  const totalDecks = data?.decks?.length ?? 0
  const caps = totalDecks > 0 ? computeCaps(totalDecks) : null

  function handleSuggest() {
    if (!data?.decks || !caps || !eloData) return
    const activeDeckIds = new Set(data.decks.map(d => d.id))
    // Sort active decks by Elo desc; unrated decks go last
    const sorted = data.decks
      .slice()
      .sort((a, b) => (eloById[b.id] ?? 0) - (eloById[a.id] ?? 0))
    const newTiers = { S: [], A: [], B: [], C: [], D: [], F: [], unranked: [] }
    for (const deck of sorted) {
      let placed = false
      for (const tier of TIERS) {
        if (newTiers[tier].length < caps[tier]) {
          newTiers[tier].push(deck.id)
          placed = true
          break
        }
      }
      if (!placed) newTiers.unranked.push(deck.id)
    }
    setTiers(newTiers)
  }

  function isTierFull(tier) {
    if (!caps || !tiers) return false
    return tiers[tier].length >= caps[tier]
  }

  function canDropInto(tier) {
    if (!dragging) return true
    if (dragging.fromTier === tier) return true // reordering within same tier
    return !isTierFull(tier)
  }

  function handleDragStart(e, deckId, fromTier) {
    setDragging({ deckId, fromTier })
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() {
    setDragging(null)
    setDropTarget(null)
  }

  function handleCardDragOver(e, tier, beforeId) {
    if (!canDropInto(tier)) return // no preventDefault → browser shows ⊘ cursor
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(prev =>
      prev?.tier === tier && prev?.beforeId === beforeId ? prev : { tier, beforeId }
    )
  }

  function handleTierDragOver(e, tier) {
    if (!canDropInto(tier)) return
    e.preventDefault()
    setDropTarget(prev =>
      prev?.tier === tier && prev?.beforeId == null ? prev : { tier, beforeId: null }
    )
  }

  function handleDrop(e, tier) {
    e.preventDefault()
    if (!dragging || !canDropInto(tier)) return
    const { deckId } = dragging
    const beforeId = dropTarget?.tier === tier ? (dropTarget?.beforeId ?? null) : null

    setTiers(prev => {
      const next = {}
      for (const t of [...TIERS, 'unranked']) {
        next[t] = (prev[t] || []).filter(id => id !== deckId)
      }
      if (beforeId == null) {
        next[tier] = [...next[tier], deckId]
      } else {
        const idx = next[tier].indexOf(beforeId)
        next[tier].splice(idx >= 0 ? idx : next[tier].length, 0, deckId)
      }
      return next
    })

    setDragging(null)
    setDropTarget(null)
  }

  function handleReset() {
    if (!data?.decks) return
    setTiers(initTiers(data.decks.map(d => d.id), null))
  }

  if (isLoading || !tiers) {
    return <div className={styles.loading}>Loading decks…</div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Tier List</h1>
        <div className={styles.headerActions}>
          {eloData && (
            <button className={styles.suggestBtn} onClick={handleSuggest} title="Auto-fill tiers by Elo rating">
              Suggest
            </button>
          )}
          <button className={styles.resetBtn} onClick={handleReset}>Reset</button>
        </div>
      </div>

      <div className={styles.tiers}>
        {TIERS.map(tier => {
          const filled = tiers[tier].length
          const cap = caps?.[tier] ?? '?'
          const full = filled >= cap
          const blocked = dragging && dragging.fromTier !== tier && full
          return (
            <div
              key={tier}
              className={[
                styles.tierRow,
                styles[`tier${tier}`],
                full ? styles.tierFull : '',
                blocked ? styles.tierBlocked : '',
                dropTarget?.tier === tier ? styles.tierRowOver : '',
              ].join(' ')}
              onDragOver={e => handleTierDragOver(e, tier)}
              onDrop={e => handleDrop(e, tier)}
            >
              <div className={styles.tierLabel}>
                <span className={styles.tierLetter}>{tier}</span>
                <span className={styles.tierCap}>{filled}/{cap}</span>
              </div>
              <div className={styles.tierCards}>
                {tiers[tier].map(id => (
                  <DeckCard
                    key={id}
                    deck={decksById[id]}
                    rating={eloById[id]}
                    fromTier={tier}
                    isDragging={dragging?.deckId === id}
                    isDropBefore={dropTarget?.tier === tier && dropTarget?.beforeId === id}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onCardDragOver={handleCardDragOver}
                  />
                ))}
                {tiers[tier].length === 0 && (
                  <span className={styles.emptyHint}>Drop here</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

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
            <p className={styles.allRanked}>All decks have been ranked.</p>
          ) : (
            tiers.unranked.map(id => (
              <DeckCard
                key={id}
                deck={decksById[id]}
                rating={eloById[id]}
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
    </div>
  )
}

function DeckCard({ deck, rating, fromTier, isDragging, isDropBefore, onDragStart, onDragEnd, onCardDragOver }) {
  if (!deck) return null
  return (
    <div className={styles.cardWrap}>
      {isDropBefore && <div className={styles.dropLine} />}
      <div
        className={`${styles.card} ${isDragging ? styles.cardDragging : ''}`}
        draggable
        onDragStart={e => onDragStart(e, deck.id, fromTier)}
        onDragEnd={onDragEnd}
        onDragOver={e => onCardDragOver(e, fromTier, deck.id)}
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
