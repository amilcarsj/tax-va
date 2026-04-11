/**
 * TaxonomyView — renders the taxonomy tree SVG and manages node selection.
 *
 * Tree structure
 * ──────────────
 *        [Movement]          ← root (non-clickable)
 *       /          \
 *  [Kinematic]  [Geometric]  ← level 1, clickable
 *   /       \    /       \
 * [Speed] [Accel] [Curv] [Indent]  ← level 2, clickable
 *
 * Rules
 * ─────
 * • Up to 2 nodes may be selected at once.
 * • Clicking a third node replaces the oldest selection.
 * • When exactly 2 nodes are selected the callback fires only if the pair
 *   forms a valid combination (i.e. is a key in VALID_COMBINATIONS).
 * • setSelection() is called externally (e.g. from a heatmap click) to
 *   programmatically sync the tree.
 *
 * Callback signature: onSelectionChange(sortedNameA, sortedNameB)
 */
class TaxonomyView {

    static VALID_COMBINATIONS = new Set([
        'Acceleration Curvature',
        'Acceleration Indentation',
        'Acceleration Speed',
        'Curvature Indentation',
        'Curvature Speed',
        'Geometric Kinematic',
        'Indentation Speed',
    ]);

    static SELECTED_FILL  = '#DC143C80';   // crimson, semi-transparent
    static DEFAULT_FILL   = 'white';
    static MIN_FONT       = 14;            // px — enforced minimum

    constructor(containerId, onSelectionChange) {
        this.containerId       = containerId;
        this.onSelectionChange = onSelectionChange;
        this.selected          = [];   // [{name, rectEl}]  max length 2
        this._nodeEls          = {};   // name → D3 rect selection
        this._draw();
    }

    // ── Public API ────────────────────────────────────────────────

    /** Programmatically highlight two nodes without firing the callback. */
    setSelection(nameA, nameB) {
        this._clearHighlights();
        [nameA, nameB].forEach(name => {
            const el = this._nodeEls[name];
            if (!el) return;
            el.attr('fill', TaxonomyView.SELECTED_FILL);
            this.selected.push({ name, rectEl: el });
        });
    }

    clearSelection() {
        this._clearHighlights();
    }

    // ── Drawing ───────────────────────────────────────────────────

    _draw() {
        const container = document.querySelector(this.containerId);
        if (!container) return;
        container.innerHTML = '';

        const W  = container.clientWidth  || 320;
        const H  = container.clientHeight || 240;
        const F  = TaxonomyView.MIN_FONT;

        // Layout proportions
        const cx   = W / 2;
        const lx   = W * 0.25;          // Kinematic x-centre
        const rx   = W * 0.75;          // Geometric  x-centre
        const l1y  = H * 0.28;          // top of level-1 boxes
        const l2y  = H * 0.60;          // top of level-2 boxes
        const bw   = Math.min(W * 0.20, 90);   // box width
        const bh   = Math.max(26, H * 0.12);   // box height (shared all levels)

        // Level-2 nodes distributed evenly at quarters of W.
        const s2x  = W * 0.125;   // Speed
        const a2x  = W * 0.375;   // Acceleration
        const c2x  = W * 0.625;   // Curvature
        const i2x  = W * 0.875;   // Indentation

        // Vertical centering: shift whole tree so it sits in the middle of H.
        const treeH = l2y + bh;
        const yOff  = Math.max(0, (H - treeH) / 2);

        const svg = d3.select(this.containerId)
            .append('svg')
            .attr('width',  W)
            .attr('height', H);

        const g = svg.append('g').attr('transform', `translate(0,${yOff})`);

        // ── Lines ──────────────────────────────────────────────────

        const curve = d3.line().x(d => d[0]).y(d => d[1]).curve(d3.curveBasis);

        // Root → level-1 (curved)
        [
            [[cx, bh], [cx, H * 0.17], [lx, l1y]],
            [[cx, bh], [cx, H * 0.17], [rx, l1y]],
        ].forEach(pts => {
            g.append('path')
                .attr('d', curve(pts))
                .attr('stroke', 'black').attr('stroke-width', 1)
                .attr('fill', 'none');
        });

        // Level-1 → level-2 (straight)
        [
            [lx, l1y + bh, s2x, l2y],
            [lx, l1y + bh, a2x, l2y],
            [rx, l1y + bh, c2x, l2y],
            [rx, l1y + bh, i2x, l2y],
        ].forEach(([x1, y1, x2, y2]) => {
            g.append('line')
                .attr('x1', x1).attr('y1', y1)
                .attr('x2', x2).attr('y2', y2)
                .attr('stroke', 'black').attr('stroke-width', 1);
        });

        // ── Root box (non-clickable) ───────────────────────────────

        g.append('rect')
            .attr('x', cx - bw / 2).attr('y', 0)
            .attr('width', bw).attr('height', bh)
            .attr('fill', 'none').attr('stroke', 'black')
            .attr('rx', 14).attr('ry', 14);

        const rootText = g.append('text')
            .attr('x', cx).attr('text-anchor', 'middle')
            .attr('font-size', F);
        rootText.append('tspan')
            .attr('x', cx).attr('y', bh / 2 - 4)
            .text('Movement');
        rootText.append('tspan')
            .attr('x', cx).attr('dy', F + 1)
            .text('variables');

        // ── Clickable nodes ────────────────────────────────────────

        const nodes = [
            { name: 'Kinematic',    x: lx,  y: l1y },
            { name: 'Geometric',    x: rx,  y: l1y },
            { name: 'Speed',        x: s2x, y: l2y },
            { name: 'Acceleration', x: a2x, y: l2y },
            { name: 'Curvature',    x: c2x, y: l2y },
            { name: 'Indentation',  x: i2x, y: l2y },
        ];

        nodes.forEach(node => {
            const rect = g.append('rect')
                .attr('x', node.x - bw / 2).attr('y', node.y)
                .attr('width', bw).attr('height', bh)
                .attr('fill', TaxonomyView.DEFAULT_FILL)
                .attr('stroke', 'black')
                .attr('rx', 14).attr('ry', 14)
                .style('cursor', 'pointer');

            const text = g.append('text')
                .attr('x', node.x)
                .attr('y', node.y + bh / 2 + 1)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('font-size', F)
                .style('cursor', 'pointer')
                .text(node.name);

            this._nodeEls[node.name] = rect;

            const onClick = () => this._toggleNode(node.name, rect);
            rect.on('click', onClick);
            text.on('click', onClick);
        });
    }

    // ── Interaction helpers ───────────────────────────────────────

    _toggleNode(name, rectEl) {
        const idx = this.selected.findIndex(s => s.name === name);

        if (idx >= 0) {
            // Deselect
            this.selected.splice(idx, 1);
            rectEl.attr('fill', TaxonomyView.DEFAULT_FILL);
        } else if (this.selected.length < 2) {
            // Add to selection
            this.selected.push({ name, rectEl });
            rectEl.attr('fill', TaxonomyView.SELECTED_FILL);
        } else {
            // Replace oldest
            this.selected[0].rectEl.attr('fill', TaxonomyView.DEFAULT_FILL);
            this.selected.shift();
            this.selected.push({ name, rectEl });
            rectEl.attr('fill', TaxonomyView.SELECTED_FILL);
        }

        if (this.selected.length === 2) {
            const [a, b] = this.selected.map(s => s.name).sort();
            const key = `${a} ${b}`;
            if (TaxonomyView.VALID_COMBINATIONS.has(key)) {
                this.onSelectionChange(a, b);
            }
        }
    }

    _clearHighlights() {
        this.selected.forEach(s => s.rectEl.attr('fill', TaxonomyView.DEFAULT_FILL));
        this.selected = [];
    }
}
