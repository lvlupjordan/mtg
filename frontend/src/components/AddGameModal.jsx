import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import styles from './AddGameModal.module.css'

const today = () => new Date().toISOString().slice(0, 10)

const emptySeat = () => ({ deck_id: '', pilot_id: '', placement: '', victory_condition: '' })

export default function AddGameModal({ onClose }) {
  const qc = useQueryClient()

  const { data: playersData } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const { data: decksData } = useQuery({
    queryKey: ['decks-all'],
    queryFn: () => api.decks({ page_size: 100, sort: 'games' }),
  })

  const players = playersData?.filter(p => p.name !== 'Random') ?? []
  const decks = decksData?.decks ?? []

  const [date, setDate] = useState(today())
  const [seats, setSeats] = useState([emptySeat(), emptySeat(), emptySeat(), emptySeat()])
  const [error, setError] = useState(null)

  const mutation = useMutation({
    mutationFn: api.createGame,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['games'] })
      onClose()
    },
    onError: (e) => setError(e.message),
  })

  function updateSeat(i, field, value) {
    setSeats(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  function addSeat() {
    setSeats(prev => [...prev, emptySeat()])
  }

  function removeSeat(i) {
    setSeats(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    const filledSeats = seats.filter(s => s.deck_id && s.pilot_id && s.placement !== '')
    if (filledSeats.length < 2) return setError('At least 2 seats required')

    const placements = filledSeats.map(s => parseFloat(s.placement))
    if (placements.some(isNaN)) return setError('All placements must be numbers')
    if (!placements.includes(1)) return setError('At least one player must be placed 1st')

    mutation.mutate({
      played_at: date,
      variant: 'Commander',
      seats: filledSeats.map(s => ({
        deck_id: parseInt(s.deck_id),
        pilot_id: parseInt(s.pilot_id),
        placement: parseFloat(s.placement),
        victory_condition: s.victory_condition || null,
        is_archenemy: false,
      })),
    })
  }

  // Group decks by builder for the select
  const decksByBuilder = decks.reduce((acc, d) => {
    const key = d.builder?.name ?? 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(d)
    return acc
  }, {})

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
            <h2>Record Game</h2>
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label>Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={styles.input}
              />
            </div>

            <div className={styles.seatsSection}>
              <div className={styles.seatsHeader}>
                <span className={styles.seatsLabel}>Seats</span>
                <div className={styles.colHeaders}>
                  <span />
                  <span>Deck</span>
                  <span>Pilot</span>
                  <span>Place</span>
                  <span>Win Con</span>
                  <span />
                </div>
              </div>

              {seats.map((seat, i) => (
                <div key={i} className={styles.seatRow}>
                  <span className={styles.seatNum}>{i + 1}</span>

                  <select
                    value={seat.deck_id}
                    onChange={e => updateSeat(i, 'deck_id', e.target.value)}
                    className={styles.select}
                  >
                    <option value="">Deck…</option>
                    {Object.entries(decksByBuilder).map(([builder, bDecks]) => (
                      <optgroup key={builder} label={builder}>
                        {bDecks.map(d => (
                          <option key={d.id} value={d.id}>{d.commander}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>

                  <select
                    value={seat.pilot_id}
                    onChange={e => updateSeat(i, 'pilot_id', e.target.value)}
                    className={styles.select}
                  >
                    <option value="">Pilot…</option>
                    {players.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min="1"
                    max="10"
                    step="0.5"
                    placeholder="1"
                    value={seat.placement}
                    onChange={e => updateSeat(i, 'placement', e.target.value)}
                    className={`${styles.input} ${styles.placementInput}`}
                  />

                  <input
                    type="text"
                    placeholder="e.g. Combat"
                    value={seat.victory_condition}
                    onChange={e => updateSeat(i, 'victory_condition', e.target.value)}
                    className={`${styles.input} ${styles.vcInput}`}
                  />

                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeSeat(i)}
                    disabled={seats.length <= 2}
                  >✕</button>
                </div>
              ))}

              <button type="button" className={styles.addSeatBtn} onClick={addSeat}>
                + Add Seat
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button type="submit" className={styles.submitBtn} disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Record Game'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
