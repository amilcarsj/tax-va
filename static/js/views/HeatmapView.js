/**
 * HeatmapView — renders the zone-frequency heatmap.
 *
 * Input data shape (from /api/zone-frequencies):
 *   {
 *     "Geometric Kinematic":      [count0, count1, count2, count3],
 *     "Acceleration Speed":       [...],
 *     ...
 *   }
 *
 * Layout: 7 rows (combinations) × 4 columns (zones).
 * Colour scale: yellow → red, driven by count value.
 * Minimum font size: 14px everywhere.
 *
 * Callback signature: onCellClick(combinationKey)
 */
class HeatmapView {

    static ROW_ORDER = [
        'Geometric Kinematic',
        'Acceleration Speed',
        'Curvature Indentation',
        'Curvature Speed',
        'Indentation Speed',
        'Acceleration Curvature',
        'Acceleration Indentation',
    ];

    static ZONE_LABELS = ['Zone 0', 'Zone 1', 'Zone 2', 'Zone 3'];
    static MIN_FONT    = 14;   // px
    static HIGHLIGHT   = '#0080FF80';   // blue stroke on selected row

    constructor(containerId, data, onCellClick) {
        this.containerId = containerId;
        this.onCellClick = onCellClick;
        this._currentRow = null;
        this._draw(data);
    }

    // ── Public API ────────────────────────────────────────────────

    highlightRow(combination) {
        this._currentRow = combination;
        if (!this.heatGroup) return;

        // Reset all strokes, then highlight matching row.
        this.heatGroup.selectAll('rect.cell')
            .attr('stroke', 'none')
            .attr('stroke-width', 0);

        this.heatGroup.selectAll('rect.cell')
            .filter(d => d.combination === combination)
            .attr('stroke', HeatmapView.HIGHLIGHT)
            .attr('stroke-width', 3)
            .attr('rx', 3).attr('ry', 3);
    }

    // ── Drawing ───────────────────────────────────────────────────

    _draw(rawData) {
        const container = document.querySelector(this.containerId);
        if (!container) return;
        container.innerHTML = '';

        const F          = HeatmapView.MIN_FONT;
        const totalW     = container.clientWidth  || 320;
        const totalH     = container.clientHeight || 320;

        // Margins: left must fit the longest y-axis label ("Acceleration Indentation").
        // Measured at 14px system-ui ≈ 165px; add a small buffer.
        const margin = { top: 28, right: 8, bottom: 6, left: 172 };

        const plotW  = totalW - margin.left - margin.right;
        const plotH  = totalH - margin.top  - margin.bottom;

        // Cell dimensions — allow scale to fill the plot area,
        // but cap so cells don't become huge on large screens.
        const cellW  = Math.min(plotW  / 4,  72);
        const cellH  = Math.min(plotH  / 7,  54);

        // Actual SVG dimensions based on capped cells.
        const svgW   = margin.left + cellW * 4 + margin.right;
        const svgH   = margin.top  + cellH * 7 + margin.bottom;

        // Scales
        const xScale = d3.scaleBand()
            .domain(HeatmapView.ZONE_LABELS)
            .range([0, cellW * 4])
            .padding(0.05);

        const yScale = d3.scaleBand()
            .domain(HeatmapView.ROW_ORDER)
            .range([0, cellH * 7])
            .padding(0.05);

        // Flatten data for D3
        const flat = [];
        HeatmapView.ROW_ORDER.forEach(combo => {
            const counts = rawData[combo] || [0, 0, 0, 0];
            HeatmapView.ZONE_LABELS.forEach((zone, zi) => {
                flat.push({ combination: combo, zone, value: counts[zi] });
            });
        });

        const allValues  = flat.map(d => d.value);
        const colorScale = d3.scaleLinear()
            .domain([d3.min(allValues), d3.max(allValues)])
            .range(['#ffffb2', '#e31a1c']);

        // SVG
        const svg = d3.select(this.containerId)
            .append('svg')
            .attr('width',  svgW)
            .attr('height', svgH);

        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);
        this.heatGroup = g;

        // ── Cells ────────────────────────────────────────────────

        g.selectAll('rect.cell')
            .data(flat)
            .join('rect')
            .attr('class', 'cell')
            .attr('x',      d => xScale(d.zone))
            .attr('y',      d => yScale(d.combination))
            .attr('width',  xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .attr('fill',   d => colorScale(d.value))
            .attr('stroke', 'none')
            .style('cursor', 'pointer')
            .on('click', (e, d) => this._handleClick(d));

        // ── Count labels ─────────────────────────────────────────

        g.selectAll('text.cell-label')
            .data(flat)
            .join('text')
            .attr('class', 'cell-label')
            .attr('x', d => xScale(d.zone) + xScale.bandwidth() / 2)
            .attr('y', d => yScale(d.combination) + yScale.bandwidth() / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', F)
            .attr('fill', 'black')
            .style('pointer-events', 'none')
            .text(d => d.value);

        // ── Axes ─────────────────────────────────────────────────

        g.append('g')
            .call(d3.axisLeft(yScale).tickSize(3))
            .selectAll('text')
            .style('font-size', `${F}px`);

        g.append('g')
            .call(d3.axisTop(xScale).tickSize(3))
            .selectAll('text')
            .style('font-size', `${F}px`);

        // Remove axis domain lines for a cleaner look.
        g.selectAll('.domain').remove();
    }

    // ── Interaction ───────────────────────────────────────────────

    _handleClick(d) {
        this.highlightRow(d.combination);
        this.onCellClick(d.combination);
    }
}
