/**
 * MapView — 3-D trajectory visualisation using MapLibre GL + Deck.GL.
 *
 * Default (no feature selected):
 *   Five PolygonLayers are rendered, one per point-feature type
 *   (speed, acceleration, distance, angle, bearing).  Each is stacked at a
 *   different z-offset so they appear as a multi-ribbon wall.  Every layer is
 *   independently coloured by its own yellow→red scale.
 *
 * Feature selected (e.g. 'speed_mean'):
 *   All five layers remain.  The layer whose type prefix matches the selected
 *   feature keeps its full colour; the other four are shaded grey.
 *   A PathLayer and directional IconLayer are added on top.
 *
 * Public API:
 *   load(data)          — point array [{lat,lon,speed,acceleration,...}]
 *   setFeature(name)    — re-colour with a new feature (or null = all-layers mode)
 *   clear()             — remove Deck.GL layers, keep base map
 */
class MapView {

    static LAYER_TYPES    = ['speed', 'acceleration', 'distance', 'angle'];
    static ELEV_MIN       = 50;        // minimum wall height (m) — fine-grained tracks
    static ELEV_MAX       = 500_000;   // maximum wall height (m) — coarse GPS tracks
    static ELEV_RATIO     = 0.5;       // elevation = mean segment length × this ratio
    static COLOR_LOW      = [255, 255, 204];
    static COLOR_HIGH   = [227, 26, 28];
    static COLOR_SHADE  = [211, 211, 211, 100];  // inactive-layer tint
    static PATH_W       = 80;          // PathLayer width in metres
    static ZOOM_3D      = 6;
    static PITCH_3D     = 60;
    static BEARING_3D   = 30;
    static ZOOM_2D      = 3;
    static PITCH_2D     = 0;
    static BEARING_2D   = 0;
    static ARROW_URL    = '/static/img/arrow.png';

    // Maps trajectory-feature name prefixes to point-feature column names.
    // Needed because traj-feat columns use 'angles_*' while the point-feat
    // column is 'angle', and 'distance_geometry_*' splits to 'distance'.
    static PREFIX_TO_COLUMN = {
        'speed':        'speed',
        'acceleration': 'acceleration',
        'distance':     'distance',
        'angles':       'angle',
        'angle':        'angle',
    };

    // Human-readable labels for tooltip, keyed by resolved point-column name.
    static FEATURE_LABELS = {
        'speed':        'Speed',
        'acceleration': 'Acceleration',
        'distance':     'Curvature (distance_geometry)',
        'angle':        'Indentation (angles)',
    };

    // SVG data-URL fallback arrow used when the PNG is unavailable.
    static ARROW_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
        '<polygon points="32,4 60,60 32,44 4,60" fill="%230000ff" opacity="0.85"/></svg>'
    )}`;

    constructor(containerId, label, mode = '3D') {
        this.containerId    = containerId;   // bare id, no '#'
        this.label          = label;         // 'A' or 'B'
        this.mode           = mode;          // '3D' or '2D'
        this._map           = null;
        this._deckOverlay   = null;
        this._data          = null;          // raw point array
        this._wallData      = null;          // derived segment array
        this._activeFeature = null;          // e.g. 'speed_mean', or null
        this._arrowUrl      = MapView.ARROW_URL;
        // Pre-computed color scales, one per layer type — rebuilt on each load().
        this._scales        = {};
        // External [lo, hi] overrides per type — set by MapController so both
        // maps share the same domain and match the Heatmap2DView scale.
        this._domainOverrides = {};
        this._elevation     = MapView.ELEV_MIN;   // set dynamically in load()
        this._zStep         = this._elevation * 1.1;
    }

    // ── Public API ────────────────────────────────────────────────

    async load(data) {
        this._data      = data;
        this._wallData  = this.mode === '3D' ? this._buildWallData(data) : null;
        this._elevation = this._computeElevation(data);
        this._zStep     = this._elevation * 1.1;
        this._scales    = this._buildScales();
        await this._ensureMap();
        this._fitBounds(data);
        this._render();
    }

    setFeature(featureName) {
        this._activeFeature = featureName || null;
        const hasData = this.mode === '3D' ? !!this._wallData : !!this._data;
        if (this._deckOverlay && hasData) this._render();
    }

    clear() {
        this._data      = null;
        this._wallData  = null;
        this._scales    = {};
        this._elevation = MapView.ELEV_MIN;
        this._zStep     = this._elevation * 1.1;
        if (this._deckOverlay) {
            this._deckOverlay.setProps({ layers: [] });
        }
    }

    // ── Map initialisation ────────────────────────────────────────

    async _ensureMap() {
        if (this._map) return;

        this._map = new maplibregl.Map({
            container:   this.containerId,
            style: {
                version: 8,
                sources: {
                    osm: {
                        type:     'raster',
                        tiles:    ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                        tileSize: 256,
                    },
                },
                layers: [{
                    id:      'osm',
                    type:    'raster',
                    source:  'osm',
                    minzoom: 0,
                    maxzoom: 19,
                }],
            },
            center:               [0, 30],
            zoom:                 this.mode === '2D' ? MapView.ZOOM_2D    : MapView.ZOOM_3D,
            pitch:                this.mode === '2D' ? MapView.PITCH_2D   : MapView.PITCH_3D,
            bearing:              this.mode === '2D' ? MapView.BEARING_2D : MapView.BEARING_3D,
            antialias:            true,
            maxPitch:             85,
            preserveDrawingBuffer: true,
        });

        this._deckOverlay = new deck.MapboxOverlay({
            layers: [],
            getTooltip: ({ object, index }) => {
                if (!object || !this._activeFeature) return null;
                const type = this._featureType();
                if (!type) return null;
                const v = object[type];
                if (v == null || isNaN(v)) return null;
                const label = MapView.FEATURE_LABELS[type] ?? type;
                return {
                    html: `<div style="padding:4px 8px;font-size:13px;font-family:system-ui,sans-serif;">` +
                          `${label}[${index + 1}]: ${(+v).toFixed(4)}</div>`,
                    style: { background: 'rgba(0,0,0,0.72)', color: '#fff', borderRadius: '4px' },
                };
            },
        });
        this._map.addControl(this._deckOverlay);
        await new Promise(resolve => this._map.on('load', resolve));
    }

    // ── Geometry ──────────────────────────────────────────────────

    /** Convert point array to wall-segment array (all feature columns carried). */
    _buildWallData(data) {
        const segments = [];
        for (let i = 0; i < data.length - 1; i++) {
            const p1 = data[i];
            const p2 = data[i + 1];
            if (isNaN(p1.lon) || isNaN(p1.lat) || isNaN(p2.lon) || isNaN(p2.lat)) continue;
            segments.push({
                polygon:      [
                    [p1.lon, p1.lat, 0],
                    [p2.lon, p2.lat, 0],
                    [p2.lon, p2.lat, 1],
                    [p1.lon, p1.lat, 1],
                ],
                speed:        p2.speed        ?? 0,
                acceleration: p2.acceleration ?? 0,
                distance:     p2.distance     ?? 0,
                angle:        p2.angle        ?? 0,
            });
        }
        return segments;
    }

    /** Build one color scale per layer type from the loaded point data. */
    _buildScales() {
        const scales = {};
        MapView.LAYER_TYPES.forEach(type => {
            scales[type] = this._colorScale(type);
        });
        return scales;
    }

    _fitBounds(data) {
        if (!data || data.length === 0 || !this._map) return;
        let minLon = Infinity, maxLon = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;
        data.forEach(({ lon, lat }) => {
            if (isNaN(lon) || isNaN(lat)) return;
            minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        });
        if (minLon === Infinity) return;
        this._map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
            padding: 60, duration: 1200, maxZoom: 12,
        });
    }

    // ── Rendering ─────────────────────────────────────────────────

    _render() {
        if (!this._deckOverlay) return;
        if (this.mode === '3D' && !this._wallData) return;
        if (this.mode === '2D' && !this._data)     return;
        this.mode === '2D' ? this._render2D() : this._render3D();
        setTimeout(() => { if (this._map) this._map.resize(); }, 50);
    }

    _render3D() {
        const activeType = this._featureType();
        const layers     = [];

        // ── Stacked polygon layers — one per feature type ─────────
        MapView.LAYER_TYPES.forEach((type, i) => {
            const zOff     = i * this._zStep;
            const scale    = this._scales[type];
            const isActive = !activeType || activeType === type;

            layers.push(new deck.PolygonLayer({
                id:           `wall-${type}-${this.containerId}`,
                data:         this._wallData,
                pickable:     true,
                stroked:      false,
                filled:       true,
                extruded:     true,
                wireframe:    false,
                getPolygon:   d => d.polygon.map(([x, y, z]) => [x, y, z + zOff]),
                getElevation: this._elevation,
                getFillColor: d => {
                    if (!isActive) return MapView.COLOR_SHADE;
                    const v = d[type];
                    if (typeof v === 'undefined' || isNaN(v)) return MapView.COLOR_SHADE;
                    return [...(scale ? scale(v) : MapView.COLOR_LOW), 220];
                },
                material:       { ambient: 0.6, diffuse: 0.4, shininess: 80 },
                updateTriggers: { getFillColor: [activeType] },
            }));
        });

        // ── PathLayer + IconLayer — only when a feature is active ─
        if (activeType) {
            const scale        = this._scales[activeType];
            const pathSegments = this._pathSegments(activeType);

            layers.push(new deck.PathLayer({
                id:             `path-${this.containerId}`,
                data:           pathSegments,
                getPath:        d => d.path,
                getColor:       d => {
                    if (!scale || d.value == null || isNaN(d.value))
                        return [100, 100, 100, 200];
                    return [...scale(d.value), 255];
                },
                getWidth:       MapView.PATH_W,
                widthMinPixels: 2,
                pickable:       false,
                parameters:     { depthMask: false },
                updateTriggers: { getColor: [activeType] },
            }));

            const arrowLayer = this._buildArrowLayer(pathSegments);
            if (arrowLayer) layers.push(arrowLayer);
        }

        this._deckOverlay.setProps({ layers });
    }

    _render2D() {
        if (!this._data || this._data.length === 0) return;

        const activeType = this._featureType();

        if (!activeType) {
            // No feature selected — single continuous grey line.
            const coords = this._data
                .filter(d => !isNaN(d.lon) && !isNaN(d.lat))
                .map(d => [d.lon, d.lat]);

            this._deckOverlay.setProps({ layers: [
                new deck.PathLayer({
                    id:             `path-${this.containerId}`,
                    data:           [{ path: coords }],
                    getPath:        d => d.path,
                    getColor:       [100, 100, 100, 200],
                    getWidth:       MapView.PATH_W,
                    widthMinPixels: 2,
                    pickable:       false,
                }),
            ]});
            return;
        }

        // Feature selected — per-segment colouring built directly from _data.
        const scale    = this._scales[activeType];
        const segments = [];
        for (let i = 0; i < this._data.length - 1; i++) {
            const p1 = this._data[i], p2 = this._data[i + 1];
            if (isNaN(p1.lon) || isNaN(p1.lat) || isNaN(p2.lon) || isNaN(p2.lat)) continue;
            segments.push({
                path:  [[p1.lon, p1.lat], [p2.lon, p2.lat]],
                value: p1[activeType],
            });
        }

        this._deckOverlay.setProps({ layers: [
            new deck.PathLayer({
                id:             `path-${this.containerId}`,
                data:           segments,
                getPath:        d => d.path,
                getColor:       d => {
                    if (!scale || d.value == null || isNaN(d.value))
                        return [100, 100, 100, 200];
                    return [...scale(d.value), 255];
                },
                getWidth:       MapView.PATH_W,
                widthMinPixels: 2,
                pickable:       false,
                updateTriggers: { getColor: [activeType] },
            }),
        ]});
    }

    /** Build path-segment array for PathLayer / arrow layer. */
    _pathSegments(activeType) {
        return this._wallData.map(d => ({
            path:  [d.polygon[0], d.polygon[1]].map(([x, y]) => [x, y]),
            value: activeType ? d[activeType] : null,
        }));
    }

    _buildArrowLayer(pathSegments) {
        const iconData = [];
        pathSegments.forEach(({ path }) => {
            if (path.length < 2) return;
            const [x1, y1] = path[0];
            const [x2, y2] = path[1];
            iconData.push({
                position: [(x1 + x2) / 2, (y1 + y2) / 2],
                angle:    (Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) - 90,
            });
        });
        if (iconData.length === 0) return null;

        return new deck.IconLayer({
            id:          `arrows-${this.containerId}`,
            data:        iconData,
            getIcon:     () => ({
                url:     this._arrowUrl,
                width:   64,
                height:  64,
                anchorX: 32,
                anchorY: 32,
            }),
            getPosition: d => d.position,
            getAngle:    d => d.angle,
            sizeScale:   2,
            getSize:     10,
            getColor:    [0, 0, 139, 255],
            pickable:    false,
            billboard:   false,
            onError:     () => {
                if (this._arrowUrl !== MapView.ARROW_SVG) {
                    this._arrowUrl = MapView.ARROW_SVG;
                    this._render();
                }
            },
        });
    }

    // ── Helpers ───────────────────────────────────────────────────

    /**
     * Compute wall elevation proportional to the trajectory's mean segment length.
     * Converts degree-distance to metres using the Haversine formula, then applies
     * ELEV_RATIO, clamped to [ELEV_MIN, ELEV_MAX].
     */
    _computeElevation(data) {
        if (!data || data.length < 2) return MapView.ELEV_MIN;
        const R   = 6_371_000; // Earth radius in metres
        let total = 0;
        let count = 0;
        for (let i = 0; i < data.length - 1; i++) {
            const p1 = data[i], p2 = data[i + 1];
            if (isNaN(p1.lat) || isNaN(p1.lon) || isNaN(p2.lat) || isNaN(p2.lon)) continue;
            const dLat = (p2.lat - p1.lat) * Math.PI / 180;
            const dLon = (p2.lon - p1.lon) * Math.PI / 180;
            const a    = Math.sin(dLat / 2) ** 2
                       + Math.cos(p1.lat * Math.PI / 180)
                       * Math.cos(p2.lat * Math.PI / 180)
                       * Math.sin(dLon / 2) ** 2;
            total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            count++;
        }
        if (count === 0) return MapView.ELEV_MIN;
        const meanM = total / count;
        return Math.min(Math.max(meanM * MapView.ELEV_RATIO, MapView.ELEV_MIN), MapView.ELEV_MAX);
    }

    /** Resolve active feature name to a point-feature column name.
     *  e.g. 'speed_mean' → 'speed', 'angles_sd' → 'angle', 'distance_geometry_1_1' → 'distance'.
     *  Returns null if the prefix cannot be mapped to a known layer type.
     */
    _featureType() {
        if (!this._activeFeature) return null;
        const prefix = this._activeFeature.split('_')[0];
        const col    = MapView.PREFIX_TO_COLUMN[prefix] ?? null;
        return (col && MapView.LAYER_TYPES.includes(col)) ? col : null;
    }

    /**
     * Override the colour-scale domain for one feature type with an externally
     * computed [lo, hi] (e.g. the combined A+B range from MapController).
     * Immediately rebuilds that type's scale and re-renders if data is loaded.
     */
    setScaleDomain(type, lo, hi) {
        if (lo == null || hi == null) {
            delete this._domainOverrides[type];
        } else {
            this._domainOverrides[type] = { lo, hi };
        }
        // Rebuild only this type's scale entry.
        this._scales[type] = this._colorScale(type);
        const hasData = this.mode === '3D' ? !!this._wallData : !!this._data;
        if (this._deckOverlay && hasData) this._render();
    }

    /** Build a yellow→red d3 scale for the given type column.
     *  Uses an externally supplied domain override when available so that
     *  both maps share the same scale as Heatmap2DView. */
    _colorScale(type) {
        if (!this._data || this._data.length === 0) return null;
        let lo, hi;
        if (this._domainOverrides[type]) {
            ({ lo, hi } = this._domainOverrides[type]);
        } else {
            const values = this._data.map(d => d[type]).filter(v => v != null && !isNaN(v));
            if (values.length === 0) return null;
            lo = Math.min(...values);
            hi = Math.max(...values);
        }
        if (lo === hi) return () => MapView.COLOR_LOW;
        return d3.scaleLinear()
            .domain([lo, hi])
            .range([MapView.COLOR_LOW, MapView.COLOR_HIGH]);
    }

    /** Expose MapLibre map for resize calls from MapController. */
    get map() { return this._map; }
}
