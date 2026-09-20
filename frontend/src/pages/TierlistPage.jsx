import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import styles from './TierlistPage.module.css'

const TIERS = ['S', 'A', 'B', 'C', 'D', 'F']
const WEIGHTS = [1, 2, 3, 3, 2, 1]
const TIER_SCORE = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 }
const TIER_INDEX = Object.fromEntries(TIERS.map((t, i) => [t, i]))

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
  const [comparing, setComparing] = useState(false)
  const [compareWith, setCompareWith] = useState(null)
  const [ranking, setRanking] = useState(false)   // pairwise Elo builder open?

  // Land on a populated list rather than an empty page: the averaged list if any
  // exist, otherwise the always-available Elo-suggested one.
  const didDefault = useRef(false)
  useEffect(() => {
    if (didDefault.current || viewId !== null || allTierlists === undefined) return
    didDefault.current = true
    setViewId(allTierlists.length ? 'composite' : 'elo')
  }, [allTierlists, viewId])

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

  // Compare: top 5 biggest tier differences between viewId and compareWith
  const compareDiffs = useMemo(() => {
    if (!viewId || !compareWith || !data?.decks) return []
    function resolve(id) {
      if (id === 'elo') return eloTiers
      if (id === 'composite') return compositeTiers
      const pub = allTierlists?.find(t => t.user_id === id)
      return pub ? initTiers(data.decks.map(d => d.id), pub.tiers) : null
    }
    const tiersA = resolve(viewId)
    const tiersB = resolve(compareWith)
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
  }, [viewId, compareWith, data, allTierlists, eloTiers, compositeTiers])

  const viewingUser = realPlayers.find(p => p.id === viewId)

  const resetMutation = useMutation({
    mutationFn: () => api.resetTierlist(viewId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tierlists'] }),
  })
  function handleResetList() {
    if (window.confirm(`Reset ${viewingUser?.name ?? 'this player'}'s tier list? This wipes all their comparisons.`)) {
      resetMutation.mutate()
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (isLoading) return <div className={styles.loading}>Loading decks…</div>

  const displayTiers = viewTiers
  const canEdit = viewId !== null && viewId !== 'elo' && viewId !== 'composite'

  function parseId(val) {
    return val === 'elo' ? 'elo' : val === 'composite' ? 'composite' : val ? parseInt(val) : null
  }

  return (
    <div className={styles.page}>
      {ranking && canEdit && (
        <DeckRanker
          userId={viewId}
          userName={viewingUser?.name}
          onClose={() => { setRanking(false); queryClient.invalidateQueries({ queryKey: ['tierlists'] }) }}
        />
      )}
      <div className={styles.header}>
        <select
          className={styles.viewPicker}
          value={viewId ?? ''}
          onChange={e => {
            setComparing(false)
            setCompareWith(null)
            setViewId(parseId(e.target.value))
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
          {comparing ? (
            <>
              <span className={styles.compareVsLabel}>vs</span>
              <select
                className={styles.comparePicker}
                value={compareWith ?? ''}
                onChange={e => setCompareWith(parseId(e.target.value))}
              >
                <option value="" disabled>— pick —</option>
                {realPlayers.filter(p => p.id !== viewId).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {viewId !== 'elo' && <option value="elo">Elo</option>}
                {viewId !== 'composite' && <option value="composite">All Users</option>}
              </select>
              <button className={styles.cancelBtn} onClick={() => { setComparing(false); setCompareWith(null) }}>
                ← Back
              </button>
            </>
          ) : viewId !== null && (
            <>
              {canEdit && (
                <button className={styles.editBtn} onClick={() => setRanking(true)}>
                  Rank decks as {viewingUser?.name ?? '…'}
                </button>
              )}
              <button className={styles.compareBtn} onClick={() => setComparing(true)}>
                Compare lists
              </button>
              {canEdit && (
                <button className={styles.resetListBtn} onClick={handleResetList} disabled={resetMutation.isPending}>
                  {resetMutation.isPending ? 'Resetting…' : 'Reset'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {comparing ? (
        compareWith ? (
          compareDiffs.length > 0
            ? <ComparePanel diffs={compareDiffs} labelA={getLabel(viewId)} labelB={getLabel(compareWith)} />
            : <p className={styles.noList}>No ranked differences found between these two lists.</p>
        ) : (
          <p className={styles.noList}>Select a list to compare against.</p>
        )
      ) : !displayTiers ? (
        <p className={styles.noList}>
          {viewId === null
            ? 'Select a player or Elo from the dropdown.'
            : viewId === 'elo'
              ? 'Loading Elo ratings…'
              : viewId === 'composite'
                ? 'No published tier lists yet.'
                : <>
                    {viewingUser?.name ?? 'This player'} hasn't ranked any decks yet.
                    <button className={styles.editBtn} style={{ marginLeft: 12 }} onClick={() => setRanking(true)}>
                      Start ranking
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
          showRating={viewId === 'elo'}
        />
      )}
    </div>
  )
}

// ── Tier Grid (view-only) ───────────────────────────────────────────────────

function TierGrid({ tiers, caps, decksById, eloById, showRating }) {
  return (
    <div className={styles.tiers}>
      {TIERS.map(tier => {
        const filled = tiers[tier].length
        const cap = caps?.[tier] ?? '?'
        return (
          <div key={tier} className={[styles.tierRow, styles[`tier${tier}`]].join(' ')}>
            <div className={styles.tierLabel}>
              <span className={styles.tierLetter}>{tier}</span>
              <span className={styles.tierCap}>{filled}/{cap}</span>
            </div>
            <div className={styles.tierCards}>
              {tiers[tier].map(id => (
                <DeckCard
                  key={id}
                  deck={decksById[id]}
                  rating={showRating ? eloById[id] : undefined}
                />
              ))}
              {tiers[tier].length === 0 && <span className={styles.emptyHint}>—</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Deck Card (view-only) ───────────────────────────────────────────────────

function DeckCard({ deck, rating }) {
  if (!deck) return null
  return (
    <div className={styles.cardWrap}>
      <div
        className={styles.card}
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

// ── Pairwise Elo builder: Deck Comparison ───────────────────────────────────
// Two commanders sit across a gold seam. Pick the stronger (tap or ←/→): the
// winner lights up with a medallion, then the whole round slides out and the
// next pair slides in. Each pick updates the user's Elo + re-slices their tiers.

const PIP_COLOUR = { W: '#f6f1df', U: '#3f82c9', B: '#5a5563', R: '#d4544a', G: '#4fa163' }
function pipsOf(ci) {
  let cols = Array.isArray(ci) ? ci : (typeof ci === 'string' ? ci.toUpperCase().split('') : [])
  cols = [...new Set(cols)].filter(c => PIP_COLOUR[c])
  return cols
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function DuelSide({ deck, side, picked, onPick, disabled }) {
  const isWon = picked != null && deck.id === picked
  const isLost = picked != null && deck.id !== picked
  const cls = [styles.side, styles[side], isWon ? styles.chosen : '', isLost ? styles.loser : ''].join(' ')
  return (
    <button className={cls} onClick={onPick} disabled={disabled}>
      {deck.image_uri && (
        <div className={styles.sideArt} style={{ backgroundImage: `url(${deck.image_uri})` }} />
      )}
      <div className={styles.sideScrim} />
      <div className={styles.medal} aria-hidden={!isWon}>
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#eccb84"
             strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5 l4.2 4.2 L19 6.5" />
        </svg>
      </div>
      <div className={styles.sideCardWrap}>
        {deck.image_uri
          ? <img src={deck.image_uri} alt={deck.commander} className={styles.sideCard} />
          : <div className={styles.sideCardFallback}>{deck.commander}</div>}
      </div>
      <div className={styles.sidePlate}>
        <div className={styles.sideName}>{deck.commander}</div>
        {deck.builder && <div className={styles.sideBuilder}>brewed by {deck.builder}</div>}
        <div className={styles.sidePips}>
          {pipsOf(deck.color_identity).map(c => (
            <i key={c} className={styles.pip} style={{ background: PIP_COLOUR[c] }} />
          ))}
        </div>
      </div>
    </button>
  )
}

function RateChip({ side, info }) {
  const up = info.delta >= 0
  return (
    <div className={`${styles.rateChip} ${side === 'left' ? styles.rateLeft : styles.rateRight} ${up ? styles.rateUp : styles.rateDown}`}>
      <span className={styles.rateNow}>{Math.round(info.after)}</span>
      <span className={styles.rateDelta}>{up ? '▲' : '▼'} {Math.abs(Math.round(info.delta))}</span>
    </div>
  )
}

function DuelRound({ pair, picked, deltas, onPick, className = '', onAnimEnd }) {
  return (
    <div className={`${styles.round} ${className}`} onAnimationEnd={onAnimEnd}>
      <DuelSide deck={pair[0]} side="left" picked={picked}
                onPick={onPick ? () => onPick(0) : undefined} disabled={!onPick} />
      <div className={styles.seam} />
      <div className={styles.vs}>VS</div>
      <DuelSide deck={pair[1]} side="right" picked={picked}
                onPick={onPick ? () => onPick(1) : undefined} disabled={!onPick} />
      {deltas?.[pair[0].id] && <RateChip side="left" info={deltas[pair[0].id]} />}
      {deltas?.[pair[1].id] && <RateChip side="right" info={deltas[pair[1].id]} />}
    </div>
  )
}

// wait for a pair's art to decode so it doesn't pop in mid-slide (capped so a
// slow image never stalls the flow)
function preloadPair(pair) {
  return Promise.race([
    Promise.all(pair.filter(d => d.image_uri).map(d => new Promise(res => {
      const im = new Image(); im.onload = im.onerror = res; im.src = d.image_uri
    }))),
    sleep(600),
  ])
}

function DeckRanker({ userId, userName, onClose }) {
  const queryClient = useQueryClient()
  const [cur, setCur] = useState(null)
  const [incoming, setIncoming] = useState(null)   // next pair, mounted for the slide
  const [picked, setPicked] = useState(null)       // winner deck id (drives the beat)
  const [deltas, setDeltas] = useState(null)        // {deckId: {before, after, delta}} debug HUD
  const [count, setCount] = useState(0)
  const busy = useRef(false)

  async function loadFirst() {
    const r = await api.tierlistNextPair(userId)
    setCur(r.pair); setCount(r.total)
  }
  useEffect(() => { loadFirst() /* eslint-disable-next-line */ }, [userId])

  async function pick(i) {
    if (busy.current || !cur || incoming) return
    busy.current = true
    const winner = cur[i], loser = cur[1 - i]
    setPicked(winner.id)
    try {
      const r = await api.tierlistCompare(userId, winner.id, loser.id)
      setCount(r.total)
      if (r.winner && r.loser) setDeltas({ [r.winner.id]: r.winner, [r.loser.id]: r.loser })
      queryClient.invalidateQueries({ queryKey: ['tierlists'] })
      await sleep(1200)   // hold the medallion + rating change long enough to read
      const np = await api.tierlistNextPair(userId)
      if (np.pair) { await preloadPair(np.pair); setIncoming(np.pair) }
      else { setPicked(null); setDeltas(null); busy.current = false }
    } catch {
      setPicked(null); setDeltas(null); busy.current = false
    }
  }

  // the incoming round's slide-in finishes → it becomes the current round
  function promote(e) {
    if (e.target !== e.currentTarget || !incoming) return   // ignore child (medal/slam) animations
    setCur(incoming)
    setIncoming(null)
    setPicked(null)
    setDeltas(null)
    busy.current = false
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return }
      if (busy.current || incoming || !cur) return
      if (e.key === 'ArrowLeft') pick(0)
      else if (e.key === 'ArrowRight') pick(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-bind each render so cur/incoming are current

  return (
    <div className={styles.arena}>
      <div className={styles.arenaTop}>
        <span className={styles.arenaBrand}>Wooberg <span className={styles.arenaThin}>· Deck Comparison</span></span>
        <span className={styles.arenaTally}>
          <b>{count}</b> comparison{count === 1 ? '' : 's'} · {userName}
        </span>
        <button className={styles.arenaDone} onClick={onClose}>Done</button>
      </div>

      <div className={styles.stage}>
        {!cur ? (
          <p className={styles.arenaLoading}>Loading decks…</p>
        ) : (
          <>
            <DuelRound
              key={`${cur[0].id}-${cur[1].id}`}
              pair={cur} picked={picked} deltas={deltas}
              onPick={incoming ? null : pick}
              className={incoming ? styles.slideOut : ''}
            />
            {incoming && (
              <DuelRound
                key={`in-${incoming[0].id}-${incoming[1].id}`}
                pair={incoming} picked={null} onPick={null}
                className={styles.slideIn} onAnimEnd={promote}
              />
            )}
          </>
        )}
      </div>

      <div className={styles.arenaFoot}>
        <div className={styles.arenaQ}>Which commander is stronger?</div>
        <div className={styles.arenaHints}>
          <kbd>←</kbd> / <kbd>→</kbd> choose &nbsp;·&nbsp; <kbd>esc</kbd> done
        </div>
      </div>
    </div>
  )
}
