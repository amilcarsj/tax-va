from flask import Blueprint, jsonify, request
import pandas as pd
import numpy as np
import os
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score

dataset_bp = Blueprint('dataset', __name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Maps each combination name to (x_column, y_column) in the outlier-scores CSV.
# Column names match fox-outlier-scores.csv: geometric, kinematic, curvature,
# indentation, speed, acceleration.
COMBINATIONS = {
    "Geometric Kinematic":      ("kinematic",    "geometric"),
    "Acceleration Speed":       ("speed",         "acceleration"),
    "Curvature Indentation":    ("indentation",   "curvature"),
    "Curvature Speed":          ("curvature",     "speed"),
    "Indentation Speed":        ("indentation",   "speed"),
    "Acceleration Curvature":   ("curvature",     "acceleration"),
    "Acceleration Indentation": ("indentation",   "acceleration"),
}


def _zone_counts(series_x, series_y):
    """Return [count0, count1, count2, count3] using vectorised pandas ops."""
    x, y = series_x.astype(float), series_y.astype(float)
    zone = pd.Series(3, index=x.index)
    zone[(x < 0.5) & (y < 0.5)] = 0
    zone[(x < 0.5) & (y > 0.5) & (x < (y - 0.5))] = 1
    zone[(x > 0.5) & (y < (x - 0.5))] = 2
    counts = zone.value_counts().sort_index()
    return [int(counts.get(i, 0)) for i in range(4)]


# Maps each outlier-score column name to which traj-feat column prefixes belong to it.
FEATURE_GROUPS = {
    'kinematic':    ['speed', 'acceleration'],
    'geometric':    ['distance_geometry', 'angles'],
    'curvature':    ['distance_geometry'],
    'indentation':  ['angles'],
    'speed':        ['speed'],
    'acceleration': ['acceleration'],
}


def _zone_series(series_x, series_y):
    """Vectorised zone assignment; returns a Series of ints 0-3."""
    x, y = series_x.astype(float), series_y.astype(float)
    zone = pd.Series(3, index=x.index)
    zone[(x < 0.5) & (y < 0.5)] = 0
    zone[(x < 0.5) & (y > 0.5) & (x < (y - 0.5))] = 1
    zone[(x > 0.5) & (y < (x - 0.5))] = 2
    return zone


@dataset_bp.route('/api/feature-importance')
def feature_importance():
    dataset     = request.args.get('dataset', 'fox')
    combination = request.args.get('combination', '')
    zone_a      = request.args.get('zoneA', type=int)
    zone_b      = request.args.get('zoneB', type=int)

    if combination not in COMBINATIONS:
        return jsonify({'error': f'Unknown combination: {combination}'}), 400
    if zone_a is None or zone_b is None or zone_a == zone_b:
        return jsonify({'error': 'zoneA and zoneB must be different integers'}), 400

    scores_path = os.path.join(BASE_DIR, 'datasets', dataset,
                               f'{dataset}-outlier-scores.csv')
    feats_path  = os.path.join(BASE_DIR, 'datasets', dataset,
                               f'{dataset}-traj-feats.csv')
    for p in (scores_path, feats_path):
        if not os.path.exists(p):
            return jsonify({'error': f'File not found: {os.path.basename(p)}'}), 404

    x_col, y_col = COMBINATIONS[combination]

    # ── Zone assignment ─────────────────────────────────────────
    df_scores = pd.read_csv(scores_path)
    df_scores['_zone'] = _zone_series(df_scores[x_col], df_scores[y_col])
    df_scores = df_scores[df_scores['_zone'].isin([zone_a, zone_b])].copy()
    df_scores['_label'] = (df_scores['_zone'] == zone_a).astype(int)

    # ── Feature matrix ──────────────────────────────────────────
    df_feats = pd.read_csv(feats_path)
    df_merged = df_scores[['trajectory_id', '_label']].merge(
        df_feats, on='trajectory_id', how='inner'
    )
    df_merged = df_merged.dropna()

    # ── Select feature columns for this combination ─────────────
    x_prefixes = FEATURE_GROUPS.get(x_col, [x_col])
    y_prefixes = FEATURE_GROUPS.get(y_col, [y_col])
    all_prefixes = list(dict.fromkeys(x_prefixes + y_prefixes))  # dedup, preserve order

    non_feature = {'trajectory_id', 'object_id', '_label'}
    all_cols    = [c for c in df_merged.columns if c not in non_feature]

    # kinematic+geometric → use every feature column
    if set(all_prefixes) >= {'speed', 'acceleration', 'distance_geometry', 'angles'}:
        feat_cols = all_cols
    else:
        feat_cols = [c for c in all_cols
                     if any(c.startswith(p) for p in all_prefixes)]

    if not feat_cols:
        return jsonify({'error': 'No matching feature columns found'}), 400

    X = df_merged[feat_cols]
    y = df_merged['_label']

    if len(y.unique()) < 2:
        return jsonify({'error': 'Only one class present — cannot train classifier'}), 400

    # ── Random Forest ───────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    rf = RandomForestClassifier(
        n_estimators=200, max_depth=10,
        class_weight='balanced', random_state=42
    )
    rf.fit(X_train, y_train)
    y_pred = rf.predict(X_test)

    accuracy = float(accuracy_score(y_test, y_pred))
    f1       = float(f1_score(y_test, y_pred, average='binary', zero_division=0))

    # ── Build feature list with group tag ───────────────────────
    importance_df = pd.DataFrame({
        'name':       feat_cols,
        'importance': rf.feature_importances_,
    }).sort_values('importance', ascending=False)

    def _group(col):
        for p in x_prefixes:
            if col.startswith(p):
                return 'x'
        return 'y'

    features = [
        {'name': row['name'], 'importance': round(float(row['importance']), 6), 'group': _group(row['name'])}
        for _, row in importance_df.iterrows()
    ]

    return jsonify({
        'features':  features,
        'accuracy':  round(accuracy, 4),
        'f1':        round(f1, 4),
        'x_label':   x_col,
        'y_label':   y_col,
    })


@dataset_bp.route('/api/scatter-data')
def scatter_data():
    dataset     = request.args.get('dataset', 'fox')
    combination = request.args.get('combination', '')

    if combination not in COMBINATIONS:
        return jsonify({'error': f'Unknown combination: {combination}'}), 400

    csv_path = os.path.join(BASE_DIR, 'datasets', dataset,
                            f'{dataset}-outlier-scores.csv')
    if not os.path.exists(csv_path):
        return jsonify({'error': f'Dataset not found: {dataset}'}), 404

    x_col, y_col = COMBINATIONS[combination]
    df = pd.read_csv(csv_path)

    base_cols = ['trajectory_id']
    if 'object_id' in df.columns:
        base_cols.append('object_id')
    records = (
        df[base_cols + [x_col, y_col]]
        .rename(columns={'trajectory_id': 'id', x_col: 'x', y_col: 'y'})
        .astype({'x': float, 'y': float})
        .to_dict('records')
    )
    return jsonify({'data': records, 'x_label': x_col, 'y_label': y_col})


@dataset_bp.route('/api/trajectory-points')
def trajectory_points():
    dataset = request.args.get('dataset', 'fox')
    tid     = request.args.get('tid', type=int)

    if tid is None:
        return jsonify({'error': 'tid is required'}), 400

    feats_path = os.path.join(BASE_DIR, 'datasets', dataset,
                              f'{dataset}-point-feats.csv')
    if not os.path.exists(feats_path):
        return jsonify({'error': f'File not found: {os.path.basename(feats_path)}'}), 404

    df = pd.read_csv(feats_path)
    df = df[df['trajectory_id'] == tid].copy()
    if df.empty:
        return jsonify({'error': f'No data for trajectory {tid}'}), 404

    if 'time' in df.columns:
        df = df.sort_values('time')

    object_id = int(df['object_id'].iloc[0]) if 'object_id' in df.columns else None

    cols = ['lat', 'lon', 'distance', 'speed', 'acceleration', 'angle']
    cols = [c for c in cols if c in df.columns]
    records = df[cols].to_dict('records')
    return jsonify({'data': records, 'object_id': object_id})


@dataset_bp.route('/api/zone-frequencies')
def zone_frequencies():
    dataset = request.args.get('dataset', 'fox')
    csv_path = os.path.join(BASE_DIR, 'datasets', dataset,
                            f'{dataset}-outlier-scores.csv')

    if not os.path.exists(csv_path):
        return jsonify({'error': f'Dataset not found: {dataset}'}), 404

    df = pd.read_csv(csv_path)
    result = {
        name: _zone_counts(df[x_col], df[y_col])
        for name, (x_col, y_col) in COMBINATIONS.items()
    }
    return jsonify(result)
