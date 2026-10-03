from flask import Flask, render_template, jsonify, request
import requests
import gzip

from database import (
    create_tables,
    get_all_stations,
    get_station_by_id,
    search_stations,
    get_stations_by_district,
    get_station_count,
    get_district_summary,
)


# ============================================================
# Flask Application
# ============================================================

app = Flask(__name__)


# ============================================================
# Initialize Database
# ============================================================

create_tables()


# ============================================================
# Security Headers
# ============================================================

@app.after_request
def add_security_headers(response):

    # Allow browser geolocation for this website.
    response.headers["Permissions-Policy"] = "geolocation=(self)"

    return response

# ============================================================
# Response Compression
# ============================================================

@app.after_request
def compress_response(response):

    # --------------------------------------------------------
    # Compress only large JSON responses.
    # This reduces the amount of data transferred to the
    # browser without changing the actual API response.
    # --------------------------------------------------------

    if (
        response.status_code == 200
        and response.content_type.startswith("application/json")
        and response.content_length
        and response.content_length > 1024
        and "Content-Encoding" not in response.headers
    ):

        data = response.get_data()

        compressed_data = gzip.compress(
            data,
            compresslevel=6
        )

        response.set_data(
            compressed_data
        )

        response.headers["Content-Encoding"] = "gzip"

        response.headers["Vary"] = "Accept-Encoding"

        response.headers["Content-Length"] = str(
            len(compressed_data)
        )

    return response

# ============================================================
# Home Page
# ============================================================

@app.route("/")
def index():

    return render_template("index.html")


# ============================================================
# Get All Stations
# ============================================================

@app.route("/api/stations")
def api_stations():

    try:

        # Load stations using the existing database function.
        stations = get_all_stations()

        return jsonify({
            "success": True,
            "count": len(stations),
            "stations": stations
        })

    except Exception as error:

        return jsonify({
            "success": False,
            "message": str(error),
            "stations": []
        }), 500


# ============================================================
# Search Stations
# ============================================================

@app.route("/api/stations/search")
def api_search_stations():

    search_text = request.args.get(
        "q",
        ""
    ).strip()

    if not search_text:

        return jsonify({
            "success": False,
            "message": "Search text is required.",
            "stations": []
        }), 400

    try:

        stations = search_stations(search_text)

        return jsonify({
            "success": True,
            "count": len(stations),
            "stations": stations
        })

    except Exception as error:

        return jsonify({
            "success": False,
            "message": str(error),
            "stations": []
        }), 500


# ============================================================
# Stations by District
# ============================================================

@app.route("/api/stations/district")
def api_district_stations():

    district = request.args.get(
        "district",
        ""
    ).strip()

    if not district:

        return jsonify({
            "success": False,
            "message": "District is required.",
            "stations": []
        }), 400

    try:

        stations = get_stations_by_district(district)

        return jsonify({
            "success": True,
            "count": len(stations),
            "stations": stations
        })

    except Exception as error:

        return jsonify({
            "success": False,
            "message": str(error),
            "stations": []
        }), 500


# ============================================================
# Single Station
# ============================================================

@app.route("/api/stations/<int:station_id>")
def api_station(station_id):

    try:

        station = get_station_by_id(station_id)

        if station is None:

            return jsonify({
                "success": False,
                "message": "Station not found."
            }), 404

        return jsonify({
            "success": True,
            "station": station
        })

    except Exception as error:

        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


# ============================================================
# Summary
# ============================================================

@app.route("/api/summary")
def api_summary():

    try:

        total_stations = get_station_count()

        district_summary = get_district_summary()

        # --------------------------------------------------------
        # Calculate total installed power and connectors.
        # --------------------------------------------------------
        stations = get_all_stations()

        total_power = 0.0
        total_connectors = 0

        for station in stations:

            rating = station.get(
                "charger_rating_kw"
            )

            connectors = station.get(
                "connector_count"
            )

            if rating is not None:

                try:

                    total_power += float(rating)

                except (ValueError, TypeError):

                    pass

            if connectors is not None:

                try:

                    total_connectors += int(connectors)

                except (ValueError, TypeError):

                    pass

        return jsonify({

            "success": True,

            "total_stations":
                total_stations,

            "total_districts":
                len(district_summary),

            "total_power_kw":
                round(
                    total_power,
                    2
                ),

            "total_connectors":
                total_connectors,

            "districts":
                district_summary

        })

    except Exception as error:

        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


# ============================================================
# Geocoding
# ============================================================

@app.route("/api/geocode")
def api_geocode():

    query = request.args.get(
        "q",
        ""
    ).strip()

    if not query:

        return jsonify({
            "success": False,
            "message": "Location is required."
        }), 400

    try:

        response = requests.get(

            "https://nominatim.openstreetmap.org/search",

            params={
                "q": query,
                "format": "json",
                "limit": 1,
                "countrycodes": "in"
            },

            headers={
                "User-Agent":
                    "EV-Charging-Station-Finder/1.0"
            },

            timeout=15
        )

        response.raise_for_status()

        results = response.json()

        if not results:

            return jsonify({
                "success": False,
                "message": "Location not found."
            })

        result = results[0]

        return jsonify({

            "success": True,

            "latitude":
                float(result["lat"]),

            "longitude":
                float(result["lon"]),

            "display_name":
                result.get(
                    "display_name",
                    query
                )

        })

    except Exception as error:

        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


# ============================================================
# Load Predictor
# ============================================================

@app.route("/api/predict")
def api_predict():

    station_id = request.args.get(
        "station_id",
        type=int
    )

    utilization = request.args.get(
        "utilization",
        default=60.0,
        type=float
    )

    if station_id is None:

        return jsonify({
            "success": False,
            "message": "Station ID is required."
        }), 400

    # Keep utilization within the valid 0–100% range.
    utilization = max(
        0.0,
        min(
            100.0,
            utilization
        )
    )

    station = get_station_by_id(
        station_id
    )

    if station is None:

        return jsonify({
            "success": False,
            "message": "Station not found."
        }), 404

    charger_rating = station.get(
        "charger_rating_kw"
    )

    if charger_rating is None:

        return jsonify({
            "success": False,
            "message":
                "Charger rating is not available."
        }), 400

    try:

        charger_rating = float(
            charger_rating
        )

    except (ValueError, TypeError):

        return jsonify({
            "success": False,
            "message":
                "Invalid charger rating."
        }), 400

    # --------------------------------------------------------
    # Transparent load estimation.
    # This is an estimate, not live electrical telemetry.
    # --------------------------------------------------------
    estimated_load = (
        charger_rating
        * utilization
        / 100.0
    )

    return jsonify({

        "success": True,

        "station_id":
            station_id,

        "station_name":
            station.get("name"),

        "power_kw":
            charger_rating,

        "utilization_percent":
            utilization,

        "predicted_load_kw":
            round(
                estimated_load,
                2
            ),

        "note":
            "Transparent utilization-based estimate; "
            "not live electrical load and not ML-trained."

    })


# ============================================================
# Run Application
# ============================================================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True,
        ssl_context=(
            "127.0.0.1+2.pem",
            "127.0.0.1+2-key.pem"
        )
    )