/**
 * ZoneExplorerView — scatter plot for exploring trajectory zones.
 *
 * Layout: square scatter with D3 linear scales on [0,1]×[0,1].
 * Zone geometry drawn as filled polygons + boundary lines.
 * Two zone selectors (A = blue, B = red) are embedded in the SVG legend
 * above the plot via <foreignObject>, alongside the coloured dot and
 * selected trajectory info.
 * Clicking a circle in Zone A selects Trajectory A; Zone B → Trajectory B.
 * Changing a zone selector deselects only that zone's trajectory.
 * Points in non-selected zones are drawn in a lighter gray to signal
 * they are not available for selection.
 *
 * Callbacks: { onZoneAChange, onZoneBChange, onTrajectoryA, onTrajectoryB }
 */
class ZoneExplorerView {

    static ZONE_A_COLOR       = '#0080FF80';
    static ZONE_B_COLOR       = '#DC143C80';
    static BLOCKED_COLOR      = 'rgba(180, 140, 100, 0.38)';
    static UNSELECTABLE_COLOR = '#d0d0d0';   // points in non-selected zones
    static MIN_FONT           = 14;

    // Zone boundary polygons in normalised [0,1] coords.
    static ZONE_SHAPES = [
        [[0,0.5],[0.5,0.5],[0.5,0],[0,0],[0,0.5]],                           // 0
        [[0,0.5],[0.5,1],  [0,1],  [0,0.5]],                                  // 1
        [[0.5,0],[1,0.5],  [1,0],  [0.5,0]],                                  // 2
        [[0,0.5],[0.5,1],[1,1],[1,0.5],[0.5,0],[0.5,0.5],[0,0.5]],           // 3
    ];

    static ZONE_LABEL_POS = [
        [0.22, 0.22],
        [0.15, 0.85],
        [0.85, 0.15],
        [0.70, 0.70],
    ];

    static BOUNDARY_LINES = [
        { pts: [[0,0.5],[0.5,1]],            dashed: false },
        { pts: [[0,0.5],[0.5,0.5],[0.5,0]],  dashed: false },
        { pts: [[0.5,0],[1,0.5]],             dashed: false },
        { pts: [[0,0],[1,1]],                 dashed: true  },
    ];

    constructor(containerId, selectorAId, selectorBId, callbacks) {
        this.containerId = containerId;
        this.selectorAId = selectorAId;   // used as the id attr on the embedded <select>
        this.selectorBId = selectorBId;
        this.callbacks   = callbacks;

        this._zoneA = 1;
        this._zoneB = 2;
        this._selA  = null;   // d3 selection of highlighted circle (zone A)
        this._selB  = null;
        this._idA   = null;   // { tid, objectId } for zone A selection
        this._idB   = null;
        this._xLabel = null;
        this._yLabel = null;

        // SVG layers — recreated on each load()
        this._svg         = null;
        this._zoneGroup   = null;
        this._maskGroup   = null;
        this._lineGroup   = null;
        this._labelGroup  = null;
        this._circleGroup = null;
        this._legendGroup = null;
        this._xScale      = null;
        this._yScale      = null;
        this._lineGen     = null;
        this._size        = 0;
    }

    // ── Public API ────────────────────────────────────────────────

    /** Draw a new scatter for the given combination data. */
    load(data, xLabel, yLabel) {
        this._zoneA  = 1;
        this._zoneB  = 2;
        this._selA   = null;
        this._selB   = null;
        this._idA    = null;
        this._idB    = null;
        this._xLabel = xLabel;
        this._yLabel = yLabel;
        this._draw(data, xLabel, yLabel);
    }

    // ── Drawing ───────────────────────────────────────────────────

    _draw(data, xLabel, yLabel) {
        const container = document.querySelector(this.containerId);
        if (!container) return;
        container.innerHTML = '';

        const W      = container.clientWidth  || 300;
        const H      = container.clientHeight || 300;
        const margin = { top: 72, right: 20, bottom: 50, left: 55 };
        const plotW  = W - margin.left - margin.right;
        const plotH  = H - margin.top  - margin.bottom;
        const size   = Math.min(plotW, plotH);   // square plot area
        this._size   = size;

        // Centre the square horizontally; never let the left offset drop below
        // margin.left so the y-axis label always has room.
        const offsetX = Math.max(margin.left, Math.floor((W - size) / 2));

        this._xScale = d3.scaleLinear().domain([0, 1]).range([0, size]);
        this._yScale = d3.scaleLinear().domain([0, 1]).range([size, 0]);
        this._lineGen = d3.line()
            .x(d => this._xScale(d[0]))
            .y(d => this._yScale(d[1]));

        const svg = d3.select(this.containerId)
            .append('svg')
            .attr('width', W)
            .attr('height', H);
        this._svg = svg;

        const g = svg.append('g')
            .attr('transform', `translate(${offsetX},${margin.top})`);

        // Layers (bottom → top draw order)
        this._zoneGroup   = g.append('g').attr('class', 'ze-zone-fills');
        this._maskGroup   = g.append('g').attr('class', 'ze-masks');
        this._lineGroup   = g.append('g').attr('class', 'ze-boundary');
        this._labelGroup  = g.append('g').attr('class', 'ze-zone-labels');
        this._circleGroup = g.append('g').attr('class', 'ze-circles');
        this._legendGroup = g.append('g').attr('class', 'ze-legend');

        this._drawBoundaryLines();
        this._drawZoneNumberLabels();
        this._drawAxisElements(g, size, xLabel, yLabel);
        this._drawCircles(data);
        this._updateZoneColors();
        this._drawLegend();
    }

    _drawBoundaryLines() {
        ZoneExplorerView.BOUNDARY_LINES.forEach(({ pts, dashed }) => {
            this._lineGroup.append('path')
                .attr('d', this._lineGen(pts))
                .attr('fill', 'none')
                .attr('stroke', dashed ? '#aaa' : '#444')
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', dashed ? '6 3' : null)
                .attr('pointer-events', 'none');
        });
    }

    _drawZoneNumberLabels() {
        const labelSize = Math.max(ZoneExplorerView.MIN_FONT, Math.min(34, this._size * 0.12));
        ZoneExplorerView.ZONE_LABEL_POS.forEach(([px, py], i) => {
            this._labelGroup.append('text')
                .attr('x', this._xScale(px))
                .attr('y', this._yScale(py))
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('font-size', labelSize)
                .attr('fill', '#000')
                .attr('pointer-events', 'none')
                .text(String(i));
        });
    }

    _cap(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    _drawAxisElements(g, size, xLabel, yLabel) {
        const F = ZoneExplorerView.MIN_FONT;

        g.append('g')
            .attr('transform', `translate(0,${size})`)
            .call(d3.axisBottom(this._xScale).ticks(5))
            .selectAll('text').style('font-size', `${F}px`);

        g.append('g')
            .call(d3.axisLeft(this._yScale).ticks(5))
            .selectAll('text').style('font-size', `${F}px`);

        g.append('text')
            .attr('x', size / 2).attr('y', size + 42)
            .attr('text-anchor', 'middle')
            .attr('font-size', F)
            .text(this._cap(xLabel));

        g.append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -(size / 2)).attr('y', -42)
            .attr('text-anchor', 'middle')
            .attr('font-size', F)
            .text(this._cap(yLabel));
    }

    _drawCircles(data) {
        const self    = this;
        const tooltip = this._buildTooltip();

        this._circleGroup.selectAll('circle')
            .data(data)
            .join('circle')
            .attr('cx', d => this._xScale(d.x))
            .attr('cy', d => this._yScale(d.y))
            .attr('r', 4)
            .attr('fill', 'grey')
            .style('cursor', 'pointer')
            .on('click',     function(event, d) { self._handleClick(this, d); })
            .on('mouseover', function(event, d) {
                const z = self._zone(d.x, d.y);
                if (z !== self._zoneA && z !== self._zoneB) {
                    d3.select(this).style('cursor', 'not-allowed');
                } else if (d.id !== self._idA?.tid && d.id !== self._idB?.tid) {
                    d3.select(this).attr('r', 7);
                }
                tooltip.show(event, d);
            })
            .on('mousemove', (event) => tooltip.move(event))
            .on('mouseout',  function(event, d) {
                d3.select(this).style('cursor', 'pointer');
                if (d.id !== self._idA?.tid && d.id !== self._idB?.tid) {
                    d3.select(this).attr('r', 4);
                }
                tooltip.hide();
            });
    }

    _buildTooltip() {
        const tip = this._svg.append('g')
            .attr('class', 'ze-tooltip')
            .style('display', 'none')
            .style('pointer-events', 'none');

        tip.append('rect')
            .attr('width', 180).attr('height', 92)
            .attr('fill', 'rgba(40,40,40,0.82)')
            .attr('rx', 6);

        const txt = tip.append('text').attr('fill', 'white').attr('font-size', 12);
        ['tt0','tt1','tt2','tt3'].forEach((cls, i) => {
            txt.append('tspan').attr('class', cls).attr('x', 8).attr('y', 20 + i * 20);
        });

        const svgNode = this._svg.node();

        return {
            show: (event, d) => {
                tip.style('display', null);
                tip.select('.tt0').text(`Episode: ${d.id}`);
                tip.select('.tt1').text(`Object ID: ${d.object_id ?? '—'}`);
                tip.select('.tt2').text(`${this._cap(this._xLabel)}: ${d.x.toFixed(4)}`);
                tip.select('.tt3').text(`${this._cap(this._yLabel)}: ${d.y.toFixed(4)}`);
            },
            move: (event) => {
                const [mx, my] = d3.pointer(event, svgNode);
                const tx = Math.min(mx + 12, +this._svg.attr('width') - 190);
                const ty = Math.max(my - 100, 4);
                tip.attr('transform', `translate(${tx},${ty})`).raise();
            },
            hide: () => tip.style('display', 'none'),
        };
    }

    // ── Circle click ──────────────────────────────────────────────

    _handleClick(el, d) {
        const z = this._zone(d.x, d.y);
        if (z !== this._zoneA && z !== this._zoneB) return;

        const circ = d3.select(el);

        if (z === this._zoneA) {
            if (d.id === this._idA?.tid) {
                this._clearA(true);
            } else {
                this._clearA(false);
                this._selA = circ;
                this._idA  = { tid: d.id, objectId: d.object_id ?? null };
                circ.attr('fill', ZoneExplorerView.ZONE_A_COLOR).attr('r', 8).raise();
                this.callbacks.onTrajectoryA(d.id);
            }
        } else {
            if (d.id === this._idB?.tid) {
                this._clearB(true);
            } else {
                this._clearB(false);
                this._selB = circ;
                this._idB  = { tid: d.id, objectId: d.object_id ?? null };
                circ.attr('fill', ZoneExplorerView.ZONE_B_COLOR).attr('r', 8).raise();
                this.callbacks.onTrajectoryB(d.id);
            }
        }
        this._drawLegend();
    }

    /** Reset Zone A circle and optionally fire the trajectory callback. */
    _clearA(fireCallback) {
        if (this._selA) { this._selA.attr('r', 4); this._selA = null; }
        this._idA = null;
        if (fireCallback) this.callbacks.onTrajectoryA(null);
        this._updateCircleColors();
        this._drawLegend();
    }

    /** Reset Zone B circle and optionally fire the trajectory callback. */
    _clearB(fireCallback) {
        if (this._selB) { this._selB.attr('r', 4); this._selB = null; }
        this._idB = null;
        if (fireCallback) this.callbacks.onTrajectoryB(null);
        this._updateCircleColors();
        this._drawLegend();
    }

    // ── Zone coloring ─────────────────────────────────────────────

    _updateZoneColors() {
        if (!this._zoneGroup) return;
        this._zoneGroup.selectAll('*').remove();
        this._maskGroup.selectAll('*').remove();

        ZoneExplorerView.ZONE_SHAPES.forEach((shape, z) => {
            const path = (z === this._zoneA)
                ? this._zoneGroup.append('path').attr('fill', ZoneExplorerView.ZONE_A_COLOR)
                : (z === this._zoneB)
                    ? this._zoneGroup.append('path').attr('fill', ZoneExplorerView.ZONE_B_COLOR)
                    : this._maskGroup.append('path').attr('fill', ZoneExplorerView.BLOCKED_COLOR);

            path.attr('d', this._lineGen(shape) + 'Z')
                .attr('pointer-events', 'none');
        });

        this._updateCircleColors();

        // Keep circles and labels above the fills.
        if (this._circleGroup) this._circleGroup.raise();
        if (this._labelGroup)  this._labelGroup.raise();
        if (this._legendGroup) this._legendGroup.raise();
    }

    /**
     * Recolour all scatter circles based on zone membership and selection state.
     * Selected trajectories keep their A/B colour; points in non-selected zones
     * are drawn lighter to signal they cannot be clicked.
     */
    _updateCircleColors() {
        if (!this._circleGroup) return;
        const self = this;
        this._circleGroup.selectAll('circle').attr('fill', function(d) {
            if (d.id === self._idA?.tid) return ZoneExplorerView.ZONE_A_COLOR;
            if (d.id === self._idB?.tid) return ZoneExplorerView.ZONE_B_COLOR;
            const z = self._zone(d.x, d.y);
            return (z === self._zoneA || z === self._zoneB)
                ? 'grey'
                : ZoneExplorerView.UNSELECTABLE_COLOR;
        });
    }

    // ── Legend (zone selectors + trajectory IDs above the plot) ──

    /**
     * Draws two legend rows above the scatter plot. Each row contains:
     *   "A:" / "B:" label  →  embedded <select> for zone choice
     *                      →  coloured dot  →  episode + object-id text
     *
     * The <select> elements are embedded via SVG <foreignObject> so they
     * stay inside the SVG coordinate system. Event handlers are attached
     * inline each redraw (since the elements are recreated on every call).
     */
    _drawLegend() {
        if (!this._legendGroup) return;
        this._legendGroup.selectAll('*').remove();

        const F = ZoneExplorerView.MIN_FONT;
        const fmtId = (sel) => sel
            ? `Episode ${sel.tid}, Object ID: ${sel.objectId ?? '—'}`
            : '—';

        const rows = [
            {
                color:        ZoneExplorerView.ZONE_A_COLOR,
                label:        fmtId(this._idA),
                selectId:     this.selectorAId,
                currentZone:  this._zoneA,
                disabledZone: this._zoneB,
                onChange: (e) => {
                    this._zoneA = parseInt(e.target.value);
                    this._clearA(true);
                    this._updateZoneColors();
                    this.callbacks.onZoneAChange(this._zoneA);
                },
            },
            {
                color:        ZoneExplorerView.ZONE_B_COLOR,
                label:        fmtId(this._idB),
                selectId:     this.selectorBId,
                currentZone:  this._zoneB,
                disabledZone: this._zoneA,
                onChange: (e) => {
                    this._zoneB = parseInt(e.target.value);
                    this._clearB(true);
                    this._updateZoneColors();
                    this.callbacks.onZoneBChange(this._zoneB);
                },
            },
        ];

        rows.forEach(({ color, label, selectId, currentZone, disabledZone, onChange }, i) => {
            // rowY is relative to the plot group (translated by margin.top=72).
            // A: rowY=-52 → absolute SVG y=20;  B: rowY=-26 → absolute SVG y=46
            const rowY = -52 + i * 26;

            // Zone <select> embedded via <foreignObject>
            const fo = this._legendGroup.append('foreignObject')
                .attr('x', 0).attr('y', rowY - 10)
                .attr('width', 62).attr('height', 22);

            const sel = document.createElementNS('http://www.w3.org/1999/xhtml', 'select');
            if (selectId) sel.id = selectId;
            sel.style.cssText =
                'font-size:12px;width:60px;height:20px;' +
                'border:1px solid #ccc;border-radius:3px;box-sizing:border-box;';
            [0, 1, 2, 3].forEach(z => {
                const opt = document.createElement('option');
                opt.value = z;
                opt.textContent = `Z ${z}`;
                opt.disabled = (z === disabledZone);
                if (z === currentZone) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.onchange = onChange;
            fo.node().appendChild(sel);

            // Coloured dot
            this._legendGroup.append('circle')
                .attr('cx', 70).attr('cy', rowY).attr('r', 5)
                .attr('fill', color)
                .attr('pointer-events', 'none');

            // Episode / Object ID text
            this._legendGroup.append('text')
                .attr('x', 82).attr('y', rowY + 5)
                .attr('font-size', F)
                .attr('fill', '#333')
                .attr('pointer-events', 'none')
                .text(label);
        });
    }

    // ── Zone classifier ───────────────────────────────────────────

    _zone(x, y) {
        if (x < 0.5 && y < 0.5) return 0;
        if (x < 0.5 && y > 0.5 && x < (y - 0.5)) return 1;
        if (x > 0.5 && y < (x - 0.5)) return 2;
        return 3;
    }
}
