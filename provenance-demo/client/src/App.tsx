import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import FeedPage from './pages/FeedPage'
import CapturePage from './pages/CapturePage'
import ItemPage from './pages/ItemPage'
import SetupPage from './pages/SetupPage'
import AttackerPage from './pages/AttackerPage'
import SplitScreenPage from './pages/SplitScreenPage'
import PasskeyTestPage from './pages/PasskeyTestPage'

export default function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <NavLink to="/" end className="brand">Provenance</NavLink>
        <NavLink to="/" end>Briefing</NavLink>
        <NavLink to="/capture">Capture</NavLink>
        <NavLink to="/attack">Attacker</NavLink>
        <NavLink to="/split">Split</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<FeedPage />} />
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
