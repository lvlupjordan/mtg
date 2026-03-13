import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell,
} from 'recharts'
import { api } from '../api'
import ColorPips from '../components/ColorPips'
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

function InlineSelect({ value, onChange, options, className }) {
  return (
    <select
      className={`${styles.inlineSelect} ${className || ''}`}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
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
  if (filterBy === 'colour') {
    return <ColourPicker value={value} onChange={onChange} />
  }
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
  if (metric === 'avg_placement') return val.toFixed(2)
  return val
}

function CustomTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{d.label}</div>
      <div className={styles.tooltipValue}>{fmt(metric, d.value)}</div>
      {d.games !== undefined && (
        <div className={styles.tooltipGames}>{d.games} games</div>
      )}
    </div>
  )
}

function ChartView({ data, metric, dimension }) {
  const isHorizontal = ['player', 'deck'].includes(dimension)
  const isLine = dimension === 'month' && ['win_rate', 'avg_placement'].includes(metric)

  const barColour = (entry) => {
    if (dimension === 'colour') return COLOUR_FILL[entry.label] || 'var(--gold)'
    if (dimension === 'identity') return 'var(--gold)'
    return 'var(--gold)'
  }

  const tickFormatter = (v) => fmt(metric, v)

  if (isLine) {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 16 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fill: 'var(--text-dim)', fontSize: 11, fontFamily: 'Cinzel, serif' }} />
          <YAxis tickFormatter={tickFormatter} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} width={48} />
          <Tooltip content={<CustomTooltip metric={metric} />} />
          <Line type="monotone" dataKey="value" stroke="var(--gold)" strokeWidth={2} dot={{ fill: 'var(--gold)', r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (isHorizontal) {
    const barHeight = Math.max(320, data.length * 44)
    return (
      <ResponsiveContainer width="100%" height={barHeight}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={tickFormatter} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="label"
            width={110}
            tick={{ fill: 'var(--text-bright)', fontSize: 12, fontFamily: 'Cinzel, serif' }}
          />
          <Tooltip content={<CustomTooltip metric={metric} />} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill="var(--gold)" opacity={1 - i * (0.4 / Math.max(data.length, 1))} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // Vertical bar (colour, identity, month)
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 24, bottom: 24, left: 16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--text-dim)', fontSize: 11, fontFamily: 'Cinzel, serif' }}
          angle={dimension === 'month' ? -35 : 0}
          textAnchor={dimension === 'month' ? 'end' : 'middle'}
          interval={0}
        />
        <YAxis tickFormatter={tickFormatter} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} width={48} />
        <Tooltip content={<CustomTooltip metric={metric} />} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={barColour(entry)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function StatsPage() {
  const [metric, setMetric] = useState('win_rate')
  const [dimension, setDimension] = useState('player')
  const [filterBy, setFilterBy] = useState('')
  const [filterValue, setFilterValue] = useState('')

  const { data: players } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const { data: decksData } = useQuery({
    queryKey: ['decks-all'],
    queryFn: () => api.decks({ page_size: 100 }),
  })

  const queryEnabled = !filterBy || !!filterValue

  const { data: chartData, isLoading, error } = useQuery({
    queryKey: ['stats-query', metric, dimension, filterBy, filterValue],
    queryFn: () => api.statsQuery({
      metric,
      dimension,
      filter_by: filterBy || undefined,
      filter_value: filterValue || undefined,
    }),
    enabled: queryEnabled,
  })

  function handleFilterByChange(val) {
    setFilterBy(val)
    setFilterValue('')
  }

  const hasData = chartData && chartData.length > 0

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Statistics</h1>

      <div className={styles.builderCard}>
        <div className={styles.sentence}>
          <span className={styles.prose}>Show me</span>
          <InlineSelect value={metric} onChange={setMetric} options={METRICS} />
          <span className={styles.prose}>by</span>
          <InlineSelect value={dimension} onChange={setDimension} options={DIMENSIONS} />
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
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
          </div>
        ) : error ? (
          <div className={styles.empty}>Something went wrong.</div>
        ) : !hasData ? (
          <div className={styles.empty}>No data for this combination.</div>
        ) : (
          <ChartView data={chartData} metric={metric} dimension={dimension} />
        )}
      </div>
    </div>
  )
}
