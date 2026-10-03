import sqlite3


# ============================================================
# Database Configuration
# ============================================================

DATABASE_NAME = "ev_charging.db"


# ============================================================
# Database Connection
# ============================================================

def get_connection():

    connection = sqlite3.connect(
        DATABASE_NAME
    )

    # Return rows as dictionary-like objects.
    connection.row_factory = sqlite3.Row

    return connection


# ============================================================
# Create Table
# ============================================================

def create_tables():

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS charging_stations (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            cpo_name TEXT,

            ownership TEXT,

            state TEXT NOT NULL,

            district TEXT,

            city TEXT,

            name TEXT NOT NULL,

            address TEXT,

            latitude REAL NOT NULL,

            longitude REAL NOT NULL,

            charger_type TEXT,

            charger_rating_kw REAL,

            connector_rating_kw REAL,

            connector_count INTEGER,

            status TEXT DEFAULT 'Unknown',

            availability TEXT DEFAULT 'Unknown',

            source TEXT DEFAULT 'BEE',

            source_date TEXT DEFAULT '2025-10-26'

        )
    """)

    connection.commit()

    connection.close()


# ============================================================
# Convert SQLite Row to Dictionary
# ============================================================

def row_to_dict(row):

    if row is None:
        return None

    return dict(row)


# ============================================================
# Convert Multiple Rows
# ============================================================

def rows_to_dict(rows):

    return [
        dict(row)
        for row in rows
    ]


# ============================================================
# Common Station Columns
# ============================================================

STATION_COLUMNS = """
    id,
    cpo_name,
    ownership,
    state,
    district,
    city,
    name,
    address,
    latitude,
    longitude,
    charger_type,
    charger_rating_kw,
    connector_rating_kw,
    connector_count,
    status,
    availability,
    source,
    source_date
"""

# ============================================================
# Get All Stations
# ============================================================

def get_all_stations(limit=None, offset=0):
    """
    Fetch EV charging stations from the database.

    limit=None:
        Returns all stations (keeps existing application behavior).

    limit=50:
        Returns only 50 stations starting from the given offset.

    Pagination is used later to reduce response time and
    prevent the browser from receiving thousands of records
    in a single request.
    """

    connection = get_connection()

    cursor = connection.cursor()

    if limit is None:

        # --------------------------------------------------------
        # Existing behavior:
        # Return all stations.
        # --------------------------------------------------------
        cursor.execute(f"""
            SELECT
                {STATION_COLUMNS}
            FROM charging_stations
            ORDER BY district, id
        """)

    else:

        # --------------------------------------------------------
        # Pagination:
        # Return only the requested number of stations.
        # --------------------------------------------------------
        limit = max(1, min(int(limit), 100))
        offset = max(0, int(offset))

        cursor.execute(f"""
            SELECT
                {STATION_COLUMNS}
            FROM charging_stations
            ORDER BY district, id
            LIMIT ? OFFSET ?
        """, (
            limit,
            offset
        ))

    rows = cursor.fetchall()

    connection.close()

    return rows_to_dict(rows)
# ============================================================
# Get Single Station
# ============================================================

def get_station_by_id(station_id):

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(f"""
        SELECT
            {STATION_COLUMNS}
        FROM charging_stations
        WHERE id = ?
    """, (station_id,))

    row = cursor.fetchone()

    connection.close()

    return row_to_dict(row)


# ============================================================
# Search Stations
# ============================================================

def search_stations(search_text):

    connection = get_connection()

    cursor = connection.cursor()

    pattern = f"%{search_text}%"

    cursor.execute(f"""
        SELECT
            {STATION_COLUMNS}
        FROM charging_stations

        WHERE
            name LIKE ?
            OR district LIKE ?
            OR city LIKE ?
            OR address LIKE ?
            OR cpo_name LIKE ?
            OR charger_type LIKE ?

        ORDER BY
            district,
            id
    """, (
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern
    ))

    rows = cursor.fetchall()

    connection.close()

    return rows_to_dict(rows)


# ============================================================
# Get Stations by District
# ============================================================

def get_stations_by_district(district):

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(f"""
        SELECT
            {STATION_COLUMNS}
        FROM charging_stations

        WHERE district LIKE ?

        ORDER BY id
    """, (
        f"%{district}%",
    ))

    rows = cursor.fetchall()

    connection.close()

    return rows_to_dict(rows)


# ============================================================
# Station Count
# ============================================================

def get_station_count():

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute("""
        SELECT
            COUNT(*) AS total
        FROM charging_stations
    """)

    result = cursor.fetchone()

    connection.close()

    return result["total"]


# ============================================================
# District Summary
# ============================================================

def get_district_summary():

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute("""
        SELECT
            district,
            COUNT(*) AS station_count

        FROM charging_stations

        GROUP BY district

        ORDER BY station_count DESC
    """)

    rows = cursor.fetchall()

    connection.close()

    return rows_to_dict(rows)


# ============================================================
# Update Status / Availability
#
# NOTE:
# Do not call this with fake live values.
# It is available for future real API/OCPP integration.
# ============================================================

def update_station_status(
    station_id,
    status=None,
    availability=None
):

    connection = get_connection()

    cursor = connection.cursor()

    if status is not None:

        cursor.execute("""
            UPDATE charging_stations

            SET status = ?

            WHERE id = ?
        """, (
            status,
            station_id
        ))

    if availability is not None:

        cursor.execute("""
            UPDATE charging_stations

            SET availability = ?

            WHERE id = ?
        """, (
            availability,
            station_id
        ))

    connection.commit()

    connection.close()


# ============================================================
# Main Test
# ============================================================

if __name__ == "__main__":

    create_tables()

    print(
        "Database initialized successfully."
    )

    print(
        "Total stations:",
        get_station_count()
    )