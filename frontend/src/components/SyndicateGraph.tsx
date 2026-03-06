import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface SyndicateGraphProps {
  apiUrl: string;
}

export const SyndicateGraph: React.FC<SyndicateGraphProps> = ({ apiUrl }) => {
  const [graphData, setGraphData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);

  useEffect(() => {
    const fetchGraphData = () => {
      fetch(`${apiUrl}/syndicates/graph`)
        .then(res => res.json())
        .then(data => {
          if (data && data.nodes) {
            setGraphData(data);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    };

    fetchGraphData();
    const interval = setInterval(fetchGraphData, 10000); // 10s poll
    return () => clearInterval(interval);
  }, [apiUrl]);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px] text-gray-500 italic">
        Gathering advanced correlation data...
      </div>
    );
  }

  return (
    <div className="relative h-[600px] w-full rounded-xl overflow-hidden border border-gray-800 bg-gray-950 flex flex-col items-center shadow-inner">
      <ForceGraph2D
        width={800} // adjust based on container if needed, using fixed or relative later
        height={600}
        backgroundColor="#030712"
        graphData={graphData}
        nodeLabel="id"
        nodeColor={node => {
          if (node.group === 'A') return '#39FF14'; // Neon Green
          if (node.group === 'B') return '#00BFFF'; // Blue
          return '#6b7280'; // Gray for unrated
        }}
        nodeRelSize={4}
        nodeVal={node => node.val}
        linkColor={() => '#4b5563'} // Link color
        linkWidth={link => (link as any).value / 2}
        onNodeClick={handleNodeClick}
        d3VelocityDecay={0.1}
      />

      {/* Side Panel / Modal for Node Details */}
      {selectedNode && (
        <div className="absolute top-4 right-4 w-72 bg-gray-900 border border-gray-700 shadow-2xl rounded-xl p-5 fade-in transition-all">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-pink-400 font-bold uppercase text-xs tracking-wider">Whale Profile</h3>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-gray-500 text-xs uppercase mb-1">Address</p>
              <p className="text-gray-300 font-mono text-xs break-all">
                {selectedNode.id}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-500 text-xs uppercase mb-1">Grade</p>
                <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${selectedNode.group === 'A' ? 'bg-green-500/20 text-green-400' :
                    selectedNode.group === 'B' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-500/20 text-gray-400'
                  }`}>
                  {selectedNode.group}
                </div>
              </div>
              <div>
                <p className="text-gray-500 text-xs uppercase mb-1">Win Rate</p>
                <p className="text-white font-medium">
                  {selectedNode.winRate ? `${selectedNode.winRate.toFixed(1)}%` : 'N/A'}
                </p>
              </div>
            </div>

            <div>
              <p className="text-gray-500 text-xs uppercase mb-1">Recent ROI (30d)</p>
              <p className={`font-medium ${selectedNode.val >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {selectedNode.val === 1 && !selectedNode.winRate ? 'N/A' : `${selectedNode.val > 0 ? '+' : ''}${selectedNode.val}%`}
              </p>
            </div>
          </div>

          <button className="w-full mt-5 py-2 bg-pink-600 hover:bg-pink-700 active:bg-pink-800 text-white rounded text-sm font-medium transition-colors shadow-lg">
            View Recent Trades
          </button>
        </div>
      )}
    </div>
  );
};
