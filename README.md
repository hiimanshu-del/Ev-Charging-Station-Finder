# EV Charging Station Finder & Load Estimator

A beginner-friendly but functional Flask + SQLite + Leaflet project.

## Features

- Real SQLite database
- Samastipur EV charging-station data from the BEE public dataset
- OpenStreetMap Leaflet map
- Manual city/location search
- OpenStreetMap Nominatim geocoding
- OSRM road-distance calculation
- Browser current-location option
- Charging station cards
- Transparent load estimation API
- Responsive design
- Professional code comments

## Important data note

The station records included in this package are based on the BEE EV Public
Charging Stations Data published on the BEE website and referenced as data
till 26 October 2025.

The data should not be described as real-time availability. The `Available`
status in this project is a database status used for the demo/application
interface; it is not a live confirmation that a connector is free.

## Installation

Open PowerShell inside this folder.

Create the virtual environment:

    py -m venv venv

Install Flask:

    venv\Scripts\python.exe -m pip install -r requirements.txt

Load the database:

    venv\Scripts\python.exe database.py

Start the application:

    venv\Scripts\python.exe app.py

Open:

    http://127.0.0.1:5000/

## Manual location

Type:

    Samastipur

and press Search.

This is recommended on laptops where browser GPS is inaccurate.

## API examples

All stations:

    /api/stations

Search:

    /api/stations/search?city=Samastipur

Geocode:

    /api/geocode?location=Samastipur

Load estimate:

    /api/predict?station_id=1&utilization=60

## Next development stage

For a genuine ML load predictor, collect historical station-level load data
(timestamp, kWh/load, station ID, day, hour, etc.) and train a model such as
Random Forest or Gradient Boosting. The current predictor deliberately does
not pretend that a trained ML model exists without training data.
