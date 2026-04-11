/**
 * MapController — manages 3D and 2D map views plus the 2D heatmap strip.
 *
 * Subscribes to AppController events:
 *   trajectoryAChanged → fetch points → load mapA (3D+2D), update heatmap strip
 *   trajectoryBChanged → fetch points → load mapB (3D+2D), update heatmap strip
 *   featureChanged     → re-colour all maps, re-render heatmap strip
 *   zoneAChanged       → clear map A (3D+2D), clear heatmap strip row A
 *   zoneBChanged       → clear map B (3D+2D), clear heatmap strip row B
 *   combinationChanged → clear all maps + heatmap strip
 *   viewModeChanged    → toggle visible panels, resize maps
 *
 * Also wires the #view-switcher <select> to app.setViewMode().
 */
class MapController {

    constructor(appController) {
        this.app = appController;

        // 3D maps (always in DOM, shown/hidden by view mode).
        this.mapA3D = new MapView('map-1',    'A', '3D');
        this.mapB3D = new MapView('map-2',    'B', '3D');

        // 2D maps (inside #maps-row, shown in 2D mode).
        this.mapA2D = new MapView('map-1-2d', 'A', '2D');
        this.mapB2D = new MapView('map-2-2d', 'B', '2D');

        // 2D heatmap strip (inside #heatmap-2d).
        this.heatmap2D = new Heatmap2DView('#heatmap-2d');

        // Cached point data so mode-switches don't require a re-fetch.
        this._dataA = null;
        this._dataB = null;

        this._wireViewSwitcher();
        this._subscribe();
    }

    // ── View switcher ─────────────────────────────────────────────

    _wireViewSwitcher() {
        const sel = document.getElementById('view-switcher');
        if (!sel) return;
        sel.addEventListener('change', e => {
            this.app.setViewMode(e.target.value);
        });
    }

    // ── Subscriptions ─────────────────────────────────────────────

    _subscribe() {
        this.app.on('trajectoryAChanged', s => this._onTrajectoryA(s));
        this.app.on('trajectoryBChanged', s => this._onTrajectoryB(s));
        this.app.on('featureChanged',     s => this._onFeature(s));
        this.app.on('zoneAChanged',       ()  => this._clearA());
        this.app.on('zoneBChanged',       ()  => this._clearB());
        this.app.on('combinationChanged', ()  => this._clearAll());
        this.app.on('viewModeChanged',    s  => this._onViewMode(s));
    }

    // ── View mode ─────────────────────────────────────────────────

    _onViewMode({ viewMode }) {
        const view3d     = document.getElementById('view-3d');
        const heatmap2d  = document.getElementById('heatmap-2d');
        const mapsRow    = document.getElementById('maps-row');

        if (viewMode === '2D') {
            if (view3d)    view3d.style.display    = 'none';
            if (heatmap2d) heatmap2d.style.display = 'flex';
            if (mapsRow)   mapsRow.style.display   = 'flex';

            // Resize 2D maps after layout settles.
            setTimeout(() => {
                if (this.mapA2D.map) this.mapA2D.map.resize();
                if (this.mapB2D.map) this.mapB2D.map.resize();
            }, 80);

            // Re-render strip if feature is already active.
            this.heatmap2D.render();

        } else {
            if (view3d)    view3d.style.display    = 'flex';
            if (heatmap2d) heatmap2d.style.display = 'none';
            if (mapsRow)   mapsRow.style.display   = 'none';

            setTimeout(() => {
                if (this.mapA3D.map) this.mapA3D.map.resize();
                if (this.mapB3D.map) this.mapB3D.map.resize();
            }, 80);
        }
    }

    // ── Trajectory handlers ───────────────────────────────────────

    async _onTrajectoryA(state) {
        if (!state.trajectoryA) { this._clearA(); return; }
        const result = await this._fetchPoints(state.dataset, state.trajectoryA);
        if (!result) return;

        const { data, objectId } = result;
        this._dataA = data;
        this._setMapLabel('A', state.trajectoryA, objectId);
        this.heatmap2D.setTrajectoryA(data);
        this.heatmap2D.setLabelA(state.trajectoryA, objectId);

        this.mapA3D.setFeature(state.activeFeature);
        this.mapA2D.setFeature(state.activeFeature);
        await Promise.all([this.mapA3D.load(data), this.mapA2D.load(data)]);

        this._pushSharedScales();
        this.heatmap2D.render();
    }

    async _onTrajectoryB(state) {
        if (!state.trajectoryB) { this._clearB(); return; }
        const result = await this._fetchPoints(state.dataset, state.trajectoryB);
        if (!result) return;

        const { data, objectId } = result;
        this._dataB = data;
        this._setMapLabel('B', state.trajectoryB, objectId);
        this.heatmap2D.setTrajectoryB(data);
        this.heatmap2D.setLabelB(state.trajectoryB, objectId);

        this.mapB3D.setFeature(state.activeFeature);
        this.mapB2D.setFeature(state.activeFeature);
        await Promise.all([this.mapB3D.load(data), this.mapB2D.load(data)]);

        this._pushSharedScales();
        this.heatmap2D.render();
    }

    // ── Feature handler ───────────────────────────────────────────

    _onFeature({ activeFeature }) {
        this.mapA3D.setFeature(activeFeature);
        this.mapB3D.setFeature(activeFeature);
        this.mapA2D.setFeature(activeFeature);
        this.mapB2D.setFeature(activeFeature);

        this.heatmap2D.setFeature(activeFeature);
        this.heatmap2D.render();
    }

    // ── Shared colour-scale domain ────────────────────────────────

    /**
     * Compute the combined [lo, hi] domain for each feature type across
     * both loaded trajectories and push it to all four MapView instances.
     * This ensures the map colours match the Heatmap2DView scale exactly.
     */
    _pushSharedScales() {
        const datasets = [this._dataA, this._dataB].filter(Boolean);
        MapView.LAYER_TYPES.forEach(type => {
            const vals = datasets.flatMap(d => d.map(p => p[type]))
                                 .filter(v => v != null && !isNaN(v));
            if (vals.length === 0) return;
            const lo = Math.min(...vals);
            const hi = Math.max(...vals);
            [this.mapA3D, this.mapB3D, this.mapA2D, this.mapB2D].forEach(m => {
                m.setScaleDomain(type, lo, hi);
            });
        });
    }

    // ── Clear helpers ─────────────────────────────────────────────

    _clearA() {
        this._dataA = null;
        this._setMapLabel('A', null, null);
        this.mapA3D.clear();
        this.mapA2D.clear();
        this.heatmap2D.setTrajectoryA(null);
        this.heatmap2D.setLabelA(null, null);
        this._pushSharedScales();
        this.heatmap2D.render();
    }

    _clearB() {
        this._dataB = null;
        this._setMapLabel('B', null, null);
        this.mapB3D.clear();
        this.mapB2D.clear();
        this.heatmap2D.setTrajectoryB(null);
        this.heatmap2D.setLabelB(null, null);
        this._pushSharedScales();
        this.heatmap2D.render();
    }

    _clearAll() {
        this._dataA = null;
        this._dataB = null;
        this._setMapLabel('A', null, null);
        this._setMapLabel('B', null, null);
        this.mapA3D.clear(); this.mapB3D.clear();
        this.mapA2D.clear(); this.mapB2D.clear();
        this.heatmap2D.setTrajectoryA(null);
        this.heatmap2D.setTrajectoryB(null);
        this.heatmap2D.setLabelA(null, null);
        this.heatmap2D.setLabelB(null, null);
        this.heatmap2D.clear();
    }

    // ── Map label helpers ─────────────────────────────────────────

    _setMapLabel(slot, tid, objectId) {
        const text = tid != null
            ? `Episode ${tid}, Object ID: ${objectId ?? '—'}`
            : '—';
        const suffix = slot === 'A' ? '1' : '2';
        const el3d = document.getElementById(`map-label-${suffix}`);
        const el2d = document.getElementById(`map-label-${suffix}-2d`);
        if (el3d) el3d.textContent = text;
        if (el2d) el2d.textContent = text;
    }

    // ── Data fetching ─────────────────────────────────────────────

    async _fetchPoints(dataset, tid) {
        try {
            const res  = await fetch(`/api/trajectory-points?dataset=${dataset}&tid=${tid}`);
            const json = await res.json();
            if (json.error) {
                console.error('trajectory-points error:', json.error);
                return null;
            }
            return { data: json.data, objectId: json.object_id ?? null };
        } catch (err) {
            console.error('Failed to fetch trajectory points:', err);
            return null;
        }
    }
}
