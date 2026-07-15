import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ScraperForm from './components/ScraperForm';
import LogViewer from './components/LogViewer';
import './App.css';

function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [profile, setProfile] = useState(null);
  const [runHistory, setRunHistory] = useState([]);

  useEffect(() => {
    let cleanup;
    if (window.electronAPI) {
      cleanup = window.electronAPI.onLogMessage((logData) => {
        setLogs(prev => [...prev, logData]);
      });
    } else {
      console.warn('Electron API not available - running in browser mode');
    }
    return () => { if (cleanup) cleanup(); };
  }, []);

  const handleStartScraper = async (config) => {
    setIsRunning(true);
    setActiveView('logs');
    const startedAt = new Date().toISOString();

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.startScraper(config);
        setRunHistory(prev => [{ startedAt, success: result.success, url: config.productUrl }, ...prev]);
      } else {
        setLogs(prev => [...prev, {
          timestamp: new Date().toISOString(),
          message: '⚠️ Running in browser mode - scraper functionality limited',
          type: 'warning'
        }]);
      }
    } catch (error) {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        message: `❌ Error: ${error.message}`,
        type: 'error'
      }]);
      setRunHistory(prev => [{ startedAt, success: false, url: config.productUrl }, ...prev]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleClearLogs = () => setLogs([]);

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return (
          <Dashboard
            profile={profile}
            runHistory={runHistory}
            isRunning={isRunning}
            logCount={logs.length}
            onNavigate={setActiveView}
          />
        );
      case 'profile':
        return <ScraperForm mode="profile" profile={profile} onSave={setProfile} />;
      case 'run':
        return (
          <ScraperForm
            mode="run"
            profile={profile}
            onStart={handleStartScraper}
            isRunning={isRunning}
          />
        );
      case 'logs':
        return <LogViewer logs={logs} onClear={handleClearLogs} isRunning={isRunning} />;
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        isRunning={isRunning}
        hasProfile={!!profile}
        electronConnected={!!window.electronAPI}
      />
      <main className="main-panel">
        {renderView()}
      </main>
    </div>
  );
}

export default App;