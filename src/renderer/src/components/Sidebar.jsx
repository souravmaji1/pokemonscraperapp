import React from 'react';
import './Sidebar.css';

// In Sidebar.js, add to NAV_ITEMS
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈' },
  { id: 'profile', label: 'Profile & Card', icon: '◐' },
  { id: 'run', label: 'Quick Run', icon: '▶' },
  { id: 'twitter', label: 'Twitter Monitor', icon: '🐦' },
  { id: 'logs', label: 'Logs', icon: '▤' },
];

function Sidebar({ activeView, onNavigate, isRunning, hasProfile, electronConnected }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">◆</div>
        <div>
          <div className="brand-title">Checkout Bot</div>
          <div className="brand-sub">Target Monitor</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.id === 'run' && isRunning && <span className="nav-pulse" />}
            {item.id === 'profile' && hasProfile && <span className="nav-check">✓</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`status-pill ${electronConnected ? 'online' : 'offline'}`}>
          <span className="status-dot" />
          {electronConnected ? 'Engine Connected' : 'Browser Mode'}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;