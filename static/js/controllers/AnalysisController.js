/**
 * AnalysisController — wires TaxonomyView, HeatmapView, ZoneExplorerView,
 * and FeatureImportanceView together.
 *
 * Responsibilities:
 *  1. Fetch zone-frequency data on boot → render Taxonomy + Heatmap.
 *  2. Cross-panel sync:
 *       tree selection  → heatmap highlight + zone explorer load + FI
 *       heatmap click   → tree selection   + zone explorer load + FI
 *  3. Zone dropdown changes → re-compute Feature Importance for new pair.
 *  4. Forward zone/trajectory/feature events to AppController.
 */
class AnalysisController {

    constructor(appController) {
        this.app              = appController;
        this.taxonomy         = null;
        this.heatmap          = null;
        this.zoneExplorer     = null;
        this.featureImportance = null;
        this._boot();
    }

    // ── Boot ──────────────────────────────────────────────────────

    async _boot() {
        const dataset = this.app.state.dataset;
        let zoneData;

        try {
            const res = await fetch(`/api/zone-frequencies?dataset=${dataset}`);
            zoneData  = await res.json();
        } catch (err) {
            console.error('Failed to load zone frequencies:', err);
            return;
        }

        this.zoneData = zoneData;

        // Taxonomy tree
        this.taxonomy = new TaxonomyView(
            '#taxonomy-body',
            (a, b) => this._onTreeSelection(a, b)
        );

        // Heatmap
        this.heatmap = new HeatmapView(
            '#heatmap-body',
            zoneData,
            (combination) => this._onHeatmapClick(combination)
        );

        // Zone Explorer — zone changes re-trigger FI
        this.zoneExplorer = new ZoneExplorerView(
            '#zone-explorer-body',
            'zone-select-a',
            'zone-select-b',
            {
                onZoneAChange: (z) => {
                    this.app.setZoneA(z);
                    this._loadFeatureImportance();
                },
                onZoneBChange: (z) => {
                    this.app.setZoneB(z);
                    this._loadFeatureImportance();
                },
                onTrajectoryA: (id) => this.app.setTrajectoryA(id),
                onTrajectoryB: (id) => this.app.setTrajectoryB(id),
            }
        );

        // Feature Importance panel
        this.featureImportance = new FeatureImportanceView(
            '#feature-importance-body',
            (featureName) => this.app.setActiveFeature(featureName)
        );

        this.app.on('datasetChanged', () => this._reload());
    }

    // ── Dataset reload ────────────────────────────────────────────

    async _reload() {
        const dataset = this.app.state.dataset;
        let zoneData;
        try {
            const res = await fetch(`/api/zone-frequencies?dataset=${dataset}`);
            zoneData  = await res.json();
        } catch (err) {
            console.error('Failed to reload zone frequencies:', err);
            return;
        }
        this.zoneData = zoneData;

        document.querySelector('#taxonomy-body').innerHTML = '';
        document.querySelector('#heatmap-body').innerHTML  = '';

        this.taxonomy = new TaxonomyView(
            '#taxonomy-body',
            (a, b) => this._onTreeSelection(a, b)
        );
        this.heatmap = new HeatmapView(
            '#heatmap-body',
            zoneData,
            (combination) => this._onHeatmapClick(combination)
        );

        document.querySelector('#zone-explorer-body').innerHTML =
            '<span class="placeholder-text">Select a combination in the Taxonomy or Heatmap to load the Zone Explorer.</span>';

        this.featureImportance.clear();
    }

    // ── Cross-panel callbacks ─────────────────────────────────────

    /** Fired when two nodes are selected in the tree. */
    _onTreeSelection(a, b) {
        const key = `${a} ${b}`;    // already sorted by TaxonomyView
        this.heatmap.highlightRow(key);
        this.app.setCombination(a, b);
        this._loadZoneExplorer(key);
    }

    /** Fired when a heatmap cell is clicked. */
    _onHeatmapClick(combination) {
        const [a, b] = combination.split(' ');
        this.taxonomy.setSelection(a, b);
        this.app.setCombination(a, b);
        this._loadZoneExplorer(combination);
    }

    // ── Data loading ──────────────────────────────────────────────

    async _loadZoneExplorer(combination) {
        const dataset = this.app.state.dataset;
        try {
            const res  = await fetch(
                `/api/scatter-data?dataset=${dataset}&combination=${encodeURIComponent(combination)}`
            );
            const json = await res.json();
            this.zoneExplorer.load(json.data, json.x_label, json.y_label);
        } catch (err) {
            console.error('Failed to load scatter data:', err);
            return;
        }

        // Immediately compute FI for the default zones (1 vs 2).
        this._loadFeatureImportance();
    }

    async _loadFeatureImportance() {
        const { dataset, combination, zoneA, zoneB } = this.app.state;
        if (!combination) return;

        const url = `/api/feature-importance?dataset=${dataset}`
            + `&combination=${encodeURIComponent(combination)}`
            + `&zoneA=${zoneA}&zoneB=${zoneB}`;

        try {
            const res  = await fetch(url);
            const json = await res.json();
            if (json.error) {
                console.error('Feature importance error:', json.error);
                return;
            }
            this.featureImportance.render(json);
        } catch (err) {
            console.error('Failed to load feature importance:', err);
        }
    }
}
