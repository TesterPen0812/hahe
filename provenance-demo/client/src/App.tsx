import { lazy, Suspense } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import FeedPage from './pages/FeedPage'
import CapturePage from './pages/CapturePage'
import ItemPage from './pages/ItemPage'
import SetupPage from './pages/SetupPage'
import AttackerPage from './pages/AttackerPage'
import SplitScreenPage from './pages/SplitScreenPage'
import PasskeyTestPage from './pages/PasskeyTestPage'

// three.js only loads on the landing page, so the phone's capture page stays light.
const UniversePage = lazy(() => import('./universe/UniversePage'))

/** The universe landing page draws its own chrome. */
function Nav() {
  const { pathname } = useLocation()
  if (pathname === '/') return null
  return (
    <nav className="nav">
      <NavLink to="/" end className="brand">Provenance</NavLink>
      <NavLink to="/feed">Briefing</NavLink>
      <NavLink to="/capture">Capture</NavLink>
      <NavLink to="/attack">Attacker</NavLink>
      <NavLink to="/split">Split</NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Suspense fallback={<div className="uv-loading" />}><UniversePage /></Suspense>} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/capture" element={<CapturePage />} />
        <Route path="/item/:id" element={<ItemPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/attack" element={<AttackerPage />} />
        <Route path="/split" element={<SplitScreenPage />} />
        <Route path="/passkey-test" element={<PasskeyTestPage />} />
      </Routes>
    </BrowserRouter>
  )
}
