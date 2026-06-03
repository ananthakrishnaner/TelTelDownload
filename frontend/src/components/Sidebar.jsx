import { NavLink, useNavigate } from 'react-router-dom';
import { FiHome, FiSettings, FiLogOut, FiBox, FiImage, FiActivity } from 'react-icons/fi';

export default function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="w-full md:w-72 bg-[#0a0f1d] border-b md:border-r border-slate-800/60 flex flex-row md:flex-col justify-between md:justify-start shadow-xl z-20 shrink-0 relative">
      {/* Decorative Gradient Line */}
      <div className="absolute top-0 right-0 w-[1px] h-full bg-gradient-to-b from-transparent via-blue-500/20 to-transparent hidden md:block"></div>
      
      <div className="p-4 md:p-8 flex items-center justify-between md:block shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
             <FiBox className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-slate-100">
              TelTel
            </h1>
            <p className="hidden md:block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mt-0.5">Media Manager</p>
          </div>
        </div>
      </div>

      <div className="flex md:flex-1 px-3 md:px-6 py-2 md:py-8 space-x-2 md:space-x-0 md:space-y-3 items-center md:items-stretch overflow-x-auto no-scrollbar">
        <NavLink 
          to="/" 
          className={({isActive}) => `group flex items-center space-x-3 px-4 py-3 md:py-3.5 rounded-2xl transition-all duration-300 whitespace-nowrap ${isActive ? 'bg-blue-500/10 text-blue-400 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-blue-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
        >
          <FiHome size={20} className={({isActive}) => isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300 transition-colors'} />
          <span className="text-sm md:text-base">Dashboard</span>
        </NavLink>

        <NavLink 
          to="/media" 
          className={({isActive}) => `group flex items-center space-x-3 px-4 py-3 md:py-3.5 rounded-2xl transition-all duration-300 whitespace-nowrap ${isActive ? 'bg-pink-500/10 text-pink-400 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-pink-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
        >
          <FiImage size={20} className={({isActive}) => isActive ? 'text-pink-400' : 'text-slate-500 group-hover:text-slate-300 transition-colors'} />
          <span className="text-sm md:text-base">Media Vault</span>
        </NavLink>

        <NavLink 
          to="/active-jobs" 
          className={({isActive}) => `group flex items-center space-x-3 px-4 py-3 md:py-3.5 rounded-2xl transition-all duration-300 whitespace-nowrap ${isActive ? 'bg-emerald-500/10 text-emerald-400 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-emerald-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
        >
          <FiActivity size={20} className={({isActive}) => isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300 transition-colors'} />
          <span className="text-sm md:text-base">Active Jobs</span>
        </NavLink>

        <NavLink 
          to="/logs" 
          className={({isActive}) => `group flex items-center space-x-3 px-4 py-3 md:py-3.5 rounded-2xl transition-all duration-300 whitespace-nowrap ${isActive ? 'bg-purple-500/10 text-purple-400 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-purple-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
        >
          <FiActivity size={20} className={({isActive}) => isActive ? 'text-purple-400' : 'text-slate-500 group-hover:text-slate-300 transition-colors'} />
          <span className="text-sm md:text-base">Audit Logs</span>
        </NavLink>

        <NavLink 
          to="/settings" 
          className={({isActive}) => `group flex items-center space-x-3 px-4 py-3 md:py-3.5 rounded-2xl transition-all duration-300 whitespace-nowrap ${isActive ? 'bg-indigo-500/10 text-indigo-400 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-indigo-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
        >
          <FiSettings size={20} className={({isActive}) => isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300 transition-colors'} />
          <span className="text-sm md:text-base">Settings</span>
        </NavLink>
      </div>

      <div className="p-3 md:p-6 md:pb-8 flex items-center md:block shrink-0">
        <button 
          onClick={handleLogout}
          className="group flex items-center space-x-3 px-4 py-3 w-full text-left text-slate-400 hover:bg-red-500/10 hover:text-red-400 rounded-2xl transition-all duration-300 whitespace-nowrap"
        >
          <FiLogOut size={20} className="text-slate-500 group-hover:text-red-400 transition-colors" />
          <span className="font-medium text-sm md:text-base hidden sm:inline-block">Logout</span>
        </button>
      </div>
    </div>
  );
}
