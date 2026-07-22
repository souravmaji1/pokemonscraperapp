import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ScraperForm from './components/ScraperForm';
import TwitterMonitor from './components/TwitterMonitor';
import LogViewer from './components/LogViewer';
import './App.css';

function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isTwitterRunning, setIsTwitterRunning] = useState(false);
  const [profile, setProfile] = useState(null); // { target: {...}, pokemon: {...}, headless: bool }
  const [productStatuses, setProductStatuses] = useState({});
  const [runHistory, setRunHistory] = useState([]);

  useEffect(() => {
    let cleanupLog, cleanupStatus;
    if (window.electronAPI) {
      cleanupLog = window.electronAPI.onLogMessage((logData) => {
        setLogs(prev => [...prev, logData]);
      });
      cleanupStatus = window.electronAPI.onProductStatus(({ url, status, price, platform, source }) => {
        setProductStatuses(prev => ({
          ...prev,
          [url]: { status, price, platform, source }
        }));
        if (status === 'purchased' || status === 'checkout-failed') {
          setRunHistory(prev => [{
            startedAt: new Date().toISOString(),
            success: status === 'purchased',
            url,
            platform,
            source
          }, ...prev]);
        }
      });
    }
    return () => {
      if (cleanupLog) cleanupLog();
      if (cleanupStatus) cleanupStatus();
    };
  }, []);

  useEffect(() => {
    const hasActiveMonitors = Object.values(productStatuses).some(
      s => s.status === 'monitoring' || s.status === 'buying'
    );
    if (!hasActiveMonitors && isRunning) {
      setIsRunning(false);
    }
    if (!hasActiveMonitors && isTwitterRunning) {
      // Don't auto-stop Twitter flag unless explicitly stopped
      // setIsTwitterRunning(false);
    }
  }, [productStatuses, isRunning, isTwitterRunning]);

  const handleStartMonitoring = async (productUrls, profileData) => {
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
      initialStatuses[p.url] = { status: 'monitoring', platform: p.platform, source: 'manual' };
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

  const handleStartTwitterMonitor = async (config) => {
    const { twitterProfiles, profile: profileData } = config;

    const hasTargetProfile = profileData?.target?.email;
    const hasPokemonProfile = profileData?.pokemon?.email;

    if (!hasTargetProfile && !hasPokemonProfile) {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        message: '❌ No profile saved — set up Profile & Card before starting Twitter monitor.',
        type: 'error'
      }]);
      setActiveView('profile');
      return;
    }

    setActiveView('logs');
    setIsTwitterRunning(true);

    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      message: `🐦 Starting Twitter monitor for ${twitterProfiles.length} profile(s): ${twitterProfiles.join(', ')}`,
      type: 'info'
    }]);

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.startTwitterMonitor(config);
        if (!result.success) {
          setLogs(prev => [...prev, {
            timestamp: new Date().toISOString(),
            message: `❌ Failed to start Twitter monitor: ${result.error}`,
            type: 'error'
          }]);
          setIsTwitterRunning(false);
        }
      } else {
        setLogs(prev => [...prev, {
          timestamp: new Date().toISOString(),
          message: '⚠️ Running in browser mode - Twitter monitor not available',
          type: 'warning'
        }]);
        setIsTwitterRunning(false);
      }
    } catch (error) {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        message: `❌ Error starting Twitter monitor: ${error.message}`,
        type: 'error'
      }]);
      setIsTwitterRunning(false);
    }
  };

  const handleStopTwitterMonitor = async () => {
    if (window.electronAPI) {
      await window.electronAPI.stopTwitterMonitor();
    }
    setIsTwitterRunning(false);
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      message: '🛑 Twitter monitor stopped by user',
      type: 'info'
    }]);
  };

  const handleStopCheckout = async (url) => {
    if (window.electronAPI) {
      await window.electronAPI.stopCheckout(url);
    }
  };

  const handleStopMonitoring = async () => {
    if (window.electronAPI) {
      await window.electronAPI.stopMonitoring();
    }
    setIsRunning(false);
    setIsTwitterRunning(false);
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
            isRunning={isRunning || isTwitterRunning}
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
      case 'twitter':
        return (
          <TwitterMonitor
            profile={profile}
            isRunning={isTwitterRunning}
            onStart={handleStartTwitterMonitor}
            onStop={handleStopTwitterMonitor}
          />
        );
      case 'logs':
        return (
          <LogViewer
            logs={logs}
            onClear={handleClearLogs}
            isRunning={isRunning || isTwitterRunning}
            onStopAll={handleStopMonitoring}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="app-shell"
     
    >
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        isRunning={isRunning || isTwitterRunning}
        isTwitterRunning={isTwitterRunning}
        hasProfile={!!hasAnyProfile}
        electronConnected={!!window.electronAPI}
        theme={{
          accent: 'var(--accent)',
          accentGlow: 'var(--accent-glow)',
          bgPanel: 'var(--bg-panel)',
          borderSubtle: 'var(--border-subtle)',
          textPrimary: 'var(--text-primary)',
          textSecondary: 'var(--text-secondary)',
          textMuted: 'var(--text-muted)',
          success: 'var(--success)',
          error: 'var(--error)',
        }}
      />
      <main
        className="main-panel"
        style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--bg-panel)',
          borderLeft: '1px solid var(--border-subtle)',
        }}
      >
        {renderView()}
      </main>
    </div>
  );
}

export default App;