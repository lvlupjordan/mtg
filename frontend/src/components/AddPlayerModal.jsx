import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import styles from './AddPlayerModal.module.css'

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className={styles.toggleRow}>
      <button
        type="button"
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className={styles.track}>
          <span className={styles.thumb} />
        </span>
      </button>
      <div className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {hint && <span className={styles.toggleHint}>{hint}</span>}
      </div>
    </div>
  )
}

export default function AddPlayerModal({ onClose, player = null }) {
  const qc = useQueryClient()

  const [form, setForm] = useState(player ? {
    name: player.name || '',
    show_as_brewer: player.show_as_brewer ?? true,
    include_in_data: player.include_in_data ?? true,
  } : {
    name: '',
    show_as_brewer: true,
    include_in_data: true,
  })
  const [error, setError] = useState(null)

  const mutation = useMutation({
    mutationFn: player
      ? (data) => api.patchPlayer(player.id, data)
      : api.createPlayer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['players'] })
      if (player) qc.invalidateQueries({ queryKey: ['player', String(player.id)] })
      onClose()
    },
    onError: (e) => setError(e.message),
  })

  function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('Name is required')
    mutation.mutate(form)
  }

  return (
    <AnimatePresence>
      <motion.div
        className={styles.backdrop}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className={styles.modal}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.header}>
            <h2>{player ? 'Edit Player' : 'Add Player'}</h2>
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label>Name</label>
              <input
                type="text"
                className={styles.input}
                placeholder="Player name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label>Flags</label>
              <div className={styles.toggleList}>
                <Toggle
                  label="Show as brewer"
                  hint="Appears in the brewer dropdown when adding a deck"
                  checked={form.show_as_brewer}
                  onChange={v => setForm(f => ({ ...f, show_as_brewer: v }))}
                />
                <Toggle
                  label="Include in data"
                  hint="Included in stats and leaderboards"
                  checked={form.include_in_data}
                  onChange={v => setForm(f => ({ ...f, include_in_data: v }))}
                />
              </div>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button type="button" className={styles.cancelBtn} onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Saving…' : player ? 'Save Changes' : 'Add Player'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
