"use client";
import React, { useEffect, useState, useRef } from 'react';
import FancySelect from '../../components/FancySelect';

type Project = { id: string; name: string; run_dir?: string; kind?: string };
type Goal = { id: string; task_name?: string; task_id?: string | number; goal?: string };

// Demo tree data
const demoTree = {
  id:"home", label:"Home", users:100, issues:[], children:[
    { id:"product", label:"Product", users:100, issues:[], children:[
      { id:"cart", label:"Cart", users:65, issues:[], children:[
        { id:"checkoutA", label:"Checkout", users:65, issues:[1,2,3,4,56,7], children:[
          { id:"connectA", label:"Connect Wal…", users:57, issues:[], children:[
            { id:"approveA", label:"Approve", users:57, issues:[], children:[
              { id:"payA", label:"Pay", users:57, issues:[1,2,3,4,56,7], children:[] }
            ]},
            { id:"summary", label:"Summary", users:8, issues:[], children:[
              { id:"refresh", label:"Refresh", users:8, issues:[1,2,3,4,56,7], children:[
                { id:"error", label:"Error", users:8, issues:[], children:[] }
              ] }
            ]},
            { id:"wrong", label:"Wrong Chain", users:18, issues:[1,2,3,4,56,7], children:[
              { id:"approveLoop", label:"Approve (loop)", users:9, issues:[1,2,3], children:[
                { id:"payLoop", label:"Pay", users:9, issues:[], children:[] }
              ]},
              { id:"switch", label:"Switch Chain", users:18, issues:[], children:[
                { id:"approveB", label:"Approve", users:18, issues:[1,2], children:[] }
              ]}
            ]}
          ]},
          { id:"connectB", label:"Connect Wal…", users:27, issues:[], children:[
            { id:"payB", label:"Pay", users:8, issues:[], children:[] },
            { id:"approveC", label:"Approve", users:8, issues:[], children:[] }
          ]},
          { id:"quoteSlow", label:"Quote (slow)", users:8, issues:[1,2,3,4,56,7], children:[] }
        ]},
        { id:"checkoutB", label:"Checkout", users:35, issues:[], children:[] }
      ]}
    ]}
  ]
};

export default function FlowInsightsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoal, setSelectedGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bootLoading, setBootLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);

  async function loadProjects() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/projects', { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load projects');
      const data = await res.json();

      // Filter to only show functional test projects (kind='webapp' or kind='functional')
      const allProjects = data.projects || [];
      const functionalProjects = allProjects.filter((p: Project) => {
        const kind = String(p.kind || '').toLowerCase();
        return kind === 'webapp' || kind === 'functional';
      });

      setProjects(functionalProjects);
    } catch (err) {
      console.error('Error loading projects:', err);
      setError('Failed to load projects');
    } finally {
      setBootLoading(false);
    }
  }

  async function loadGoals(projectId: string) {
    if (!projectId) {
      setGoals([]);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const token = typeof window !== 'undefined' ? localStorage.getItem('sparrow_token') : null;
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/projects/${projectId}/goals`, { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load tasks');
      const data = await res.json();
      setGoals(data.goals || []);
    } catch (err) {
      console.error('Error loading tasks:', err);
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadGoals(selectedProject);
    } else {
      setGoals([]);
      setSelectedGoal('');
    }
  }, [selectedProject]);

  // Render flow tree
  useEffect(() => {
    console.log('useEffect running, svgRef.current:', svgRef.current);
    if (!svgRef.current) {
      console.log('SVG ref is null, returning early');
      return;
    }

    const svg = svgRef.current;
    const ns = "http://www.w3.org/2000/svg";
    svg.innerHTML = ''; // clear
    console.log('Starting to render flow tree...');

    const nodeSize = { w: 140, h: 78 };
    const vGap = 24;
    const colGap = 72;

    function severityStyle(issues: any[]) {
      const has = Array.isArray(issues) && issues.length > 0;
      return {
        stroke: has ? "#ef4444" : "#9ca3af",
        cardClass: has ? "card red" : "card",
        chipClass: has ? "chip red" : "chip",
      };
    }

    function issuesLabel(arr: any[]) {
      const n = Array.isArray(arr) ? arr.length : 0;
      if (n === 0) return "No issues";
      if (n === 1) return "1 issue";
      return `${n} issues`;
    }

    function collectByDepth(root: any) {
      const cols: any[] = [];
      (function dfs(n: any, d = 0) {
        (cols[d] || (cols[d] = [])).push(n);
        (n.children || []).forEach((c: any) => dfs(c, d + 1));
      })(root, 0);
      return cols;
    }

    function layoutColumns(columns: any[]) {
      const pos = new Map();
      const widthPerCol = nodeSize.w + colGap;
      columns.forEach((col, i) => {
        const total = col.length * nodeSize.h + (col.length - 1) * vGap;
        let y = 50; // Add top padding
        col.forEach((n: any) => {
          pos.set(n.id, { x: 50 + i * widthPerCol, y }); // Add left padding
          y += nodeSize.h + vGap;
        });
      });
      return pos;
    }

    function buildEdges(root: any, pos: Map<any, any>, siblingOffset = 10) {
      const edges: any[] = [];
      (function walk(n: any) {
        const from = pos.get(n.id);
        (n.children || []).forEach((c: any, idx: number, arr: any[]) => {
          const to = pos.get(c.id);
          const style = severityStyle(c.issues);
          edges.push({
            from: { x: from.x + nodeSize.w, y: from.y + nodeSize.h / 2 },
            to: { x: to.x, y: to.y + nodeSize.h / 2 },
            color: style.stroke,
            hasIssues: Array.isArray(c.issues) && c.issues.length > 0,
            offset: (idx - (arr.length - 1) / 2) * siblingOffset,
          });
          walk(c);
        });
      })(root);
      return edges;
    }

    const columns = collectByDepth(demoTree);
    const positions = layoutColumns(columns);
    const edges = buildEdges(demoTree, positions, 10);

    const widthPerCol = nodeSize.w + colGap;
    const maxX = (columns.length - 1) * widthPerCol + nodeSize.w;
    const maxColLen = Math.max(...columns.map((c: any) => c.length));
    const totalH = Math.max(300, maxColLen * (nodeSize.h + vGap));

    const svgWidth = maxX + 200;
    const svgHeight = totalH + 200;

    svg.setAttribute('width', String(svgWidth));
    svg.setAttribute('height', String(svgHeight));
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    console.log('SVG dimensions:', { svgWidth, svgHeight, columns: columns.length, nodes: columns.flat().length });
    console.log('Columns:', columns);
    console.log('Edges:', edges.length);

    function edgePath(e: any) {
      const dx = Math.max(60, (e.to.x - e.from.x) * 0.35);
      const c1x = e.from.x + dx;
      const c1y = e.from.y + e.offset;
      const c2x = e.to.x - dx;
      const c2y = e.to.y;
      return `M ${e.from.x} ${e.from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${e.to.x} ${e.to.y}`;
    }

    // Draw edges (background layer)
    edges.forEach((e: any) => {
      const d = edgePath(e);
      // White outline
      const outline = document.createElementNS(ns, 'path');
      outline.setAttribute('d', d);
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', '#ffffff');
      outline.setAttribute('stroke-width', String((e.hasIssues ? 3 : 2.25) + 2));
      outline.setAttribute('stroke-linecap', 'round');
      outline.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(outline);

      // Colored line
      const line = document.createElementNS(ns, 'path');
      line.setAttribute('d', d);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', e.color);
      line.setAttribute('stroke-width', String(e.hasIssues ? 3 : 2.25));
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(line);
    });

    // Draw nodes (foreground layer)
    function nodeHTML(n: any) {
      const style = severityStyle(n.issues);
      const users = `${n.users} users`;
      const cardClass = style.cardClass === "card red" ? "flow-card red clickable" : "flow-card";
      const chipClass = style.chipClass === "chip red" ? "flow-chip red" : "flow-chip";
      const hasIssues = Array.isArray(n.issues) && n.issues.length > 0;
      return `
        <div xmlns="http://www.w3.org/1999/xhtml" class="${cardClass}" data-node-id="${n.id}" style="${hasIssues ? 'cursor: pointer;' : ''}">
          <div class="flow-title" title="${n.label}">${n.label}</div>
          <div class="flow-meta">${users}</div>
          <span class="${chipClass}">${issuesLabel(n.issues)}</span>
        </div>
      `;
    }

    columns.forEach((col: any) => {
      col.forEach((n: any) => {
        const pos = positions.get(n.id);
        console.log('Creating node:', n.id, 'at position:', pos);
        const fo = document.createElementNS(ns, 'foreignObject');
        fo.setAttribute('x', String(pos.x));
        fo.setAttribute('y', String(pos.y));
        fo.setAttribute('width', String(nodeSize.w));
        fo.setAttribute('height', String(nodeSize.h));
        fo.innerHTML = nodeHTML(n);

        // Add click handler for nodes with issues
        if (Array.isArray(n.issues) && n.issues.length > 0) {
          fo.addEventListener('click', () => {
            console.log('Node clicked:', n.id);
            setSelectedNode(n);
            setShowModal(true);
          });
        }

        svg.appendChild(fo);
      });
    });

    console.log('Total elements in SVG:', svg.children.length);
  }, [bootLoading]); // Re-run when bootLoading changes

  const handleExport = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const img = new Image();
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Number(svgRef.current?.getAttribute('width')) * zoom;
      canvas.height = Number(svgRef.current?.getAttribute('height')) * zoom;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(zoom, zoom);
      ctx.fillStyle = "#f9fafb";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'flow-tree.png';
        a.click();
      });
    };
    img.src = url;
  };

  if (bootLoading) return <div>Loading...</div>;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Flow Insights</h2>
      </div>

      <div className="grid" style={{ gap: 12, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 700 }}>
            Project
            <FancySelect
              value={selectedProject}
              onChange={(val) => {
                setSelectedProject(val);
                setSelectedGoal('');
                setGoals([]);
              }}
              placeholder="Select project"
              options={projects.map(p => ({ value: p.id, label: p.name }))}
              searchable={false}
              compact
            />
          </label>
          <label style={{ fontSize: 14, fontWeight: 700 }}>
            Task
            <FancySelect
              value={selectedGoal}
              onChange={(val) => {
                setSelectedGoal(val);
              }}
              placeholder={selectedProject ? "Select a task" : "Select project first"}
              options={goals.map(g => ({
                value: g.id,
                label: (
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <span style={{ fontWeight:600, color:'#0F172A' }}>{g.task_name || (g.goal || `Goal ${g.id.slice(0,8)}`)}</span>
                    {g.task_id != null && (
                      <span style={{ fontSize:11, color:'#94A3B8', fontWeight: 500 }}>ID: task-{g.task_id}</span>
                    )}
                  </div>
                ) as any
              }))}
              searchable={true}
              compact
            />
          </label>
        </div>
        {(loading || error) && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {loading && <span className="muted">Loading…</span>}
            {error && <span className="muted" style={{ color: '#fca5a5' }}>{error}</span>}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: '#4b5563' }}>Flow Tree — columns = depth, smooth connectors</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={handleExport} style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>
            Export
          </button>
          <label style={{ fontSize: 14, color: '#4b5563', display: 'flex', alignItems: 'center', gap: 8 }}>
            Zoom
            <input
              type="range"
              min="0.6"
              max="1.6"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              style={{ width: 100 }}
            />
          </label>
        </div>
      </div>

      {/* Flow Canvas */}
      <div style={{ border: '1px solid #edf2f7', borderRadius: 12, overflow: 'auto', height: 520, background: '#f9fafb' }}>
        <svg ref={svgRef} style={{ display: 'block', transformOrigin: 'left top', transform: `scale(${zoom})`, background: '#f9fafb' }} />
      </div>

      {/* Sidebar Modal */}
      {showModal && selectedNode && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 480,
          height: '100vh',
          background: '#fff',
          boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          overflow: 'auto',
          padding: 24
        }}>
          {/* Close Button */}
          <button
            onClick={() => setShowModal(false)}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              border: 'none',
              background: 'transparent',
              fontSize: 24,
              cursor: 'pointer',
              color: '#64748b',
              padding: 4
            }}
          >
            ×
          </button>

          {/* Title */}
          <h2 style={{ margin: '0 0 24px 0', fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
            Issue Details
          </h2>

          {/* Name */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Name</h3>
            <div style={{
              padding: 12,
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              fontSize: 14,
              color: '#0f172a'
            }}>
              {selectedNode.label}
            </div>
          </div>

          {/* Path */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Path</h3>
            <div style={{
              padding: 12,
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              fontSize: 13,
              fontFamily: 'monospace',
              color: '#475569'
            }}>
              Home → Product → Cart → {selectedNode.label}
            </div>
          </div>

          {/* Evidence */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Evidence (What Actually Happened)</h3>
            <div style={{
              padding: 12,
              background: '#fef2f2',
              borderRadius: 8,
              border: '1px solid #fecaca',
              fontSize: 13,
              color: '#0f172a',
              lineHeight: 1.6
            }}>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>User reached "{selectedNode.label}" screen with {selectedNode.users} users</li>
                <li>Detected {selectedNode.issues?.length || 0} critical issues affecting user flow</li>
                <li>High abandonment rate observed at this step</li>
                <li>Payment gateway timeout errors reported</li>
              </ul>
            </div>
          </div>

          {/* Repro Steps */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Repro Steps</h3>
            <div style={{
              padding: 12,
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px solid #e2e8f0'
            }}>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#475569', lineHeight: 1.8 }}>
                <li>Navigate to Home page</li>
                <li>Click on "Product" category</li>
                <li>Add item to Cart</li>
                <li>Proceed to "{selectedNode.label}"</li>
                <li>Observe the issue at this step</li>
              </ol>
            </div>
          </div>

          {/* Issue Count Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            color: '#dc2626'
          }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            {selectedNode.issues?.length || 0} {selectedNode.issues?.length === 1 ? 'issue' : 'issues'} found
          </div>
        </div>
      )}

      {/* Backdrop */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 999
          }}
        />
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .flow-card {
          position: relative;
          min-width: 140px;
          max-width: 140px;
          height: 78px;
          border-radius: 16px;
          border: 2px solid #9ca3af;
          background: #fff;
          box-shadow: 0 1px 2px rgba(0,0,0,.06);
          padding: 8px 12px;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        .flow-card.red {
          border-color: #f87171;
          background: #fff5f5;
          animation: pulse-border 2s ease-in-out infinite;
        }
        .flow-card.clickable:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 16px rgba(239, 68, 68, 0.25);
          border-color: #dc2626;
          background: #fff;
        }
        @keyframes pulse-border {
          0%, 100% {
            border-color: #f87171;
            box-shadow: 0 1px 2px rgba(0,0,0,.06);
          }
          50% {
            border-color: #ef4444;
            box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
          }
        }
        .flow-title {
          font-size: 14px;
          font-weight: 600;
          color: #1f2937;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .flow-meta {
          margin-top: 4px;
          font-size: 11px;
          color: #4b5563;
        }
        .flow-chip {
          position: absolute;
          right: 8px;
          bottom: 8px;
          font-size: 10px;
          border-radius: 999px;
          padding: 2px 8px;
          border: 1px solid #e5e7eb;
          color: #4b5563;
          background: #fff;
        }
        .flow-chip.red {
          background: #ef4444;
          color: #fff;
          border-color: transparent;
        }
      `}} />
    </div>
  );
}
