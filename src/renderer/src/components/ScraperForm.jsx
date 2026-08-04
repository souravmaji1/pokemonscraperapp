import React, { useState, useEffect, useRef } from 'react';
import './ScraperForm.css';

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const PLATFORMS = [
  { value: 'target', label: '🎯 Target', color: '#cc0000' },
  { value: 'pokemon', label: '⚡ Pokémon Center', color: '#ffcb05' },
];

const CARD_MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const CARD_YEARS = Array.from({length: 10}, (_, i) => String(new Date().getFullYear() + i).slice(-2));

const emptyTargetProfile = {
  email: '',
  password: '',
  shipping: { firstName: '', lastName: '', address1: '', zip: '', city: '', state: '', phone: '' },
  card: { number: '', expMonth: '', expYear: '', cvv: '', nameOnCard: '' },
};

const emptyPokemonProfile = {
  email: '',
  password: '',
  shipping: { givenName: '', familyName: '', streetAddress: '', extendedAddress: '', postalCode: '', phoneNumber: '' },
  card: { number: '', cvv: '', expMonth: '', expYear: '', nameOnCard: '' },
};

function ScraperForm({ mode, profile, onSave, onStart, onStop, onStopCheckout, isRunning, productStatuses = {} }) {
  const [activeProfileTab, setActiveProfileTab] = useState('target');
  const [targetProfile, setTargetProfile] = useState(profile?.target || emptyTargetProfile);
  const [pokemonProfile, setPokemonProfile] = useState(profile?.pokemon || emptyPokemonProfile);
  const [headless, setHeadless] = useState(profile?.headless || false);
  const [productUrls, setProductUrls] = useState([{ name: '', url: '', platform: 'target' }]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [saveMessage, setSaveMessage] = useState('');
  const isInitialLoad = useRef(true);
  const saveTimeoutRef = useRef(null);

  // Load saved products on mount
  useEffect(() => {
    async function loadSavedProducts() {
      try {
        if (window.electronAPI && mode === 'run') {
          const result = await window.electronAPI.loadProducts();
          if (result.success && result.products && result.products.length > 0) {
            setProductUrls(result.products);
            console.log('✅ Loaded saved products:', result.products.length);
          }
        }
      } catch (error) {
        console.error('Error loading saved products:', error);
      } finally {
        setIsLoadingProducts(false);
        // Reset the initial load flag after a short delay
        setTimeout(() => {
          isInitialLoad.current = false;
        }, 500);
      }
    }
    loadSavedProducts();
  }, [mode]);

  useEffect(() => {
    if (profile) {
      if (profile.target) setTargetProfile(profile.target);
      if (profile.pokemon) setPokemonProfile(profile.pokemon);
      if (profile.headless !== undefined) setHeadless(profile.headless);
    }
  }, [profile]);

  // Auto-save products whenever they change
  useEffect(() => {
    // Don't save during initial load
    if (mode === 'run' && !isLoadingProducts && !isInitialLoad.current && window.electronAPI) {
      // Clear previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce the save operation
      saveTimeoutRef.current = setTimeout(async () => {
        const validProducts = productUrls.filter(p => p.url.trim() || p.name.trim());
        if (validProducts.length > 0) {
          try {
            await window.electronAPI.saveProducts(validProducts);
            setSaveMessage('Products saved ✓');
            setTimeout(() => setSaveMessage(''), 2000);
          } catch (error) {
            console.error('Error saving products:', error);
          }
        } else {
          // Clear storage if no valid products
          try {
            await window.electronAPI.clearProducts();
          } catch (error) {
            console.error('Error clearing products:', error);
          }
        }
      }, 1000); // Debounce for 1 second
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [productUrls, mode, isLoadingProducts]);

  const handleTargetChange = (e) => {
    const { name, value } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setTargetProfile(prev => ({ ...prev, [parent]: { ...prev[parent], [child]: value } }));
    } else {
      setTargetProfile(prev => ({ ...prev, [name]: value }));
    }
  };

  const handlePokemonChange = (e) => {
    const { name, value } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setPokemonProfile(prev => ({ ...prev, [parent]: { ...prev[parent], [child]: value } }));
    } else {
      setPokemonProfile(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleProductChange = (index, field, value) => {
    setProductUrls(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const addProductRow = () => setProductUrls(prev => [...prev, { name: '', url: '', platform: 'target' }]);

  const removeProductRow = (index) => {
    setProductUrls(prev => {
      const updated = prev.filter((_, i) => i !== index);
      // If removing the last row, replace with empty row
      if (updated.length === 0) {
        return [{ name: '', url: '', platform: 'target' }];
      }
      return updated;
    });
  };

  const handleClearAllProducts = async () => {
    setProductUrls([{ name: '', url: '', platform: 'target' }]);
    if (window.electronAPI) {
      try {
        await window.electronAPI.clearProducts();
        setSaveMessage('All products cleared ✓');
        setTimeout(() => setSaveMessage(''), 2000);
      } catch (error) {
        console.error('Error clearing products:', error);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'profile') {
      // Save complete profile with both platform profiles
      onSave({
        target: targetProfile,
        pokemon: pokemonProfile,
        headless,
      });
    } else {
      const validProducts = productUrls
        .filter(p => p.url.trim())
        .map(p => ({ url: p.url.trim(), name: p.name.trim() || p.url.trim(), platform: p.platform }));
      if (validProducts.length === 0) return;
      
      // Pass the complete profile to main process
      onStart(validProducts, {
        target: targetProfile,
        pokemon: pokemonProfile,
        headless,
      });
    }
  };

  const copyFromTarget = () => {
    setPokemonProfile({
      email: targetProfile.email,
      password: targetProfile.password,
      shipping: {
        givenName: targetProfile.shipping.firstName,
        familyName: targetProfile.shipping.lastName,
        streetAddress: targetProfile.shipping.address1,
        extendedAddress: '',
        postalCode: targetProfile.shipping.zip,
        phoneNumber: targetProfile.shipping.phone,
      },
      card: {
        number: targetProfile.card.number,
        cvv: targetProfile.card.cvv,
        expMonth: targetProfile.card.expMonth,
        expYear: targetProfile.card.expYear,
        nameOnCard: targetProfile.card.nameOnCard,
      },
    });
  };

  const copyFromPokemon = () => {
    setTargetProfile({
      email: pokemonProfile.email,
      password: pokemonProfile.password,
      shipping: {
        firstName: pokemonProfile.shipping.givenName,
        lastName: pokemonProfile.shipping.familyName,
        address1: pokemonProfile.shipping.streetAddress,
        zip: pokemonProfile.shipping.postalCode,
        city: '',
        state: '',
        phone: pokemonProfile.shipping.phoneNumber,
      },
      card: {
        number: pokemonProfile.card.number,
        cvv: pokemonProfile.card.cvv,
        expMonth: pokemonProfile.card.expMonth,
        expYear: pokemonProfile.card.expYear,
        nameOnCard: pokemonProfile.card.nameOnCard,
      },
    });
  };

  return (
    <div className="scraper-form">
      <div className="form-header">
        <h1>{mode === 'profile' ? 'Profile & Card Details' : 'Run Scraper'}</h1>
        <p className="form-sub">
          {mode === 'profile'
            ? 'Configure platform-specific profiles. Pokemon Center has different field names than Target.'
            : 'Add one or more products. Each is monitored independently — checkout fires automatically the moment one comes in stock.'}
        </p>
        {mode === 'run' && saveMessage && (
          <div style={{
            marginTop: 8,
            padding: '4px 12px',
            background: '#ecfdf5',
            color: '#065f46',
            borderRadius: 6,
            fontSize: 13,
            display: 'inline-block',
          }}>
            {saveMessage}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="form-body">
        {mode === 'run' && (
          <div className="card-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h3 style={{ margin: 0 }}>
                Products to Monitor
                {!isLoadingProducts && productUrls.filter(p => p.url.trim()).length > 0 && (
                  <span style={{ fontSize: 14, color: '#6b7280', marginLeft: 8, fontWeight: 400 }}>
                    ({productUrls.filter(p => p.url.trim()).length} product{productUrls.filter(p => p.url.trim()).length !== 1 ? 's' : ''})
                  </span>
                )}
              </h3>
              {productUrls.filter(p => p.url.trim() || p.name.trim()).length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllProducts}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    background: '#f9fafb',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="Clear all saved products"
                >
                  🗑️ Clear All
                </button>
              )}
            </div>

            {isLoadingProducts ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>
                Loading saved products...
              </div>
            ) : (
              <>
                {productUrls.map((p, index) => {
                  const status = productStatuses[p.url]?.status;
                  const platform = productStatuses[p.url]?.platform || p.platform;
                  const isBuying = status === 'buying';
                  const isMonitoring = status === 'monitoring';
                  
                  return (
                    <div 
                      key={index} 
                      className="form-row" 
                      style={{ 
                        marginBottom: 10, 
                        alignItems: 'flex-end', 
                        flexWrap: 'wrap', 
                        gap: 8,
                        padding: '12px',
                        background: isMonitoring ? '#f0f9ff' : isBuying ? '#fef3c7' : 'transparent',
                        borderRadius: 8,
                        border: isMonitoring ? '1px solid #bae6fd' : isBuying ? '1px solid #fde68a' : '1px solid transparent',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
                        <label>Platform</label>
                        <select
                          value={p.platform}
                          onChange={(e) => handleProductChange(index, 'platform', e.target.value)}
                          style={{ 
                            padding: '8px 12px', 
                            borderRadius: 6, 
                            border: '1px solid #d1d5db', 
                            width: '100%',
                            
                          }}
                          disabled={isMonitoring || isBuying}
                        >
                          {PLATFORMS.map(plat => (
                            <option key={plat.value} value={plat.value}>{plat.label}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 150 }}>
                        <label>Name (optional)</label>
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => handleProductChange(index, 'name', e.target.value)}
                          placeholder="Elite Trainer Box"
                          disabled={isMonitoring || isBuying}
                        />
                      </div>
                      
                      <div className="form-group" style={{ marginBottom: 0, flex: 2, minWidth: 250 }}>
                        <label>
                          Product URL 
                          {status && (
                            <span style={{ 
                              marginLeft: 8, 
                              fontSize: 12,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: isMonitoring ? '#dbeafe' : isBuying ? '#fef3c7' : '#f3f4f6',
                              color: isMonitoring ? '#1e40af' : isBuying ? '#92400e' : '#6b7280',
                            }}>
                              {status} [{platform}]
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          value={p.url}
                          onChange={(e) => handleProductChange(index, 'url', e.target.value)}
                          placeholder={p.platform === 'pokemon' ? 'https://www.pokemoncenter.com/product/...' : 'https://www.target.com/p/...'}
                          disabled={isMonitoring || isBuying}
                        />
                      </div>
                      
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        {isBuying && (
                          <button
                            type="button"
                            className="clear-button"
                            onClick={() => onStopCheckout(p.url)}
                            style={{ 
                              whiteSpace: 'nowrap',
                              background: '#fee2e2',
                              color: '#dc2626',
                              border: '1px solid #fecaca',
                            }}
                          >
                            🛑 Stop Checkout
                          </button>
                        )}
                        {!isMonitoring && !isBuying && (
                          <button 
                            type="button" 
                            className="link-button" 
                            onClick={() => removeProductRow(index)}
                            title="Remove product"
                            style={{
                              padding: '4px 8px',
                              fontSize: 18,
                              color: '#ef4444',
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {!isRunning && (
                  <button 
                    type="button" 
                    className="link-button" 
                    onClick={addProductRow}
                    style={{
                      marginTop: 8,
                      padding: '8px 16px',
                      background: '#f0f9ff',
                      border: '1px dashed #93c5fd',
                      borderRadius: 8,
                      color: '#2563eb',
                      fontWeight: 500,
                    }}
                  >
                    + Add another product
                  </button>
                )}

                {(!targetProfile.email && !pokemonProfile.email) && (
                  <div className="warn-banner" style={{ marginTop: 16 }}>
                    ⚠️ No profile saved for any platform — set up your details in Profile & Card first.
                  </div>
                )}
                {targetProfile.email && !pokemonProfile.email && (
                  <div className="warn-banner" style={{ background: '#fff3cd', border: '1px solid #ffc107', marginTop: 16 }}>
                    ⚡ Pokémon Center profile not configured. Click <strong>"Copy from Target"</strong> in the profile tab to quickly set it up.
                  </div>
                )}
                {!targetProfile.email && pokemonProfile.email && (
                  <div className="warn-banner" style={{ background: '#fff3cd', border: '1px solid #ffc107', marginTop: 16 }}>
                    🎯 Target profile not configured. Click <strong>"Copy from Pokémon"</strong> in the profile tab to quickly set it up.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {mode === 'profile' && (
          <>
            <div className="platform-tabs" style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e5e7eb' }}>
              {PLATFORMS.map(plat => (
                <button
                  key={plat.value}
                  type="button"
                  onClick={() => setActiveProfileTab(plat.value)}
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    background: 'none',
                    borderBottom: activeProfileTab === plat.value ? `3px solid ${plat.color}` : '3px solid transparent',
                    color: activeProfileTab === plat.value ? plat.color : '#6b7280',
                    fontWeight: activeProfileTab === plat.value ? 600 : 400,
                    cursor: 'pointer',
                    fontSize: 15,
                    transition: 'all 0.2s',
                  }}
                >
                  {plat.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              {activeProfileTab === 'pokemon' && targetProfile.email && (
                <button
                  type="button"
                  onClick={copyFromTarget}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    background: '#f9fafb',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#4b5563',
                    marginRight: 8,
                  }}
                  title="Copy Target profile data to Pokémon Center fields"
                >
                  📋 Copy from Target
                </button>
              )}
              {activeProfileTab === 'target' && pokemonProfile.email && (
                <button
                  type="button"
                  onClick={copyFromPokemon}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    background: '#f9fafb',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#4b5563',
                  }}
                  title="Copy Pokémon Center profile data to Target fields"
                >
                  📋 Copy from Pokémon
                </button>
              )}
            </div>

            {/* Target Profile */}
            {activeProfileTab === 'target' && (
              <>
                <div className="card-block">
                  <h3>🎯 Target Account</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" name="email" value={targetProfile.email} onChange={handleTargetChange} placeholder="you@example.com" />
                    </div>
                    <div className="form-group">
                      <label>Password</label>
                      <input type="password" name="password" value={targetProfile.password} onChange={handleTargetChange} placeholder="••••••••" />
                    </div>
                  </div>
                </div>

                <div className="card-block">
                  <h3>Shipping Address</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label>First Name *</label>
                      <input type="text" name="shipping.firstName" value={targetProfile.shipping.firstName} onChange={handleTargetChange} required />
                    </div>
                    <div className="form-group">
                      <label>Last Name *</label>
                      <input type="text" name="shipping.lastName" value={targetProfile.shipping.lastName} onChange={handleTargetChange} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Address *</label>
                    <input type="text" name="shipping.address1" value={targetProfile.shipping.address1} onChange={handleTargetChange} required />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>City *</label>
                      <input type="text" name="shipping.city" value={targetProfile.shipping.city} onChange={handleTargetChange} required />
                    </div>
                    <div className="form-group">
                      <label>State *</label>
                      <select name="shipping.state" value={targetProfile.shipping.state} onChange={handleTargetChange} required>
                        <option value="">Select</option>
                        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>ZIP *</label>
                      <input type="text" name="shipping.zip" value={targetProfile.shipping.zip} onChange={handleTargetChange} required />
                    </div>
                    <div className="form-group">
                      <label>Phone *</label>
                      <input type="tel" name="shipping.phone" value={targetProfile.shipping.phone} onChange={handleTargetChange} required />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Pokemon Center Profile */}
            {activeProfileTab === 'pokemon' && (
              <>
                <div className="card-block">
                  <h3>⚡ Pokémon Center Account</h3>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" name="email" value={pokemonProfile.email} onChange={handlePokemonChange} placeholder="you@example.com" />
                    </div>
                    <div className="form-group">
                      <label>Password</label>
                      <input type="password" name="password" value={pokemonProfile.password} onChange={handlePokemonChange} placeholder="••••••••" />
                    </div>
                  </div>
                </div>

                <div className="card-block">
                  <h3>Shipping Address</h3>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                    Pokémon Center auto-populates City/State from the postal code.
                  </p>
                  <div className="form-row">
                    <div className="form-group">
                      <label>First Name (Given Name) *</label>
                      <input type="text" name="shipping.givenName" value={pokemonProfile.shipping.givenName} onChange={handlePokemonChange} required />
                    </div>
                    <div className="form-group">
                      <label>Last Name (Family Name) *</label>
                      <input type="text" name="shipping.familyName" value={pokemonProfile.shipping.familyName} onChange={handlePokemonChange} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Street Address *</label>
                    <input type="text" name="shipping.streetAddress" value={pokemonProfile.shipping.streetAddress} onChange={handlePokemonChange} required />
                  </div>
                  <div className="form-group">
                    <label>Extended Address (Apt, Suite, etc.)</label>
                    <input type="text" name="shipping.extendedAddress" value={pokemonProfile.shipping.extendedAddress} onChange={handlePokemonChange} placeholder="Optional" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Postal Code *</label>
                      <input type="text" name="shipping.postalCode" value={pokemonProfile.shipping.postalCode} onChange={handlePokemonChange} required />
                    </div>
                    <div className="form-group">
                      <label>Phone Number *</label>
                      <input type="tel" name="shipping.phoneNumber" value={pokemonProfile.shipping.phoneNumber} onChange={handlePokemonChange} required />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Common Payment Section */}
            <div className="card-block">
              <h3>💳 Payment ({activeProfileTab === 'target' ? 'Target' : 'Pokémon Center'})</h3>
              <div className="form-group">
                <label>Card Number *</label>
                <input 
                  type="text" 
                  name="card.number" 
                  value={activeProfileTab === 'target' ? targetProfile.card.number : pokemonProfile.card.number} 
                  onChange={activeProfileTab === 'target' ? handleTargetChange : handlePokemonChange} 
                  maxLength="16" 
                  placeholder="•••• •••• •••• ••••" 
                />
              </div>
              <div className="form-row three">
                <div className="form-group">
                  <label>Exp Month *</label>
                  <select 
                    name="card.expMonth" 
                    value={activeProfileTab === 'target' ? targetProfile.card.expMonth : pokemonProfile.card.expMonth} 
                    onChange={activeProfileTab === 'target' ? handleTargetChange : handlePokemonChange}
                    style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', width: '100%' }}
                  >
                    <option value="">MM</option>
                    {CARD_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Exp Year *</label>
                  <select 
                    name="card.expYear" 
                    value={activeProfileTab === 'target' ? targetProfile.card.expYear : pokemonProfile.card.expYear} 
                    onChange={activeProfileTab === 'target' ? handleTargetChange : handlePokemonChange}
                    style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', width: '100%' }}
                  >
                    <option value="">YY</option>
                    {CARD_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>CVV *</label>
                  <input 
                    type="text" 
                    name="card.cvv" 
                    value={activeProfileTab === 'target' ? targetProfile.card.cvv : pokemonProfile.card.cvv} 
                    onChange={activeProfileTab === 'target' ? handleTargetChange : handlePokemonChange} 
                    maxLength="4" 
                    placeholder="•••" 
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Name on Card *</label>
                <input 
                  type="text" 
                  name="card.nameOnCard" 
                  value={activeProfileTab === 'target' ? targetProfile.card.nameOnCard : pokemonProfile.card.nameOnCard} 
                  onChange={activeProfileTab === 'target' ? handleTargetChange : handlePokemonChange} 
                />
              </div>
            </div>

            {/* Headless Mode Toggle */}
            <div className="card-block">
              <h3>Browser Settings</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={headless} 
                  onChange={(e) => setHeadless(e.target.checked)} 
                  style={{ width: 18, height: 18 }}
                />
                <span>Headless Mode (no visible browser window)</span>
              </label>
            </div>
          </>
        )}

        {mode === 'run' ? (
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button 
              type="submit" 
              className="submit-button" 
              disabled={isRunning || productUrls.filter(p => p.url.trim()).length === 0}
              style={{
                opacity: isRunning || productUrls.filter(p => p.url.trim()).length === 0 ? 0.6 : 1,
                cursor: isRunning || productUrls.filter(p => p.url.trim()).length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {isRunning ? '⏳ Monitoring...' : '🚀 Start Monitoring'}
            </button>
            {isRunning && (
              <button type="button" className="clear-button" onClick={onStop}>
                🛑 Stop All
              </button>
            )}
          </div>
        ) : (
          <button type="submit" className="submit-button" style={{ marginTop: 20 }}>
            💾 Save All Profiles
          </button>
        )}
      </form>
    </div>
  );
}

export default ScraperForm;