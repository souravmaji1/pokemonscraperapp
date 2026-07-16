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
  const [productStatuses, setProductStatuses] = useState({}); // url -> {status, price}
  const [runHistory, setRunHistory] = useState([]);

  useEffect(() => {
    let cleanupLog, cleanupStatus;
    if (window.electronAPI) {
      cleanupLog = window.electronAPI.onLogMessage((logData) => {
        setLogs(prev => [...prev, logData]);
      });
      cleanupStatus = window.electronAPI.onProductStatus(({ url, status, price }) => {
        setProductStatuses(prev => ({ ...prev, [url]: { status, price } }));
        if (status === 'purchased' || status === 'checkout-failed') {
          setRunHistory(prev => [{ startedAt: new Date().toISOString(), success: status === 'purchased', url }, ...prev]);
        }
      });
    } else {
      console.warn('Electron API not available - running in browser mode');
    }
    return () => { if (cleanupLog) cleanupLog(); if (cleanupStatus) cleanupStatus(); };
  }, []);

  const handleStartMonitoring = async (productUrls) => {
  if (!profile) {
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      message: '❌ No profile saved — set up Profile & Card before monitoring.',
      type: 'error'
    }]);
    setActiveView('profile');
    return;
  }

  setActiveView('logs');

  const initialStatuses = {};
  productUrls.forEach(p => { initialStatuses[p.url] = { status: 'monitoring' }; });
  setProductStatuses(prev => ({ ...prev, ...initialStatuses }));
  setIsRunning(true); // stays true until stopped or all products resolve — see effect below

  try {
    if (window.electronAPI) {
      await window.electronAPI.startMonitoring({
        profile,
        productUrls,
        headless: profile?.headless ?? false,
      });
      // NOTE: intentionally NOT setting isRunning(false) here —
      // this resolving just means "monitors were launched", not "work is done"
    } else {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        message: '⚠️ Running in browser mode - scraper functionality limited',
        type: 'warning'
      }]);
      setIsRunning(false);
    }
  } catch (error) {
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      message: `❌ Error: ${error.message}`,
      type: 'error'
    }]);
    setIsRunning(false);
  }
};

  const handleStopCheckout = async (url) => {
  if (window.electronAPI) await window.electronAPI.stopCheckout(url);
};

  const handleStopMonitoring = async () => {
    if (window.electronAPI) await window.electronAPI.stopMonitoring();
    setIsRunning(false);
  };

  const handleClearLogs = () => setLogs([]);

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return (
          <Dashboard
            profile={profile}
            runHistory={runHistory}
            productStatuses={productStatuses}
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
  onStart={handleStartMonitoring}
  onStop={handleStopMonitoring}
  onStopCheckout={handleStopCheckout}
  isRunning={isRunning}
  productStatuses={productStatuses}
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
      <main className="main-panel">{renderView()}</main>
    </div>
  );
}

export default App;