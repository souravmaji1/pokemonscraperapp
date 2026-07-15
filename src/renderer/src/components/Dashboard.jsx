import React from 'react';
import './Dashboard.css';

function Dashboard({ profile, runHistory, isRunning, logCount, onNavigate }) {
  const successCount = runHistory.filter(r => r.success).length;

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <h1>Dashboard</h1>
          <p className="dash-sub">Overview of your checkout automation</p>
        </div>
        <button className="cta-button" onClick={() => onNavigate('run')}>
          ▶ Run Scraper
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Status</div>
          <div className="stat-value">
            <span className={`status-dot-lg ${isRunning ? 'running' : 'idle'}`} />
            {isRunning ? 'Running' : 'Idle'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Runs</div>
          <div className="stat-value">{runHistory.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Successful</div>
          <div className="stat-value accent-success">{successCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Log Entries</div>
          <div className="stat-value">{logCount}</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel-card">
          <div className="panel-card-header">
            <h3>Profile</h3>
            <button className="link-button" onClick={() => onNavigate('profile')}>Edit →</button>
          </div>
          {profile ? (
            <div className="profile-summary">
              <div className="summary-row"><span>Name on card</span><span>{profile.card?.nameOnCard || '—'}</span></div>
              <div className="summary-row"><span>Card ending</span><span>•••• {profile.card?.number?.slice(-4) || '----'}</span></div>
              <div className="summary-row"><span>Shipping</span><span>{profile.shipping?.city || '—'}, {profile.shipping?.state || '—'}</span></div>
            </div>
          ) : (
            <div className="empty-hint">
              No profile saved yet. <button className="link-button" onClick={() => onNavigate('profile')}>Set one up</button>
            </div>
          )}
        </div>

        <div className="panel-card">
          <div className="panel-card-header">
            <h3>Recent Runs</h3>
          </div>
          {runHistory.length === 0 ? (
            <div className="empty-hint">No runs yet.</div>
          ) : (
            <div className="run-list">
              {runHistory.slice(0, 5).map((run, i) => (
                <div key={i} className="run-row">
                  <span className={`run-dot ${run.success ? 'ok' : 'fail'}`} />
                  <span className="run-url">{run.url}</span>
                  <span className="run-time">{new Date(run.startedAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;