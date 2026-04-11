/**
 * Heatmap2DView — horizontal strip shown in 2D mode above the two flat maps.
 *
 * Displays ALL per-point feature values for each selected trajectory as two
 * rows of coloured rectangles (yellow → red). Both rows share the same colour
 * scale so values are directly comparable. Rect width scales with the number
 * of actual data points, so longer trajectories get narrower rects.
 *
 * Public API:
 *   setTrajectoryA(data)  — point array for Trajectory A (or null to clear)
 *   setTrajectoryB(data)  — point array for Trajectory B (or null to clear)
 *   setFeature(name)      — trajectory-feature name (e.g. 'speed_mean')
 *   render()              — redraw with current data + feature
 *   clear()               — reset to placeholder state
 */
class Heatmap2DView {

    static COLOR_A      = '#0080FF';   // label colour for Trajectory A
    static COLOR_B      = '#DC143C';   // label colour for Trajectory B
    static COLOR_LOW    = '#ffffcc';
    static COLOR_HIGH   = '#e31a1c';
    static LABEL_W      = 150;         // px reserved on the left for row labels
    static ROW_H        = 36;          // fixed row height (px) — sized for two text lines
    static ROW_GAP      = 8;           // fixed gap (px) between the two rows
    static SCALE_H      = 34;          // px reserved below rows for the colour-scale bar
    static FEAT_LABEL_H = 18;          // px reserved below scale bar for the feature name

    // Internal SVG padding (keeps drawn content away from SVG edges).
    static PAD_TOP    = 10;
    static PAD_BOTTOM = 22;
    static PAD_LEFT   = 20;
    static PAD_RIGHT  = 20;

    // Maps trajectory-feature name prefixes to point-feature column names —
    // mirrors the same mapping in MapView.PREFIX_TO_COLUMN.
    static PREFIX_TO_COLUMN = {
        'speed':        'speed',
        'acceleration': 'acceleration',
        'distance':     'distance',
        'angles':       'angle',
        'angle':        'angle',
    };

    // Human-readable labels for each point-feature type.
    static FEATURE_LABELS = {
        'speed':        'Speed',
        'acceleration': 'Acceleration',
        'distance':     'Curvature (distance_geometry)',
        'angles':       'Indentation (angles)',
        'angle':        'Indentation (angles)',
    };

    constructor(containerId) {
        this.containerId   = containerId;
        this._dataA        = null;
        this._dataB        = null;
        this._featureName  = null;
        this._svg          = null;
        this._labelA       = null;   // { tid, objectId } or null
        this._labelB       = null;
    }

    // ── Public API ────────────────────────────────────────────────

    setTrajectoryA(data) { this._dataA = data; }
    setTrajectoryB(data) { this._dataB = data; }

    setLabelA(tid, objectId) {
        this._labelA = tid != null ? { tid, objectId } : null;
    }
    setLabelB(tid, objectId) {
        this._labelB = tid != null ? { tid, objectId } : null;
    }

    setFeature(name) {
        this._featureName = name || null;
    }

    render() {
        const col = this._columnName();
        if (!col || (!this._dataA && !this._dataB)) {
            this.clear();
            return;
        }
        this._draw(col);
    }

    clear() {
        const el = document.querySelector(this.containerId);
        if (!el) return;
        el.innerHTML =
            '<span style="color:#999;font-style:italic;font-size:13px;' +
            'display:flex;align-items:center;justify-content:center;height:100%;">' +
            'Select a feature in Feature Importance to see the value strip.</span>';
        this._svg = null;
    }

    // ── Drawing ───────────────────────────────────────────────────

    /** Returns { top, bottom } so _drawRow can render two lines. */
    _fmtLabel(meta) {
        if (!meta) return { top: '—', bottom: '' };
        return {
            top:    `Episode ${meta.tid}`,
            bottom: `Object ID: ${meta.objectId ?? '—'}`,
        };
    }

    _draw(col) {
        const el = document.querySelector(this.containerId);
        if (!el) return;
        el.innerHTML = '';

        const style = getComputedStyle(el);
        const padH  = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const W = Math.max(200, (el.clientWidth || 600) - padH);

        const valsA   = this._sample(this._dataA, col);
        const valsB   = this._sample(this._dataB, col);
        const allVals = [...valsA, ...valsB].filter(v => v != null && !isNaN(v));

        if (allVals.length === 0) { this.clear(); return; }

        const lo = d3.min(allVals);
        const hi = d3.max(allVals);
        const colorScale = d3.scaleLinear()
            .domain([lo, hi])
            .range([Heatmap2DView.COLOR_LOW, Heatmap2DView.COLOR_HIGH]);

        const PT   = Heatmap2DView.PAD_TOP;
        const PB   = Heatmap2DView.PAD_BOTTOM;
        const PL   = Heatmap2DView.PAD_LEFT;
        const PR   = Heatmap2DView.PAD_RIGHT;
        const rowH = Heatmap2DView.ROW_H;
        const gap  = Heatmap2DView.ROW_GAP;

        // SVG height is fixed by content, not by the container.
        const H = PT + 2 * rowH + gap + Heatmap2DView.SCALE_H + Heatmap2DView.FEAT_LABEL_H + PB;

        const svg = d3.select(this.containerId)
            .append('svg')
            .attr('width', W)
            .attr('height', H);

        this._svg = svg;

        const row1Y  = PT;
        const row2Y  = PT + rowH + gap;
        const labelW = Heatmap2DView.LABEL_W;
        const availW = W - PL - PR - labelW;

        // Single uniform rectW based on the larger of the two point counts,
        // so both rows use the same tile width and the scale bar aligns exactly.
        const maxN   = Math.max(valsA.length || 0, valsB.length || 0);
        const rectW  = maxN > 0 ? Math.max(2, Math.floor(availW / maxN)) : 4;
        const stripW = maxN * rectW;   // actual painted width — used for scale bar

        const ptLabel = this._pointFeatureLabel();

        this._drawRow(svg, valsA, this._fmtLabel(this._labelA), Heatmap2DView.COLOR_A,
                      colorScale, row1Y, rowH, rectW, labelW + PL, W - PR, ptLabel);
        this._drawRow(svg, valsB, this._fmtLabel(this._labelB), Heatmap2DView.COLOR_B,
                      colorScale, row2Y, rowH, rectW, labelW + PL, W - PR, ptLabel);

        // ── Colour-scale bar — spans exactly the tile strip ───────────
        const scaleBarX = labelW + PL;
        const scaleBarW = stripW;
        const scaleBarY = row2Y + rowH + 8;
        const scaleBarH = 10;

        const gradId = `h2d-grad-${Date.now()}`;
        const defs   = svg.append('defs');
        const grad   = defs.append('linearGradient')
            .attr('id', gradId)
            .attr('x1', '0%').attr('x2', '100%')
            .attr('y1', '0%').attr('y2', '0%');
        grad.append('stop').attr('offset', '0%')  .attr('stop-color', Heatmap2DView.COLOR_LOW);
        grad.append('stop').attr('offset', '100%').attr('stop-color', Heatmap2DView.COLOR_HIGH);

        svg.append('rect')
            .attr('x', scaleBarX).attr('y', scaleBarY)
            .attr('width', scaleBarW).attr('height', scaleBarH)
            .attr('fill', `url(#${gradId})`).attr('rx', 2);

        const minMaxY = scaleBarY + scaleBarH + 11;
        svg.append('text')
            .attr('x', scaleBarX).attr('y', minMaxY)
            .attr('text-anchor', 'start')
            .attr('font-size', 11).attr('fill', '#555')
            .text(lo.toFixed(4));
        svg.append('text')
            .attr('x', scaleBarX + scaleBarW).attr('y', minMaxY)
            .attr('text-anchor', 'end')
            .attr('font-size', 11).attr('fill', '#555')
            .text(hi.toFixed(4));

        // Point-feature name centred below the scale bar.
        svg.append('text')
            .attr('x', scaleBarX + scaleBarW / 2)
            .attr('y', minMaxY + 14)
            .attr('text-anchor', 'middle')
            .attr('font-size', 12)
            .attr('font-weight', 600)
            .attr('fill', '#333')
            .text(ptLabel);
    }

    /**
     * Draw one data row.
     * @param {object} label  — { top, bottom } strings for the two-line row label
     * @param {number} rectW  — width of each rect (computed per-row)
     * @param {number} labelW — x position where rects start
     * @param {number} W      — right edge of drawable area (for placeholder + tooltip clamp)
     * @param {string} ptLabel — human-readable point-feature name for tooltip
     */
    _drawRow(svg, vals, label, labelColor, colorScale, rowY, rowH, rectW, labelW, W, ptLabel) {
        const g = svg.append('g').attr('transform', `translate(0,${rowY})`);

        // Two-line label: "Episode X" on top, "Object ID: Y" below.
        g.append('text')
            .attr('x', labelW - 6).attr('y', rowH / 2 - 7)
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', 12)
            .attr('font-weight', 700)
            .attr('fill', labelColor)
            .text(label.top);

        if (label.bottom) {
            g.append('text')
                .attr('x', labelW - 6).attr('y', rowH / 2 + 7)
                .attr('text-anchor', 'end')
                .attr('dominant-baseline', 'middle')
                .attr('font-size', 11)
                .attr('font-weight', 400)
                .attr('fill', labelColor)
                .text(label.bottom);
        }

        if (!vals || vals.length === 0) {
            // No data — grey placeholder row.
            g.append('rect')
                .attr('x', labelW).attr('y', 0)
                .attr('width', W - labelW).attr('height', rowH)
                .attr('fill', '#e0e0e0').attr('rx', 2);
            g.append('text')
                .attr('x', labelW + (W - labelW) / 2).attr('y', rowH / 2)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('font-size', 11).attr('fill', '#999')
                .text('No trajectory selected');
            return;
        }

        const tip = svg.append('g').attr('class', 'h2d-tooltip').style('display', 'none');
        tip.append('rect')
            .attr('fill', 'rgba(0,0,0,0.7)').attr('rx', 3)
            .attr('width', 200).attr('height', 24);
        const tipTxt = tip.append('text')
            .attr('x', 6).attr('y', 16)
            .attr('font-size', 11).attr('fill', '#fff');

        vals.forEach((v, i) => {
            const rx   = labelW + i * rectW;
            const fill = (v == null || isNaN(v)) ? '#ccc' : colorScale(v);

            const rect = g.append('rect')
                .attr('x', rx).attr('y', 0)
                .attr('width', rectW - 1).attr('height', rowH)
                .attr('fill', fill)
                .attr('stroke', '#fff').attr('stroke-width', 0.5)
                .style('cursor', 'default');

            rect.on('mouseover', function(event) {
                    d3.select(this).attr('stroke', '#333').attr('stroke-width', 2).raise();
                    const displayVal = (v == null || isNaN(v)) ? 'N/A' : v.toFixed(4);
                    tipTxt.text(`${ptLabel}[${i + 1}]: ${displayVal}`);
                    tip.style('display', null);
                })
                .on('mousemove', function(event) {
                    const [mx, my] = d3.pointer(event, svg.node());
                    const svgW = +svg.attr('width');
                    const tx = Math.min(mx + 10, svgW - 210);
                    const ty = Math.max(my - 30, 2);
                    tip.attr('transform', `translate(${tx},${ty})`);
                })
                .on('mouseout', function() {
                    d3.select(this).attr('stroke', '#fff').attr('stroke-width', 0.5);
                    tip.style('display', 'none');
                });
        });
    }

    // ── Helpers ───────────────────────────────────────────────────

    /** Return all point values for the given column (no sampling). */
    _sample(data, col) {
        if (!data || data.length === 0) return [];
        return data.map(d => {
            const v = d[col];
            return (v == null || isNaN(v)) ? null : +v;
        });
    }

    /** Resolve trajectory-feature name prefix to point-column name. */
    _columnName() {
        if (!this._featureName) return null;
        const prefix = this._featureName.split('_')[0];
        return Heatmap2DView.PREFIX_TO_COLUMN[prefix] ?? null;
    }

    /** Human-readable point-feature label derived from the trajectory-feature name. */
    _pointFeatureLabel() {
        if (!this._featureName) return '';
        const prefix = this._featureName.split('_')[0];
        return Heatmap2DView.FEATURE_LABELS[prefix] ?? this._featureName;
    }
}
