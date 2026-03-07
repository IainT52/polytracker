import React, { useEffect, useState } from 'react';

interface MarketDetailsModalProps {
  conditionId: string;
  onClose: () => void;
}

export const MarketDetailsModal: React.FC<MarketDetailsModalProps> = ({ conditionId, onClose }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`http://localhost:3001/api/markets/${conditionId}`)
      .then(res => res.json())
      .then(d => {
        setData(d);
      })
      .catch(err => {
        console.error(err);
        setData({ error: "Failed to load market (Server Offline)" });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [conditionId]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] backdrop-blur-sm transition-all" onClick={onClose}>
      <div 
        className="w-full max-w-lg bg-gray-900 border border-gray-700 shadow-2xl rounded-2xl p-6 transform transition-transform"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">✕</button>
        
        {loading ? (
          <div className="flex items-center justify-center h-48 text-indigo-400 animate-pulse">Resolving Market...</div>
        ) : data && !data.error ? (
          <div className="space-y-6">
            <div className="flex items-start space-x-4">
              {data.icon ? (
                <img src={data.icon} alt="Market Icon" className="w-16 h-16 rounded-xl shadow-lg border border-gray-700" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gray-800 flex items-center justify-center border border-gray-700 text-gray-500 font-bold">MKT</div>
              )}
              <div className="flex-1">
                 <h2 className="text-xl font-bold text-white leading-tight">{data.question}</h2>
                 <p className="text-sm text-gray-400 mt-2 line-clamp-2">{data.description || 'No description provided.'}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700">
                <p className="text-xs text-gray-400 tracking-wider">Polymarket Volume</p>
                <p className="text-2xl font-bold text-indigo-400 mt-1">
                  ${(data.volume || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700">
                <p className="text-xs text-gray-400 tracking-wider">Resolution Date</p>
                <p className="text-xl font-medium text-gray-200 mt-1">
                  {data.endDate ? new Date(data.endDate).toLocaleDateString() : 'TBD'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 pt-4 border-t border-gray-800">
              <a 
                  href={data.slug ? `https://polymarket.com/event/${data.slug}` : `https://polymarket.com/markets?search=${encodeURIComponent(data.question)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-center transition-colors shadow-lg shadow-indigo-900/20"
              >
                View on Polymarket
              </a>
              <div className="px-4 py-3 rounded-xl bg-gray-800 border border-gray-700">
                 <span className={`font-bold ${data.resolved ? 'text-red-400' : 'text-green-400'}`}>
                    {data.resolved ? 'Closed' : 'Live'}
                 </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-red-400 py-8 text-center">{data?.error || 'Failed to load market.'}</div>
        )}
      </div>
    </div>
  );
};
