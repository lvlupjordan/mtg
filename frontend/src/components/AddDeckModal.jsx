import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import ColorPips from './ColorPips'
import styles from './AddDeckModal.module.css'

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C']
const STRATEGIES = ['Aggro', 'Combo', 'Control', 'Tokens', 'Aristocrats', 'Graveyard', 'Ramp', 'Voltron', 'Stax', 'Spellslinger', 'Tribal', 'Lands', 'Artifacts', 'Group Hug', 'Infect']
const BUDGETS = ['Precon', 'Budget', 'Standard', 'Optimized', 'cEDH']

export default function AddDeckModal({ onClose }) {
  const qc = useQueryClient()
  const { data: players } = useQuery({ queryKey: ['players'], queryFn: api.players })

  const [form, setForm] = useState({
    commander: '',
    builder_id: '',
    color_identity: [],
    commander_cmc: '',
    strategy: [],
    budget: 'Standard',
  })
  const [error, setError] = useState(null)
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState(null)

  async function lookupScryfall() {
    if (!form.commander.trim()) return
    setLooking(true)
    setLookupError(null)
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(form.commander.split(' //')[0].trim())}`
      )
      if (!res.ok) { setLookupError('Card not found'); return }
      const card = res.json ? await res.json() : res
      const ci = (card.color_identity ?? []).map(c => c.toUpperCase())
      const cmc = card.cmc ?? ''
      setForm(f => ({ ...f, color_identity: ci, commander_cmc: cmc }))
    } catch {
      setLookupError('Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  const mutation = useMutation({
    mutationFn: api.createDeck,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decks'] })
      onClose()
    },
    onError: (e) => setError(e.message),
  })

  function toggleColor(c) {
    setForm(f => ({
      ...f,
      color_identity: f.color_identity.includes(c)
        ? f.color_identity.filter(x => x !== c)
        : [...f.color_identity, c]
    }))
  }

  function toggleStrategy(s) {
    setForm(f => ({
      ...f,
      strategy: f.strategy.includes(s)
        ? f.strategy.filter(x => x !== s)
        : [...f.strategy, s]
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!form.commander.trim()) return setError('Commander name is required')
    if (!form.builder_id) return setError('Select a brewer')
    if (form.color_identity.length === 0) return setError('Select at least one colour')
    mutation.mutate({
      ...form,
      builder_id: parseInt(form.builder_id),
      commander_cmc: form.commander_cmc ? parseFloat(form.commander_cmc) : null,
    })
  }

  const realPlayers = players?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? []

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
            <h2>Add Deck</h2>
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label>Commander</label>
              <div className={styles.commanderRow}>
                <input
                  type="text"
                  placeholder="e.g. Atraxa, Praetors' Voice"
                  value={form.commander}
                  onChange={e => setForm(f => ({ ...f, commander: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), lookupScryfall())}
                  className={styles.input}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.lookupBtn}
                  onClick={lookupScryfall}
                  disabled={looking || !form.commander.trim()}
                >
                  {looking ? '…' : 'Lookup'}
                </button>
              </div>
              {lookupError && <span className={styles.lookupError}>{lookupError}</span>}
              {!lookupError && <span className={styles.hint}>Image, colour identity and CMC fetched from Scryfall</span>}
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label>Brewer</label>
                <select
                  value={form.builder_id}
                  onChange={e => setForm(f => ({ ...f, builder_id: e.target.value }))}
                  className={styles.select}
                >
                  <option value="">Select player</option>
                  {realPlayers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label>Commander CMC</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  placeholder="e.g. 4"
                  value={form.commander_cmc}
                  onChange={e => setForm(f => ({ ...f, commander_cmc: e.target.value }))}
                  className={styles.input}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label>Colour Identity</label>
              <div className={styles.colorRow}>
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.colorBtn} ${form.color_identity.includes(c) ? styles.colorBtnActive : ''}`}
                    onClick={() => toggleColor(c)}
                  >
                    <span className={`${styles.colorPip} ${styles[`pip_${c}`]}`}>{c}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label>Budget</label>
              <div className={styles.budgetRow}>
                {BUDGETS.map(b => (
                  <button
                    key={b}
                    type="button"
                    className={`${styles.budgetBtn} ${form.budget === b ? styles.budgetBtnActive : ''}`}
                    onClick={() => setForm(f => ({ ...f, budget: b }))}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label>Strategy <span className={styles.optional}>(optional)</span></label>
              <div className={styles.strategyGrid}>
                {STRATEGIES.map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.stratBtn} ${form.strategy.includes(s) ? styles.stratBtnActive : ''}`}
                    onClick={() => toggleStrategy(s)}
                  >
                    {s}
                  </button>
                ))}
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
                {mutation.isPending ? 'Adding...' : 'Add Deck'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
