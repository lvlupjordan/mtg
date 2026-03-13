import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell, Legend,
} from 'recharts'
import { api } from '../api'
import styles from './StatsPage.module.css'

const METRICS = [
  { value: 'win_rate', label: 'win rate' },
  { value: 'games', label: 'games played' },
  { value: 'wins', label: 'wins' },
  { value: 'avg_placement', label: 'avg placement' },
]

const DIMENSIONS = [
  { value: 'player', label: 'player' },
  { value: 'deck', label: 'deck' },
  { value: 'colour', label: 'colour' },
  { value: 'identity', label: 'commander identity' },
  { value: 'month', label: 'month' },
]

const OVER_OPTIONS = [
  { value: '', label: '—' },
  { value: 'month', label: 'month' },
  { value: 'game', label: 'game' },
]

const FILTER_OPTIONS = [
  { value: '', label: 'no filter' },
  { value: 'player', label: 'player' },
  { value: 'colour', label: 'colour' },
  { value: 'deck', label: 'deck' },
]

const COLOURS = ['W', 'U', 'B', 'R', 'G']

const COLOUR_FILL = {
  W: '#f5e9c0', U: '#5b9bd5', B: '#a87fc1', R: '#d9534f', G: '#3aaa6a', C: '#8a8a8a',
}

const LINE_COLOURS = [
  '#c9a84c', '#5b9bd5', '#3aaa6a', '#d9534f', '#a87fc1',
  '#e8a838', '#4ec9b0', '#f48fb1', '#80cbc4', '#ffcc80',
]

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
          style={{ '--pip': COLOUR_FILL[c] }}
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

function fmt(metric, val) {
  if (val === null || val === undefined) return '—'
  if (metric === 'win_rate') return `${Math.round(val * 100)}%`
  if (metric === 'avg_placement') return val.toFixed ? val.toFixed(2) : val
  return val
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

function MultiLineChart({ tsData, metric }) {
  const { series, data } = tsData
  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={data} margin={{ top: 8, right: 24, bottom: 32, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          tick={{ fill: 'var(--text-dim)', fontSize: 11, fontFamily: 'Cinzel, serif' }}
          angle={-30}
          textAnchor="end"
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={v => fmt(metric, v)}
          tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
          width={48}
        />
        <Tooltip content={<CustomTooltip metric={metric} />} />
        <Legend
          wrapperStyle={{ fontFamily: 'Cinzel, serif', fontSize: 11, color: 'var(--text-dim)', paddingTop: 8 }}
        />
        {series.map((name, i) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={LINE_COLOURS[i % LINE_COLOURS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function BarChartView({ data, metric, dimension }) {
  const isHorizontal = ['player', 'deck'].includes(dimension)

  if (isHorizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(320, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={v => fmt(metric, v)} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={110} tick={{ fill: 'var(--text-bright)', fontSize: 12, fontFamily: 'Cinzel, serif' }} />
          <Tooltip content={<BarCustomTooltip metric={metric} />} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill="var(--gold)" opacity={1 - i * (0.4 / Math.max(data.length, 1))} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 24, bottom: 32, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--text-dim)', fontSize: 11, fontFamily: 'Cinzel, serif' }}
          angle={dimension === 'month' ? -30 : 0}
          textAnchor={dimension === 'month' ? 'end' : 'middle'}
          interval={0}
        />
        <YAxis tickFormatter={v => fmt(metric, v)} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} width={48} />
        <Tooltip content={<BarCustomTooltip metric={metric} />} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={dimension === 'colour' ? (COLOUR_FILL[entry.label] || 'var(--gold)') : 'var(--gold)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// All dimensions except 'month' support "over time"
const TIME_DIMS = ['player', 'deck', 'colour', 'identity']

export default function StatsPage() {
  const [metric, setMetric] = useState('win_rate')
  const [dimension, setDimension] = useState('player')
  const [over, setOver] = useState('')
  const [filterBy, setFilterBy] = useState('')
  const [filterValue, setFilterValue] = useState('')

  const { data: players } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const { data: decksData } = useQuery({
    queryKey: ['decks-all'],
    queryFn: () => api.decks({ page_size: 100 }),
  })

  // Only show "over" option for player/deck dimensions
  const canUseOver = TIME_DIMS.includes(dimension)
  const activeOver = canUseOver ? over : ''

  function handleDimensionChange(val) {
    setDimension(val)
    if (!TIME_DIMS.includes(val)) setOver('')
  }

  function handleFilterByChange(val) {
    setFilterBy(val)
    setFilterValue('')
  }

  const queryEnabled = !filterBy || !!filterValue
  const isTimeseries = !!activeOver

  const queryParams = {
    metric,
    filter_by: filterBy || undefined,
    filter_value: filterValue || undefined,
  }

  const { data: barData, isLoading: barLoading } = useQuery({
    queryKey: ['stats-query', metric, dimension, filterBy, filterValue],
    queryFn: () => api.statsQuery({ ...queryParams, dimension }),
    enabled: queryEnabled && !isTimeseries,
  })

  const { data: tsData, isLoading: tsLoading } = useQuery({
    queryKey: ['stats-ts', metric, dimension, activeOver, filterBy, filterValue],
    queryFn: () => api.statsTimeseries({ ...queryParams, group_by: dimension, over: activeOver }),
    enabled: queryEnabled && isTimeseries,
  })

  const isLoading = isTimeseries ? tsLoading : barLoading
  const hasData = isTimeseries
    ? tsData && tsData.data?.length > 0
    : barData && barData.length > 0

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Statistics</h1>

      <div className={styles.builderCard}>
        <div className={styles.sentence}>
          <span className={styles.prose}>Show me</span>
          <InlineSelect value={metric} onChange={setMetric} options={METRICS} />
          <span className={styles.prose}>by</span>
          <InlineSelect value={dimension} onChange={handleDimensionChange} options={DIMENSIONS} />

          {canUseOver && (
            <>
              <span className={styles.prose}>over</span>
              <InlineSelect value={over} onChange={setOver} options={OVER_OPTIONS} />
            </>
          )}

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
        </div>
      </div>

      <div className={styles.chartCard}>
        {!queryEnabled ? (
          <div className={styles.empty}>Select a filter value to see results.</div>
        ) : isLoading ? (
          <div className={styles.loadingWrap}><div className={styles.spinner} /></div>
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
