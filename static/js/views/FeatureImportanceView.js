/**
 * FeatureImportanceView — horizontal bar chart of Random Forest feature importances.
 *
 * Layout: two columns (X-axis group = blue, Y-axis group = red).
 * Each row: feature name | proportional bar | importance value.
 * Clicking a row highlights it gold and fires onFeatureSelect(featureName).
 * Clicking the same row again deselects it.
 *
 * Rendered into a scrollable card-body, so height is unconstrained.
 */
class FeatureImportanceView {

    static ZONE_A_COLOR  = '#0080FF80';   // blue  — X-axis group header
    static ZONE_B_COLOR  = '#DC143C80';   // red   — Y-axis group header
    static HIGHLIGHT     = 'gold';
    static MIN_FONT      = 14;
    static BAR_H         = 10;
    static ROW_H         = 18;            // vertical spacing per row
    static HEADER_H      = 24;

    constructor(containerId, onFeatureSelect) {
        this.containerId     = containerId;
        this.onFeatureSelect = onFeatureSelect;
        this._selectedFeature = null;
    }

    // ── Public API ────────────────────────────────────────────────

    render(data) {
        const container = document.querySelector(this.containerId);
        if (!container) return;
        container.innerHTML = '';
        this._selectedFeature = null;
        this._draw(container, data);
    }

    clear() {
        const container = document.querySelector(this.containerId);
        if (!container) return;
        container.innerHTML =
            '<span class="placeholder-text">Select a combination in the Taxonomy or Heatmap to see feature importance.</span>';
        this._selectedFeature = null;
    }

    // ── Drawing ───────────────────────────────────────────────────

    _draw(container, data) {
        const { features, accuracy, f1, x_label, y_label } = data;

        const F  = FeatureImportanceView.MIN_FONT;
        const RH = FeatureImportanceView.ROW_H;
        const BH = FeatureImportanceView.BAR_H;
        const HH = FeatureImportanceView.HEADER_H;

        // Split into X and Y groups (preserving rank order within each).
        const xFeats = features.filter(d => d.group === 'x');
        const yFeats = features.filter(d => d.group === 'y');
        const maxRows = Math.max(xFeats.length, yFeats.length);

        // Measure available width from the container.
        const W = container.clientWidth || 300;

        // Layout fractions of total width:
        //   [label | bar | value]  [label | bar | value]
        //   each half = W/2; within each half: label 45%, bar 35%, value 20%
        const halfW     = Math.floor(W / 2);
        const labelW    = Math.floor(halfW * 0.44);
        const barMaxW   = Math.floor(halfW * 0.32);
        const valueW    = Math.floor(halfW * 0.22);

        const svgH = HH + maxRows * RH + 28;   // header + rows + stats strip

        const svg = d3.select(this.containerId)
            .append('svg')
            .attr('width', W)
            .attr('height', svgH);

        // ── Stats strip (accuracy + F1) ───────────────────────────
        const stats = svg.append('g').attr('class', 'fi-stats');
        stats.append('text')
            .attr('x', 6).attr('y', F)
            .attr('font-size', F)
            .attr('font-weight', 600)
            .text(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
        stats.append('text')
            .attr('x', W / 2).attr('y', F)
            .attr('font-size', F)
            .attr('font-weight', 600)
            .text(`F1: ${(f1 * 100).toFixed(1)}%`);

        // ── Column headers ────────────────────────────────────────
        const headers = svg.append('g')
            .attr('class', 'fi-headers')
            .attr('transform', `translate(0,${F + 4})`);

        this._drawHeader(headers, 0,     halfW, x_label, FeatureImportanceView.ZONE_A_COLOR, HH);
        this._drawHeader(headers, halfW, halfW, y_label, FeatureImportanceView.ZONE_B_COLOR, HH);

        // ── Shared importance scale ───────────────────────────────
        const maxImp = d3.max(features, d => d.importance) || 1;
        const barScale = d3.scaleLinear().domain([0, maxImp]).range([0, barMaxW]);

        // ── Rows ──────────────────────────────────────────────────
        const rowsG = svg.append('g')
            .attr('class', 'fi-rows')
            .attr('transform', `translate(0,${F + 4 + HH})`);

        const self = this;

        [xFeats, yFeats].forEach((feats, col) => {
            const xOff = col * halfW;

            feats.forEach((d, i) => {
                const y = i * RH;

                const row = rowsG.append('g')
                    .attr('class', 'fi-row')
                    .attr('transform', `translate(${xOff},${y})`)
                    .style('cursor', 'pointer')
                    .on('click', function() { self._handleRowClick(this, d.name); });

                // Highlight background (hidden by default).
                row.append('rect')
                    .attr('class', 'fi-highlight')
                    .attr('x', 2).attr('y', 1)
                    .attr('width', halfW - 4).attr('height', RH - 2)
                    .attr('fill', FeatureImportanceView.HIGHLIGHT)
                    .attr('rx', 2)
                    .attr('opacity', 0);

                // Feature name label (truncated to fit).
                row.append('text')
                    .attr('x', 4).attr('y', RH - 5)
                    .attr('font-size', 11)
                    .attr('fill', '#222')
                    .text(self._truncate(d.name, labelW, 11));

                // Bar.
                row.append('rect')
                    .attr('x', labelW + 2)
                    .attr('y', (RH - BH) / 2)
                    .attr('width', barScale(d.importance))
                    .attr('height', BH)
                    .attr('fill', col === 0
                        ? FeatureImportanceView.ZONE_A_COLOR
                        : FeatureImportanceView.ZONE_B_COLOR)
                    .attr('pointer-events', 'none');

                // Importance value.
                row.append('text')
                    .attr('x', labelW + barMaxW + 4)
                    .attr('y', RH - 5)
                    .attr('font-size', 11)
                    .attr('font-weight', 700)
                    .attr('fill', '#222')
                    .text(d.importance.toFixed(4));
            });
        });

        // Vertical divider between columns.
        svg.append('line')
            .attr('x1', halfW).attr('x2', halfW)
            .attr('y1', F + 4).attr('y2', svgH)
            .attr('stroke', '#ddd')
            .attr('stroke-width', 1);
    }

    _drawHeader(g, x, w, label, color, h) {
        g.append('rect')
            .attr('x', x + 2).attr('y', 0)
            .attr('width', w - 4).attr('height', h - 2)
            .attr('fill', color)
            .attr('rx', 3);
        g.append('text')
            .attr('x', x + w / 2).attr('y', h - 7)
            .attr('text-anchor', 'middle')
            .attr('font-size', FeatureImportanceView.MIN_FONT)
            .attr('font-weight', 700)
            .attr('fill', '#111')
            .text(label);
    }

    // ── Row click ─────────────────────────────────────────────────

    _handleRowClick(rowEl, featureName) {
        const svg = d3.select(this.containerId).select('svg');

        if (featureName === this._selectedFeature) {
            // Deselect.
            d3.select(rowEl).select('.fi-highlight').attr('opacity', 0);
            this._selectedFeature = null;
            this.onFeatureSelect(null);
            return;
        }

        // Clear previous highlight.
        svg.selectAll('.fi-highlight').attr('opacity', 0);

        // Highlight new selection.
        d3.select(rowEl).select('.fi-highlight').attr('opacity', 1);
        this._selectedFeature = featureName;
        this.onFeatureSelect(featureName);
    }

    // ── Helpers ───────────────────────────────────────────────────

    /** Truncate text so it fits within maxPx at the given font size (~0.6 ratio). */
    _truncate(text, maxPx, fontSize) {
        const approxCharW = fontSize * 0.58;
        const maxChars    = Math.floor(maxPx / approxCharW);
        return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + '…';
    }
}
