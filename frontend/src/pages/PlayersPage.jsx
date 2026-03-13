import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import styles from './PlayersPage.module.css'

function WinBar({ rate }) {
  return (
    <div className={styles.winBar}>
      <div className={styles.winFill} style={{ width: `${Math.round(rate * 100)}%` }} />
    </div>
  )
}

export default function PlayersPage() {
  const { data: players, isLoading } = useQuery({ queryKey: ['players'], queryFn: api.players })

  const ranked = (players?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? [])
    .sort((a, b) => b.win_rate - a.win_rate)

  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [addError, setAddError] = useState(null)

  const addPlayer = useMutation({
    mutationFn: api.createPlayer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['players'] })
      setName('')
      setShowAdd(false)
      setAddError(null)
    },
    onError: (e) => setAddError(e.message),
  })

  function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    addPlayer.mutate({ name: name.trim() })
  }

  if (isLoading) return (
    <div className={styles.state}>
      <div className={styles.spinner} />
      <p>Consulting the archives…</p>
    </div>
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Players</h1>
          <span className={styles.count}>{ranked.length} players</span>
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(s => !s)}>
          + Add Player
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.form
            className={styles.addForm}
            onSubmit={handleAdd}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <input
              autoFocus
              className={styles.addInput}
              placeholder="Player name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <button type="submit" className={styles.addSubmit} disabled={addPlayer.isPending}>
              {addPlayer.isPending ? '…' : 'Add'}
            </button>
            <button type="button" className={styles.addCancel} onClick={() => setShowAdd(false)}>Cancel</button>
            {addError && <span className={styles.addError}>{addError}</span>}
          </motion.form>
        )}
      </AnimatePresence>

      <div className={styles.table}>
        <div className={styles.tableHead}>
          <span className={styles.colRank}>#</span>
          <span className={styles.colName}>Player</span>
          <span className={styles.colStat}>Games</span>
          <span className={styles.colStat}>Wins</span>
          <span className={styles.colWr}>Win Rate</span>
          <span className={styles.colStat}>Avg Place</span>
        </div>

        {ranked.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: 0.2 }}
          >
            <Link to={`/players/${p.id}`} className={styles.row}>
              <span className={`${styles.colRank} ${i < 3 ? styles[`rank${i}`] : ''}`}>
                {i + 1}
              </span>
              <span className={styles.colName}>
                <span className={styles.playerName}>{p.name}</span>
              </span>
              <span className={styles.colStat}>{p.games}</span>
              <span className={styles.colStat} style={{ color: 'var(--win)' }}>{p.wins}</span>
              <span className={styles.colWr}>
                <span className={styles.wrPct} style={{
                  color: p.win_rate >= 0.4 ? 'var(--win)' : p.win_rate >= 0.25 ? 'var(--gold)' : 'var(--text-dim)'
                }}>
                  {Math.round(p.win_rate * 100)}%
                </span>
                <WinBar rate={p.win_rate} />
              </span>
              <span className={styles.colStat} style={{
                color: p.avg_placement <= 2 ? 'var(--win)' : p.avg_placement >= 3 ? 'var(--loss)' : 'var(--text)'
              }}>
                {p.avg_placement}
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
