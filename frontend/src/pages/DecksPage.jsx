import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '../api'
import DeckCard from '../components/DeckCard'
import AddDeckModal from '../components/AddDeckModal'
import styles from './DecksPage.module.css'

const SORT_OPTIONS = [
  { value: 'games', label: 'Most Played' },
  { value: 'win_rate', label: 'Win Rate' },
  { value: 'avg_placement', label: 'Avg Placement' },
  { value: 'cmc', label: 'Commander CMC' },
]

const COLORS = ['W', 'U', 'B', 'R', 'G']

export default function DecksPage() {
  const [sort, setSort] = useState('games')
  const [colours, setColours] = useState([])
  const [owner, setOwner] = useState('')
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)

  const { data: playersData } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const brewers = playersData?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? []

  const params = {
    sort,
    page,
    page_size: 24,
    ...(colours.length && { colours }),
    ...(owner && { owner }),
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['decks', sort, colours.join(','), owner, page],
    queryFn: () => api.decks(params),
  })

  const totalPages = data ? Math.ceil(data.total / 24) : 1

  function reset() {
    setColours([])
    setOwner('')
    setSort('games')
    setPage(1)
  }

  const hasFilters = colours.length > 0 || owner || sort !== 'games'

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <h1 className={styles.title}>Decks</h1>
          {data && <span className={styles.count}>{data.total} decks</span>}
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + Add Deck
        </button>
      </div>

      <div className={styles.filterBar}>
        {/* Colour pips */}
        <div className={styles.filterSection}>
          <span className={styles.filterLabel}>Colour</span>
          <div className={styles.colorPips}>
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => {
                  setColours(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
                  setPage(1)
                }}
                className={`${styles.colorPip} ${styles[`pip_${c}`]} ${colours.includes(c) ? styles.pipActive : ''}`}
                title={c}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider} />

        {/* Brewer */}
        <div className={styles.filterSection}>
          <span className={styles.filterLabel}>Brewer</span>
          <div className={styles.brewerPills}>
            {brewers.map(p => (
              <button
                key={p.id}
                onClick={() => { setOwner(owner === String(p.id) ? '' : String(p.id)); setPage(1) }}
                className={`${styles.brewerPill} ${owner === String(p.id) ? styles.brewerActive : ''}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider} />

        {/* Sort */}
        <div className={styles.filterSection}>
          <span className={styles.filterLabel}>Sort</span>
          <select
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(1) }}
            className={styles.sortSelect}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button className={styles.clearBtn} onClick={reset}>Clear</button>
        )}
      </div>

      {isLoading && (
        <div className={styles.state}>
          <div className={styles.spinner} />
          <p>Consulting the archives…</p>
        </div>
      )}

      {isError && (
        <div className={styles.state}>
          <p className={styles.errorText}>Failed to load decks.</p>
        </div>
      )}

      {data && (
        <>
          <motion.div
            className={styles.grid}
            key={`${sort}-${colours.join('')}-${owner}-${page}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {data.decks.map((deck, i) => (
              <motion.div
                key={deck.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03, duration: 0.25 }}
              >
                <DeckCard deck={deck} />
              </motion.div>
            ))}
          </motion.div>

          {data.decks.length === 0 && (
            <div className={styles.state}>
              <p>No decks match these filters.</p>
            </div>
          )}

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >←</button>
              <span className={styles.pageInfo}>{page} / {totalPages}</span>
              <button
                className={styles.pageBtn}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >→</button>
            </div>
          )}
        </>
      )}

      {showAdd && <AddDeckModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
