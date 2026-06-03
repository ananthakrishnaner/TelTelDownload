import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FiHome, FiSettings, FiLogOut } from 'react-icons/fi';

export default function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="w-full md:w-64 bg-gray-900 border-b md:border-r md:border-b-0 border-gray-800 flex flex-row md:flex-col justify-between md:justify-start shadow-2xl z-10 shrink-0">
      <div className="p-4 md:p-6 flex items-center justify-between md:block md:border-b border-gray-800">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
            TelTel
          </h1>
          <p className="hidden md:block text-xs text-gray-500 mt-1">Media Manager</p>
        </div>
      </div>

      <div className="flex md:flex-1 px-2 md:px-4 py-2 md:py-6 space-x-2 md:space-x-0 md:space-y-2 items-center md:items-stretch overflow-x-auto no-scrollbar">
        <NavLink 
          to="/" 
          className={({isActive}) => `flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 rounded-xl transition-all whitespace-nowrap ${isActive ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-blue-400 border border-blue-500/30' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
        >
          <FiHome size={20} />
          <span className="font-medium text-sm md:text-base">Dashboard</span>
        </NavLink>

        <NavLink 
          to="/settings" 
          className={({isActive}) => `flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 rounded-xl transition-all whitespace-nowrap ${isActive ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-blue-400 border border-blue-500/30' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
        >
          <FiSettings size={20} />
          <span className="font-medium text-sm md:text-base">Settings</span>
        </NavLink>
      </div>

      <div className="p-2 md:p-4 flex items-center md:border-t border-gray-800 md:block">
        <button 
          onClick={handleLogout}
          className="flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2 md:py-3 w-full text-left text-gray-400 hover:bg-red-500/10 hover:text-red-400 rounded-xl transition-all whitespace-nowrap"
        >
          <FiLogOut size={20} />
          <span className="font-medium text-sm md:text-base hidden sm:inline-block">Logout</span>
        </button>
      </div>
    </div>
  );
}
