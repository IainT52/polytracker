import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Trade {
  id: number;
  action: string;
  shares: number | string;
  price: number | string;
  timestamp: string;
  marketId: string;
  question: string;
  icon: string;
}

interface WalletDetailsModalProps {
  address: string;
  onClose: () => void;
  onMarketClick: (marketId: string) => void;
}

export const WalletDetailsModal: React.FC<WalletDetailsModalProps> = ({ address, onClose, onMarketClick }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`http://localhost:3001/api/wallets/${address}`)
      .then(res => res.json())
      .then(d => {
        setData(d);
      })
      .catch(err => {
        console.error(err);
        setData({ error: "Failed to load wallet (Server Offline)" });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [address]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-end z-50 backdrop-blur-sm transition-all" onClick={onClose}>
      <div 
        className="w-full max-w-md h-full bg-gray-900 border-l border-gray-800 shadow-2xl p-6 overflow-y-auto transform transition-transform"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">✕</button>
        
        {loading ? (
          <div className="flex items-center justify-center h-full text-indigo-400 animate-pulse">Scanning On-Chain Data...</div>
        ) : data && data.metadata ? (
          <div className="space-y-6">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <div className={`text-xl font-bold px-3 py-1 rounded bg-opacity-20 ${data.metadata.grade === 'A' ? 'bg-green-500 text-green-400' : 'bg-blue-500 text-blue-400'}`}>
                  Grade {data.metadata.grade}
                </div>
                <h2 className="text-xl font-mono text-gray-200 truncate">{address.substring(0,6)}...{address.substring(38)}</h2>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Realized PnL</p>
                <p className={`text-xl font-bold ${data.metadata.realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${data.metadata.realizedPnL?.toLocaleString() || '0'}
                </p>
              </div>
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Total Volume</p>
                <p className="text-xl font-bold text-gray-200">
                  ${data.metadata.totalVolume?.toLocaleString() || '0'}
                </p>
              </div>
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Total Trades</p>
                <p className="text-xl font-bold text-gray-200">{data.metadata.totalTrades || 0}</p>
              </div>
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Lifetime ROI</p>
                <p className={`text-xl font-bold ${data.metadata.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.metadata.roi?.toFixed(2) || '0'}%
                </p>
              </div>
            </div>

              {/* Phase 22: Performance Chart */}
              <div className="mt-6 border-t border-gray-800 pt-6">
                <h3 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
                  Net Cash Flow
                </h3>
                {data.performanceChart && data.performanceChart.length > 0 ? (
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.performanceChart}>
                        <defs>
                          <linearGradient id="colorCashFlow" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="displayDate" hide />
                        <YAxis
                          tickFormatter={(val) => `$${val > 1000 ? (val / 1000).toFixed(1) + 'k' : val}`}
                          stroke="#4b5563"
                          fontSize={10}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '0.5rem', color: '#e5e7eb' }}
                          itemStyle={{ color: '#818cf8', fontWeight: 'bold' }}
                          formatter={(value: any) => [`$${value.toLocaleString()}`, 'Cash Flow']}
                        />
                        <Area type="monotone" dataKey="cashFlow" stroke="#818cf8" fillOpacity={1} fill="url(#colorCashFlow)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-48 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-600 text-sm">
                    Not enough historical data
                  </div>
                )}
              </div>

            <div className="mt-8 border-t border-gray-800 pt-6">
              <h3 className="text-lg font-semibold text-gray-300 mb-4">50 Most Recent Trades</h3>
              <div className="space-y-3">
                {data.recentTrades && data.recentTrades.length > 0 ? (
                  data.recentTrades.map((t: Trade) => (
                    <div 
                      key={t.id} 
                      className="bg-gray-800 rounded p-3 text-sm border border-transparent hover:border-indigo-500/50 cursor-pointer transition-colors"
                      onClick={() => onMarketClick(t.marketId)}
                    >
                      <div className="flex items-center space-x-2 mb-2">
                        {t.icon && <img src={t.icon} alt="" className="w-5 h-5 rounded-full" />}
                        <p className="text-gray-300 font-medium truncate flex-1">{t.question || 'Unknown Market'}</p>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className={`px-2 py-0.5 rounded font-bold ${t.action === 'BUY' ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                          {t.action}
                        </span>
                        <span className="text-gray-400">
                          {Number(t.shares).toFixed(0)} shares @ ${(Number(t.price)).toFixed(3)}
                        </span>
                        <span className="text-gray-500">
                          {new Date(t.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-sm">No recent trades found.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-red-400">Failed to load wallet data.</div>
        )}
      </div>
    </div>
  );
};
