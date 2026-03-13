import { Routes, Route, NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import DecksPage from './pages/DecksPage'
import DeckDetailPage from './pages/DeckDetailPage'
import PlayersPage from './pages/PlayersPage'
import PlayerDetailPage from './pages/PlayerDetailPage'
import GamesPage from './pages/GamesPage'
import StatsPage from './pages/StatsPage'
import styles from './App.module.css'

export default function App() {
  const { data: players } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const population = players?.filter(p => !['Random', 'Precon'].includes(p.name)).length

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logoWrap}>
          <NavLink to="/" className={styles.logo}>Wooberg</NavLink>
          {population > 0 && (
            <>
              <span className={styles.population}>Welcome to Wooberg!</span>
              <span className={styles.population}>Population: {population}</span>
            </>
          )}
        </div>
        <nav className={styles.nav}>
          <NavLink to="/decks" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
            Decks
          </NavLink>
          <NavLink to="/players" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
            Players
          </NavLink>
          <NavLink to="/games" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
            Games
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
            Stats
          </NavLink>
        </nav>
      </header>

      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<DecksPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/:id" element={<DeckDetailPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/players/:id" element={<PlayerDetailPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
    </div>
  )
}
