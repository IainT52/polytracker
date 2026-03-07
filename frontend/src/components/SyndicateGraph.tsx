import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

// Phase 14: Custom Resize Observer to bypass Airlock NPM blocks
function useResizeObserver<T extends HTMLElement>() {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const observeTarget = ref.current;
    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });
    });

    resizeObserver.observe(observeTarget);
    return () => resizeObserver.unobserve(observeTarget);
  }, []);

  return [ref, dimensions] as const;
}

interface SyndicateGraphProps {
  apiUrl: string;
  onNodeClick: (nodeId: string) => void;
  selectedSyndicate?: any;
}

export const SyndicateGraph: React.FC<SyndicateGraphProps> = ({ apiUrl, onNodeClick, selectedSyndicate }) => {
  const [graphData, setGraphData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const fgRef = useRef<any>(null);
  const [containerRef, dimensions] = useResizeObserver<HTMLDivElement>();

  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-200);
    }
  }, [graphData]);

  useEffect(() => {
    const fetchGraphData = () => {
      fetch(`${apiUrl}/syndicates/graph`)
        .then(res => res.json())
        .then(data => {
          if (data && data.nodes) {
            setGraphData(prev => {
              // Phase 13: Prevent physics explosion by only setting state if data actually changed
              if (JSON.stringify(data) !== JSON.stringify(prev)) {
                return data;
              }
              return prev;
            });
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
    if (node && node.id) {
      onNodeClick(node.id);
    }
  }, [onNodeClick]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px] text-gray-500 italic">
        Gathering advanced correlation data...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-[600px] w-full flex-1 rounded-xl overflow-hidden border border-gray-800 bg-gray-950 flex flex-col items-center shadow-inner">
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#030712"
        graphData={graphData}
        nodeLabel="id"
        nodeColor={node => {
          if (selectedSyndicate && selectedSyndicate.members?.includes(node.id)) {
            return '#ec4899'; // Pink-500 highlight
          }
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


    </div>
  );
};
