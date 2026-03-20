import { useState, useDeferredValue } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import styles from './CollectionPage.module.css'

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C']
const COLOR_LABELS = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' }
const RARITIES = ['common', 'uncommon', 'rare', 'mythic']
const CONDITIONS = ['near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged']
const CONDITION_LABELS = {
  near_mint: 'NM', lightly_played: 'LP', moderately_played: 'MP', heavily_played: 'HP', damaged: 'DMG',
}
const RARITY_COLOR = {
  common: 'var(--text-dim)',
  uncommon: '#a0b8c8',
  rare: 'var(--gold)',
  mythic: '#e8762a',
}

function CollectionCard({ entry, onEdit, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const imgSrc = entry.image_art_crop || entry.image_uri

  return (
    <motion.div
      className={styles.card}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      layout
    >
      <div className={styles.cardArt} style={imgSrc ? { backgroundImage: `url(${imgSrc})` } : {}}>
        <div className={styles.cardArtOverlay} />
        {entry.foil && <span className={styles.foilBadge}>✦ Foil</span>}
        <span
          className={styles.rarityDot}
          style={{ background: RARITY_COLOR[entry.rarity] || 'var(--text-dim)' }}
          title={entry.rarity}
        />
        <AnimatePresence>
          {hovered && (
            <motion.div
              className={styles.cardActions}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <button onClick={() => onEdit(entry)} className={styles.actionBtn}>Edit</button>
              <button onClick={() => onDelete(entry)} className={`${styles.actionBtn} ${styles.actionBtnDanger}`}>Remove</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardName}>{entry.name}</div>
        <div className={styles.cardMeta}>
          <span className={styles.cardSet}>{entry.set_code?.toUpperCase()} #{entry.collector_number}</span>
          {entry.quantity > 1 && <span className={styles.cardQty}>×{entry.quantity}</span>}
        </div>
        {entry.condition && entry.condition !== 'near_mint' && (
          <span className={styles.conditionBadge}>{CONDITION_LABELS[entry.condition] || entry.condition}</span>
        )}
      </div>
    </motion.div>
  )
}

function TagChip({ tag, active, onClick }) {
  return (
    <button className={`${styles.tagChip} ${active ? styles.tagChipActive : ''}`} onClick={onClick}>
      {tag}
    </button>
  )
}

function AddCardModal({ owners, onClose }) {
  const [step, setStep] = useState('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const [form, setForm] = useState({
    owner_id: owners[0]?.id || '',
    quantity: 1,
    foil: false,
    condition: 'near_mint',
    language: 'en',
    purchase_price: '',
    purchase_currency: 'EUR',
  })
  const qc = useQueryClient()

  async function doSearch() {
    if (query.length < 2) return
    setSearching(true)
    try {
      const data = await api.searchScryfall(query)
      setResults(data.cards || [])
      setStep('pick')
    } finally {
      setSearching(false)
    }
  }

  async function pickCard(card) {
    await api.addCardFromScryfall(card)
    setPicked(card)
    setStep('details')
  }

  async function submitAdd() {
    await api.addToCollection({
      card_id: picked.id,
      owner_id: Number(form.owner_id),
      quantity: Number(form.quantity),
      foil: form.foil,
      condition: form.condition,
      language: form.language,
      purchase_price: form.purchase_price !== '' ? Number(form.purchase_price) : null,
      purchase_currency: form.purchase_currency,
    })
    qc.invalidateQueries({ queryKey: ['collection'] })
    onClose()
  }

  return (
    <div className={styles.modalBg} onClick={onClose}>
      <motion.div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {step === 'search' ? 'Add Card' : step === 'pick' ? 'Choose Printing' : `Add ${picked?.name}`}
          </h2>
          <div className={styles.modalHeaderRight}>
            {step !== 'search' && (
              <button className={styles.modalBack} onClick={() => setStep(step === 'details' ? 'pick' : 'search')}>
                ← Back
              </button>
            )}
            <button className={styles.modalClose} onClick={onClose}>×</button>
          </div>
        </div>

        {step === 'search' && (
          <div className={styles.searchStep}>
            <div className={styles.searchRow}>
              <input
                className={styles.searchInput}
                placeholder="Card name…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                autoFocus
              />
              <button
                className={styles.searchBtn}
                onClick={doSearch}
                disabled={searching || query.length < 2}
              >
                {searching ? '…' : 'Search'}
              </button>
            </div>
          </div>
        )}

        {step === 'pick' && (
          <div className={styles.pickGrid}>
            {results.map(card => (
              <button key={card.id} className={styles.pickCard} onClick={() => pickCard(card)}>
                {card.image_uri
                  ? <img src={card.image_uri} alt={card.name} className={styles.pickImg} />
                  : <div className={styles.pickImgBlank}>{card.name}</div>
                }
                <div className={styles.pickInfo}>
                  <div className={styles.pickName}>{card.name}</div>
                  <div className={styles.pickSet}>{card.set_name} · {card.collector_number}</div>
                  <div className={styles.pickRarity} style={{ color: RARITY_COLOR[card.rarity] }}>
                    {card.rarity}
                  </div>
                </div>
              </button>
            ))}
            {results.length === 0 && <p className={styles.noResults}>No results found.</p>}
          </div>
        )}

        {step === 'details' && picked && (
          <div className={styles.detailsStep}>
            <div className={styles.detailsPreview}>
              {picked.image_uri && (
                <img src={picked.image_uri} alt={picked.name} className={styles.detailsImg} />
              )}
              <div className={styles.detailsMeta}>
                <div className={styles.detailsName}>{picked.name}</div>
                <div className={styles.detailsSet}>{picked.set_name} · #{picked.collector_number}</div>
                {picked.type_line && <div className={styles.detailsType}>{picked.type_line}</div>}
              </div>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.formLabel}>
                Owner
                <select
                  className={styles.formSelect}
                  value={form.owner_id}
                  onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))}
                >
                  {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className={styles.formLabel}>
                Quantity
                <input
                  type="number" min="1"
                  className={styles.formInput}
                  value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                />
              </label>
              <label className={styles.formLabel}>
                Condition
                <select
                  className={styles.formSelect}
                  value={form.condition}
                  onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                >
                  {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
                </select>
              </label>
              <label className={styles.formLabel}>
                Language
                <input
                  className={styles.formInput}
                  value={form.language}
                  onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                />
              </label>
              <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
                <span className={styles.foilToggle}>
                  <input
                    type="checkbox"
                    checked={form.foil}
                    onChange={e => setForm(f => ({ ...f, foil: e.target.checked }))}
                  />
                  Foil
                </span>
              </label>
              <label className={styles.formLabel}>
                Purchase Price
                <input
                  type="number" step="0.01"
                  className={styles.formInput}
                  value={form.purchase_price}
                  onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
                  placeholder="0.00"
                />
              </label>
              <label className={styles.formLabel}>
                Currency
                <input
                  className={styles.formInput}
                  value={form.purchase_currency}
                  onChange={e => setForm(f => ({ ...f, purchase_currency: e.target.value }))}
                />
              </label>
            </div>
            <button className={styles.addBtn} onClick={submitAdd}>Add to Collection</button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function EditEntryModal({ entry, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    quantity: entry.quantity,
    foil: entry.foil,
    condition: entry.condition,
    language: entry.language,
    purchase_price: entry.purchase_price ?? '',
    purchase_currency: entry.purchase_currency,
    notes: entry.notes ?? '',
  })

  async function save() {
    await api.updateCollectionEntry(entry.entry_id, {
      ...form,
      quantity: Number(form.quantity),
      purchase_price: form.purchase_price !== '' ? Number(form.purchase_price) : null,
    })
    qc.invalidateQueries({ queryKey: ['collection'] })
    onClose()
  }

  return (
    <div className={styles.modalBg} onClick={onClose}>
      <motion.div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Edit — {entry.name}</h2>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.detailsStep}>
          <div className={styles.formGrid}>
            <label className={styles.formLabel}>
              Quantity
              <input type="number" min="1" className={styles.formInput} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </label>
            <label className={styles.formLabel}>
              Condition
              <select className={styles.formSelect} value={form.condition}
                onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
              </select>
            </label>
            <label className={styles.formLabel}>
              Language
              <input className={styles.formInput} value={form.language}
                onChange={e => setForm(f => ({ ...f, language: e.target.value }))} />
            </label>
            <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
              <span className={styles.foilToggle}>
                <input type="checkbox" checked={form.foil}
                  onChange={e => setForm(f => ({ ...f, foil: e.target.checked }))} />
                Foil
              </span>
            </label>
            <label className={styles.formLabel}>
              Purchase Price
              <input type="number" step="0.01" className={styles.formInput} value={form.purchase_price}
                onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} />
            </label>
            <label className={styles.formLabel}>
              Currency
              <input className={styles.formInput} value={form.purchase_currency}
                onChange={e => setForm(f => ({ ...f, purchase_currency: e.target.value }))} />
            </label>
            <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
              Notes
              <textarea className={styles.formTextarea} value={form.notes} rows={2}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <button className={styles.addBtn} onClick={save}>Save Changes</button>
        </div>
      </motion.div>
    </div>
  )
}

function ImportModal({ owners, onClose }) {
  const [csvFile, setCsvFile] = useState(null)
  const [ownerId, setOwnerId] = useState('')
  const [status, setStatus] = useState(null) // null | 'loading' | 'syncing' | {result}
  const qc = useQueryClient()

  async function doImport() {
    if (!csvFile) return
    setStatus('loading')
    try {
      const result = await api.importCollection(csvFile, ownerId || undefined)
      setStatus(result)
      qc.invalidateQueries({ queryKey: ['collection'] })
      qc.invalidateQueries({ queryKey: ['collectionTags'] })
    } catch (e) {
      setStatus({ error: e.message })
    }
  }

  return (
    <div className={styles.modalBg} onClick={status && status !== 'loading' ? onClose : undefined}>
      <motion.div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Import Collection</h2>
          {status !== 'loading' && <button className={styles.modalClose} onClick={onClose}>×</button>}
        </div>

        {!status && (
          <div className={styles.detailsStep}>
            <p className={styles.importHint}>
              Supports <strong>ManaBox</strong> exports (Scryfall ID + Owner columns) and <strong>MTGCB</strong> exports (Edition + Collector Number). Card data is fetched from Scryfall automatically.
            </p>
            <div className={styles.formGrid}>
              <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
                Collection CSV <span className={styles.importRequired}>required</span>
                <input
                  type="file"
                  accept=".csv"
                  className={styles.formFile}
                  onChange={e => setCsvFile(e.target.files[0] || null)}
                />
              </label>
              <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
                Owner <span className={styles.importOptional}>required for MTGCB · overrides CSV owner for ManaBox</span>
                <select
                  className={styles.formSelect}
                  value={ownerId}
                  onChange={e => setOwnerId(e.target.value)}
                >
                  <option value="">— from CSV (ManaBox only) —</option>
                  {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            </div>
            <button className={styles.addBtn} onClick={doImport} disabled={!csvFile}>
              Import
            </button>
          </div>
        )}

        {status === 'loading' && (
          <div className={styles.importProgress}>
            <div className={styles.importSpinner} />
            <p>Importing… fetching card data and oracle tags from Scryfall.</p>
          </div>
        )}

        {status && status !== 'loading' && (
          <div className={styles.detailsStep}>
            {status.error ? (
              <p className={styles.importError}>Error: {status.error}</p>
            ) : (
              <div className={styles.importResult}>
                {status.format && (
                  <p className={styles.importFormatLabel}>
                    Detected: {status.format === 'mtgcb' ? 'MTGCB' : 'ManaBox'} format
                  </p>
                )}
                <div className={styles.importStat}>
                  <span className={styles.importStatNum}>{status.entries_imported}</span>
                  <span className={styles.importStatLabel}>entries imported</span>
                </div>
                <div className={styles.importStat}>
                  <span className={styles.importStatNum}>{status.cards_new}</span>
                  <span className={styles.importStatLabel}>new cards</span>
                </div>
                {status.cards_tagged > 0 && (
                  <div className={styles.importStat}>
                    <span className={styles.importStatNum} style={{ color: 'var(--win)' }}>{status.cards_tagged}</span>
                    <span className={styles.importStatLabel}>cards tagged</span>
                  </div>
                )}
                {status.skipped > 0 && (
                  <div className={styles.importStat}>
                    <span className={styles.importStatNum} style={{ color: 'var(--text-dim)' }}>{status.skipped}</span>
                    <span className={styles.importStatLabel}>skipped</span>
                  </div>
                )}
                {status.errors?.length > 0 && (
                  <div className={styles.importErrors}>
                    {status.errors.map((e, i) => <p key={i} className={styles.importError}>{e}</p>)}
                  </div>
                )}
              </div>
            )}
            <button className={styles.addBtn} onClick={onClose}>Done</button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

export default function CollectionPage() {
  const [owner, setOwner] = useState('')
  const [q, setQ] = useState('')
  const [selectedColors, setSelectedColors] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [rarity, setRarity] = useState('')
  const [typeLine, setTypeLine] = useState('')
  const [foil, setFoil] = useState(null)
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editEntry, setEditEntry] = useState(null)

  const deferredQ = useDeferredValue(q)
  const deferredType = useDeferredValue(typeLine)

  const { data: playersData } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const players = playersData?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? []

  const ownerId = owner ? Number(owner) : null

  const { data: tagsData } = useQuery({
    queryKey: ['collectionTags', ownerId],
    queryFn: () => api.collectionTags(ownerId),
  })
  const availableTags = tagsData?.tags ?? []

  const params = {
    ...(ownerId && { owner_id: ownerId }),
    ...(deferredQ && { q: deferredQ }),
    ...(selectedColors.length && { colors: selectedColors.join(',') }),
    ...(selectedTags.length && { oracle_tags: selectedTags.join(',') }),
    ...(rarity && { rarity }),
    ...(deferredType && { type_line: deferredType }),
    ...(foil !== null && { foil }),
    page,
    page_size: 60,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['collection', params],
    queryFn: () => api.collection(params),
    keepPreviousData: true,
  })

  const qc = useQueryClient()

  function toggleColor(c) {
    setSelectedColors(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
    setPage(1)
  }
  function toggleTag(t) {
    setSelectedTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
    setPage(1)
  }

  async function handleDelete(entry) {
    if (!confirm(`Remove ${entry.name} from collection?`)) return
    await api.deleteCollectionEntry(entry.entry_id)
    qc.invalidateQueries({ queryKey: ['collection'] })
  }

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 60)
  const entries = data?.entries ?? []

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <h2 className={styles.sidebarTitle}>Collection</h2>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Owner</label>
          <select className={styles.filterSelect} value={owner} onChange={e => { setOwner(e.target.value); setPage(1) }}>
            <option value="">All</option>
            {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Name</label>
          <input className={styles.filterInput} placeholder="Search cards…" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Type</label>
          <input className={styles.filterInput} placeholder="Creature, Instant…" value={typeLine} onChange={e => { setTypeLine(e.target.value); setPage(1) }} />
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Colors</label>
          <div className={styles.colorPips}>
            {COLORS.map(c => (
              <button
                key={c}
                title={COLOR_LABELS[c]}
                className={`${styles.colorPip} ${selectedColors.includes(c) ? styles.colorPipActive : ''}`}
                onClick={() => toggleColor(c)}
              >
                <img src={`https://svgs.scryfall.io/card-symbols/${c}.svg`} alt={c} />
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Rarity</label>
          <div className={styles.rarityBtns}>
            {RARITIES.map(r => (
              <button
                key={r}
                className={`${styles.rarityBtn} ${rarity === r ? styles.rarityBtnActive : ''}`}
                style={rarity === r ? { borderColor: RARITY_COLOR[r], color: RARITY_COLOR[r] } : {}}
                onClick={() => { setRarity(rarity === r ? '' : r); setPage(1) }}
                title={r}
              >
                {r[0].toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterSection}>
          <label className={styles.filterLabel}>Finish</label>
          <div className={styles.rarityBtns}>
            <button
              className={`${styles.rarityBtn} ${foil === true ? styles.rarityBtnActive : ''}`}
              onClick={() => { setFoil(foil === true ? null : true); setPage(1) }}
            >
              Foil
            </button>
            <button
              className={`${styles.rarityBtn} ${foil === false ? styles.rarityBtnActive : ''}`}
              onClick={() => { setFoil(foil === false ? null : false); setPage(1) }}
            >
              Non-foil
            </button>
          </div>
        </div>

        {availableTags.length > 0 && (
          <div className={styles.filterSection}>
            <label className={styles.filterLabel}>Oracle Tags</label>
            <div className={styles.tagList}>
              {availableTags.map(tag => (
                <TagChip
                  key={tag}
                  tag={tag}
                  active={selectedTags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                />
              ))}
            </div>
          </div>
        )}

        <button className={styles.addCardBtn} onClick={() => setShowAdd(true)}>
          + Add Card
        </button>
        <button className={styles.importBtn} onClick={() => setShowImport(true)}>
          ↑ Import CSV
        </button>
      </aside>

      <div className={styles.main}>
        <div className={styles.mainHeader}>
          <span className={styles.resultCount}>
            {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
          </span>
          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
              <span className={styles.pageInfo}>{page} / {totalPages}</span>
              <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>

        {isLoading && <div className={styles.loading}>Loading…</div>}

        <div className={styles.cardGrid}>
          {entries.map(entry => (
            <CollectionCard
              key={entry.entry_id}
              entry={entry}
              onEdit={setEditEntry}
              onDelete={handleDelete}
            />
          ))}
        </div>

        {!isLoading && entries.length === 0 && (
          <div className={styles.empty}>No cards match your filters.</div>
        )}

        {totalPages > 1 && (
          <div className={styles.paginationBottom}>
            <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
            <span className={styles.pageInfo}>{page} / {totalPages}</span>
            <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && <AddCardModal key="add" owners={players} onClose={() => setShowAdd(false)} />}
        {showImport && <ImportModal key="import" owners={players} onClose={() => setShowImport(false)} />}
        {editEntry && <EditEntryModal key="edit" entry={editEntry} onClose={() => setEditEntry(null)} />}
      </AnimatePresence>
    </div>
  )
}
