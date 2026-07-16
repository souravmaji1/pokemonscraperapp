import React, { useState, useEffect } from 'react';
import './ScraperForm.css';

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const emptyForm = {
  email: '',
  password: '',
  shipping: { firstName: '', lastName: '', address1: '', zip: '', city: '', state: '', phone: '' },
  card: { number: '', expMonth: '', expYear: '', cvv: '', nameOnCard: '' },
  headless: false,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized', '--disable-blink-features=AutomationControlled'],
};

function ScraperForm({ mode, profile, onSave, onStart, onStop, onStopCheckout, isRunning, productStatuses = {} }) {
  const [formData, setFormData] = useState(profile || emptyForm);
  const [productUrls, setProductUrls] = useState([{ name: '', url: '' }]);

  useEffect(() => {
    if (profile) setFormData(profile);
  }, [profile]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setFormData(prev => ({ ...prev, [parent]: { ...prev[parent], [child]: value } }));
    } else {
      setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    }
  };

  const handleProductChange = (index, field, value) => {
    setProductUrls(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const addProductRow = () => setProductUrls(prev => [...prev, { name: '', url: '' }]);
  const removeProductRow = (index) => setProductUrls(prev => prev.filter((_, i) => i !== index));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'profile') {
      onSave(formData);
    } else {
      const validProducts = productUrls
        .filter(p => p.url.trim())
        .map(p => ({ url: p.url.trim(), name: p.name.trim() || p.url.trim() }));
      if (validProducts.length === 0) return;
      onStart(validProducts);
    }
  };

  return (
    <div className="scraper-form">
      <div className="form-header">
        <h1>{mode === 'profile' ? 'Profile & Card Details' : 'Run Scraper'}</h1>
        <p className="form-sub">
          {mode === 'profile'
            ? 'Stored locally for this session — used to auto-fill checkout.'
            : 'Add one or more products. Each is monitored independently — checkout fires automatically the moment one comes in stock.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="form-body">
        {mode === 'run' && (
          <div className="card-block">
            <h3>Products to Monitor</h3>
           {productUrls.map((p, index) => {
  const status = productStatuses[p.url]?.status;
  const isBuying = status === 'buying';
  return (
    <div key={index} className="form-row" style={{ marginBottom: 10, alignItems: 'center' }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label>Name (optional)</label>
        <input
          type="text"
          value={p.name}
          onChange={(e) => handleProductChange(index, 'name', e.target.value)}
          placeholder="Elite Trainer Box"
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label>Product URL {status ? `— ${status}` : ''}</label>
        <input
          type="text"
          value={p.url}
          onChange={(e) => handleProductChange(index, 'url', e.target.value)}
          placeholder="https://www.target.com/p/..."
        />
      </div>
      {isBuying && (
        <button
          type="button"
          className="clear-button"
          onClick={() => onStopCheckout(p.url)}
        >
          🛑 Stop Checkout
        </button>
      )}
      {productUrls.length > 1 && !isBuying && (
        <button type="button" className="link-button" onClick={() => removeProductRow(index)}>
          Remove
        </button>
      )}
    </div>
  );
})}
            <button type="button" className="link-button" onClick={addProductRow}>+ Add another product</button>

           
            {!profile && <div className="warn-banner">⚠️ No profile saved — set up your details in Profile & Card first.</div>}
          </div>
        )}

        {mode === 'profile' && (
          <>
            <div className="card-block">
              <h3>Account</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" name="email" value={formData.email} onChange={handleChange} required placeholder="you@example.com" />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" name="password" value={formData.password} onChange={handleChange} required placeholder="••••••••" />
                </div>
              </div>
            </div>

            <div className="card-block">
              <h3>Shipping Address</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>First Name</label>
                  <input type="text" name="shipping.firstName" value={formData.shipping.firstName} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" name="shipping.lastName" value={formData.shipping.lastName} onChange={handleChange} required />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <input type="text" name="shipping.address1" value={formData.shipping.address1} onChange={handleChange} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>City</label>
                  <input type="text" name="shipping.city" value={formData.shipping.city} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <select name="shipping.state" value={formData.shipping.state} onChange={handleChange} required>
                    <option value="">Select</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>ZIP</label>
                  <input type="text" name="shipping.zip" value={formData.shipping.zip} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" name="shipping.phone" value={formData.shipping.phone} onChange={handleChange} required />
                </div>
              </div>
            </div>

            <div className="card-block">
              <h3>Payment</h3>
              <div className="form-group">
                <label>Card Number</label>
                <input type="text" name="card.number" value={formData.card.number} onChange={handleChange} required maxLength="16" placeholder="•••• •••• •••• ••••" />
              </div>
              <div className="form-row three">
                <div className="form-group">
                  <label>Exp Month</label>
                  <input type="text" name="card.expMonth" value={formData.card.expMonth} onChange={handleChange} required maxLength="2" placeholder="MM" />
                </div>
                <div className="form-group">
                  <label>Exp Year</label>
                  <input type="text" name="card.expYear" value={formData.card.expYear} onChange={handleChange} required maxLength="2" placeholder="YY" />
                </div>
                <div className="form-group">
                  <label>CVV</label>
                  <input type="text" name="card.cvv" value={formData.card.cvv} onChange={handleChange} required maxLength="4" placeholder="•••" />
                </div>
              </div>
              <div className="form-group">
                <label>Name on Card</label>
                <input type="text" name="card.nameOnCard" value={formData.card.nameOnCard} onChange={handleChange} required />
              </div>
            </div>
          </>
        )}

        {mode === 'run' ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" className="submit-button" disabled={isRunning}>
              {isRunning ? '⏳ Monitoring...' : '🚀 Start Monitoring'}
            </button>
            {isRunning && (
              <button type="button" className="clear-button" onClick={onStop}>Stop All</button>
            )}
          </div>
        ) : (
          <button type="submit" className="submit-button">💾 Save Profile</button>
        )}
      </form>
    </div>
  );
}

export default ScraperForm;