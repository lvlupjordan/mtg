import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import ColorPips from './ColorPips'
import styles from './DeckCard.module.css'

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox%3D%220 0 265 370%22%3E%3Crect width%3D%22265%22 height%3D%22370%22 fill%3D%22%231a1728%22%2F%3E%3C%2Fsvg%3E'

function WinBadge({ rate, games }) {
  const pct = Math.round(rate * 100)
  const color = pct >= 40 ? 'var(--win)' : pct >= 25 ? 'var(--gold)' : 'var(--text-dim)'
  return (
    <div className={styles.winBadge}>
      <span className={styles.winPct} style={{ color }}>{pct}%</span>
      <span className={styles.winLabel}>{games} games</span>
    </div>
  )
}

export default function DeckCard({ deck }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -4 }}
    >
      <Link to={`/decks/${deck.id}`} className={styles.card}>
        <div className={styles.imageWrap}>
          <img
            src={deck.image_uri || PLACEHOLDER}
            alt={deck.commander}
            className={`${styles.image} ${!deck.active ? styles.imageRetired : ''}`}
            loading="lazy"
          />
          <div className={styles.imageFade} />
          {!deck.active && (
            <span className={styles.retiredTag}>Retired</span>
          )}
          {deck.budget && deck.active && (
            <span className={`${styles.budgetTag} ${styles[`budget_${deck.budget?.toLowerCase()}`]}`}>
              {deck.budget}
            </span>
          )}
        </div>

        <div className={styles.body}>
          <div className={styles.topRow}>
            <ColorPips colors={deck.color_identity} size="sm" />
            <WinBadge rate={deck.win_rate} games={deck.games} />
          </div>

          <h3 className={styles.commander}>{deck.commander}</h3>
          <p className={styles.builder}>by {deck.builder?.name}</p>

          {deck.strategy?.length > 0 && (
            <div className={styles.tags}>
              {deck.strategy.slice(0, 2).map(s => (
                <span key={s} className={styles.tag}>{s}</span>
              ))}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  )
}
