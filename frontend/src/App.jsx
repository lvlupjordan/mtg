import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import DecksPage from './pages/DecksPage'
import DeckDetailPage from './pages/DeckDetailPage'
import PlayersPage from './pages/PlayersPage'
import PlayerDetailPage from './pages/PlayerDetailPage'
import GamesPage from './pages/GamesPage'
import StatsPage from './pages/StatsPage'
import TrackerPage from './pages/TrackerPage'
import TierlistPage from './pages/TierlistPage'
import CollectionPage from './pages/CollectionPage'
import styles from './App.module.css'

export default function App() {
  const { data: players } = useQuery({ queryKey: ['players'], queryFn: api.players })
  const population = players?.filter(p => !['Random', 'Precon'].includes(p.name)).length
  const location = useLocation()
  const isTracker = location.pathname === '/tracker'

  return (
    <div className={styles.app}>
      <header className={`${styles.header}${isTracker ? ` ${styles.headerTracker}` : ''}`}>
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
          <NavLink to="/tracker" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
            Tracker
          </NavLink>
          <NavLink to="/tierlist" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
            Tier List
          </NavLink>
          <NavLink to="/collection" className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}>
            Collection
          </NavLink>
        </nav>
      </header>

      <main className={isTracker ? styles.mainFull : styles.main}>
        <Routes>
          <Route path="/" element={<DecksPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/:id" element={<DeckDetailPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/players/:id" element={<PlayerDetailPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/tracker" element={<TrackerPage />} />
          <Route path="/tierlist" element={<TierlistPage />} />
          <Route path="/collection" element={<CollectionPage />} />
        </Routes>
      </main>
    </div>
  )
}
