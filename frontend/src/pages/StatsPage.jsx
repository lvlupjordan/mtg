import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell, Legend,
} from 'recharts'
import { api } from '../api'
import styles from './StatsPage.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const WUBRG = ['W', 'U', 'B', 'R', 'G']

function sortedKey(colors) {
  if (!colors?.length) return 'C'
  return [...colors].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('')
}

const ALL_IDENTITIES = [
  // Colorless
  { key: 'C',     colors: [],                    name: 'Colorless',  pips: 0 },
  // Mono
  { key: 'W',     colors: ['W'],                 name: 'White',      pips: 1 },
  { key: 'U',     colors: ['U'],                 name: 'Blue',       pips: 1 },
  { key: 'B',     colors: ['B'],                 name: 'Black',      pips: 1 },
  { key: 'R',     colors: ['R'],                 name: 'Red',        pips: 1 },
  { key: 'G',     colors: ['G'],                 name: 'Green',      pips: 1 },
  // Guilds (allied)
  { key: 'WU',    colors: ['W','U'],             name: 'Azorius',    pips: 2 },
  { key: 'UB',    colors: ['U','B'],             name: 'Dimir',      pips: 2 },
  { key: 'BR',    colors: ['B','R'],             name: 'Rakdos',     pips: 2 },
  { key: 'RG',    colors: ['R','G'],             name: 'Gruul',      pips: 2 },
  { key: 'WG',    colors: ['W','G'],             name: 'Selesnya',   pips: 2 },
  // Guilds (enemy)
  { key: 'WB',    colors: ['W','B'],             name: 'Orzhov',     pips: 2 },
  { key: 'UR',    colors: ['U','R'],             name: 'Izzet',      pips: 2 },
  { key: 'BG',    colors: ['B','G'],             name: 'Golgari',    pips: 2 },
  { key: 'WR',    colors: ['W','R'],             name: 'Boros',      pips: 2 },
  { key: 'UG',    colors: ['U','G'],             name: 'Simic',      pips: 2 },
  // Shards
  { key: 'WUB',   colors: ['W','U','B'],         name: 'Esper',      pips: 3 },
  { key: 'UBR',   colors: ['U','B','R'],         name: 'Grixis',     pips: 3 },
  { key: 'BRG',   colors: ['B','R','G'],         name: 'Jund',       pips: 3 },
  { key: 'WRG',   colors: ['W','R','G'],         name: 'Naya',       pips: 3 },
  { key: 'WUG',   colors: ['W','U','G'],         name: 'Bant',       pips: 3 },
  // Clans / wedges
  { key: 'WBR',   colors: ['W','B','R'],         name: 'Mardu',      pips: 3 },
  { key: 'URG',   colors: ['U','R','G'],         name: 'Temur',      pips: 3 },
  { key: 'WBG',   colors: ['W','B','G'],         name: 'Abzan',      pips: 3 },
  { key: 'WUR',   colors: ['W','U','R'],         name: 'Jeskai',     pips: 3 },
  { key: 'UBG',   colors: ['U','B','G'],         name: 'Sultai',     pips: 3 },
  // Nephilim / 4-colour
  { key: 'WUBR',  colors: ['W','U','B','R'],     name: 'Yore-Tiller', pips: 4 },
  { key: 'UBRG',  colors: ['U','B','R','G'],     name: 'Glint-Eye',   pips: 4 },
  { key: 'WBRG',  colors: ['W','B','R','G'],     name: 'Dune-Brood',  pips: 4 },
  { key: 'WURG',  colors: ['W','U','R','G'],     name: 'Ink-Treader', pips: 4 },
  { key: 'WUBG',  colors: ['W','U','B','G'],     name: 'Witch-Maw',   pips: 4 },
  // Five-colour
  { key: 'WUBRG', colors: ['W','U','B','R','G'], name: 'WUBRG',       pips: 5 },
]

const PIP_GROUPS = [
  { pips: 0, label: 'Colorless' },
  { pips: 1, label: 'Mono' },
  { pips: 2, label: 'Two-Colour' },
  { pips: 3, label: 'Three-Colour' },
  { pips: 4, label: 'Four-Colour' },
  { pips: 5, label: 'Five-Colour' },
]

const PIP_COLOUR = {
  W: '#f5e9c0', U: '#5b9bd5', B: '#b07ec4', R: '#d9534f', G: '#3aaa6a', C: '#8a8a8a',
}

const METRICS = [
  { value: 'win_rate',     label: 'win rate' },
  { value: 'games',        label: 'games played' },
  { value: 'wins',         label: 'wins' },
  { value: 'avg_placement',label: 'avg placement' },
  { value: 'decks',        label: 'decks built' },
  { value: 'active_decks', label: 'active decks' },
]

const DIMENSIONS = [
  { value: 'player',   label: 'player' },
  { value: 'deck',     label: 'deck' },
  { value: 'colour',   label: 'colour' },
  { value: 'identity', label: 'commander identity' },
  { value: 'month',    label: 'month' },
]

const OVER_OPTIONS = [
  { value: '', label: '—' },
  { value: 'month', label: 'month' },
  { value: 'game',  label: 'game' },
]

const FILTER_OPTIONS = [
  { value: '',       label: 'no filter' },
  { value: 'player', label: 'player' },
  { value: 'colour', label: 'colour' },
  { value: 'deck',   label: 'deck' },
]

const COLOURS = ['W', 'U', 'B', 'R', 'G']

const LINE_COLOURS = [
  '#c9a84c', '#5b9bd5', '#3aaa6a', '#d9534f', '#a87fc1',
  '#e8a838', '#4ec9b0', '#f48fb1', '#80cbc4', '#ffcc80',
]

const TIME_DIMS = ['player', 'deck', 'colour', 'identity']
const DECK_METRICS = ['decks', 'active_decks']  // no timeseries support

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(metric, val) {
  if (val === null || val === undefined) return '—'
  if (metric === 'win_rate') return `${Math.round(val * 100)}%`
  if (metric === 'avg_placement') return val.toFixed ? val.toFixed(2) : val
  return val
}

// ── Small components ──────────────────────────────────────────────────────────

function InlineSelect({ value, onChange, options }) {
  return (
    <select className={styles.inlineSelect} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function ColourPicker({ value, onChange }) {
  return (
    <div className={styles.colourPicker}>
      {COLOURS.map(c => (
        <button
          key={c}
          type="button"
          className={`${styles.colourBtn} ${value === c ? styles.colourBtnActive : ''}`}
          style={{ '--pip': PIP_COLOUR[c] }}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

function FilterValueInput({ filterBy, value, onChange, players, decks }) {
  if (filterBy === 'colour') return <ColourPicker value={value} onChange={onChange} />
  if (filterBy === 'player') {
    const opts = (players || []).map(p => ({ value: p.name, label: p.name }))
    return <InlineSelect value={value} onChange={onChange} options={[{ value: '', label: '…' }, ...opts]} />
  }
  if (filterBy === 'deck') {
    const opts = (decks || []).map(d => ({ value: d.commander, label: d.commander }))
    return <InlineSelect value={value} onChange={onChange} options={[{ value: '', label: '…' }, ...opts]} />
  }
  return null
}

function CustomTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span className={styles.tooltipName}>{p.name}</span>
          <span className={styles.tooltipValue}>{fmt(metric, p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function BarCustomTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{d.label}</div>
      <div className={styles.tooltipValue}>{fmt(metric, d.value)}</div>
      {d.games !== undefined && <div className={styles.tooltipGames}>{d.games} games</div>}
    </div>
  )
}

// ── Charts ────────────────────────────────────────────────────────────────────

function MultiLineChart({ tsData, metric }) {
  const { series, data } = tsData
  const chartH = window.innerWidth < 600 ? 220 : 360
  return (
    <ResponsiveContainer width="100%" height={chartH}>
      <LineChart data={data} margin={{ top: 8, right: 24, bottom: 32, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="x" tick={{ fill: 'var(--text-dim)', fontSize: 11, fontFamily: 'Cinzel, serif' }} angle={-30} textAnchor="end" interval="preserveStartEnd" />
        <YAxis tickFormatter={v => fmt(metric, v)} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} width={48} />
        <Tooltip content={<CustomTooltip metric={metric} />} />
        <Legend wrapperStyle={{ fontFamily: 'Cinzel, serif', fontSize: 11, color: 'var(--text-dim)', paddingTop: 8 }} />
        {series.map((name, i) => (
          <Line key={name} type="monotone" dataKey={name} stroke={LINE_COLOURS[i % LINE_COLOURS.length]} strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function BarChartView({ data, metric, dimension }) {
  const isHorizontal = ['player', 'deck'].includes(dimension)
  const isMobile = window.innerWidth < 600
  data = data.filter(d => d.value !== null && d.value !== undefined)

  if (isHorizontal) {
    const yWidth = isMobile
      ? Math.min(120, Math.max(60, Math.max(...data.map(d => (d.label || '').length)) * 6))
      : Math.min(240, Math.max(80, Math.max(...data.map(d => (d.label || '').length)) * 8))
    const rowH = isMobile ? 32 : 44
    return (
      <ResponsiveContainer width="100%" height={Math.max(isMobile ? 200 : 320, data.length * rowH)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: isMobile ? 24 : 48, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={v => fmt(metric, v)} tick={{ fill: 'var(--text-dim)', fontSize: isMobile ? 10 : 11 }} />
          <YAxis type="category" dataKey="label" width={yWidth} tick={{ fill: 'var(--text-bright)', fontSize: isMobile ? 10 : 11, fontFamily: 'Cinzel, serif' }} />
          <Tooltip content={<BarCustomTooltip metric={metric} />} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => <Cell key={i} fill="var(--gold)" opacity={1 - i * (0.4 / Math.max(data.length, 1))} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={isMobile ? 200 : 320}>
      <BarChart data={data} margin={{ top: 8, right: 24, bottom: 32, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fill: 'var(--text-dim)', fontSize: 11, fontFamily: 'Cinzel, serif' }} angle={dimension === 'month' ? -30 : 0} textAnchor={dimension === 'month' ? 'end' : 'middle'} interval={0} />
        <YAxis tickFormatter={v => fmt(metric, v)} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} width={48} />
        <Tooltip content={<BarCustomTooltip metric={metric} />} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => <Cell key={i} fill={dimension === 'colour' ? (PIP_COLOUR[entry.label] || 'var(--gold)') : 'var(--gold)'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Identity Grid ─────────────────────────────────────────────────────────────

function IdentityPip({ color }) {
  return (
    <img
      className={styles.identityPip}
      src={`https://svgs.scryfall.io/card-symbols/${color}.svg`}
      alt={color}
      title={color}
    />
  )
}

function IdentityGrid({ metric, apiData }) {
  const isDeckMetric = DECK_METRICS.includes(metric)

  const lookup = useMemo(() => {
    const result = {}
    for (const row of apiData ?? []) {
      result[row.label] = { value: row.value, games: row.games }
    }
    return result
  }, [apiData])

  function getValue(identity) {
    const val = lookup[identity.key]?.value ?? null
    return (isDeckMetric && val === null) ? 0 : val
  }

  function getGames(identity) {
    return lookup[identity.key]?.games ?? 0
  }

  return (
    <div className={styles.identityGrid}>
      {PIP_GROUPS.map(group => {
        const items = ALL_IDENTITIES.filter(id => id.pips === group.pips)
        return (
          <div key={group.pips} className={styles.identityGroup}>
            <div className={styles.identityGroupLabel}>{group.label}</div>
            <div className={styles.identityGroupCards}>
              {items.map(identity => {
                const val = getValue(identity)
                const games = getGames(identity)
                const empty = isDeckMetric ? val === 0 : val === null || val === undefined
                return (
                  <div
                    key={identity.key}
                    className={`${styles.identityCard} ${empty ? styles.identityCardEmpty : ''}`}
                    title={`${identity.name} — ${fmt(metric, val)}${!isDeckMetric && games ? ` (${games} games)` : ''}`}
                  >
                    <div className={styles.identityPips}>
                      {identity.colors.length === 0
                        ? <IdentityPip color="C" />
                        : identity.colors.map(c => <IdentityPip key={c} color={c} />)
                      }
                    </div>
                    <div className={styles.identityName}>{identity.name}</div>
                    <div className={`${styles.identityValue} ${!empty && val === 0 && !isDeckMetric ? styles.identityValueZero : ''}`}>{fmt(metric, val)}</div>
                    {!isDeckMetric && games > 0 && (
                      <div className={styles.identityGames}>{games}g</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [metric, setMetric] = useState('win_rate')
  const [dimension, setDimension] = useState('player')
  const [over, setOver] = useState('game')
  const [filterBy, setFilterBy] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const [minGames, setMinGames] = useState(5)
  const [limit, setLimit] = useState(10)

  const { data: players } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const { data: decksData } = useQuery({
    queryKey: ['decks-all'],
    queryFn: () => api.decks({ page_size: 500 }),
  })

  const canUseOver = TIME_DIMS.includes(dimension)
  const activeOver = canUseOver ? over : ''
  const isDeckMetric = DECK_METRICS.includes(metric)
  const isIdentityGrid = dimension === 'identity' && !activeOver

  function handleDimensionChange(val) {
    setDimension(val)
    if (!TIME_DIMS.includes(val) || val === 'identity') setOver('')
  }

  function handleFilterByChange(val) {
    setFilterBy(val)
    setFilterValue('')
  }

  function handleMetricChange(val) {
    setMetric(val)
    // Deck metrics don't support timeseries — clear over
    if (DECK_METRICS.includes(val)) setOver('')
  }

  const queryEnabled = !filterBy || !!filterValue
  const isTimeseries = !!activeOver

  const queryParams = {
    metric,
    filter_by: filterBy || undefined,
    filter_value: filterValue || undefined,
    min_games: showIdentityGrid ? 0 : minGames,
    limit,
  }

  const { data: barData, isLoading: barLoading } = useQuery({
    queryKey: ['stats-query', metric, dimension, filterBy, filterValue, minGames, limit],
    queryFn: () => api.statsQuery({ ...queryParams, dimension }),
    enabled: queryEnabled && !isTimeseries,
  })

  const { data: tsData, isLoading: tsLoading } = useQuery({
    queryKey: ['stats-ts', metric, dimension, activeOver, filterBy, filterValue, minGames, limit],
    queryFn: () => api.statsTimeseries({ ...queryParams, group_by: dimension, over: activeOver }),
    enabled: queryEnabled && isTimeseries,
  })

  const isLoading = isTimeseries ? tsLoading : barLoading
  const hasData = isTimeseries ? tsData?.data?.length > 0 : barData?.length > 0

  const showIdentityGrid = isIdentityGrid

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Statistics</h1>

      <div className={styles.builderCard}>
        <div className={styles.sentence}>
          <span className={styles.prose}>Show me</span>
          <InlineSelect value={metric} onChange={handleMetricChange} options={METRICS} />
          <span className={styles.prose}>by</span>
          <InlineSelect value={dimension} onChange={handleDimensionChange} options={DIMENSIONS} />

          {canUseOver && !isDeckMetric && (
            <>
              <span className={styles.prose}>over</span>
              <InlineSelect value={over} onChange={setOver} options={OVER_OPTIONS} />
            </>
          )}

          {!isDeckMetric && (
            <>
              <span className={styles.prose}>filtered for</span>
              <InlineSelect value={filterBy} onChange={handleFilterByChange} options={FILTER_OPTIONS} />
              {filterBy && (
                <>
                  <span className={styles.prose}>=</span>
                  <FilterValueInput
                    filterBy={filterBy}
                    value={filterValue}
                    onChange={setFilterValue}
                    players={players?.filter(p => !['Random', 'Precon'].includes(p.name))}
                    decks={decksData?.decks}
                  />
                </>
              )}
            </>
          )}

          {!showIdentityGrid && !isDeckMetric && (
            <>
              <span className={styles.prose}>top</span>
              <input
                type="number" min="1" max="100" value={limit}
                onChange={e => setLimit(Math.max(1, parseInt(e.target.value) || 1))}
                className={styles.minGamesInput}
              />
              <span className={styles.prose}>results, min.</span>
              <input
                type="number" min="0" max="50" value={minGames}
                onChange={e => setMinGames(Math.max(0, parseInt(e.target.value) || 0))}
                className={styles.minGamesInput}
              />
              <span className={styles.prose}>games</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.chartCard}>
        {!queryEnabled && !isDeckMetric ? (
          <div className={styles.empty}>Select a filter value to see results.</div>
        ) : isLoading ? (
          <div className={styles.loadingWrap}><div className={styles.spinner} /></div>
        ) : showIdentityGrid ? (
          <IdentityGrid
            metric={metric}
            apiData={barData}
          />
        ) : !hasData ? (
          <div className={styles.empty}>No data for this combination.</div>
        ) : isTimeseries ? (
          <MultiLineChart tsData={tsData} metric={metric} />
        ) : (
          <BarChartView data={barData} metric={metric} dimension={dimension} />
        )}
      </div>
    </div>
  )
}
