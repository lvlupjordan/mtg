import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '../api'
import ColorPips from '../components/ColorPips'
import AddDeckModal from '../components/AddDeckModal'
import styles from './DeckDetailPage.module.css'

const PLACEMENT_LABEL = {
  1: { label: '1st', color: 'var(--win)' },
  2: { label: '2nd', color: 'var(--gold)' },
  3: { label: '3rd', color: 'var(--text-dim)' },
  4: { label: '4th', color: 'var(--loss)' },
}

function placementLabel(p) {
  const floor = Math.floor(p)
  const meta = PLACEMENT_LABEL[floor] ?? { label: `${p}`, color: 'var(--text-dim)' }
  if (p !== floor) return { label: `${p}`, color: 'var(--neutral)' }
  return meta
}

function StatBox({ label, value, color }) {
  return (
    <div className={styles.statBox}>
      <span className={styles.statValue} style={color ? { color } : {}}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox%3D%220 0 265 370%22%3E%3Crect width%3D%22265%22 height%3D%22370%22 fill%3D%22%231a1728%22%2F%3E%3C%2Fsvg%3E'

export default function DeckDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: deck, isLoading, isError } = useQuery({
    queryKey: ['deck', id],
    queryFn: () => api.deck(id),
  })

  const [showEdit, setShowEdit] = useState(false)

  const toggleActive = useMutation({
    mutationFn: (active) => api.patchDeck(id, { active }),
    onSuccess: (data) => {
      qc.setQueryData(['deck', id], old => old ? { ...old, active: data.active } : old)
      qc.invalidateQueries({ queryKey: ['decks'] })
    },
  })

  if (isLoading) {
    return (
      <div className={styles.state}>
        <div className={styles.spinner} />
        <p>Consulting the archives…</p>
      </div>
    )
  }

  if (isError || !deck) {
    return (
      <div className={styles.state}>
        <p className={styles.errorText}>Deck not found.</p>
        <Link to="/decks" className={styles.back}>← Back to Decks</Link>
      </div>
    )
  }

  const winPct = Math.round(deck.win_rate * 100)
  const winColor = winPct >= 40 ? 'var(--win)' : winPct >= 25 ? 'var(--gold)' : 'var(--text-dim)'

  return (
    <motion.div
      className={styles.page}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <Link to="/decks" className={styles.back}>← Decks</Link>

      <div className={styles.hero}>
        <div className={styles.imageWrap}>
          <img
            src={deck.image_uri || PLACEHOLDER}
            alt={deck.commander}
            className={styles.image}
          />
          <div className={styles.imageFade} />
        </div>

        <div className={styles.heroContent}>
          <div className={styles.heroTop}>
            <ColorPips colors={deck.color_identity} size="lg" />
            {deck.budget && (
              <span className={`${styles.budgetTag} ${styles[`budget_${deck.budget?.toLowerCase()}`]}`}>
                {deck.budget}
              </span>
            )}
          </div>

          <h1 className={styles.commander}>{deck.commander}</h1>
          <div className={styles.builderRow}>
            <p className={styles.builder}>
              Brewed by <strong>{deck.builder?.name}</strong>
              {deck.commander_cmc != null && (
                <span className={styles.cmc}> · CMC {deck.commander_cmc}</span>
              )}
            </p>
            <button
              className={`${styles.activeToggle} ${deck.active ? styles.activeOn : styles.activeOff}`}
              onClick={() => toggleActive.mutate(!deck.active)}
              disabled={toggleActive.isPending}
              role="switch"
              aria-checked={deck.active}
            >
              <span className={styles.track}>
                <span className={styles.thumb} />
              </span>
              <span className={styles.toggleLabel}>{deck.active ? 'Active' : 'Retired'}</span>
            </button>
            <button className={styles.editBtn} onClick={() => setShowEdit(true)}>Edit</button>
          </div>

          {deck.strategy?.length > 0 && (
            <div className={styles.tags}>
              {deck.strategy.map(s => (
                <span key={s} className={styles.tag}>{s}</span>
              ))}
            </div>
          )}

          <div className={styles.stats}>
            <StatBox label="Games" value={deck.games} />
            <StatBox label="Wins" value={deck.wins} color="var(--win)" />
            <StatBox label="Win Rate" value={`${winPct}%`} color={winColor} />
            <StatBox
              label="Avg Place"
              value={deck.avg_placement ?? '—'}
              color={deck.avg_placement <= 2 ? 'var(--win)' : deck.avg_placement >= 3 ? 'var(--loss)' : undefined}
            />
          </div>
        </div>
      </div>

      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pilots</h2>
          <div className={styles.pilotList}>
            {deck.pilots?.map(p => (
              <div key={p.id} className={styles.pilotRow}>
                <span className={styles.pilotName}>{p.name}</span>
                <span className={styles.pilotGames}>{p.games}g</span>
                <span
                  className={styles.pilotWr}
                  style={{ color: p.win_rate >= 0.4 ? 'var(--win)' : p.win_rate >= 0.25 ? 'var(--gold)' : 'var(--text-dim)' }}
                >
                  {Math.round(p.win_rate * 100)}%
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent Games</h2>
          <div className={styles.gameList}>
            {deck.recent_games?.map(g => {
              const { label, color } = placementLabel(g.placement)
              return (
                <div key={g.game_id} className={styles.gameCard}>
                  <div className={styles.gameRow}>
                    <span className={styles.gamePlacement} style={{ color }}>{label}</span>
                    <div className={styles.gameInfo}>
                      <span className={styles.gamePilot}>{g.pilot}</span>
                      {g.victory_condition && (
                        <span className={styles.gameVc}>{g.victory_condition}</span>
                      )}
                    </div>
                    <span className={styles.gameDate}>
                      {new Date(g.played_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </span>
                  </div>
                  {g.opponents?.length > 0 && (
                    <div className={styles.opponents}>
                      {g.opponents.map(o => {
                        const { label: oLabel, color: oColor } = placementLabel(o.placement)
                        return (
                          <div key={o.deck_id} className={styles.opponent}>
                            <span className={styles.oppPlacement} style={{ color: oColor }}>{oLabel}</span>
                            <Link to={`/decks/${o.deck_id}`} className={styles.oppCommander}>
                              {o.commander}
                            </Link>
                            <span className={styles.oppPilot}>{o.pilot}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
      {showEdit && <AddDeckModal deck={deck} onClose={() => setShowEdit(false)} />}
    </motion.div>
  )
}
