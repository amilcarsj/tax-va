/**
 * Info-icon tooltip.
 * Uses a position:fixed div so it escapes overflow:hidden panel containers.
 */
(function () {
    const tip = document.createElement('div');
    tip.id = 'info-tooltip';
    document.body.appendChild(tip);

    function reposition(icon) {
        const r   = icon.getBoundingClientRect();
        const w   = 280;
        const gap = 8;
        let left  = r.left + r.width / 2 - w / 2;
        let top   = r.bottom + gap;
        if (left < 4) left = 4;
        if (left + w > window.innerWidth - 4) left = window.innerWidth - w - 4;
        tip.style.left = left + 'px';
        tip.style.top  = top  + 'px';
    }

    document.addEventListener('mouseover', e => {
        const icon = e.target.closest('.info-icon');
        if (!icon) return;
        tip.textContent = icon.dataset.info;
        tip.style.display = 'block';
        reposition(icon);
    });
    document.addEventListener('mouseout', e => {
        if (e.target.closest('.info-icon')) tip.style.display = 'none';
    });
})();

/**
 * main.js — application entry point.
 * Boots controllers after the DOM is ready.
 */
document.addEventListener('DOMContentLoaded', () => {
    const app      = new AppController();
    const analysis = new AnalysisController(app);
    const maps     = new MapController(app);

    // Dataset selector bar
    document.querySelectorAll('.dataset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            document.querySelectorAll('.dataset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            app.setDataset(btn.dataset.dataset);
        });
    });

    // Expose globally for debugging / future inter-controller access.
    window._app      = app;
    window._analysis = analysis;
    window._maps     = maps;
});
