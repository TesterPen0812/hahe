import { lazy, Suspense } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import FeedPage from './pages/FeedPage'
import CapturePage from './pages/CapturePage'
import ItemPage from './pages/ItemPage'
import SetupPage from './pages/SetupPage'
import AttackerPage from './pages/AttackerPage'
import SplitScreenPage from './pages/SplitScreenPage'
import PasskeyTestPage from './pages/PasskeyTestPage'
import UploadPage from './pages/UploadPage'

// three.js only loads on the landing page, so the phone's capture page stays light.
const UniversePage = lazy(() => import('./universe/UniversePage'))
// Webcam hand tracking loads only on its own page.
const GestureTestPage = lazy(() => import('./gesture/GestureTestPage'))
// DEV-only harness for the live toy-RSA break; unlinked.
const ToyRsaTestPage = lazy(() => import('./pages/ToyRsaTestPage'))

/** The universe landing page draws its own chrome. */
function Nav() {
  const { pathname } = useLocation()
  if (pathname === '/') return null
  return (
    <nav className="nav">
      <NavLink to="/" end className="brand">Provenance</NavLink>
      <NavLink to="/feed">Briefing</NavLink>
      <NavLink to="/capture">Capture</NavLink>
      <NavLink to="/upload">Upload</NavLink>
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
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/item/:id" element={<ItemPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/attack" element={<AttackerPage />} />
        <Route path="/split" element={<SplitScreenPage />} />
        <Route path="/passkey-test" element={<PasskeyTestPage />} />
        <Route path="/gesture" element={<Suspense fallback={null}><GestureTestPage /></Suspense>} />
        {import.meta.env.DEV && <Route path="/toy-rsa" element={<Suspense fallback={null}><ToyRsaTestPage /></Suspense>} />}
      </Routes>
    </BrowserRouter>
  )
}
