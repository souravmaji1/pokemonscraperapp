import React, { useEffect, useRef } from 'react';
import './LogViewer.css';

function LogViewer({ logs, onClear, isRunning }) {
  const logContainerRef = useRef(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogClass = (type) => {
    switch (type) {
      case 'success': return 'log-success';
      case 'error': return 'log-error';
      case 'warning': return 'log-warning';
      default: return 'log-info';
    }
  };

  return (
    <div className="log-viewer">
      <div className="log-header">
        <div>
          <h1>Logs</h1>
          <p className="form-sub">
            {isRunning ? <><span className="live-dot" /> Live</> : `${logs.length} entries`}
          </p>
        </div>
        <button onClick={onClear} className="clear-button">Clear</button>
      </div>
      <div className="log-container" ref={logContainerRef}>
        {logs.length === 0 ? (
          <div className="log-empty"><p>No logs yet. Start the scraper to see output here.</p></div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={`log-entry ${getLogClass(log.type)}`}>
              <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LogViewer;