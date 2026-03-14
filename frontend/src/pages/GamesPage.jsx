import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../api'
import ColorPips from '../components/ColorPips'
import AddGameModal from '../components/AddGameModal'
import styles from './GamesPage.module.css'

const PLACEMENT_LABEL = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
}

function placementLabel(p) {
  if (p === Math.floor(p)) return PLACEMENT_LABEL[p] ?? `${p}`
  return `${p}`
}

function placementColor(p) {
  if (p === 1) return 'var(--win)'
  if (p >= 3) return 'var(--loss)'
  return 'var(--text-dim)'
}

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox%3D%220 0 265 370%22%3E%3Crect width%3D%22265%22 height%3D%22370%22 fill%3D%22%231a1728%22%2F%3E%3C%2Fsvg%3E'

function GameCard({ game, index, onEdit }) {
  const seats = [...(game.seats ?? [])].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
  const winner = seats.find(s => s.placement === 1)

  return (
    <motion.div
      className={styles.gameCard}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
    >
      <div className={styles.gameHeader}>
        <div className={styles.gameHeaderLeft}>
          <span className={styles.gameId}>Game #{game.id}</span>
          <span className={styles.gameDate}>
            {new Date(game.played_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {game.turn_count && <span className={styles.gameMeta}>{game.turn_count} turns</span>}
        </div>
        <div className={styles.gameHeaderRight}>
          {winner && (
            <span className={styles.winnerBadge}>
              <span className={styles.winnerCrown}>♛</span>
              {winner.pilot.name}
              {winner.victory_condition && <span className={styles.vc}> · {winner.victory_condition}</span>}
            </span>
          )}
          <button className={styles.editBtn} onClick={onEdit}>✎</button>
        </div>
      </div>

      <div className={styles.seats}>
        {seats.map(s => (
          <div key={s.seat} className={`${styles.seat} ${s.placement === 1 ? styles.seatWinner : ''}`}>
            <span className={styles.seatPlacement} style={{ color: placementColor(s.placement) }}>
              {placementLabel(s.placement)}
            </span>
            <Link to={`/decks/${s.deck.id}`} className={styles.seatDeck}>
              <div className={styles.seatImg}>
                {s.deck.image_uri
                  ? <img src={s.deck.image_uri} alt={s.deck.commander} />
                  : <div className={styles.seatImgPlaceholder} />
                }
              </div>
              <div className={styles.seatInfo}>
                <span className={styles.seatCommander}>{s.deck.commander}</span>
                <div className={styles.seatMeta}>
                  <ColorPips colors={s.deck.color_identity} size="sm" />
                  {s.victory_condition && s.placement === 1 && (
                    <span className={styles.seatVc}>{s.victory_condition}</span>
                  )}
                </div>
              </div>
            </Link>
            <Link to={`/players/${s.pilot.id}`} className={styles.seatPilot}>
              {s.pilot.name}
            </Link>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export default function GamesPage() {
  const [page, setPage] = useState(1)
  const [player, setPlayer] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editGame, setEditGame] = useState(null)

  const { data: playersData } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const players = playersData?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? []

  const { data, isLoading, isError } = useQuery({
    queryKey: ['games', page, player],
    queryFn: () => api.games({ page, page_size: 15, ...(player && { player }) }),
  })

  const totalPages = data ? Math.ceil(data.total / 15) : 1

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <h1 className={styles.title}>Games</h1>
          {data && <span className={styles.count}>{data.total} games</span>}
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>+ Record Game</button>
        </div>
        <div className={styles.toolbarRight}>
          <div className={styles.filterPills}>
            <button
              className={`${styles.pill} ${player === '' ? styles.pillActive : ''}`}
              onClick={() => { setPlayer(''); setPage(1) }}
            >
              All
            </button>
            {players.map(p => (
              <button
                key={p.id}
                className={`${styles.pill} ${player === String(p.id) ? styles.pillActive : ''}`}
                onClick={() => { setPlayer(String(p.id)); setPage(1) }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className={styles.state}>
          <div className={styles.spinner} />
          <p>Consulting the archives…</p>
        </div>
      )}

      {isError && (
        <div className={styles.state}>
          <p className={styles.errorText}>Failed to load games.</p>
        </div>
      )}

      {showAdd && <AddGameModal onClose={() => setShowAdd(false)} />}
      {editGame && <AddGameModal game={editGame} onClose={() => setEditGame(null)} />}

      {data && (
        <>
          <div className={styles.gameList}>
            {data.games.map((g, i) => (
              <GameCard key={g.id} game={g} index={i} onEdit={() => setEditGame(g)} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>←</button>
              <span className={styles.pageInfo}>{page} / {totalPages}</span>
              <button className={styles.pageBtn} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>→</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
