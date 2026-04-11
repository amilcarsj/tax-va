/**
 * AppController — owns the single application state object.
 * All other controllers communicate through this class.
 * No rendering happens here; this is pure state management.
 */
class AppController {
    constructor() {
        this.state = {
            dataset:      'fox',
            combination:  null,   // e.g. "Geometric Kinematic"
            xAxis:        null,   // alphabetically first of the two node names
            yAxis:        null,   // alphabetically second
            zoneA:        1,
            zoneB:        2,
            trajectoryA:  null,
            trajectoryB:  null,
            activeFeature: null,
            viewMode:     '3D',
        };

        // Subscribers for each state key (key → [callback, ...])
        this._listeners = {};
    }

    // ── Subscription ──────────────────────────────────────────────
    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }

    _emit(event, payload) {
        (this._listeners[event] || []).forEach(cb => cb(payload));
    }

    // ── State transitions ─────────────────────────────────────────

    /**
     * Called when the user selects a taxonomy combination (tree or heatmap).
     * Resets all downstream state: zones return to defaults, trajectories/feature cleared.
     * @param {string} a  – alphabetically first node name
     * @param {string} b  – alphabetically second node name
     */
    setCombination(a, b) {
        const [sortedA, sortedB] = [a, b].sort();
        this.state.combination  = `${sortedA} ${sortedB}`;
        this.state.xAxis        = sortedA;
        this.state.yAxis        = sortedB;
        this.state.zoneA        = 1;
        this.state.zoneB        = 2;
        this.state.trajectoryA  = null;
        this.state.trajectoryB  = null;
        this.state.activeFeature = null;
        this._emit('combinationChanged', { ...this.state });
    }

    /** Zone A changed — clears only Trajectory A. */
    setZoneA(zone) {
        this.state.zoneA       = zone;
        this.state.trajectoryA = null;
        this._emit('zoneAChanged', { ...this.state });
    }

    /** Zone B changed — clears only Trajectory B. */
    setZoneB(zone) {
        this.state.zoneB       = zone;
        this.state.trajectoryB = null;
        this._emit('zoneBChanged', { ...this.state });
    }

    setTrajectoryA(id) {
        this.state.trajectoryA = id;
        this._emit('trajectoryAChanged', { ...this.state });
    }

    setTrajectoryB(id) {
        this.state.trajectoryB = id;
        this._emit('trajectoryBChanged', { ...this.state });
    }

    setActiveFeature(featureId) {
        this.state.activeFeature = featureId;
        this._emit('featureChanged', { ...this.state });
    }

    setViewMode(mode) {
        this.state.viewMode = mode;
        this._emit('viewModeChanged', { ...this.state });
    }

    setDataset(dataset) {
        this.state.dataset      = dataset;
        this.state.combination  = null;
        this.state.xAxis        = null;
        this.state.yAxis        = null;
        this.state.zoneA        = 1;
        this.state.zoneB        = 2;
        this.state.trajectoryA  = null;
        this.state.trajectoryB  = null;
        this.state.activeFeature = null;
        this._emit('datasetChanged', { ...this.state });
    }
}
