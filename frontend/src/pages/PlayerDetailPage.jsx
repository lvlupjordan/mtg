import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import ColorPips from '../components/ColorPips'
import AddPlayerModal from '../components/AddPlayerModal'
import styles from './PlayerDetailPage.module.css'

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox%3D%220 0 265 370%22%3E%3Crect width%3D%22265%22 height%3D%22370%22 fill%3D%22%231a1728%22%2F%3E%3C%2Fsvg%3E'

function ColourRow({ pct, games, decks, children }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className={styles.colourRow}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <div className={styles.colourBar}>
        <div className={styles.colourFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.colourPct} style={{ color: pct >= 40 ? 'var(--win)' : pct >= 25 ? 'var(--gold)' : 'var(--text-dim)' }}>
        {pct}%
      </span>
      <span className={styles.colourGames}>{games}g</span>
      {hovered && <DeckTooltip decks={decks} />}
    </div>
  )
}

function DeckTooltip({ decks }) {
  if (!decks?.length) return null
  return (
    <AnimatePresence>
      <motion.div
        className={styles.tooltip}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.12 }}
      >
        {decks.map(d => (
          <Link key={d.id} to={`/decks/${d.id}`} className={styles.tooltipDeck}>
            <img
              src={d.image_uri || PLACEHOLDER}
              alt={d.commander}
              className={styles.tooltipImg}
            />
            <span className={styles.tooltipName}>{d.commander}</span>
            <span className={styles.tooltipWr} style={{
              color: d.win_rate >= 0.4 ? 'var(--win)' : d.win_rate >= 0.25 ? 'var(--gold)' : 'var(--text-dim)'
            }}>
              {Math.round(d.win_rate * 100)}%
            </span>
          </Link>
        ))}
      </motion.div>
    </AnimatePresence>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div className={styles.statBox}>
      <span className={styles.statValue} style={color ? { color } : {}}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function StatsPanel({ label, stats }) {
  if (!stats) return null
  const winPct = Math.round(stats.win_rate * 100)
  const winColor = winPct >= 40 ? 'var(--win)' : winPct >= 25 ? 'var(--gold)' : 'var(--text-dim)'
  return (
    <div className={styles.statsPanel}>
      <span className={styles.statsPanelLabel}>{label}</span>
      <div className={styles.statsRow}>
        <StatBox label="Games" value={stats.games} />
        <StatBox label="Wins" value={stats.wins} color="var(--win)" />
        <StatBox label="Win Rate" value={`${winPct}%`} color={winColor} />
        <StatBox
          label="Avg Place"
          value={stats.avg_placement ?? '—'}
          color={stats.avg_placement <= 2 ? 'var(--win)' : stats.avg_placement >= 3 ? 'var(--loss)' : undefined}
        />
      </div>
    </div>
  )
}

export default function PlayerDetailPage() {
  const { id } = useParams()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['player', id],
    queryFn: () => api.player(id),
  })
  const [showEdit, setShowEdit] = useState(false)

  if (isLoading) return (
    <div className={styles.state}>
      <div className={styles.spinner} />
      <p>Consulting the archives…</p>
    </div>
  )

  if (isError || !data) return (
    <div className={styles.state}>
      <p className={styles.errorText}>Player not found.</p>
      <Link to="/players" className={styles.back}>← Back to Players</Link>
    </div>
  )

  const { pilot, brewer } = data

  return (
    <motion.div className={styles.page} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <Link to="/players" className={styles.back}>← Players</Link>

      <div className={styles.hero}>
        <div className={styles.avatar}>
          {data.name.slice(0, 1).toUpperCase()}
        </div>
        <h1 className={styles.name}>{data.name}</h1>
        <button className={styles.editBtn} onClick={() => setShowEdit(true)}>Edit</button>
      </div>

      <div className={styles.statsPanels}>
        <StatsPanel label="As Pilot" stats={pilot} />
        <StatsPanel label="As Brewer" stats={brewer} />
      </div>

      <div className={styles.columns}>
        {/* Decks piloted */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Decks Piloted</h2>
          <div className={styles.deckList}>
            {pilot?.by_deck?.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Link to={`/decks/${d.id}`} className={styles.deckRow}>
                  <div className={styles.deckThumb}>
                    {d.image_uri && <img src={d.image_uri} alt={d.commander} className={styles.deckThumbImg} />}
                  </div>
                  <ColorPips colors={d.color_identity} size="sm" />
                  <span className={styles.deckName}>{d.commander}</span>
                  <span className={styles.deckGames}>{d.games}g</span>
                  <span
                    className={styles.deckWr}
                    style={{ color: d.win_rate >= 0.4 ? 'var(--win)' : d.win_rate >= 0.25 ? 'var(--gold)' : 'var(--text-dim)' }}
                  >
                    {Math.round(d.win_rate * 100)}%
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>

        <div className={styles.colourSections}>
          {/* Atomic colours */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Win Rate by Colour</h2>
            <div className={styles.colourList}>
              {pilot?.by_colour?.map((c) => {
                const pct = Math.round(c.win_rate * 100)
                const matchingDecks = pilot.by_deck?.filter(d => d.color_identity?.includes(c.colour))
                return (
                  <ColourRow key={c.colour} pct={pct} games={c.games} decks={matchingDecks}>
                    <ColorPips colors={[c.colour]} size="sm" />
                  </ColourRow>
                )
              })}
            </div>
          </section>

          {/* By commander identity */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Win Rate by Identity</h2>
            <div className={styles.colourList}>
              {pilot?.by_identity?.filter(c => c.games >= 2).map((c, i) => {
                const label = c.color_identity.length ? c.color_identity.join('') : 'C'
                const pct = Math.round(c.win_rate * 100)
                const sorted = [...c.color_identity].sort()
                const matchingDecks = pilot.by_deck?.filter(d =>
                  JSON.stringify([...(d.color_identity || [])].sort()) === JSON.stringify(sorted)
                )
                return (
                  <ColourRow key={label + i} pct={pct} games={c.games} decks={matchingDecks}>
                    <ColorPips colors={c.color_identity.length ? c.color_identity : ['C']} size="sm" />
                  </ColourRow>
                )
              })}
            </div>
          </section>
        </div>
      </div>
      {showEdit && <AddPlayerModal player={data} onClose={() => setShowEdit(false)} />}
    </motion.div>
  )
}
