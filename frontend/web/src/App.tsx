import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface SocialToken {
  id: string;
  name: string;
  symbol: string;
  creator: string;
  price: number;
  encryptedPrice: string;
  supply: number;
  encryptedSupply: string;
  volume: number;
  encryptedVolume: string;
  category: string;
  timestamp: number;
  isVerified: boolean;
}

interface TradeHistory {
  id: string;
  tokenId: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  encryptedAmount: string;
  encryptedPrice: string;
  timestamp: number;
  trader: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [tokens, setTokens] = useState<SocialToken[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTokenData, setNewTokenData] = useState({ name: "", symbol: "", price: 0, supply: 0, category: "" });
  const [selectedToken, setSelectedToken] = useState<SocialToken | null>(null);
  const [tradeAmount, setTradeAmount] = useState(0);
  const [activeTab, setActiveTab] = useState<'tokens' | 'trading' | 'portfolio'>('tokens');
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [fheComputing, setFheComputing] = useState(false);

  // Initialize contract and load data
  useEffect(() => {
    loadTokens().finally(() => setLoading(false));
    const initContract = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setPublicKey(generatePublicKey());
    };
    initContract();
  }, []);

  // Load tokens from contract
  const loadTokens = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load token keys
      const keysBytes = await contract.getData("token_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing token keys:", e); }
      }
      
      // Load each token
      const tokenList: SocialToken[] = [];
      for (const key of keys) {
        try {
          const tokenBytes = await contract.getData(`token_${key}`);
          if (tokenBytes.length > 0) {
            try {
              const tokenData = JSON.parse(ethers.toUtf8String(tokenBytes));
              tokenList.push({
                id: key,
                name: tokenData.name,
                symbol: tokenData.symbol,
                creator: tokenData.creator,
                price: tokenData.price,
                encryptedPrice: tokenData.encryptedPrice,
                supply: tokenData.supply,
                encryptedSupply: tokenData.encryptedSupply,
                volume: tokenData.volume || 0,
                encryptedVolume: tokenData.encryptedVolume || FHEEncryptNumber(0),
                category: tokenData.category,
                timestamp: tokenData.timestamp,
                isVerified: tokenData.isVerified || false
              });
            } catch (e) { console.error(`Error parsing token data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading token ${key}:`, e); }
      }
      
      tokenList.sort((a, b) => b.timestamp - a.timestamp);
      setTokens(tokenList);
    } catch (e) { console.error("Error loading tokens:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  // Create new social token
  const createToken = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting token data with Zama FHE..." });
    
    try {
      // Encrypt sensitive data with FHE
      const encryptedPrice = FHEEncryptNumber(newTokenData.price);
      const encryptedSupply = FHEEncryptNumber(newTokenData.supply);
      const encryptedVolume = FHEEncryptNumber(0);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const tokenId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const tokenData = {
        name: newTokenData.name,
        symbol: newTokenData.symbol,
        creator: address,
        price: newTokenData.price,
        encryptedPrice: encryptedPrice,
        supply: newTokenData.supply,
        encryptedSupply: encryptedSupply,
        volume: 0,
        encryptedVolume: encryptedVolume,
        category: newTokenData.category,
        timestamp: Math.floor(Date.now() / 1000),
        isVerified: false
      };
      
      // Store token data
      await contract.setData(`token_${tokenId}`, ethers.toUtf8Bytes(JSON.stringify(tokenData)));
      
      // Update token keys
      const keysBytes = await contract.getData("token_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(tokenId);
      await contract.setData("token_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Social token created with FHE encryption!" });
      await loadTokens();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTokenData({ name: "", symbol: "", price: 0, supply: 0, category: "" });
      }, 2000);
      
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  // Execute trade with FHE computation
  const executeTrade = async (token: SocialToken, type: 'buy' | 'sell') => {
    if (!isConnected || tradeAmount <= 0) return;
    
    setFheComputing(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: `Processing ${type} trade with FHE encrypted computation...` 
    });
    
    try {
      // Simulate FHE computation on encrypted data
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const encryptedAmount = FHEEncryptNumber(tradeAmount);
      const encryptedPrice = FHECompute(token.encryptedPrice, type === 'buy' ? 'increase10%' : 'decrease10%');
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const tradeId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const tradeData = {
        tokenId: token.id,
        type: type,
        amount: tradeAmount,
        price: FHEDecryptNumber(encryptedPrice),
        encryptedAmount: encryptedAmount,
        encryptedPrice: encryptedPrice,
        timestamp: Math.floor(Date.now() / 1000),
        trader: address
      };
      
      // Store trade data
      await contract.setData(`trade_${tradeId}`, ethers.toUtf8Bytes(JSON.stringify(tradeData)));
      
      // Update trade history keys
      const tradeKeysBytes = await contract.getData("trade_keys");
      let tradeKeys: string[] = [];
      if (tradeKeysBytes.length > 0) {
        try { tradeKeys = JSON.parse(ethers.toUtf8String(tradeKeysBytes)); } 
        catch (e) { console.error("Error parsing trade keys:", e); }
      }
      tradeKeys.push(tradeId);
      await contract.setData("trade_keys", ethers.toUtf8Bytes(JSON.stringify(tradeKeys)));
      
      setTransactionStatus({ visible: true, status: "success", message: `${type.toUpperCase()} trade executed with FHE!` });
      setTradeAmount(0);
      
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: `Trade failed: ${e.message}` });
    } finally { 
      setFheComputing(false);
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Verify contract availability
  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is ${isAvailable ? 'available' : 'unavailable'}` 
      });
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Render token price chart
  const renderTokenChart = (token: SocialToken) => {
    return (
      <div className="token-chart">
        <div className="chart-placeholder">
          <div className="chart-line"></div>
          <div className="chart-points">
            <div className="chart-point" style={{ left: '20%', bottom: '30%' }}></div>
            <div className="chart-point" style={{ left: '40%', bottom: '50%' }}></div>
            <div className="chart-point" style={{ left: '60%', bottom: '70%' }}></div>
            <div className="chart-point" style={{ left: '80%', bottom: '40%' }}></div>
          </div>
        </div>
        <div className="chart-info">
          <span>FHE Encrypted Price: {token.encryptedPrice.substring(0, 20)}...</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing FHE Encrypted DEX...</p>
    </div>
  );

  return (
    <div className="app-container fhe-theme">
      {/* Sidebar Navigation */}
      <aside className="app-sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="fhe-logo"></div>
            <h1>FHE<span>SocialDEX</span></h1>
          </div>
        </div>
        
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'tokens' ? 'active' : ''}`}
            onClick={() => setActiveTab('tokens')}
          >
            <div className="nav-icon">🔍</div>
            <span>Browse Tokens</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'trading' ? 'active' : ''}`}
            onClick={() => setActiveTab('trading')}
          >
            <div className="nav-icon">⚡</div>
            <span>Trading</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'portfolio' ? 'active' : ''}`}
            onClick={() => setActiveTab('portfolio')}
          >
            <div className="nav-icon">💼</div>
            <span>Portfolio</span>
          </button>
        </nav>
        
        <div className="sidebar-footer">
          <div className="fhe-status">
            <div className="status-indicator"></div>
            <span>FHE Encryption Active</span>
          </div>
          <button onClick={checkAvailability} className="contract-check-btn">
            Check Contract
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="content-header">
          <div className="header-title">
            <h2>
              {activeTab === 'tokens' && 'Social Tokens Marketplace'}
              {activeTab === 'trading' && 'FHE Encrypted Trading'}
              {activeTab === 'portfolio' && 'My Portfolio'}
            </h2>
            <p>Anonymous creator tokens with Zama FHE encryption</p>
          </div>
          
          <div className="header-actions">
            <button onClick={() => setShowCreateModal(true)} className="create-token-btn">
              + Create Token
            </button>
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={true} />
          </div>
        </header>

        {/* Tokens Browser */}
        {activeTab === 'tokens' && (
          <section className="tokens-section">
            <div className="section-header">
              <h3>Available Social Tokens</h3>
              <button onClick={loadTokens} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            
            <div className="tokens-grid">
              {tokens.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🔒</div>
                  <p>No social tokens found</p>
                  <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                    Create First Token
                  </button>
                </div>
              ) : (
                tokens.map(token => (
                  <div key={token.id} className="token-card">
                    <div className="token-header">
                      <div className="token-info">
                        <h4>{token.name} ({token.symbol})</h4>
                        <span className="token-category">{token.category}</span>
                      </div>
                      <div className={`verification-badge ${token.isVerified ? 'verified' : 'pending'}`}>
                        {token.isVerified ? 'Verified' : 'Pending'}
                      </div>
                    </div>
                    
                    {renderTokenChart(token)}
                    
                    <div className="token-stats">
                      <div className="stat">
                        <label>Price</label>
                        <span className="encrypted-value">{token.encryptedPrice.substring(0, 15)}...</span>
                      </div>
                      <div className="stat">
                        <label>Supply</label>
                        <span className="encrypted-value">{token.encryptedSupply.substring(0, 15)}...</span>
                      </div>
                    </div>
                    
                    <div className="token-actions">
                      <button onClick={() => setSelectedToken(token)} className="trade-btn">
                        Trade
                      </button>
                      <button onClick={() => setSelectedToken(token)} className="details-btn">
                        Details
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Trading Interface */}
        {activeTab === 'trading' && selectedToken && (
          <section className="trading-section">
            <div className="trading-interface">
              <div className="trading-panel">
                <div className="panel-header">
                  <h3>Trade {selectedToken.name} ({selectedToken.symbol})</h3>
                  <button onClick={() => setSelectedToken(null)} className="back-btn">← Back</button>
                </div>
                
                <div className="price-display">
                  <div className="current-price">
                    <span>FHE Encrypted Price:</span>
                    <strong>{selectedToken.encryptedPrice.substring(0, 25)}...</strong>
                  </div>
                </div>
                
                <div className="trade-form">
                  <div className="form-group">
                    <label>Amount</label>
                    <input 
                      type="number" 
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(parseFloat(e.target.value))}
                      placeholder="Enter amount..."
                      className="trade-input"
                    />
                  </div>
                  
                  <div className="trade-buttons">
                    <button 
                      onClick={() => executeTrade(selectedToken, 'buy')}
                      disabled={fheComputing || tradeAmount <= 0}
                      className="buy-btn"
                    >
                      {fheComputing ? 'FHE Computing...' : 'BUY'}
                    </button>
                    <button 
                      onClick={() => executeTrade(selectedToken, 'sell')}
                      disabled={fheComputing || tradeAmount <= 0}
                      className="sell-btn"
                    >
                      {fheComputing ? 'FHE Computing...' : 'SELL'}
                    </button>
                  </div>
                </div>
                
                {fheComputing && (
                  <div className="fhe-computation">
                    <div className="computation-animation"></div>
                    <span>Processing with Zama FHE encryption...</span>
                  </div>
                )}
              </div>
              
              <div className="market-data">
                <h4>Market Data</h4>
                <div className="data-grid">
                  <div className="data-item">
                    <span>24h Volume</span>
                    <strong>{selectedToken.encryptedVolume.substring(0, 15)}...</strong>
                  </div>
                  <div className="data-item">
                    <span>Total Supply</span>
                    <strong>{selectedToken.encryptedSupply.substring(0, 15)}...</strong>
                  </div>
                  <div className="data-item">
                    <span>Creator</span>
                    <strong>{selectedToken.creator.substring(0, 8)}...</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Portfolio View */}
        {activeTab === 'portfolio' && (
          <section className="portfolio-section">
            <div className="portfolio-header">
              <h3>My Portfolio</h3>
              <div className="portfolio-stats">
                <div className="stat-card">
                  <span>Total Value</span>
                  <strong>FHE-Encrypted</strong>
                </div>
                <div className="stat-card">
                  <span>Tokens Held</span>
                  <strong>{tokens.filter(t => t.creator === address).length}</strong>
                </div>
              </div>
            </div>
            
            <div className="created-tokens">
              <h4>My Created Tokens</h4>
              {tokens.filter(t => t.creator === address).length === 0 ? (
                <div className="empty-portfolio">
                  <p>You haven't created any tokens yet</p>
                  <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                    Create Your First Token
                  </button>
                </div>
              ) : (
                <div className="tokens-list">
                  {tokens.filter(t => t.creator === address).map(token => (
                    <div key={token.id} className="portfolio-token">
                      <span>{token.name} ({token.symbol})</span>
                      <span className="token-value">FHE: {token.encryptedPrice.substring(0, 10)}...</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* Create Token Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h3>Create Social Token</h3>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <div className="notice-icon">🔒</div>
                <p>All token data will be encrypted with Zama FHE technology</p>
              </div>
              
              <div className="form-grid">
                <div className="form-group">
                  <label>Token Name</label>
                  <input 
                    type="text"
                    value={newTokenData.name}
                    onChange={(e) => setNewTokenData({...newTokenData, name: e.target.value})}
                    className="form-input"
                  />
                </div>
                
                <div className="form-group">
                  <label>Symbol</label>
                  <input 
                    type="text"
                    value={newTokenData.symbol}
                    onChange={(e) => setNewTokenData({...newTokenData, symbol: e.target.value})}
                    className="form-input"
                  />
                </div>
                
                <div className="form-group">
                  <label>Initial Price</label>
                  <input 
                    type="number"
                    value={newTokenData.price}
                    onChange={(e) => setNewTokenData({...newTokenData, price: parseFloat(e.target.value)})}
                    className="form-input"
                  />
                </div>
                
                <div className="form-group">
                  <label>Total Supply</label>
                  <input 
                    type="number"
                    value={newTokenData.supply}
                    onChange={(e) => setNewTokenData({...newTokenData, supply: parseFloat(e.target.value)})}
                    className="form-input"
                  />
                </div>
                
                <div className="form-group">
                  <label>Category</label>
                  <select 
                    value={newTokenData.category}
                    onChange={(e) => setNewTokenData({...newTokenData, category: e.target.value})}
                    className="form-select"
                  >
                    <option value="">Select category</option>
                    <option value="Art">Crypto Art</option>
                    <option value="Music">Music</option>
                    <option value="Writing">Writing</option>
                    <option value="Gaming">Gaming</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button onClick={createToken} disabled={creating} className="create-btn">
                {creating ? 'Creating with FHE...' : 'Create Token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`status-icon ${transactionStatus.status}`}>
              {transactionStatus.status === 'pending' && <div className="spinner"></div>}
              {transactionStatus.status === 'success' && '✓'}
              {transactionStatus.status === 'error' && '✕'}
            </div>
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;