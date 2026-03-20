import { useState, useDeferredValue, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../api'
import styles from './CollectionPage.module.css'

const RARITIES = ['common', 'uncommon', 'rare', 'mythic']
const CONDITIONS = ['near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged']
const CONDITION_LABELS = {
  near_mint: 'NM', lightly_played: 'LP', moderately_played: 'MP', heavily_played: 'HP', damaged: 'DMG',
}
const RARITY_COLOR = {
  common: 'var(--text-dim)', uncommon: '#a0b8c8', rare: 'var(--gold)', mythic: '#e8762a',
}

// ── Color identity lookup ────────────────────────────────────────────────────
const IDENTITY_MAP = {
  azorius: ['W','U'], dimir: ['U','B'], rakdos: ['B','R'], gruul: ['R','G'],
  selesnya: ['G','W'], orzhov: ['W','B'], izzet: ['U','R'], golgari: ['B','G'],
  boros: ['R','W'], simic: ['G','U'],
  bant: ['G','W','U'], esper: ['W','U','B'], grixis: ['U','B','R'],
  jund: ['B','R','G'], naya: ['R','G','W'],
  abzan: ['W','B','G'], jeskai: ['U','R','W'], sultai: ['B','G','U'],
  mardu: ['R','W','B'], temur: ['G','U','R'],
  wubrg: ['W','U','B','R','G'], fivecolor: ['W','U','B','R','G'],
  colorless: [], mono: [],
}
const COLOR_NAMES = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
  w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', c: 'C',
}
const RARITY_MAP = {
  c: 'common', common: 'common', u: 'uncommon', uncommon: 'uncommon',
  r: 'rare', rare: 'rare', m: 'mythic', mythic: 'mythic',
}

function resolveColorIdentity(val) {
  const lower = val.toLowerCase()
  if (IDENTITY_MAP[lower] !== undefined) return IDENTITY_MAP[lower]
  return val.toUpperCase().split('').filter(c => 'WUBRG'.includes(c))
}
function resolveColors(val) {
  const lower = val.toLowerCase()
  if (COLOR_NAMES[lower]) return [COLOR_NAMES[lower]]
  return val.toUpperCase().split('').filter(c => 'WUBRG'.includes(c))
}

function parseQuery(raw, players) {
  const tokens = raw.match(/\S+/g) || []
  const nameParts = []
  const oracle_tags = []
  const colors = []
  const result = {}

  for (const token of tokens) {
    const colon = token.indexOf(':')
    if (colon === -1) { nameParts.push(token); continue }
    const key = token.slice(0, colon).toLowerCase()
    const val = token.slice(colon + 1)
    if (!val) continue

    switch (key) {
      case 'owner': {
        const p = players.find(p => p.name.toLowerCase().includes(val.toLowerCase()))
        if (p) result.owner_id = p.id
        break
      }
      case 'commander': case 'ci': {
        const ci = resolveColorIdentity(val)
        if (ci.length) result.color_identity = ci.join(',')
        break
      }
      case 'cmc': {
        if (val.includes('-')) {
          const [a, b] = val.split('-')
          if (!isNaN(a)) result.cmc_min = Number(a)
          if (!isNaN(b)) result.cmc_max = Number(b)
        } else if (val.startsWith('>=')) { result.cmc_min = Number(val.slice(2)) }
        else if (val.startsWith('<=')) { result.cmc_max = Number(val.slice(2)) }
        else if (val.startsWith('>')) { result.cmc_min = Number(val.slice(1)) + 1 }
        else if (val.startsWith('<')) { result.cmc_max = Number(val.slice(1)) - 1 }
        else if (!isNaN(val)) { result.cmc_min = result.cmc_max = Number(val) }
        break
      }
      case 'oracletag': case 'tag': case 't': oracle_tags.push(val); break
      case 'type': case 'ty': result.type_line = val; break
      case 'rarity': case 'r': result.rarity = RARITY_MAP[val.toLowerCase()] || val.toLowerCase(); break
      case 'c': case 'color': case 'colors': resolveColors(val).forEach(c => colors.push(c)); break
      case 'o': case 'oracle': case 'text': result.oracle_text = val; break
      case 'foil':
        result.foil = ['yes', 'true', '1', 'foil'].includes(val.toLowerCase()) ? true
          : ['no', 'false', '0'].includes(val.toLowerCase()) ? false : undefined
        break
      default: nameParts.push(token)
    }
  }

  if (nameParts.length) result.q = nameParts.join(' ')
  if (oracle_tags.length) result.oracle_tags = oracle_tags.join(',')
  if (colors.length) result.colors = colors.join(',')
  return result
}

// ── Mana symbol renderer ─────────────────────────────────────────────────────
function ManaCost({ cost }) {
  if (!cost) return null
  const symbols = cost.match(/\{[^}]+\}/g) || []
  return (
    <span className={styles.manaCost}>
      {symbols.map((sym, i) => {
        const code = sym.slice(1, -1).replace('/', '')
        return (
          <img
            key={i}
            src={`https://svgs.scryfall.io/card-symbols/${code}.svg`}
            alt={sym}
            className={styles.manaSymbol}
            onError={e => { e.target.style.display = 'none' }}
          />
        )
      })}
    </span>
  )
}

// ── Card detail modal ────────────────────────────────────────────────────────
function CardDetailModal({ entry, ownerName, onClose, onEdit, onDelete }) {
  const lines = entry.oracle_text?.split('\n') || []
  return (
    <div className={styles.modalBg} onClick={onClose}>
      <motion.div
        className={`${styles.modal} ${styles.detailModal}`}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2 }}
      >
        <button className={styles.modalClose} onClick={onClose} style={{ position: 'absolute', top: 14, right: 16 }}>×</button>
        <div className={styles.detailLayout}>
          <div className={styles.detailImageWrap}>
            {entry.image_uri
              ? <img src={entry.image_uri} alt={entry.name} className={styles.detailImage} />
              : <div className={styles.detailImageBlank}>{entry.name}</div>
            }
            {entry.back_image_uri && (
              <img src={entry.back_image_uri} alt={entry.name + ' back'} className={styles.detailImage} style={{ marginTop: 8 }} />
            )}
          </div>
          <div className={styles.detailInfo}>
            <div className={styles.detailNameRow}>
              <h2 className={styles.detailName}>{entry.name}</h2>
              <ManaCost cost={entry.mana_cost} />
            </div>
            {entry.type_line && <div className={styles.detailType}>{entry.type_line}</div>}
            {lines.length > 0 && (
              <div className={styles.detailOracle}>
                {lines.map((line, i) => (
                  <p key={i} className={styles.detailOracleLine}>{line}</p>
                ))}
              </div>
            )}
            {(entry.power != null || entry.toughness != null) && (
              <div className={styles.detailPT}>{entry.power}/{entry.toughness}</div>
            )}
            {entry.oracle_tags?.length > 0 && (
              <div className={styles.detailTags}>
                {entry.oracle_tags.map(t => (
                  <span key={t} className={styles.detailTag}>{t}</span>
                ))}
              </div>
            )}
            <div className={styles.detailDivider} />
            <div className={styles.detailMeta}>
              {ownerName && <span className={styles.detailMetaItem}><span className={styles.detailMetaLabel}>Owner</span>{ownerName}</span>}
              <span className={styles.detailMetaItem}><span className={styles.detailMetaLabel}>Qty</span>{entry.quantity}</span>
              {entry.foil && <span className={`${styles.detailMetaItem} ${styles.detailFoil}`}>✦ Foil</span>}
              {entry.condition && entry.condition !== 'near_mint' && (
                <span className={styles.detailMetaItem}><span className={styles.detailMetaLabel}>Cond</span>{CONDITION_LABELS[entry.condition] || entry.condition}</span>
              )}
              {entry.language && entry.language !== 'en' && (
                <span className={styles.detailMetaItem}><span className={styles.detailMetaLabel}>Lang</span>{entry.language.toUpperCase()}</span>
              )}
              {entry.purchase_price != null && (
                <span className={styles.detailMetaItem}>
                  <span className={styles.detailMetaLabel}>Paid</span>
                  {entry.purchase_price} {entry.purchase_currency}
                </span>
              )}
            </div>
            <div className={styles.detailSetRow}>
              <span className={styles.detailSetCode}>{entry.set_code?.toUpperCase()}</span>
              <span className={styles.detailSetName}>{entry.set_name}</span>
              <span className={styles.detailCollector}>#{entry.collector_number}</span>
              {entry.rarity && (
                <span className={styles.detailRarity} style={{ color: RARITY_COLOR[entry.rarity] }}>
                  {entry.rarity}
                </span>
              )}
            </div>
            {entry.notes && <div className={styles.detailNotes}>{entry.notes}</div>}
            <div className={styles.detailActions}>
              <button className={styles.detailEditBtn} onClick={() => { onClose(); onEdit(entry) }}>Edit</button>
              <button className={styles.detailDeleteBtn} onClick={() => { onClose(); onDelete(entry) }}>Remove</button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Collection card (grid tile) ──────────────────────────────────────────────
function CollectionCard({ entry, onDetail, onEdit, onDelete }) {
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
      onClick={() => onDetail(entry)}
      layout
    >
      {hovered && entry.oracle_text && (
        <div className={styles.oracleTooltip}>
          <div className={styles.tooltipName}>{entry.name}</div>
          {entry.type_line && <div className={styles.tooltipType}>{entry.type_line}</div>}
          <div className={styles.tooltipText}>
            {entry.oracle_text.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          {(entry.power != null && entry.toughness != null) && (
            <div className={styles.tooltipPT}>{entry.power}/{entry.toughness}</div>
          )}
        </div>
      )}
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
              onClick={e => e.stopPropagation()}
            >
              <button onClick={e => { e.stopPropagation(); onEdit(entry) }} className={styles.actionBtn}>Edit</button>
              <button onClick={e => { e.stopPropagation(); onDelete(entry) }} className={`${styles.actionBtn} ${styles.actionBtnDanger}`}>Remove</button>
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

// ── Add card modal ───────────────────────────────────────────────────────────
function AddCardModal({ owners, onClose }) {
  const [step, setStep] = useState('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const [form, setForm] = useState({
    owner_id: owners[0]?.id || '',
    quantity: 1, foil: false, condition: 'near_mint',
    language: 'en', purchase_price: '', purchase_currency: 'EUR',
  })
  const qc = useQueryClient()

  async function doSearch() {
    if (query.length < 2) return
    setSearching(true)
    try {
      const data = await api.searchScryfall(query)
      setResults(data.cards || [])
      setStep('pick')
    } finally { setSearching(false) }
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
              <button className={styles.searchBtn} onClick={doSearch} disabled={searching || query.length < 2}>
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
                  <div className={styles.pickRarity} style={{ color: RARITY_COLOR[card.rarity] }}>{card.rarity}</div>
                </div>
              </button>
            ))}
            {results.length === 0 && <p className={styles.noResults}>No results found.</p>}
          </div>
        )}

        {step === 'details' && picked && (
          <div className={styles.detailsStep}>
            <div className={styles.detailsPreview}>
              {picked.image_uri && <img src={picked.image_uri} alt={picked.name} className={styles.detailsImg} />}
              <div className={styles.detailsMeta}>
                <div className={styles.detailsName}>{picked.name}</div>
                <div className={styles.detailsSet}>{picked.set_name} · #{picked.collector_number}</div>
                {picked.type_line && <div className={styles.detailsType}>{picked.type_line}</div>}
              </div>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.formLabel}>
                Owner
                <select className={styles.formSelect} value={form.owner_id} onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))}>
                  {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className={styles.formLabel}>
                Quantity
                <input type="number" min="1" className={styles.formInput} value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              </label>
              <label className={styles.formLabel}>
                Condition
                <select className={styles.formSelect} value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                  {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
                </select>
              </label>
              <label className={styles.formLabel}>
                Language
                <input className={styles.formInput} value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} />
              </label>
              <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
                <span className={styles.foilToggle}>
                  <input type="checkbox" checked={form.foil} onChange={e => setForm(f => ({ ...f, foil: e.target.checked }))} />
                  Foil
                </span>
              </label>
              <label className={styles.formLabel}>
                Purchase Price
                <input type="number" step="0.01" className={styles.formInput} value={form.purchase_price}
                  onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} placeholder="0.00" />
              </label>
              <label className={styles.formLabel}>
                Currency
                <input className={styles.formInput} value={form.purchase_currency}
                  onChange={e => setForm(f => ({ ...f, purchase_currency: e.target.value }))} />
              </label>
            </div>
            <button className={styles.addBtn} onClick={submitAdd}>Add to Collection</button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Edit entry modal ─────────────────────────────────────────────────────────
function EditEntryModal({ entry, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    quantity: entry.quantity, foil: entry.foil, condition: entry.condition,
    language: entry.language, purchase_price: entry.purchase_price ?? '',
    purchase_currency: entry.purchase_currency, notes: entry.notes ?? '',
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
            <label className={styles.formLabel}>Quantity
              <input type="number" min="1" className={styles.formInput} value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </label>
            <label className={styles.formLabel}>Condition
              <select className={styles.formSelect} value={form.condition}
                onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
              </select>
            </label>
            <label className={styles.formLabel}>Language
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
            <label className={styles.formLabel}>Purchase Price
              <input type="number" step="0.01" className={styles.formInput} value={form.purchase_price}
                onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} />
            </label>
            <label className={styles.formLabel}>Currency
              <input className={styles.formInput} value={form.purchase_currency}
                onChange={e => setForm(f => ({ ...f, purchase_currency: e.target.value }))} />
            </label>
            <label className={`${styles.formLabel} ${styles.formLabelFull}`}>Notes
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

// ── Import modal ─────────────────────────────────────────────────────────────
function ImportModal({ owners, onClose }) {
  const [csvFile, setCsvFile] = useState(null)
  const [ownerId, setOwnerId] = useState('')
  const [status, setStatus] = useState(null)
  const qc = useQueryClient()

  async function doImport() {
    if (!csvFile) return
    setStatus('loading')
    try {
      const result = await api.importCollection(csvFile, ownerId || undefined)
      setStatus(result)
      qc.invalidateQueries({ queryKey: ['collection'] })
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
              Supports <strong>ManaBox</strong> and <strong>MTGCB</strong> CSV exports. Card data and oracle tags are fetched from Scryfall automatically. Import replaces the owner's current collection.
            </p>
            <div className={styles.formGrid}>
              <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
                Collection CSV <span className={styles.importRequired}>required</span>
                <input type="file" accept=".csv" className={styles.formFile}
                  onChange={e => setCsvFile(e.target.files[0] || null)} />
              </label>
              <label className={`${styles.formLabel} ${styles.formLabelFull}`}>
                Owner <span className={styles.importOptional}>required for MTGCB · overrides CSV owner for ManaBox</span>
                <select className={styles.formSelect} value={ownerId} onChange={e => setOwnerId(e.target.value)}>
                  <option value="">— from CSV (ManaBox only) —</option>
                  {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            </div>
            <button className={styles.addBtn} onClick={doImport} disabled={!csvFile}>Import</button>
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

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CollectionPage() {
  const [rawQuery, setRawQuery] = useState('')
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [detailEntry, setDetailEntry] = useState(null)

  const deferredQuery = useDeferredValue(rawQuery)

  const { data: playersData } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const players = playersData?.filter(p => !['Random', 'Precon'].includes(p.name)) ?? []
  const playerById = useMemo(() => Object.fromEntries(players.map(p => [p.id, p.name])), [players])

  const parsed = useMemo(() => parseQuery(deferredQuery, players), [deferredQuery, players])

  const params = {
    page,
    page_size: 60,
    ...(parsed.owner_id != null && { owner_id: parsed.owner_id }),
    ...(parsed.q && { q: parsed.q }),
    ...(parsed.oracle_text && { oracle_text: parsed.oracle_text }),
    ...(parsed.colors && { colors: parsed.colors }),
    ...(parsed.color_identity && { color_identity: parsed.color_identity }),
    ...(parsed.oracle_tags && { oracle_tags: parsed.oracle_tags }),
    ...(parsed.rarity && { rarity: parsed.rarity }),
    ...(parsed.type_line && { type_line: parsed.type_line }),
    ...(parsed.foil != null && { foil: parsed.foil }),
    ...(parsed.cmc_min != null && { cmc_min: parsed.cmc_min }),
    ...(parsed.cmc_max != null && { cmc_max: parsed.cmc_max }),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['collection', params],
    queryFn: () => api.collection(params),
    keepPreviousData: true,
  })

  const qc = useQueryClient()

  function resetPage() { setPage(1) }

  async function handleDelete(entry) {
    if (!confirm(`Remove ${entry.name} from collection?`)) return
    await api.deleteCollectionEntry(entry.entry_id)
    qc.invalidateQueries({ queryKey: ['collection'] })
  }

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 60)
  const entries = data?.entries ?? []

  // Active filter chips derived from parsed query
  const activeChips = useMemo(() => {
    const chips = []
    if (parsed.q) chips.push({ label: `name: ${parsed.q}` })
    if (parsed.oracle_text) chips.push({ label: `o: ${parsed.oracle_text}` })
    if (parsed.owner_id) chips.push({ label: `owner: ${playerById[parsed.owner_id] || parsed.owner_id}` })
    if (parsed.color_identity) chips.push({ label: `commander: ${parsed.color_identity}` })
    if (parsed.colors) chips.push({ label: `c: ${parsed.colors}` })
    if (parsed.oracle_tags) parsed.oracle_tags.split(',').forEach(t => chips.push({ label: `tag: ${t}` }))
    if (parsed.type_line) chips.push({ label: `type: ${parsed.type_line}` })
    if (parsed.rarity) chips.push({ label: `rarity: ${parsed.rarity}` })
    if (parsed.foil != null) chips.push({ label: `foil: ${parsed.foil ? 'yes' : 'no'}` })
    if (parsed.cmc_min != null && parsed.cmc_max != null && parsed.cmc_min === parsed.cmc_max) {
      chips.push({ label: `cmc: ${parsed.cmc_min}` })
    } else {
      if (parsed.cmc_min != null) chips.push({ label: `cmc: >=${parsed.cmc_min}` })
      if (parsed.cmc_max != null) chips.push({ label: `cmc: <=${parsed.cmc_max}` })
    }
    return chips
  }, [parsed, playerById])

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchBar}
            placeholder="Search… owner:jordan commander:jund cmc:3 oracletag:ramp type:creature o:draw foil:yes"
            value={rawQuery}
            onChange={e => { setRawQuery(e.target.value); resetPage() }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {activeChips.length > 0 && (
            <div className={styles.activeChips}>
              {activeChips.map((chip, i) => (
                <span key={i} className={styles.activeChip}>{chip.label}</span>
              ))}
              <button className={styles.clearChips} onClick={() => { setRawQuery(''); resetPage() }}>clear ×</button>
            </div>
          )}
        </div>
        <div className={styles.topActions}>
          <button className={styles.addCardBtn} onClick={() => setShowAdd(true)}>+ Add Card</button>
          <button className={styles.importBtn} onClick={() => setShowImport(true)}>↑ Import CSV</button>
        </div>
      </div>

      <div className={styles.resultsBar}>
        <span className={styles.resultCount}>
          {isLoading ? '…' : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`}
        </span>
        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span className={styles.pageInfo}>{page} / {totalPages}</span>
            <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </div>

      <div className={styles.cardGrid}>
        {entries.map(entry => (
          <CollectionCard
            key={entry.entry_id}
            entry={entry}
            onDetail={setDetailEntry}
            onEdit={setEditEntry}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {!isLoading && entries.length === 0 && (
        <div className={styles.empty}>No cards match your search.</div>
      )}

      {totalPages > 1 && (
        <div className={styles.paginationBottom}>
          <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
          <span className={styles.pageInfo}>{page} / {totalPages}</span>
          <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
        </div>
      )}

      <AnimatePresence>
        {detailEntry && (
          <CardDetailModal
            key="detail"
            entry={detailEntry}
            ownerName={playerById[detailEntry.owner_id]}
            onClose={() => setDetailEntry(null)}
            onEdit={setEditEntry}
            onDelete={handleDelete}
          />
        )}
        {showAdd && <AddCardModal key="add" owners={players} onClose={() => setShowAdd(false)} />}
        {showImport && <ImportModal key="import" owners={players} onClose={() => setShowImport(false)} />}
        {editEntry && <EditEntryModal key="edit" entry={editEntry} onClose={() => setEditEntry(null)} />}
      </AnimatePresence>
    </div>
  )
}
