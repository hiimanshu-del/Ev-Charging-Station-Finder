import pdfplumber

PDF_FILE = "bee_ev_data.pdf"

with pdfplumber.open(PDF_FILE) as pdf:

    for page_number, page in enumerate(pdf.pages, start=1):

        tables = page.extract_tables()

        for table in tables:

            for row in table:

                if not row:
                    continue

                cells = [
                    "" if cell is None else str(cell).replace("\n", " ").strip()
                    for cell in row
                ]

                # Look for the first real charging-station row.
                if (
                    len(cells) >= 12
                    and cells[2].strip().lower() == "bihar"
                ):

                    print("\nPAGE:", page_number)
                    print("NUMBER OF COLUMNS:", len(cells))

                    for index, value in enumerate(cells):
                        print(f"cells[{index}] = {value}")

                    raise SystemExit

print("No Bihar record found.")