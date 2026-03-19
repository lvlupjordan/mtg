import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import styles from './TierlistPage.module.css'

const TIERS = ['S', 'A', 'B', 'C', 'D', 'F']
const TIER_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5, unranked: 6 }
const WEIGHTS = [1, 2, 3, 3, 2, 1]
const STORAGE_KEY = (userId) => userId ? `wooberg-tierlist-user-${userId}` : 'wooberg-tierlist-v1'
const IDENTITY_KEY = 'wooberg-identity'

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

function tierDistance(t1, t2) {
  return Math.abs((TIER_ORDER[t1] ?? 6) - (TIER_ORDER[t2] ?? 6))
}

function getDeckTier(tiers, deckId) {
  for (const tier of [...TIERS, 'unranked']) {
    if (tiers[tier]?.includes(deckId)) return tier
  }
  return 'unranked'
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

  const [identity, setIdentity] = useState(() => {
    try { return JSON.parse(localStorage.getItem(IDENTITY_KEY)) } catch { return null }
  })
  const [tiers, setTiers] = useState(null)
  const [mode, setMode] = useState('edit') // 'edit' | 'compare'
  const [compareA, setCompareA] = useState(null) // user_id
  const [compareB, setCompareB] = useState(null) // user_id
  const [saveStatus, setSaveStatus] = useState(null) // null | 'saving' | 'saved' | 'error'
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  // Persist identity
  useEffect(() => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
  }, [identity])

  // Load tiers: from localStorage, falling back to DB if identified
  useEffect(() => {
    if (!data?.decks) return
    const ids = data.decks.map(d => d.id)
    const key = STORAGE_KEY(identity?.id)

    const tryInit = (saved) => setTiers(initTiers(ids, saved))

    try {
      const local = JSON.parse(localStorage.getItem(key))
      if (local) { tryInit(local); return }
    } catch {}

    if (identity?.id) {
      api.tierlist(identity.id)
        .then(res => tryInit(res.tiers))
        .catch(() => tryInit(null))
    } else {
      tryInit(null)
    }
  }, [data, identity])

  // Auto-save to localStorage on every change
  useEffect(() => {
    if (!tiers) return
    localStorage.setItem(STORAGE_KEY(identity?.id), JSON.stringify(tiers))
  }, [tiers, identity])

  const saveMutation = useMutation({
    mutationFn: () => api.saveTierlist(identity.id, tiers),
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

  const decksById = Object.fromEntries((data?.decks ?? []).map(d => [d.id, d]))
  const eloById = Object.fromEntries((eloData ?? []).map(d => [d.deck_id, d.rating]))
  const totalDecks = data?.decks?.length ?? 0
  const caps = totalDecks > 0 ? computeCaps(totalDecks) : null

  function handleIdentityChange(e) {
    const val = e.target.value
    if (!val) { setIdentity(null); return }
    const player = players?.find(p => p.id === parseInt(val))
    if (player) setIdentity({ id: player.id, name: player.name })
  }

  function isTierFull(tier) {
    if (!caps || !tiers) return false
    return tiers[tier].length >= caps[tier]
  }

  function canDropInto(tier) {
    if (!dragging) return true
    if (dragging.fromTier === tier) return true
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
    if (!canDropInto(tier)) return
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

  function handleSuggest() {
    if (!data?.decks || !caps || !eloData) return
    const sorted = data.decks.slice().sort((a, b) => (eloById[b.id] ?? 0) - (eloById[a.id] ?? 0))
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

  // ── Compare helpers ──────────────────────────────────────────────────────
  const publishedUsers = allTierlists ?? []

  function getTiersForUser(userId) {
    const found = publishedUsers.find(t => t.user_id === userId)
    return found?.tiers ?? null
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (isLoading || !tiers) {
    return <div className={styles.loading}>Loading decks…</div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Tier List</h1>
          <select
            className={styles.identityPicker}
            value={identity?.id ?? ''}
            onChange={handleIdentityChange}
          >
            <option value="">Anonymous</option>
            {(players ?? [])
              .filter(p => !['Random', 'Precon', 'Stranger'].includes(p.name))
              .map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))
            }
          </select>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.modeToggle}>
            <button
              className={`${styles.modeBtn} ${mode === 'edit' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('edit')}
            >My List</button>
            <button
              className={`${styles.modeBtn} ${mode === 'compare' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('compare')}
              disabled={publishedUsers.length < 2}
              title={publishedUsers.length < 2 ? 'At least 2 published lists needed' : ''}
            >Compare</button>
          </div>

          {mode === 'edit' && (
            <>
              {eloData && (
                <button className={styles.suggestBtn} onClick={handleSuggest}>Suggest</button>
              )}
              {identity && (
                <button
                  className={styles.publishBtn}
                  onClick={() => saveMutation.mutate()}
                  disabled={saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Error' : 'Publish'}
                </button>
              )}
              <button className={styles.resetBtn} onClick={handleReset}>Reset</button>
            </>
          )}
        </div>
      </div>

      {mode === 'edit' ? (
        <EditView
          tiers={tiers}
          caps={caps}
          decksById={decksById}
          eloById={eloById}
          dragging={dragging}
          dropTarget={dropTarget}
          handleDragStart={handleDragStart}
          handleDragEnd={handleDragEnd}
          handleCardDragOver={handleCardDragOver}
          handleTierDragOver={handleTierDragOver}
          handleDrop={handleDrop}
          isTierFull={isTierFull}
        />
      ) : (
        <CompareView
          publishedUsers={publishedUsers}
          compareA={compareA}
          compareB={compareB}
          setCompareA={setCompareA}
          setCompareB={setCompareB}
          decksById={decksById}
          eloById={eloById}
          getTiersForUser={getTiersForUser}
        />
      )}
    </div>
  )
}

// ── Edit View ────────────────────────────────────────────────────────────────

function EditView({ tiers, caps, decksById, eloById, dragging, dropTarget,
  handleDragStart, handleDragEnd, handleCardDragOver, handleTierDragOver, handleDrop, isTierFull }) {
  return (
    <>
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
    </>
  )
}

// ── Compare View ─────────────────────────────────────────────────────────────

function CompareView({ publishedUsers, compareA, compareB, setCompareA, setCompareB,
  decksById, eloById, getTiersForUser }) {

  const userA = compareA ?? publishedUsers[0]?.user_id ?? null
  const userB = compareB ?? publishedUsers[1]?.user_id ?? null
  const tiersA = getTiersForUser(userA)
  const tiersB = getTiersForUser(userB)

  const nameA = publishedUsers.find(u => u.user_id === userA)?.user_name ?? '—'
  const nameB = publishedUsers.find(u => u.user_id === userB)?.user_name ?? '—'

  return (
    <div className={styles.compareWrap}>
      <div className={styles.comparePickers}>
        <select className={styles.comparePicker} value={userA ?? ''} onChange={e => setCompareA(parseInt(e.target.value))}>
          {publishedUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.user_name}</option>)}
        </select>
        <span className={styles.compareVs}>vs</span>
        <select className={styles.comparePicker} value={userB ?? ''} onChange={e => setCompareB(parseInt(e.target.value))}>
          {publishedUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.user_name}</option>)}
        </select>
      </div>

      {tiersA && tiersB ? (
        <div className={styles.compareLists}>
          <CompareList label={nameA} tiers={tiersA} otherTiers={tiersB} decksById={decksById} eloById={eloById} />
          <CompareList label={nameB} tiers={tiersB} otherTiers={tiersA} decksById={decksById} eloById={eloById} />
        </div>
      ) : (
        <p className={styles.compareEmpty}>Select two published lists to compare.</p>
      )}
    </div>
  )
}

function CompareList({ label, tiers, otherTiers, decksById, eloById }) {
  return (
    <div className={styles.compareCol}>
      <div className={styles.compareColHeader}>{label}</div>
      <div className={styles.compareTiers}>
        {TIERS.map(tier => (
          <div key={tier} className={`${styles.tierRow} ${styles[`tier${tier}`]} ${styles.tierRowCompare}`}>
            <div className={styles.tierLabel}>
              <span className={styles.tierLetter}>{tier}</span>
            </div>
            <div className={styles.tierCards}>
              {(tiers[tier] ?? []).map(id => {
                const otherTier = getDeckTier(otherTiers, id)
                const dist = tierDistance(tier, otherTier)
                return (
                  <DeckCard
                    key={id}
                    deck={decksById[id]}
                    rating={eloById[id]}
                    diffDistance={dist}
                    readonly
                  />
                )
              })}
              {(tiers[tier] ?? []).length === 0 && (
                <span className={styles.emptyHint}>—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getDeckTier(tiers, deckId) {
  for (const tier of [...TIERS, 'unranked']) {
    if (tiers[tier]?.includes(deckId)) return tier
  }
  return 'unranked'
}

// ── Deck Card ─────────────────────────────────────────────────────────────────

function DeckCard({ deck, rating, fromTier, isDragging, isDropBefore, diffDistance,
  onDragStart, onDragEnd, onCardDragOver, readonly }) {
  if (!deck) return null

  const diffClass = diffDistance >= 3 ? styles.diffHigh
    : diffDistance === 2 ? styles.diffMid
    : diffDistance === 1 ? styles.diffLow
    : ''

  return (
    <div className={styles.cardWrap}>
      {isDropBefore && <div className={styles.dropLine} />}
      <div
        className={`${styles.card} ${isDragging ? styles.cardDragging : ''} ${diffClass}`}
        draggable={!readonly}
        onDragStart={!readonly ? e => onDragStart(e, deck.id, fromTier) : undefined}
        onDragEnd={!readonly ? onDragEnd : undefined}
        onDragOver={!readonly ? e => onCardDragOver(e, fromTier, deck.id) : undefined}
        title={`${deck.name} — ${deck.commander}${rating != null ? ` · ${Math.round(rating)} Elo` : ''}${diffDistance > 0 ? ` · ${diffDistance} tier${diffDistance > 1 ? 's' : ''} apart` : ''}`}
      >
        {deck.image_uri
          ? <img src={deck.image_uri} className={styles.cardArt} alt="" draggable={false} />
          : <div className={styles.cardNoArt} />
        }
        {rating != null && (
          <div className={styles.ratingBadge}>{Math.round(rating)}</div>
        )}
        {diffDistance > 0 && (
          <div className={styles.diffBadge}>{diffDistance > 0 ? `±${diffDistance}` : ''}</div>
        )}
        <div className={styles.cardOverlay}>
          <span className={styles.cardName}>{deck.name}</span>
          <span className={styles.cardCommander}>{deck.commander}</span>
        </div>
      </div>
    </div>
  )
}
