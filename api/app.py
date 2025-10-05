# app.py
from flask import Flask, render_template, request, jsonify
import ee
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

# ===========================================
# 1️⃣ INICIALIZACIÓN DE EARTH ENGINE
# ===========================================
try:
    ee.Initialize(project='super-bloom')
    print("✅ Google Earth Engine inicializado correctamente.")
except Exception as e:
    print("🪪 Autenticando con Google Earth Engine...")
    ee.Authenticate()   
    ee.Initialize(project='super-bloom')
    print("✅ Autenticación completada.")

# ===========================================
# 2️⃣ CONSTANTES Y FUNCIONES AUXILIARES
# ===========================================
S2_COLLECTION = 'COPERNICUS/S2_SR_HARMONIZED'
LST_COLLECTION = 'MODIS/061/MOD11A2'
GPM_COLLECTION = 'NASA/GPM_L3/IMERG_V06'
S2_BANDS = {'NIR': 'B8', 'RED': 'B4', 'GREEN': 'B3', 'BLUE': 'B2', 'SCL': 'SCL'}
EVI_CONSTANTS = {"G": 2.5, "L": 1, "C1": 6, "C2": 7.5}

def mask_s2_clouds(img):
    scl = img.select('SCL')
    good_quality = scl.eq(4).Or(scl.eq(5)).Or(scl.eq(6)).Or(scl.eq(11))
    return img.updateMask(good_quality).divide(10000)

def to_celsius(img):
    lst = img.select('LST_Day_1km').multiply(0.02).subtract(273.15).rename('LST')
    return img.addBands(lst)

def get_info_safe(ee_object, default_value=None):
    try: return ee_object.getInfo()
    except ee.EEException as e:
        print(f"Error GEE: {e}", file=sys.stderr)
        return default_value

def interpretar_cambio(valor, umbral_alto=0.1, umbral_bajo=0.02, tipo=""):
    if valor is None: return "No se pudo calcular."
    if valor > umbral_alto: return f"Aumento significativo de {tipo}."
    if valor > umbral_bajo: return f"Ligero aumento de {tipo}."
    if valor < -umbral_alto: return f"Descenso significativo de {tipo}."
    if valor < -umbral_bajo: return f"Ligero descenso de {tipo}."
    return "Cambio insignificante."

def interpretar_precipitacion(valor):
    if valor is None: return "No se pudo calcular."
    if valor < 1: return "Precipitación muy baja o nula."
    if valor < 10: return "Precipitación baja."
    if valor < 50: return "Precipitación moderada."
    return "Precipitación alta."

# ===========================================
# 3️⃣ FUNCIONES DE ANÁLISIS POR VARIABLE
# ===========================================

def analizar_ndvi(region, s2_collection, h_start, h_end, c_start, c_end):
    s2_current_col = s2_collection.filterDate(c_start, c_end).map(mask_s2_clouds)
    s2_historic_col = s2_collection.filterDate(h_start, h_end).map(mask_s2_clouds)
    
    img_current = s2_current_col.median().clip(region)
    ndvi_current = img_current.normalizedDifference(['B8', 'B4']).rename('NDVI')
    ndvi_historic = s2_historic_col.median().normalizedDifference(['B8', 'B4']).rename('NDVI').clip(region)
    ndvi_diff = ndvi_current.subtract(ndvi_historic).rename('NDVI_diff')

    reducer_mean = ee.Reducer.mean()
    scale = 100
    vals = {
        'ndvi_c': get_info_safe(ndvi_current.reduceRegion(reducer_mean, region, scale).get('NDVI')),
        'ndvi_h': get_info_safe(ndvi_historic.reduceRegion(reducer_mean, region, scale).get('NDVI')),
        'ndvi_d': get_info_safe(ndvi_diff.reduceRegion(reducer_mean, region, scale).get('NDVI_diff'))
    }

    map_urls = {
        'ndvi': {
            'actual': ndvi_current.getMapId({'min': 0, 'max': 0.8, 'palette': ['red', 'yellow', 'green']})['tile_fetcher'].url_format,
            'historico': ndvi_historic.getMapId({'min': 0, 'max': 0.8, 'palette': ['red', 'yellow', 'green']})['tile_fetcher'].url_format,
            'diferencia': ndvi_diff.getMapId({'min': -0.3, 'max': 0.3, 'palette': ['red', 'white', 'green']})['tile_fetcher'].url_format
        }
    }

    return vals, map_urls

def analizar_lst(region, lst_collection, h_start, h_end, c_start, c_end):
    lst_current = lst_collection.filterDate(c_start, c_end).map(to_celsius).select('LST').mean().clip(region)
    lst_historic = lst_collection.filterDate(h_start, h_end).map(to_celsius).select('LST').mean().clip(region)
    lst_diff = lst_current.subtract(lst_historic).rename('LST_diff')

    reducer_mean = ee.Reducer.mean()
    vals = {
        'lst_c': get_info_safe(lst_current.reduceRegion(reducer_mean, region, 1000).get('LST')),
        'lst_h': get_info_safe(lst_historic.reduceRegion(reducer_mean, region, 1000).get('LST')),
        'lst_d': get_info_safe(lst_diff.reduceRegion(reducer_mean, region, 1000).get('LST_diff'))
    }

    map_urls = {
        'temperatura': {
            'actual': lst_current.getMapId({'min': 10, 'max': 45, 'palette': ['blue', 'cyan', 'yellow', 'red']})['tile_fetcher'].url_format,
            'historico': lst_historic.getMapId({'min': 10, 'max': 45, 'palette': ['blue', 'cyan', 'yellow', 'red']})['tile_fetcher'].url_format,
            'diferencia': lst_diff.getMapId({'min': -5, 'max': 5, 'palette': ['blue', 'white', 'red']})['tile_fetcher'].url_format
        }
    }

    return vals, map_urls

def analizar_precip(region, gpm_collection, h_start, h_end, c_start, c_end):
    precip_current = gpm_collection.filterDate(c_start, c_end).select('precipitationCal').sum().clip(region)
    precip_historic = gpm_collection.filterDate(h_start, h_end).select('precipitationCal').sum().clip(region)
    precip_diff_rel = precip_current.subtract(precip_historic).divide(precip_historic.add(1e-6)).rename('precip_diff_rel')

    reducer_mean = ee.Reducer.mean()
    vals = {
        'precip_c': get_info_safe(precip_current.reduceRegion(reducer_mean, region, 1000).get('precipitationCal')),
        'precip_h': get_info_safe(precip_historic.reduceRegion(reducer_mean, region, 1000).get('precipitationCal')),
        'precip_d': get_info_safe(precip_diff_rel.reduceRegion(reducer_mean, region, 1000).get('precip_diff_rel'))
    }

    map_urls = {
        'precipitacion': {
            'actual': precip_current.getMapId({'min': 0, 'max': 50, 'palette': ['white', 'blue', 'purple']})['tile_fetcher'].url_format,
            'historico': precip_historic.getMapId({'min': 0, 'max': 50, 'palette': ['white', 'blue', 'purple']})['tile_fetcher'].url_format,
            'diferencia': precip_diff_rel.getMapId({'min': -1, 'max': 1, 'palette': ['red', 'white', 'blue']})['tile_fetcher'].url_format
        }
    }

    return vals, map_urls

def analizar_ecosistema_avanzado(coords, h_start, h_end, c_start, c_end):
    region = ee.Geometry.Rectangle(coords)
    s2_collection = ee.ImageCollection(S2_COLLECTION).filterBounds(region)
    lst_collection = ee.ImageCollection(LST_COLLECTION).filterBounds(region)
    gpm_collection = ee.ImageCollection(GPM_COLLECTION).filterBounds(region)

    resultados_vals = {}
    resultados_maps = {}

    with ThreadPoolExecutor() as executor:
        futures = {
            executor.submit(analizar_ndvi, region, s2_collection, h_start, h_end, c_start, c_end): 'ndvi',
            executor.submit(analizar_lst, region, lst_collection, h_start, h_end, c_start, c_end): 'temperatura',
            executor.submit(analizar_precip, region, gpm_collection, h_start, h_end, c_start, c_end): 'precipitacion'
        }

        for future in as_completed(futures):
            key = futures[future]
            try:
                vals, maps = future.result()
                resultados_vals.update(vals)
                resultados_maps.update(maps)
            except Exception as e:
                print(f"Error en {key}: {e}", file=sys.stderr)

    img_current = s2_collection.filterDate(c_start, c_end).map(mask_s2_clouds).median().clip(region)
    evi_current = img_current.expression(
        'G * ((NIR - RED) / (NIR + C1 * RED - C2 * BLUE + L))',
        {'NIR': img_current.select('B8'), 'RED': img_current.select('B4'), 'BLUE': img_current.select('B2'), **EVI_CONSTANTS}
    ).rename('EVI')
    ndsi_floral_current = img_current.normalizedDifference(['B3', 'B4']).rename('NDSI_floral')

    reducer_mean = ee.Reducer.mean()
    resultados_vals['evi_c'] = get_info_safe(evi_current.reduceRegion(reducer_mean, region, 100).get('EVI'))
    resultados_vals['ndsi_c'] = get_info_safe(ndsi_floral_current.reduceRegion(reducer_mean, region, 100).get('NDSI_floral'))

    # ✨ NUEVA SECCIÓN: PREPARAR DATOS PARA GRÁFICAS ✨
    chart_data = {
        "comparative_charts": {
            "ndvi": {
                "labels": ["Histórico", "Actual"],
                "datasets": [{
                    "label": "NDVI",
                    "data": [resultados_vals.get('ndvi_h'), resultados_vals.get('ndvi_c')]
                }]
            },
            "temperature": {
                "labels": ["Histórico (°C)", "Actual (°C)"],
                "datasets": [{
                    "label": "Temperatura",
                    "data": [resultados_vals.get('lst_h'), resultados_vals.get('lst_c')]
                }]
            },
            "precipitation": {
                "labels": ["Histórico (mm)", "Actual (mm)"],
                "datasets": [{
                    "label": "Precipitación",
                    "data": [resultados_vals.get('precip_h'), resultados_vals.get('precip_c')]
                }]
            }
        },
        "gauge_charts": {
            "ndvi": {"valor": resultados_vals.get('ndvi_c')},
            "evi": {"valor": resultados_vals.get('evi_c')},
            "ndsi_floral": {"valor": resultados_vals.get('ndsi_c')}
        }
    }

    return {
        "map_data": {"centro": [region.centroid().coordinates().get(1).getInfo(),
                                region.centroid().coordinates().get(0).getInfo()],
                     "tile_urls": resultados_maps},
        "dashboard_data": {
            "actual": {
                "ndvi": {"valor": resultados_vals.get('ndvi_c')},
                "evi": {"valor": resultados_vals.get('evi_c')},
                "ndsi_floral": {"valor": resultados_vals.get('ndsi_c')},
                "temperatura": {"valor": resultados_vals.get('lst_c')},
                "precipitacion": {"valor": resultados_vals.get('precip_c'), "interpretacion": interpretar_precipitacion(resultados_vals.get('precip_c'))}
            },
            "comparativo": {
                "ndvi_historico": {"valor": resultados_vals.get('ndvi_h')},
                "cambio_ndvi": {"valor": resultados_vals.get('ndvi_d'), "interpretacion": interpretar_cambio(resultados_vals.get('ndvi_d'), 0.1, 0.02, 'vegetación')},
                "temperatura_historica": {"valor": resultados_vals.get('lst_h')},
                "cambio_temperatura": {"valor": resultados_vals.get('lst_d'), "interpretacion": interpretar_cambio(resultados_vals.get('lst_d'), 2, 0.5, 'temperatura')},
                "precipitacion_historica": {"valor": resultados_vals.get('precip_h')},
                "cambio_precipitacion_rel": {"valor": resultados_vals.get('precip_d'), "interpretacion": interpretar_cambio(resultados_vals.get('precip_d'), 0.5, 0.1, 'precipitación')}
            }
        },
        "chart_data": chart_data # <-- Se añade el nuevo objeto a la respuesta
    }

# ===========================================
# 4️⃣ CONFIGURACIÓN DEL SERVIDOR FLASK
# ===========================================
app = Flask(__name__)

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/analizar-avanzado', methods=['POST'])
def analizar_endpoint():
    try:
        data = request.get_json()
        required_keys = ['coords', 'historic_start', 'historic_end', 'current_start', 'current_end']
        if not all(key in data for key in required_keys):
            return jsonify({"error": "Faltan parámetros."}), 400

        resultados = analizar_ecosistema_avanzado(
            data['coords'], data['historic_start'], data['historic_end'],
            data['current_start'], data['current_end']
        )
        return jsonify(resultados)
    except Exception as e:
        print(f"Error en servidor: {e}", file=sys.stderr)
        return jsonify({"error": f"Error interno del servidor: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True)