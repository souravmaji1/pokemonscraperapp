import React, { useState, useEffect } from 'react';
import './TwitterMonitor.css';

function TwitterMonitor({ profile, isRunning, onStart, onStop }) {
  const [twitterProfiles, setTwitterProfiles] = useState(['']);
  const [suggestedProfiles] = useState([
    '@pokebeach',
    '@poketcgalerts', 
    '@pokenotifyx',
    '@PokemonTCG',
    '@PokemonRestocks'
  ]);

  useEffect(() => {
    // Load saved Twitter profiles from localStorage if available
    try {
      const saved = localStorage.getItem('twitterProfiles');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTwitterProfiles(parsed);
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const saveProfiles = (profiles) => {
    try {
      localStorage.setItem('twitterProfiles', JSON.stringify(profiles));
    } catch (e) {
      // ignore
    }
  };

  const addProfile = () => {
    const newProfiles = [...twitterProfiles, ''];
    setTwitterProfiles(newProfiles);
    saveProfiles(newProfiles);
  };

  const removeProfile = (index) => {
    const newProfiles = twitterProfiles.filter((_, i) => i !== index);
    setTwitterProfiles(newProfiles);
    saveProfiles(newProfiles);
  };
  
  const handleProfileChange = (index, value) => {
    const newProfiles = twitterProfiles.map((p, i) => i === index ? value : p);
    setTwitterProfiles(newProfiles);
    saveProfiles(newProfiles);
  };

  const addSuggestedProfile = (suggestion) => {
    const cleanSuggestion = suggestion.replace('@', '');
    if (!twitterProfiles.some(p => p.replace('@', '') === cleanSuggestion)) {
      const newProfiles = [...twitterProfiles.filter(p => p.trim()), suggestion];
      setTwitterProfiles(newProfiles);
      saveProfiles(newProfiles);
    }
  };

  const handleStart = () => {
    const validProfiles = twitterProfiles
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => {
        // Add @ if not present and not a URL
        if (!p.startsWith('@') && !p.includes('twitter.com') && !p.includes('x.com')) {
          return '@' + p;
        }
        return p;
      });

    if (validProfiles.length === 0) return;

    // Save profiles before starting
    saveProfiles(validProfiles);
    
    onStart({
      twitterProfiles: validProfiles,
      profile
    });
  };

  const handleStop = () => {
    onStop();
  };

  const hasValidProfiles = twitterProfiles.some(p => p.trim().length > 0);
  const hasCheckoutProfile = profile?.target?.email || profile?.pokemon?.email;

  return (
    <div className="twitter-monitor">
      <div className="form-header">
        <h1>🐦 Twitter Monitor</h1>
        <p className="form-sub">
          Monitor Twitter profiles for Pokémon TCG product drops. When a URL is found 
          (pokemoncenter.com or target.com), it automatically starts monitoring that product 
          and proceeds to checkout when in stock.
        </p>
      </div>

      <div className="card-block">
        <h3>Twitter Profiles to Monitor</h3>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
          Add Twitter handles or profile URLs. The monitor will continuously scan for new 
          tweets containing product links from pokemoncenter.com and target.com.
        </p>

        <div className="twitter-profiles-list">
          {twitterProfiles.map((profile, index) => (
            <div key={index} className="twitter-profile-row">
              <div className="twitter-profile-input-wrapper">
                <span className="twitter-at-symbol">@</span>
                <input
                  type="text"
                  value={profile.startsWith('@') ? profile.substring(1) : profile}
                  onChange={(e) => handleProfileChange(index, e.target.value)}
                  placeholder="username or full URL"
                  disabled={isRunning}
                  className="twitter-profile-input"
                />
              </div>
              {twitterProfiles.length > 1 && !isRunning && (
                <button 
                  type="button" 
                  className="remove-profile-btn" 
                  onClick={() => removeProfile(index)}
                  title="Remove profile"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {!isRunning && (
          <button type="button" className="add-profile-btn" onClick={addProfile}>
            + Add Profile
          </button>
        )}

        {/* Suggested Profiles */}
        {!isRunning && (
          <div className="suggested-profiles">
            <p className="suggested-label">Suggested profiles to monitor:</p>
            <div className="suggested-chips">
              {suggestedProfiles.map(suggestion => {
                const cleanSuggestion = suggestion.replace('@', '');
                const isAdded = twitterProfiles.some(p => p.replace('@', '') === cleanSuggestion);
                return (
                  <button
                    key={suggestion}
                    className={`suggested-chip ${isAdded ? 'added' : ''}`}
                    onClick={() => addSuggestedProfile(suggestion)}
                    disabled={isAdded}
                  >
                    {isAdded ? '✓ ' : '+ '}{suggestion}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Profile Status */}
      <div className="card-block">
        <h3>Checkout Profiles Status</h3>
        <div className="profile-status-grid">
          <div className={`profile-status-card ${profile?.target?.email ? 'configured' : 'missing'}`}>
            <span className="platform-icon">🎯</span>
            <div>
              <strong>Target</strong>
              <p>{profile?.target?.email ? '✓ Configured' : '✗ Not configured'}</p>
            </div>
          </div>
          <div className={`profile-status-card ${profile?.pokemon?.email ? 'configured' : 'missing'}`}>
            <span className="platform-icon">⚡</span>
            <div>
              <strong>Pokémon Center</strong>
              <p>{profile?.pokemon?.email ? '✓ Configured' : '✗ Not configured'}</p>
            </div>
          </div>
        </div>
        {!hasCheckoutProfile && (
          <div className="warn-banner">
            ⚠️ No checkout profiles configured. URLs will be monitored but can't auto-checkout 
            without saved profiles. Set up your profiles in the Profile & Card tab first.
          </div>
        )}
      </div>

      {/* How It Works */}
      <div className="card-block">
        <h3>How It Works</h3>
        <div className="steps-list">
          <div className="step-item">
            <span className="step-number">1</span>
            <div>
              <strong>Scan Twitter Profiles</strong>
              <p>Continuously monitors specified Twitter profiles for new tweets containing product links from pokemoncenter.com and target.com</p>
            </div>
          </div>
          <div className="step-item">
            <span className="step-number">2</span>
            <div>
              <strong>Auto-Monitor Products</strong>
              <p>When a valid product URL is found, automatically starts monitoring that product page for stock availability</p>
            </div>
          </div>
          <div className="step-item">
            <span className="step-number">3</span>
            <div>
              <strong>Instant Checkout</strong>
              <p>Once the product comes in stock, immediately starts the automated checkout process using your saved profile</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="action-buttons">
        {!isRunning ? (
          <button 
            type="button" 
            className="submit-button" 
            onClick={handleStart}
            disabled={!hasValidProfiles}
          >
            🚀 Start Monitoring Twitter
          </button>
        ) : (
          <button 
            type="button" 
            className="stop-button" 
            onClick={handleStop}
          >
            🛑 Stop Twitter Monitor
          </button>
        )}
      </div>
    </div>
  );
}

export default TwitterMonitor;