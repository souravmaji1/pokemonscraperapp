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
  const [profile, setProfile] = useState(null); // { target: {...}, pokemon: {...}, headless: bool }
  const [productStatuses, setProductStatuses] = useState({});
  const [runHistory, setRunHistory] = useState([]);

  useEffect(() => {
    let cleanupLog, cleanupStatus;
    if (window.electronAPI) {
      cleanupLog = window.electronAPI.onLogMessage((logData) => {
        setLogs(prev => [...prev, logData]);
      });
      cleanupStatus = window.electronAPI.onProductStatus(({ url, status, price, platform }) => {
        setProductStatuses(prev => ({ ...prev, [url]: { status, price, platform } }));
        if (status === 'purchased' || status === 'checkout-failed') {
          setRunHistory(prev => [{ startedAt: new Date().toISOString(), success: status === 'purchased', url, platform }, ...prev]);
        }
      });
    }
    return () => { if (cleanupLog) cleanupLog(); if (cleanupStatus) cleanupStatus(); };
  }, []);

  const handleStartMonitoring = async (productUrls, profileData) => {
    // Check if at least one platform profile is configured
    const hasTargetProfile = profileData?.target?.email;
    const hasPokemonProfile = profileData?.pokemon?.email;
    
    if (!hasTargetProfile && !hasPokemonProfile) {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        message: '❌ No profile saved — set up Profile & Card before monitoring.',
        type: 'error'
      }]);
      setActiveView('profile');
      return;
    }

    // Check if selected platforms have profiles
    const missingProfiles = [];
    for (const p of productUrls) {
      if (p.platform === 'target' && !hasTargetProfile) missingProfiles.push('Target');
      if (p.platform === 'pokemon' && !hasPokemonProfile) missingProfiles.push('Pokémon Center');
    }
    
    if (missingProfiles.length > 0) {
      const unique = [...new Set(missingProfiles)];
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        message: `❌ Missing profile for: ${unique.join(', ')}. Configure all required platform profiles.`,
        type: 'error'
      }]);
      setActiveView('profile');
      return;
    }

    setActiveView('logs');

    const initialStatuses = {};
    productUrls.forEach(p => { 
      initialStatuses[p.url] = { status: 'monitoring', platform: p.platform }; 
    });
    setProductStatuses(prev => ({ ...prev, ...initialStatuses }));
    setIsRunning(true);

    try {
      if (window.electronAPI) {
        await window.electronAPI.startMonitoring({
          profile: profileData,
          productUrls,
        });
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

  const hasAnyProfile = profile && (profile.target?.email || profile.pokemon?.email);

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
        hasProfile={!!hasAnyProfile}
        electronConnected={!!window.electronAPI}
      />
      <main className="main-panel">{renderView()}</main>
    </div>
  );
}

export default App;