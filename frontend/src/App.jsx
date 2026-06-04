import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import MediaManager from './pages/MediaManager';
import ActivityLog from './pages/ActivityLog';
import ActiveJobs from './pages/ActiveJobs';
import Scheduler from './pages/Scheduler';
import ChannelDetail from './pages/ChannelDetail';
import Sidebar from './components/Sidebar';
import Toaster from './components/Toaster';
import useShortcuts from './hooks/useShortcuts';
import { SessionStatusProvider } from './hooks/useSessionStatus';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[var(--color-surface-0)] text-white overflow-hidden">
      <Sidebar />
      <div className="flex-1 overflow-auto pb-16 md:pb-0">
        {children}
      </div>
    </div>
  );
};

const SHORT_HELP = [
  { keys: ['g', 'd'], label: 'Go to Dashboard' },
  { keys: ['g', 'm'], label: 'Go to Media Vault' },
  { keys: ['g', 'j'], label: 'Go to Active Jobs' },
  { keys: ['g', 'l'], label: 'Go to Audit Logs' },
  { keys: ['g', 's'], label: 'Go to Settings' },
  { keys: ['/'], label: 'Focus search' },
  { keys: ['?'], label: 'Show shortcuts' },
];

function ShortcutsOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const isOpen = location.hash === '#shortcuts';

  useShortcuts([
    { key: 'g d', action: () => navigate('/') },
    { key: 'g m', action: () => navigate('/media') },
    { key: 'g j', action: () => navigate('/active-jobs') },
    { key: 'g l', action: () => navigate('/logs') },
    { key: 'g s', action: () => navigate('/settings') },
    { key: '?', action: () => {
      if (location.hash === '#shortcuts') navigate(location.pathname);
      else navigate(location.pathname + '#shortcuts');
    } },
    { key: 'Escape', action: () => { if (location.hash === '#shortcuts') navigate(location.pathname); } },
  ]);

  if (!isOpen) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => navigate(location.pathname)}
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="surface-1 rounded-xl p-6 w-full max-w-md shadow-2xl"
      >
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-4">Keyboard shortcuts</p>
        <ul className="space-y-2.5">
          {SHORT_HELP.map((s, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span className="text-slate-300">{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="px-2 py-0.5 text-[10px] font-mono bg-white/5 ring-1 ring-[var(--color-hairline)] rounded text-slate-300">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] font-mono text-slate-600 mt-5 text-center">press <kbd className="px-1.5 py-0.5 bg-white/5 ring-1 ring-[var(--color-hairline)] rounded text-slate-500">?</kbd> or <kbd className="px-1.5 py-0.5 bg-white/5 ring-1 ring-[var(--color-hairline)] rounded text-slate-500">esc</kbd> to close</p>
      </motion.div>
    </motion.div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/channels/:id" element={<ProtectedRoute><ChannelDetail /></ProtectedRoute>} />
          <Route path="/media" element={<ProtectedRoute><MediaManager /></ProtectedRoute>} />
          <Route path="/logs" element={<ProtectedRoute><ActivityLog /></ProtectedRoute>} />
          <Route path="/active-jobs" element={<ProtectedRoute><ActiveJobs /></ProtectedRoute>} />
          <Route path="/scheduler" element={<ProtectedRoute><Scheduler /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  return (
    <SessionStatusProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={
            <>
              <AnimatedRoutes />
              <ShortcutsOverlay />
              <Toaster />
            </>
          } />
        </Routes>
      </Router>
    </SessionStatusProvider>
  );
}

export default App;
