'use client';

import { useEffect, useMemo, useRef } from 'react';
import { gsap, useGSAP } from '@/lib/gsap';
import { projects, type ArchNode, type Architecture } from '@/config/content';
import { dossier, useDossier } from '@/lib/archiveState';
import styles from './Dossier.module.css';

/* ============================================================================
   DOSSIER

   The architecture diagram that opens when a shard is clicked.

   Layout is computed from the lane/row grid in content.ts, never authored in
   pixels — adding a node to a project's architecture places itself. Edges are
   drawn twice: a dim base path that GSAP strokes in on open, and a short
   bright "packet" dash that loops along the same path afterwards to show
   direction of flow.

   The panel is glass over a blurred backdrop, so the shard that was clicked
   stays visible behind it and keeps lighting the panel from underneath.
   ========================================================================= */

/* --- Diagram grid -------------------------------------------------------- */

const VIEW_W = 1240;
const NODE_H = 74;
const HEAD_Y = 30;
const ROW_Y = 104;
const ROW_GAP = 134;
const FEEDBACK_Y_PAD = 46;

type Placed = ArchNode & { x: number; y: number; w: number };

function layout(arch: Architecture) {
  const colWidth = VIEW_W / arch.lanes.length;
  const nodeW = colWidth - 60;

  const placed: Record<string, Placed> = {};
  arch.nodes.forEach((node) => {
    placed[node.id] = {
      ...node,
      w: nodeW,
      x: node.col * colWidth + colWidth / 2,
      y: ROW_Y + node.row * ROW_GAP,
    };
  });

  const maxRow = Math.max(...arch.nodes.map((n) => n.row));
  // Extra room under the feedback lane so return routes are not clipped
  // by the frame they run along.
  const height = ROW_Y + maxRow * ROW_GAP + NODE_H + FEEDBACK_Y_PAD + 42;

  return {
    placed,
    colWidth,
    nodeW,
    height,
    feedbackY: ROW_Y + maxRow * ROW_GAP + NODE_H + FEEDBACK_Y_PAD,
  };
}

/** Builds an SVG path between two placed nodes. */
function edgePath(a: Placed, b: Placed, feedback: boolean, feedbackY: number) {
  const ay = a.y + NODE_H / 2;
  const by = b.y + NODE_H / 2;

  if (feedback) {
    const ax = a.x;
    const bx = b.x;
    const r = 14;

    /* Same lane: a route under the diagram would run straight back up its
       own path and draw nothing. Bracket it out to the left instead. */
    if (Math.abs(bx - ax) < 1) {
      const edge = ax - a.w / 2;
      const out = edge - a.w * 0.34;
      return [
        `M ${edge} ${ay}`,
        `L ${out + r} ${ay}`,
        `Q ${out} ${ay} ${out} ${ay - r}`,
        `L ${out} ${by + r}`,
        `Q ${out} ${by} ${out + r} ${by}`,
        `L ${edge} ${by}`,
      ].join(' ');
    }

    // Different lanes: run the return underneath, clear of every node.
    const dir = bx < ax ? -1 : 1;
    return [
      `M ${ax} ${a.y + NODE_H}`,
      `L ${ax} ${feedbackY - r}`,
      `Q ${ax} ${feedbackY} ${ax + dir * r} ${feedbackY}`,
      `L ${bx - dir * r} ${feedbackY}`,
      `Q ${bx} ${feedbackY} ${bx} ${feedbackY - r}`,
      `L ${bx} ${b.y + NODE_H}`,
    ].join(' ');
  }

  if (a.col === b.col) {
    // Same lane: straight drop between stacked nodes.
    const x = a.x;
    return `M ${x} ${a.y + NODE_H} L ${x} ${b.y}`;
  }

  const sx = a.x + a.w / 2;
  const ex = b.x - b.w / 2;
  const dx = (ex - sx) * 0.55;

  return `M ${sx} ${ay} C ${sx + dx} ${ay}, ${ex - dx} ${by}, ${ex} ${by}`;
}

/* --- Component ----------------------------------------------------------- */

export function Dossier() {
  const openId = useDossier();
  const project = useMemo(() => projects.find((p) => p.id === openId) ?? null, [openId]);

  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const geometry = useMemo(() => (project ? layout(project.architecture) : null), [project]);

  /* Escape to close, and scroll locked while the panel owns the screen. */
  useEffect(() => {
    if (!project) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dossier.close();
    };

    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();

    return () => {
      document.documentElement.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [project]);

  useGSAP(
    () => {
      if (!project) return;

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

      if (reduced) {
        gsap.set(`.${styles.panel}, .${styles.backdrop}`, { opacity: 1 });
        gsap.set(`.${styles.edgeBase}`, { strokeDashoffset: 0 });
        return () => tl.kill();
      }

      tl.fromTo(`.${styles.backdrop}`, { opacity: 0 }, { opacity: 1, duration: 0.5 })
        .fromTo(
          `.${styles.panel}`,
          { opacity: 0, y: 36, scale: 0.985 },
          { opacity: 1, y: 0, scale: 1, duration: 0.9 },
          '-=0.3',
        )
        .from(`.${styles.lane}`, { opacity: 0, y: -12, duration: 0.6, stagger: 0.05 }, '-=0.55')
        .from(
          `.${styles.node}`,
          { opacity: 0, y: 22, scale: 0.94, duration: 0.7, stagger: 0.035 },
          '-=0.4',
        );

      /* Stroke each edge on. Lengths are measured rather than guessed, so a
         long feedback route takes proportionally longer to draw. */
      const bases = gsap.utils.toArray<SVGPathElement>(`.${styles.edgeBase}`);
      bases.forEach((path, i) => {
        const length = path.getTotalLength();
        tl.fromTo(
          path,
          { strokeDasharray: length, strokeDashoffset: length },
          { strokeDashoffset: 0, duration: 0.8, ease: 'power2.inOut' },
          0.7 + i * 0.045,
        );
      });

      tl.from(`.${styles.packet}`, { opacity: 0, duration: 0.6, stagger: 0.03 }, '>-0.3')
        .from(`.${styles.note}`, { opacity: 0, y: 16, duration: 0.7, stagger: 0.08 }, '<0.1');

      return () => tl.kill();
    },
    { scope: rootRef, dependencies: [project?.id] },
  );

  if (!project || !geometry) return null;

  const { placed, height, feedbackY } = geometry;
  const arch = project.architecture;
  const colWidth = VIEW_W / arch.lanes.length;

  return (
    <div ref={rootRef} className={styles.root} role="dialog" aria-modal="true" aria-label={`${project.title} architecture`}>
      <div className={styles.backdrop} onClick={() => dossier.close()} />

      <div className={styles.panel}>
        <header className={styles.head}>
          <div className={styles.headMeta}>
            <span className={`u-mono ${styles.codename}`}>{project.codename}</span>
            <h2 className={styles.title}>{project.title}</h2>
            <p className={styles.sub}>
              <span className="u-mono">{project.role}</span>
              <span className={styles.dot} aria-hidden="true" />
              <span className="u-mono">{project.year}</span>
            </p>
          </div>

          <button ref={closeRef} className={styles.close} onClick={() => dossier.close()}>
            <span className="u-mono">Close</span>
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <p className={styles.blurb}>{project.blurb}</p>

        <div className={styles.diagramWrap}>
          <svg
            className={styles.diagram}
            viewBox={`0 0 ${VIEW_W} ${height}`}
            role="img"
            aria-label={`Architecture diagram for ${project.title}`}
          >
            <defs>
              {/* userSpaceOnUse is required, not stylistic. The default
                  objectBoundingBox units give a vertical or same-column edge
                  a zero-width bounding box, and a gradient stroke on a
                  degenerate box paints nothing at all — those edges simply
                  disappear. In user space the ramp spans the diagram. */}
              <linearGradient
                id="dossier-edge"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="0"
                x2={VIEW_W}
                y2="0"
              >
                <stop offset="0%" stopColor="#2a7fa8" />
                <stop offset="55%" stopColor="#4fb6e8" />
                <stop offset="100%" stopColor="#7fd4ff" />
              </linearGradient>
            </defs>

            {/* Lane headers + separators */}
            {arch.lanes.map((lane, i) => (
              <g key={lane} className={styles.lane}>
                <text x={i * colWidth + colWidth / 2} y={HEAD_Y} className={styles.laneLabel}>
                  {lane}
                </text>
                {i > 0 && (
                  <line
                    x1={i * colWidth}
                    y1={HEAD_Y + 14}
                    x2={i * colWidth}
                    y2={height - 12}
                    className={styles.laneRule}
                  />
                )}
              </g>
            ))}

            {/* Edges under nodes so connections tuck behind the boxes */}
            {arch.edges.map((edge) => {
              const a = placed[edge.from];
              const b = placed[edge.to];
              if (!a || !b) return null;

              const d = edgePath(a, b, !!edge.feedback, feedbackY);
              const midX = (a.x + b.x) / 2;
              const midY = edge.feedback ? feedbackY - 10 : (a.y + b.y) / 2 + NODE_H / 2;

              return (
                <g key={`${edge.from}-${edge.to}`}>
                  <path
                    d={d}
                    className={`${styles.edgeBase} ${edge.feedback ? styles.edgeFeedback : ''}`}
                  />
                  <path d={d} className={styles.packet} />
                  {edge.label && (
                    <text x={midX} y={midY - 8} className={styles.edgeLabel}>
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {arch.nodes.map((node) => {
              const p = placed[node.id];
              return (
                <g key={node.id} className={styles.node} data-kind={node.kind}>
                  <rect
                    x={p.x - p.w / 2}
                    y={p.y}
                    width={p.w}
                    height={NODE_H}
                    rx={10}
                    className={styles.nodeBox}
                  />
                  <rect
                    x={p.x - p.w / 2}
                    y={p.y}
                    width={3}
                    height={NODE_H}
                    className={styles.nodeAccent}
                  />
                  <text x={p.x - p.w / 2 + 18} y={p.y + (node.sub ? 30 : 43)} className={styles.nodeLabel}>
                    {node.label}
                  </text>
                  {node.sub && (
                    <text x={p.x - p.w / 2 + 18} y={p.y + 50} className={styles.nodeSub}>
                      {node.sub}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <footer className={styles.foot}>
          <ul className={styles.notes}>
            {arch.notes.map((note) => (
              <li key={note} className={styles.note}>
                {note}
              </li>
            ))}
          </ul>

          <div className={styles.footMeta}>
            <ul className={styles.stack}>
              {project.stack.map((tech) => (
                <li key={tech} className={styles.chip}>
                  {tech}
                </li>
              ))}
            </ul>
            <ul className={styles.legend}>
              {(['source', 'core', 'model', 'store', 'sink'] as const).map((kind) => (
                <li key={kind} className={styles.legendItem} data-kind={kind}>
                  <span className={styles.legendSwatch} aria-hidden="true" />
                  <span className="u-mono">{kind}</span>
                </li>
              ))}
            </ul>
          </div>
        </footer>
      </div>
    </div>
  );
}
