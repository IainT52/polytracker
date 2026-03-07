import React from 'react';

interface SyndicateDetailsModalProps {
  syndicate: {
    id: number;
    name: string;
    size: number;
    combinedPnL: number;
    winRate: number;
    targetVolumeLevel: number;
    topKeywords: string;
    members: string[];
  } | null;
  onClose: () => void;
  onWalletClick: (walletAddress: string) => void;
}

export const SyndicateDetailsModal: React.FC<SyndicateDetailsModalProps> = ({ syndicate, onClose, onWalletClick }) => {
  if (!syndicate) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl relative">
        {/* Close button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors bg-gray-800 p-2 rounded-full hover:bg-gray-700"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 text-left">
          <div className="mb-6 border-b border-gray-800 pb-4">
            <h2 className="text-2xl font-bold text-white mb-2">{syndicate.name} Profile</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full text-xs font-medium border border-blue-500/20">
                Size: {syndicate.size} Members
              </span>
              <span className="bg-purple-500/10 text-purple-400 px-3 py-1 rounded-full text-xs font-medium border border-purple-500/20">
                Avg Vol: ${(syndicate.targetVolumeLevel || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-950 rounded-xl p-4 border border-gray-800 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Combined PnL</p>
                  <p className={`text-xl font-bold ${syndicate.combinedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {syndicate.combinedPnL >= 0 ? '+' : '-'}${Math.abs(syndicate.combinedPnL).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="bg-gray-950 rounded-xl p-4 border border-gray-800 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Avg Win Rate</p>
                  <p className="text-xl font-bold text-blue-400">{syndicate.winRate.toFixed(1)}%</p>
                </div>
              </div>
            </div>
            
            <div className="mt-4 bg-gray-950 p-4 rounded-xl border border-gray-800">
               <p className="text-sm text-gray-300"><span className="font-bold text-gray-500">Core Narratives: </span> {syndicate.topKeywords}</p>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-300 mb-3 border-l-4 border-indigo-500 pl-2">Swarm Members</h3>
            <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden text-sm">
                <table className="w-full text-left whitespace-nowrap">
                    <tbody className="divide-y divide-gray-800/50">
                        {syndicate.members.map((member, i) => (
                            <tr key={i} className="hover:bg-gray-800 transition-colors border-b border-gray-800 cursor-pointer" onClick={() => onWalletClick(member)}>
                                <td className="px-4 py-3 font-mono text-indigo-400 truncate max-w-[200px]">{member}</td>
                                <td className="px-4 py-3 text-right">
                                     <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded border border-gray-700">Inspect ↗</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
