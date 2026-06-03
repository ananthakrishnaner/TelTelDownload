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
    <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full shadow-2xl">
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
          TelTel
        </h1>
        <p className="text-xs text-gray-500 mt-1">Media Manager</p>
      </div>

      <div className="flex-1 px-4 py-6 space-y-2">
        <NavLink 
          to="/" 
          className={({isActive}) => `flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${isActive ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-blue-400 border border-blue-500/30' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
        >
          <FiHome size={20} />
          <span className="font-medium">Dashboard</span>
        </NavLink>

        <NavLink 
          to="/settings" 
          className={({isActive}) => `flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${isActive ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-blue-400 border border-blue-500/30' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
        >
          <FiSettings size={20} />
          <span className="font-medium">Settings</span>
        </NavLink>
      </div>

      <div className="p-4 border-t border-gray-800">
        <button 
          onClick={handleLogout}
          className="flex items-center space-x-3 px-4 py-3 w-full text-left text-gray-400 hover:bg-red-500/10 hover:text-red-400 rounded-xl transition-all"
        >
          <FiLogOut size={20} />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </div>
  );
}
