# BEE All-India EV Charging Station Import

## 1. Put these files in the project folder

Copy:
- `import_bee_data.py`
- update `requirements.txt`

Project:
`E:\New folder\EV-Charging-Project-Complete`

## 2. Install dependencies

PowerShell:

```powershell
venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 3. Import the official BEE dataset

```powershell
venv\Scripts\python.exe import_bee_data.py
```

The script uses this official BEE file path:

https://beeindia.gov.in/WriteReadData/RTF1984/EV_PCS_Data_29277.pdf

It checks that the downloaded response actually starts with `%PDF-`, so an HTML error page will not be silently imported.

## 4. Important data rule

The BEE file is a published snapshot dated 26 October 2025. It contains station/charger information, but it does not by itself prove the current online/offline or available/unavailable state.

Therefore this importer intentionally stores:

- `status = Unknown`
- `availability = Unknown`

until a verified live operator/OCPI source is integrated.

## 5. After import

The next integration step is to update the Flask `/api/stations` response and frontend so the existing Leaflet map/search works with the full database.
