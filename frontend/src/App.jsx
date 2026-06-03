import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import MediaManager from './pages/MediaManager';
import ActivityLog from './pages/ActivityLog';
import Sidebar from './components/Sidebar';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  
  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-900 text-white overflow-hidden">
      <Sidebar />
      <div className="flex-1 overflow-auto bg-gray-900/95 relative z-0">
        {children}
      </div>
    </div>
  );
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/media" element={
          <ProtectedRoute>
            <MediaManager />
          </ProtectedRoute>
        } />
        
        <Route path="/logs" element={
          <ProtectedRoute>
            <ActivityLog />
          </ProtectedRoute>
        } />
        
        <Route path="/settings" element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
  );
}

export default App;
