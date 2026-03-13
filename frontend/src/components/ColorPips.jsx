import styles from './ColorPips.module.css'

const COLOR_META = {
  W: { label: 'W', title: 'White' },
  U: { label: 'U', title: 'Blue' },
  B: { label: 'B', title: 'Black' },
  R: { label: 'R', title: 'Red' },
  G: { label: 'G', title: 'Green' },
  C: { label: 'C', title: 'Colorless' },
}

const ORDER = ['W', 'U', 'B', 'R', 'G', 'C']

export default function ColorPips({ colors = [], size = 'md' }) {
  const sorted = [...colors].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))

  return (
    <div className={styles.pips}>
      {sorted.map((c) => (
        <span
          key={c}
          className={`${styles.pip} ${styles[`pip_${c}`]} ${styles[`size_${size}`]}`}
          title={COLOR_META[c]?.title ?? c}
        >
          {COLOR_META[c]?.label ?? c}
        </span>
      ))}
    </div>
  )
}
