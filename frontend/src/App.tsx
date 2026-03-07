import React, { useEffect, useState, useMemo } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { SyndicateGraph } from './components/SyndicateGraph';
import { WalletDetailsModal } from './components/WalletDetailsModal';
import { MarketDetailsModal } from './components/MarketDetailsModal';

interface TradeConfig {
  isAutoTradeEnabled: boolean;
  isPaperTradingMode: boolean;
  maxSpreadBps: number;
  maxSlippageCents: number;
  minOrderbookLiquidityUsd: string;
  fixedBetSizeUsd: string;
  minWhalesToTrigger: number;
  dynamicSizingEnabled: boolean;
  convictionMultiplier: number;
  updatedAt: string;
}

interface Position {
  id: number;
  question: string;
  buyPrice: string;
  shares: string;
  totalCost: string;
  timestamp: string;
  status: string;
  isPaper: boolean;
  realizedPnL?: string;
}

const API_URL = 'http://localhost:3001/api';

function App() {
  const [telegramId, setTelegramId] = useState<string>(localStorage.getItem('telegramId') || '');
  const [config, setConfig] = useState<TradeConfig | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [backtestData, setBacktestData] = useState<any[]>([]);
  const [topWallets, setTopWallets] = useState<any[]>([]);
  const [signalStats, setSignalStats] = useState<any>(null);
  const [ingestionStats, setIngestionStats] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [backtestSuccess, setBacktestSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'performance' | 'explorer' | 'syndicates'>('config');
  const [syndicateView, setSyndicateView] = useState<'graph' | 'table'>('graph');
  const [syndicates, setSyndicates] = useState<any[]>([]);

  // Phase 17: Interactive UI State
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);

  useEffect(() => {
    if (!telegramId) return;

    setError(null);
    fetch(`${API_URL}/config/${telegramId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setConfig(data);
      })
      .catch(err => setError(err.message));

    fetch(`${API_URL}/positions/${telegramId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setPositions(data);
      })
      .catch(console.error);

    fetch(`${API_URL}/stats/wallets`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setTopWallets(data);
      })
      .catch(console.error);

    fetch(`${API_URL}/stats/signals`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setSignalStats(data);
      })
      .catch(console.error);

    // Polling hook for Ingestion Stats
    const fetchIngestion = () => {
      fetch(`${API_URL}/stats/ingestion`)
        .then(res => res.json())
        .then(data => {
          if (!data?.error) setIngestionStats(data);
        })
        .catch(console.error);
    };

    const fetchSyndicates = () => {
      fetch(`${API_URL}/stats/syndicates`)
        .then(res => res.json())
        .then(data => {
          if (!data?.error) setSyndicates(data);
        })
        .catch(console.error);
    };

    fetchIngestion(); // initial fetch
    fetchSyndicates();
    const interval = setInterval(() => {
      fetchIngestion();
      fetchSyndicates();
    }, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [telegramId]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/config/${telegramId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const updated = await res.json();
      if (!updated.error) {
        setConfig(updated);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };
  const runBacktest = async () => {
    if (!telegramId) return;
    setRunningBacktest(true);
    try {
      const res = await fetch(`${API_URL}/backtest/${telegramId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.error) {
        // Calculate cumulative PnL for chart
        let cumulative = 0;
        const chartData = data.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).map((p: any) => {
          cumulative += parseFloat(p.realizedPnL || '0');
          return { ...p, cumulativePnL: cumulative, displayDate: new Date(p.timestamp).toLocaleDateString() };
        });
        setBacktestData(chartData);
        setBacktestSuccess(true);
        setTimeout(() => setBacktestSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRunningBacktest(false);
    }
  };
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const id = (e.target as any).telegramId.value;
    localStorage.setItem('telegramId', id);
    setTelegramId(id);
  };

  const handleLogout = () => {
    localStorage.removeItem('telegramId');
    setTelegramId('');
    setConfig(null);
    setPositions([]);
  };

  if (!telegramId || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100 p-4 font-sans selection:bg-blue-500/30">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl max-w-md w-full space-y-6 text-center">
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent mb-2">PolyTracker</h1>
          <p className="text-gray-400 text-sm">Please enter your Telegram ID to access your dashboard.</p>
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm text-left">
              {error === 'User not found' ? 'User not found. Have you messaged the PolyTracker bot with /start yet?' : error}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <input required name="telegramId" placeholder="e.g. 123456789" className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-center text-gray-100 placeholder-gray-600" />
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-xl transition-colors">Open Dashboard</button>
          </form>
          {error && (
            <button type="button" onClick={() => setError(null)} className="text-xs text-gray-500 hover:text-gray-400 underline mt-4">Try again</button>
          )}
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-800 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              PolyTracker
            </h1>
            <p className="text-gray-400 mt-1 text-sm">Automated Trading Dashboard</p>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-3">
            <div className="flex items-center space-x-3 bg-gray-900 px-4 py-2 rounded-xl border border-gray-800">
              <span className="relative flex h-3 w-3">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.isAutoTradeEnabled ? 'bg-green-400' : 'bg-red-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-3 w-3 ${config.isAutoTradeEnabled ? 'bg-green-500' : 'bg-red-500'}`}></span>
              </span>
              <span className="text-sm font-medium tracking-wide">
                {config.isAutoTradeEnabled ? 'AUTO-TRADING ACTIVE' : 'AUTO-TRADING PAUSED'}
              </span>
            </div>
            <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white transition-colors bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-xl">Logout</button>
          </div>
        </header>

        {/* Tabs Navigation */}
        <div className="flex border-b border-gray-800 space-x-8">
          <button onClick={() => setActiveTab('config')} className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'config' ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>
            Auto-Trader Config
            {activeTab === 'config' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500 rounded-t-full"></span>}
          </button>
          <button onClick={() => setActiveTab('performance')} className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'performance' ? 'text-indigo-400' : 'text-gray-400 hover:text-gray-200'}`}>
            Simulation & Performance
            {activeTab === 'performance' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-indigo-500 rounded-t-full"></span>}
          </button>
          <button onClick={() => setActiveTab('explorer')} className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'explorer' ? 'text-purple-400' : 'text-gray-400 hover:text-gray-200'}`}>
            Data Explorer
            {activeTab === 'explorer' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-500 rounded-t-full"></span>}
          </button>
          <button onClick={() => setActiveTab('syndicates')} className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'syndicates' ? 'text-pink-400' : 'text-gray-400 hover:text-gray-200'}`}>
            Syndicates
            {activeTab === 'syndicates' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-pink-500 rounded-t-full"></span>}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'config' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-500">
            {/* Configuration Panel */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500"></div>
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  Safety Parameters
                </h2>

                <form onSubmit={handleSaveConfig} className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-gray-950/50 rounded-xl border border-gray-800/80">
                    <span className="font-semibold text-gray-200">Enable Auto-Trade</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={config.isAutoTradeEnabled} onChange={e => setConfig({ ...config, isAutoTradeEnabled: e.target.checked })} />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-purple-900/20 rounded-xl border border-purple-500/30">
                    <div>
                      <span className="font-semibold text-purple-300 block">Live Paper Trading</span>
                      <span className="text-xs text-purple-400/80">Simulate execution</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={config.isPaperTradingMode} onChange={e => setConfig({ ...config, isPaperTradingMode: e.target.checked })} />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Base Bet Size (USDC)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input type="number" required min="1" step="0.5" className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-8 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-gray-100" value={config.fixedBetSizeUsd} onChange={e => setConfig({ ...config, fixedBetSizeUsd: e.target.value })} />
                    </div>
                  </div>

                  <div className="p-4 bg-blue-900/10 rounded-xl border border-blue-500/20 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-blue-200 block">Dynamic Conviction Sizing</span>
                        <span className="text-xs text-blue-400/80">Scale bets based on Net Conviction</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={config.dynamicSizingEnabled} onChange={e => setConfig({ ...config, dynamicSizingEnabled: e.target.checked })} />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Min Whales To Trigger</label>
                      <input type="number" required min="1" step="1" className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-gray-100" value={config.minWhalesToTrigger} onChange={e => setConfig({ ...config, minWhalesToTrigger: Number(e.target.value) })} />
                    </div>

                    {config.dynamicSizingEnabled && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Conviction Multiplier</label>
                        <div className="relative">
                          <input type="number" required min="0" step="0.1" className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-gray-100" value={config.convictionMultiplier} onChange={e => setConfig({ ...config, convictionMultiplier: Number(e.target.value) })} />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">x</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Max Spread (BPS)</label>
                    <div className="relative">
                      <input type="number" required min="10" step="10" className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-gray-100" value={config.maxSpreadBps} onChange={e => setConfig({ ...config, maxSpreadBps: Number(e.target.value) })} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{(config.maxSpreadBps / 100).toFixed(2)}%</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Max Slippage (Cents)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">¢</span>
                      <input type="number" required min="1" step="1" className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-8 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-gray-100" value={config.maxSlippageCents} onChange={e => setConfig({ ...config, maxSlippageCents: Number(e.target.value) })} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Min L2 Liquidity Limit</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input type="number" required min="10" step="10" className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-8 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-gray-100" value={config.minOrderbookLiquidityUsd} onChange={e => setConfig({ ...config, minOrderbookLiquidityUsd: e.target.value })} />
                    </div>
                  </div>

                  <button type="submit" disabled={saving || saveSuccess} className={`w-full text-white font-medium py-3 px-4 rounded-xl transition-colors mt-4 flex justify-center items-center gap-2 group disabled:opacity-70 ${saveSuccess ? 'bg-green-500 hover:bg-green-600' : 'bg-blue-600 hover:bg-blue-500'}`}>
                    {saving ? 'Saving...' : saveSuccess ? '✓ Saved Successfully' : 'Save Configuration'}
                  </button>
                  <div className="text-center text-xs text-gray-500 mt-2">Last updated: {new Date(config.updatedAt).toLocaleTimeString()}</div>
                </form>
              </div>
            </div>

            {/* Positions Panel */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                  Recent Automated Trades
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400">
                        <th className="pb-3 font-medium uppercase tracking-wider text-xs">Market</th>
                        <th className="pb-3 font-medium uppercase tracking-wider text-xs">Avg Price</th>
                        <th className="pb-3 font-medium uppercase tracking-wider text-xs">Shares</th>
                        <th className="pb-3 font-medium uppercase tracking-wider text-xs">Cost</th>
                        <th className="pb-3 font-medium uppercase tracking-wider text-xs">Status</th>
                        <th className="pb-3 font-medium uppercase tracking-wider text-xs text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {positions.length === 0 ? (
                        <tr><td colSpan={6} className="py-8 text-center text-gray-500 italic">No recent trades found.</td></tr>
                      ) : (
                        positions.map(pos => (
                          <tr key={`${pos.isPaper ? 'p' : 'r'}-${pos.id}`} className="hover:bg-gray-800/30 transition-colors">
                            <td className="py-4 text-gray-200">
                              <div className="max-w-[200px] md:max-w-xs truncate" title={pos.question}>{pos.question || `Market #${pos.id}`}</div>
                            </td>
                            <td className="py-4">${Number(pos.buyPrice).toFixed(3)}</td>
                            <td className="py-4">{Number(pos.shares).toFixed(2)}</td>
                            <td className="py-4 text-indigo-300 font-medium">${Number(pos.totalCost).toFixed(2)}</td>
                            <td className="py-4">
                              {pos.isPaper ? (
                                <span className="bg-purple-500/10 text-purple-400 px-2.5 py-1 rounded-md text-xs font-medium border border-purple-500/20">PAPER_TRADE</span>
                              ) : (
                                <span className="bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-md text-xs font-medium border border-blue-500/20">LIVE_TRADE</span>
                              )}
                            </td>
                            <td className="py-4 text-right text-gray-500 text-xs text-right">{new Date(pos.timestamp).toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Performance Tab */}
        {activeTab === 'performance' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2 text-indigo-300">Historical Backtesting Engine</h2>
                  <p className="text-sm text-gray-400 mt-1">Simulate historical alpha signals against your current safety parameters.</p>
                </div>
                <button onClick={runBacktest} disabled={runningBacktest || backtestSuccess} className={`text-white font-medium py-2 px-6 rounded-xl transition-colors disabled:opacity-50 ${backtestSuccess ? 'bg-green-500 hover:bg-green-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
                  {runningBacktest ? 'Running Simulation...' : backtestSuccess ? '✓ Simulation Complete' : 'Run 30-Day Backtest'}
                </button>
              </div>

              {backtestData.length > 0 ? (
                <div className="h-[400px] mt-8">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={backtestData}>
                      <defs>
                        <linearGradient id="colorPnL" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                      <XAxis dataKey="displayDate" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                      <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} tickFormatter={(val) => `$${val}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem' }}
                        itemStyle={{ color: '#818cf8' }}
                      />
                      <Area type="monotone" dataKey="cumulativePnL" name="Cumulative PnL (USDC)" stroke="#818cf8" fillOpacity={1} fill="url(#colorPnL)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[300px] flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl mt-8">
                  <p className="text-gray-500 text-sm">Click 'Run 30-Day Backtest' to generate performance chart.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Explorer Tab */}
        {activeTab === 'explorer' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {signalStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                  <div className="text-gray-400 text-sm font-medium mb-1">Total Alpha Signals</div>
                  <div className="text-3xl font-bold text-white">{signalStats.totalSignals}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                  <div className="text-gray-400 text-sm font-medium mb-1">Historical Win Rate</div>
                  <div className="text-3xl font-bold text-green-400">{signalStats.winRate}%</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                  <div className="text-gray-400 text-sm font-medium mb-1">Average ROI</div>
                  <div className="text-3xl font-bold text-indigo-400">+{signalStats.avgRoi}%</div>
                </div>
              </div>
            )}

            {/* Ingestion Status Widget */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2 text-blue-300">
                  <svg className="w-5 h-5 text-blue-400 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                  Live Ingestion Status
                </h2>
                <span className="bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full text-xs font-medium border border-blue-500/20">
                  Markets Scraped: {ingestionStats.length} / 100
                </span>
              </div>

              <div className="overflow-x-auto max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="sticky top-0 bg-gray-900 shadow-md">
                    <tr className="border-b border-gray-800 text-gray-400">
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs">Market ID</th>
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs">Question</th>
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs text-right">Trades Ingested</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {ingestionStats.length === 0 ? (
                      <tr><td colSpan={3} className="py-8 text-center text-gray-500 italic">Scraper is offline or initializing...</td></tr>
                    ) : (
                        ingestionStats.map((stat: any, i: number) => (
                          <tr key={stat.marketId} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => setSelectedMarket(stat.marketId)}>
                            <td className="py-3 font-mono text-gray-400 text-sm truncate max-w-[100px]">{stat.marketId.substring(0, 10)}...</td>
                            <td className="py-3 text-gray-200 truncate max-w-[300px]">{stat.question}</td>
                            <td className="py-3 font-bold text-indigo-400">{stat.tradeCount.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-purple-300">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                Top Graded Wallets
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400">
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs">Wallet Address</th>
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs">Grade</th>
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs">ROI</th>
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs">Win Rate</th>
                      <th className="pb-3 font-medium uppercase tracking-wider text-xs text-right">Last Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {topWallets.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-gray-500 italic">No wallets graded yet. Waiting for scraper...</td></tr>
                    ) : (
                        topWallets.map((w: any, i: number) => (
                          <tr key={w.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => setSelectedWallet(w.address)}>
                            <td className="py-3 font-mono text-gray-300">{w.address.substring(0, 6)}...{w.address.substring(38)}</td>
                            <td className="py-3">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${w.grade === 'A' ? 'bg-green-500/20 text-green-400' : w.grade === 'B' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-400'}`}>
                                Grade {w.grade}
                            </span>
                          </td>
                          <td className={`py-3 font-bold ${w.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {w.roi ? w.roi.toFixed(1) : '0'}%
                          </td>
                          <td className="py-3 text-gray-300">
                            {w.recentRoi30d !== null ? `${w.recentRoi30d.toFixed(1)}%` : 'N/A'}
                          </td>
                          <td className="py-3 font-bold text-gray-200">
                            ${(w.realizedPnL || 0).toLocaleString()}
                          </td>
                          <td className="py-3 text-gray-400">
                            ${(w.totalVolume || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Syndicates Tab (Phase 12) */}
        {activeTab === 'syndicates' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-xl font-bold mb-2 flex items-center gap-2 text-pink-300">
                    <svg className="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                    Historical Syndicate Detection
                  </h2>
                  <p className="text-sm text-gray-400">Visualizing wallets that frequently execute grouped trades within tiny time windows.</p>
                </div>

                <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
                  <button
                    onClick={() => setSyndicateView('graph')}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${syndicateView === 'graph' ? 'bg-pink-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Network Graph
                  </button>
                  <button
                    onClick={() => setSyndicateView('table')}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${syndicateView === 'table' ? 'bg-pink-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Leaderboard
                  </button>
                </div>
              </div>

              {/* Phase 12.1 Interactive Syndicate Graph with Redux Dispatch */}
              {syndicateView === 'graph' ? (
                <div className="flex flex-col flex-1 h-[700px]">
                  <SyndicateGraph apiUrl={API_URL} onNodeClick={(address) => setSelectedWallet(address)} />
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar border border-gray-800 rounded-xl bg-gray-950">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="sticky top-0 bg-gray-900 shadow-md">
                      <tr className="border-b border-gray-800 text-gray-400">
                        <th className="py-3 px-4 font-medium uppercase tracking-wider text-xs">Wallet A</th>
                        <th className="py-3 px-4 font-medium uppercase tracking-wider text-xs">Wallet B</th>
                        <th className="py-3 px-4 font-medium uppercase tracking-wider text-xs text-right">Co-Occurrences</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {syndicates.length === 0 ? (
                        <tr><td colSpan={3} className="py-8 text-center text-gray-500 italic">No syndicates detected yet.</td></tr>
                      ) : (
                        syndicates.map((syn, idx) => (
                          <tr key={idx} className="hover:bg-gray-800/30 transition-colors">
                            <td className="py-4 text-gray-500 font-mono text-xs">{syn.walletA.substring(0, 10)}...{syn.walletA.substring(syn.walletA.length - 8)}</td>
                            <td className="py-4 text-gray-500 font-mono text-xs">{syn.walletB.substring(0, 10)}...{syn.walletB.substring(syn.walletB.length - 8)}</td>
                            <td className="py-4 text-right font-medium text-pink-400">{syn.coOccurrenceCount}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Phase 17 Deep Dive Modals */}
      {selectedWallet && (
        <WalletDetailsModal
          address={selectedWallet}
          onClose={() => setSelectedWallet(null)}
          onMarketClick={(mId) => setSelectedMarket(mId)}
        />
      )}
      {selectedMarket && (
        <MarketDetailsModal
          conditionId={selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />
      )}
    </div>
  );
}

export default App;
