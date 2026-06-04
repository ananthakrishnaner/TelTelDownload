import { NavLink, useNavigate } from 'react-router-dom';
import { FiHome, FiSettings, FiLogOut, FiImage, FiActivity, FiFileText } from 'react-icons/fi';
import useMediaQuery from '../hooks/useMediaQuery';
import SessionPill from './SessionPill';

const SECTIONS = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: FiHome, accent: 'dashboard', end: true },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/media', label: 'Media Vault', icon: FiImage, accent: 'media' },
      { to: '/active-jobs', label: 'Active Jobs', icon: FiActivity, accent: 'jobs' },
      { to: '/logs', label: 'Audit Logs', icon: FiFileText, accent: 'logs' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: FiSettings, accent: 'settings' },
    ],
  },
];

const accentText = {
  dashboard: 'text-[var(--color-route-dashboard)]',
  media: 'text-[var(--color-route-media)]',
  jobs: 'text-[var(--color-route-jobs)]',
  logs: 'text-[var(--color-route-logs)]',
  settings: 'text-[var(--color-route-settings)]',
};

const accentBorder = {
  dashboard: 'bg-[var(--color-route-dashboard)]',
  media: 'bg-[var(--color-route-media)]',
  jobs: 'bg-[var(--color-route-jobs)]',
  logs: 'bg-[var(--color-route-logs)]',
  settings: 'bg-[var(--color-route-settings)]',
};

function NavItem({ to, label, icon: Icon, accent, end, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `relative flex items-center gap-3 pl-4 pr-3 py-2.5 text-sm transition-colors duration-150 rounded-md ${
          isActive
            ? 'text-slate-100 bg-white/[0.04]'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r ${accentBorder[accent]}`} />
          )}
          <Icon
            size={16}
            className={isActive ? accentText[accent] : 'text-slate-500 group-hover:text-slate-300'}
            strokeWidth={isActive ? 2.25 : 1.75}
          />
          <span className="font-medium">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  if (isMobile) {
    return (
      <>
        <div className="fixed top-3 right-3 z-50">
          <SessionPill size="sm" />
        </div>
        <nav className="fixed bottom-0 left-0 right-0 z-40 surface-1 border-t border-[var(--color-hairline)] flex justify-around items-center px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {SECTIONS.flatMap((s) => s.items).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-3 py-1.5 rounded-md transition-colors ${
                  isActive ? accentText[item.accent] : 'text-slate-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={18} strokeWidth={isActive ? 2.25 : 1.75} />
                  <span className="text-[10px] font-mono uppercase tracking-wider">{item.label.split(' ')[0]}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </>
    );
  }

  return (
    <aside className="hidden md:flex w-64 shrink-0 bg-[var(--color-surface-1)] border-r border-[var(--color-hairline)] flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-6 pt-7 pb-6 border-b border-[var(--color-hairline)]">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl italic font-light text-slate-100 tracking-tight">TelTel</span>
            <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500">v1.0</span>
          </div>
          <SessionPill size="sm" />
        </div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mt-1.5">Media Manager</p>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-4 mb-2 text-[10px] font-mono uppercase tracking-widest text-slate-600">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User / Logout */}
      <div className="px-3 py-3 border-t border-[var(--color-hairline)]">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 ring-1 ring-white/10 flex items-center justify-center text-xs font-semibold text-slate-200">
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">admin</p>
            <p className="text-[10px] font-mono text-slate-500 tnum">session · 23h 41m</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono text-slate-500 hover:text-rose-400 transition-colors"
        >
          <FiLogOut size={13} /> [ sign out ]
        </button>
      </div>
    </aside>
  );
}
