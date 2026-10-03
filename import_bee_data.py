"""
BEE EV Public Charging Stations importer.

Downloads the official BEE EV PCS dataset from the alternate official
BEE file path and imports all rows into SQLite.

Source:
https://beeindia.gov.in/WriteReadData/RTF1984/EV_PCS_Data_29277.pdf

The dataset is a published snapshot, not a live availability feed.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import pdfplumber
import requests

PDF_URL = "https://beeindia.gov.in/WriteReadData/RTF1984/EV_PCS_Data_29277.pdf"
PDF_FILE = Path("bee_ev_data.pdf")
DB_FILE = Path("ev_charging.db")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"
}

CREATE_SQL = """
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
);
"""

def clean(value):
    if value is None:
        return ""
    value = str(value).replace("\n", " ").replace("\r", " ")
    return re.sub(r"\s+", " ", value).strip()

def to_float(value):
    value = clean(value).replace(",", "")
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def to_int(value):
    value = clean(value)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None

def download_pdf():
    print("Downloading official BEE dataset...")
    response = requests.get(PDF_URL, headers=HEADERS, timeout=120)
    response.raise_for_status()

    content = response.content
    if not content.startswith(b"%PDF-"):
        preview = content[:80]
        raise RuntimeError(
            "BEE server did not return a PDF. First bytes: "
            + repr(preview)
        )

    PDF_FILE.write_bytes(content)
    print(f"PDF saved: {PDF_FILE} ({len(content):,} bytes)")

def normalize_row(row):
    cells = [clean(c) for c in row]
    cells = [c for c in cells if c != ""]

    # The expected BEE table has 12 logical fields.
    if len(cells) < 12:
        return None

    # Keep the first 12 cells. PDF table extraction can create extra
    # empty/continuation cells; the final numeric fields identify the row.
    cpo = cells[0]
    ownership = cells[1]
    state = cells[2]
    district = cells[3]
    city = cells[4]
    location = " ".join(cells[5:-6])

    # The last six fields are location/charger metadata.
    # In normal BEE rows:
    # latitude, longitude, charger type, charger rating,
    # connector rating, connector count
    tail = cells[-6:]

    lat = to_float(tail[0])
    lon = to_float(tail[1])
    charger_type = tail[2]
    charger_rating = to_float(tail[3])
    connector_rating = to_float(tail[4])
    connector_count = to_int(tail[5])

    if lat is None or lon is None:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if connector_count is None:
        return None

    # Use the station location text as the display name when the source
    # does not provide a separate station-name field.
    name = location[:180] if location else f"{cpo} Charging Station"

    return (
        cpo,
        ownership,
        state,
        district,
        city,
        name,
        location,
        lat,
        lon,
        charger_type,
        charger_rating,
        connector_rating,
        connector_count,
    )

def import_pdf():
    connection = sqlite3.connect(DB_FILE)
    cursor = connection.cursor()
    cursor.execute(CREATE_SQL)

    # Replace the previous sample/imported dataset so repeated imports
    # do not create duplicates.
    cursor.execute("DELETE FROM charging_stations")
    cursor.execute("DELETE FROM sqlite_sequence WHERE name='charging_stations'")

    inserted = 0
    pages_with_rows = 0

    print("Reading BEE PDF. This can take a few minutes...")

    with pdfplumber.open(PDF_FILE) as pdf:
        total_pages = len(pdf.pages)

        for page_no, page in enumerate(pdf.pages, start=1):
            try:
                tables = page.extract_tables()
            except Exception as exc:
                print(f"Skipping page {page_no}: {exc}")
                continue

            page_inserted = 0

            for table in tables:
                if not table:
                    continue

                for row in table:
                    parsed = normalize_row(row)
                    if not parsed:
                        continue

                    cursor.execute(
                        """
                        INSERT INTO charging_stations
                        (
                            cpo_name, ownership, state, district, city,
                            name, address, latitude, longitude,
                            charger_type, charger_rating_kw,
                            connector_rating_kw, connector_count,
                            status, availability, source, source_date
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (*parsed, "Unknown", "Unknown", "BEE", "2025-10-26"),
                    )
                    inserted += 1
                    page_inserted += 1

            if page_inserted:
                pages_with_rows += 1

            if page_no % 25 == 0 or page_no == total_pages:
                connection.commit()
                print(
                    f"Processed {page_no}/{total_pages} pages | "
                    f"stations imported: {inserted}"
                )

    connection.commit()
    connection.close()

    print()
    print("Import complete.")
    print(f"Stations imported: {inserted}")
    print(f"Pages containing rows: {pages_with_rows}")
    print(f"Database: {DB_FILE.resolve()}")
    print()
    print("Important: status and availability are Unknown because the")
    print("BEE snapshot is not a live charger-status feed.")

def main():
    if not PDF_FILE.exists():
        download_pdf()

    import_pdf()

if __name__ == "__main__":
    main()
