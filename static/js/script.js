document.addEventListener('DOMContentLoaded', () => {

    const splashScreen = document.getElementById('splash-screen');
    const mainContent = document.getElementById('main-content');
    const video = document.getElementById('splash-video');

    function hideSplash() {
    splashScreen.style.opacity = '0';
    setTimeout(() => {
        splashScreen.style.display = 'none';
        mainContent.style.display = 'block';
        
        // ✨ LÍNEA AÑADIDA: Avisa al mapa que se redibuje ahora que es visible.
        if (map) {
            map.invalidateSize();
        }

    }, 100);
}

    video.addEventListener('ended', hideSplash);
    splashScreen.addEventListener('click', () => {
        video.pause();
        hideSplash();
    });

    // --- CONFIGURACIÓN ---
    const MAPBOX_TOKEN = 'sk.eyJ1Ijoic2FtdW1hbXUiLCJhIjoiY21nY3pndHRsMHZjNzJsbzd3YmRnZ3k2aCJ9.IN5gKsMsEjaejKJEALxB_A';
    const MAPBOX_STYLE_URL = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`;
    const MAPBOX_ATTRIBUTION = '© Mapbox';

    // --- ELEMENTOS DEL DOM ---
    const navButtons = document.querySelectorAll('.nav-button');
    const views = document.querySelectorAll('.view');
    const form = document.getElementById('analysis-form');
    const submitButton = document.getElementById('submit-button');
    const keyMetricsContainer = document.getElementById('key-metrics');
    const detailedDashboardContainer = document.getElementById('detailed-dashboard');
    const layerGroupsContainer = document.getElementById('layer-groups-container');
    const chartsContainer = document.getElementById('charts-container'); // Contenedor de gráficas

    // --- ESTADO DE LA APLICACIÓN ---
    let map;
    let geeLayers = {};
    let chartInstances = {}; // ✨ Almacenará las instancias de las gráficas

    // ===========================================
    // 1. INICIALIZACIÓN Y MANEJO DE VISTAS
    // ===========================================
    function initMap() {
        map = L.map('map', { zoomControl: false }).setView([25.7, -100.3], 10);
        L.tileLayer(MAPBOX_STYLE_URL, { attribution: MAPBOX_ATTRIBUTION, tileSize: 512, zoomOffset: -1 }).addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);
    }
    
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            navButtons.forEach(btn => btn.classList.remove('active'));
            views.forEach(view => view.classList.remove('active'));
            button.classList.add('active');
            document.getElementById(`${button.dataset.view}-view`).classList.add('active');

            // ✨ BLOQUE AÑADIDO: Si la vista activada es el mapa, lo redibujamos.
            if (button.dataset.view === 'map' && map) {
                // Se usa un pequeño retraso para asegurar que el CSS se aplicó.
                setTimeout(() => map.invalidateSize(), 10);
            }
        });
    });

    initMap();

    // ===========================================
    // 2. LLAMADA A LA API Y MANEJO DE DATOS
    // ===========================================
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        keyMetricsContainer.innerHTML = '<p class="placeholder">Cargando métricas...</p>';
        detailedDashboardContainer.innerHTML = '';
        layerGroupsContainer.innerHTML = '<p class="placeholder">Generando capas...</p>';
        chartsContainer.style.display = 'none'; // Ocultar gráficas mientras carga

        const payload = {
            coords: [
                parseFloat(document.getElementById('xmin').value), parseFloat(document.getElementById('ymin').value),
                parseFloat(document.getElementById('xmax').value), parseFloat(document.getElementById('ymax').value)
            ],
            historic_start: document.getElementById('historic-start').value, historic_end: document.getElementById('historic-end').value,
            current_start: document.getElementById('current-start').value, current_end: document.getElementById('current-end').value
        };

        try {
            const response = await fetch('/analizar-avanzado', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error((await response.json()).error || 'Error en servidor.');
            
            const results = await response.json();
            updateMap(results.map_data);
            updateDashboard(results.dashboard_data);
            updateCharts(results.chart_data); // ✨ LLAMAR A LA NUEVA FUNCIÓN
        } catch (error) {
            keyMetricsContainer.innerHTML = `<p class="placeholder" style="color: #F87171;">${error.message}</p>`;
            layerGroupsContainer.innerHTML = '<p class="placeholder">Error al generar capas.</p>';
        } finally {
            submitButton.disabled = false;
        }
    });

    // ===========================================
    // 3. FUNCIONES DE ACTUALIZACIÓN DE LA UI
    // ===========================================
    
    // ... (Las funciones updateMap, generateLayerControls y updateVisibleLayer no cambian) ...
    function updateMap(mapData) {
        Object.values(geeLayers).flat().forEach(layer => map.removeLayer(layer));
        geeLayers = {}; // Reset

        for (const variable in mapData.tile_urls) {
            geeLayers[variable] = {};
            for (const periodo in mapData.tile_urls[variable]) {
                geeLayers[variable][periodo] = L.tileLayer(mapData.tile_urls[variable][periodo], { opacity: 0.5 });
            }
        }
        
        generateLayerControls();
        map.flyTo(mapData.centro, 10);
    }
    
    function generateLayerControls() {
        const layersConfig = [
            { id: 'ndvi-diferencia', name: 'Contraste NDVI', variable: 'ndvi', period: 'diferencia', checked: true },
            { id: 'ndvi-actual', name: 'NDVI Actual', variable: 'ndvi', period: 'actual', checked: false },
            { id: 'ndvi-historico', name: 'NDVI Histórico', variable: 'ndvi', period: 'historico', checked: false },
            { id: 'temperatura-diferencia', name: 'Contraste Temp.', variable: 'temperatura', period: 'diferencia', checked: false },
            { id: 'temperatura-actual', name: 'Temp. Actual', variable: 'temperatura', period: 'actual', checked: false },
            { id: 'temperatura-historico', name: 'Temp. Histórica', variable: 'temperatura', period: 'historico', checked: false },
            { id: 'precipitacion-diferencia', name: 'Contraste Precip.', variable: 'precipitacion', period: 'diferencia', checked: false },
            { id: 'precipitacion-actual', name: 'Precip. Actual', variable: 'precipitacion', period: 'actual', checked: false },
            { id: 'precipitacion-historico', name: 'Precip. Histórica', variable: 'precipitacion', period: 'historico', checked: false },
        ];

        layerGroupsContainer.innerHTML = ''; // Limpiar

        const grid = document.createElement('div');
        grid.className = 'layer-grid';

        // Crear una lista única de radio buttons estilizados como una grilla
        layersConfig.forEach(config => {
            const label = document.createElement('label');
            label.className = 'layer-grid-item';
            label.htmlFor = `radio-${config.id}`;
            label.dataset.variable = config.variable;

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.id = `radio-${config.id}`;
            radio.name = 'layer-selection'; // Mismo nombre para agruparlos
            radio.value = `${config.variable}-${config.period}`;
            radio.checked = config.checked;
            radio.className = 'layer-radio-hidden';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = config.name;

            label.appendChild(radio);
            label.appendChild(nameSpan);
            grid.appendChild(label);

            // Añadir el evento para cambiar de capa
            radio.addEventListener('change', updateVisibleLayer);
        });

        layerGroupsContainer.appendChild(grid);

        // Mostrar la capa seleccionada por defecto
        updateVisibleLayer();
    }

    function updateVisibleLayer() {
        const selectedRadio = document.querySelector('input[name="layer-selection"]:checked');
        if (!selectedRadio) return;

        const [variable, period] = selectedRadio.value.split('-');
        
        // Ocultar todas las capas
        Object.values(geeLayers).forEach(variableLayers => {
            Object.values(variableLayers).forEach(layer => {
                if (map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            });
        });

        // Mostrar solo la capa seleccionada
        if (geeLayers[variable] && geeLayers[variable][period]) {
            map.addLayer(geeLayers[variable][period]);
        }
    }

    function updateDashboard(data) {
        const format = (val, dec=2, unit='') => (val !== null && val !== undefined) ? `${parseFloat(val).toFixed(dec)}${unit}` : 'N/A';
        const change = data.comparativo.cambio_ndvi.valor;
        const changeClass = change > 0.01 ? 'up' : change < -0.01 ? 'down' : '';
        const changeSign = change > 0 ? '+' : '';

        keyMetricsContainer.innerHTML = `
            <div class="metric-card">
                <div class="metric-card-header"><span>🌿 NDVI Actual</span></div>
                <div class="metric-card-body"><div class="value">${format(data.actual.ndvi.valor, 3)}</div></div>
            </div>
            <div class="metric-card">
                <div class="metric-card-header"><span>🔥 Temp. Actual</span></div>
                <div class="metric-card-body"><div class="value">${format(data.actual.temperatura.valor, 1, ' °C')}</div></div>
            </div>
            <div class="metric-card">
                <div class="metric-card-header"><span>💧 Precip. Actual</span></div>
                <div class="metric-card-body"><div class="value">${format(data.actual.precipitacion.valor, 1, ' mm')}</div></div>
            </div>
            <div class="metric-card">
                <div class="metric-card-header"><span>📈 Cambio NDVI</span></div>
                <div class="metric-card-body"><div class="value ${changeClass}">${changeSign}${format(change, 3)}</div></div>
            </div>
        `;

        detailedDashboardContainer.innerHTML = `
            <div class="result-card">
                <h3>Análisis de Vegetación</h3>
                <p class="valor">${format(data.actual.ndvi.valor, 3)} <span class="interpretacion">(NDVI Actual)</span></p>
                <p class="valor">${format(data.comparativo.ndvi_historico.valor, 3)} <span class="interpretacion">(NDVI Histórico)</span></p>
                <p class="valor ${changeClass}">${changeSign}${format(data.comparativo.cambio_ndvi.valor, 3)} <span class="interpretacion">(${data.comparativo.cambio_ndvi.interpretacion})</span></p>
            </div>
             <div class="result-card">
                <h3>Análisis de Temperatura</h3>
                <p class="valor">${format(data.actual.temperatura.valor, 1, ' °C')} <span class="interpretacion">(Temp. Actual)</span></p>
                <p class="valor">${format(data.comparativo.temperatura_historica.valor, 1, ' °C')} <span class="interpretacion">(Temp. Histórica)</span></p>
                <p class="valor ${data.comparativo.cambio_temperatura.valor > 0 ? 'down' : 'up'}">${format(data.comparativo.cambio_temperatura.valor, 1, ' °C')} <span class="interpretacion">(${data.comparativo.cambio_temperatura.interpretacion})</span></p>
            </div>
             <div class="result-card">
                <h3>Análisis de Precipitación</h3>
                <p class="valor">${format(data.actual.precipitacion.valor, 1, ' mm')} <span class="interpretacion">(Precip. Actual)</span></p>
                <p class="valor">${format(data.comparativo.precipitacion_historica.valor, 1, ' mm')} <span class="interpretacion">(Precip. Histórica)</span></p>
                <p class="valor ${data.comparativo.cambio_precipitacion_rel.valor > 0 ? 'up' : 'down'}">${format(data.comparativo.cambio_precipitacion_rel.valor * 100, 0, '%')} <span class="interpretacion">(${data.comparativo.cambio_precipitacion_rel.interpretacion})</span></p>
            </div>
        `;
    }

    // ===========================================
    // 4. ✨ NUEVA FUNCIÓN PARA LAS GRÁFICAS
    // ===========================================
    function updateCharts(chartData) {
        chartsContainer.style.display = 'block'; // Mostrar el contenedor de gráficas

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: { color: '#9CA3AF' },
                    grid: { color: '#374151' }
                },
                x: {
                    ticks: { color: '#9CA3AF' },
                    grid: { color: '#374151' }
                }
            }
        };

        // Gráfica de NDVI
        createBarChart('ndvi-chart', {
            labels: chartData.comparative_charts.ndvi.labels,
            datasets: [{
                label: 'NDVI',
                data: chartData.comparative_charts.ndvi.datasets[0].data,
                backgroundColor: '#34D399',
                borderRadius: 4,
                barPercentage: 0.6
            }]
        }, commonOptions);

        // Gráfica de Temperatura
        createBarChart('temperatura-chart', {
            labels: chartData.comparative_charts.temperature.labels,
            datasets: [{
                label: 'Temperatura',
                data: chartData.comparative_charts.temperature.datasets[0].data,
                backgroundColor: '#FBBF24',
                borderRadius: 4,
                barPercentage: 0.6
            }]
        }, commonOptions);

        // Gráfica de Precipitación
        createBarChart('precipitacion-chart', {
            labels: chartData.comparative_charts.precipitation.labels,
            datasets: [{
                label: 'Precipitación',
                data: chartData.comparative_charts.precipitation.datasets[0].data,
                backgroundColor: '#60A5FA',
                borderRadius: 4,
                barPercentage: 0.6
            }]
        }, commonOptions);
    }

    function createBarChart(canvasId, data, options) {
        // Si ya existe una gráfica en este canvas, la destruimos antes de crear la nueva
        if (chartInstances[canvasId]) {
            chartInstances[canvasId].destroy();
        }
        
        const ctx = document.getElementById(canvasId).getContext('2d');
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: data,
            options: options
        });
    }
});