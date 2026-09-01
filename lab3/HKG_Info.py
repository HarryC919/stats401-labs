import requests
import time
from pathlib import Path
import pandas as pd

URL = "https://www.hongkongairport.com/flightinfo-rest/rest/flights/past"
REQUEST_DATE = "2026-08-31"

REQUEST_SETS = [
    ("false", "true"),  # 客运到港
    ("false", "false"),  # 客运离港
    ("true", "true"),  # 货运到港
    ("true", "false"),  # 货运离港
]

FIELDNAMES = [
    "date",
    "direction",
    "service_type",
    "time",
    "primary_flight_number",
    "primary_airline",
    "codeshare_flight_numbers",
    "codeshare_airlines",
    "codeshare_count",
    "origin",
    "destination",
    "status",
]


def fetch_groups() -> list:
    """Request all four passenger/cargo and arrival/departure sets."""
    all_groups = []
    errors = []

    for cargo, arrival in REQUEST_SETS:
        params = {
            "date": REQUEST_DATE,
            "lang": "en",
            "cargo": cargo,
            "arrival": arrival,
        }

        try:
            response = requests.get(
                URL,
                params=params,
                timeout=10,
            )
            response.raise_for_status()

            response_groups = response.json()

            if not isinstance(response_groups, list):
                raise ValueError("The API response is not a list")

            all_groups.extend(response_groups)

            record_count = sum(len(group.get("list", [])) for group in response_groups)

            print(f"{response.url}: " f"{record_count} records")

        except (requests.RequestException, ValueError) as error:
            errors.append(str(error))
            print(f"Request failed for {params}: {error}")

        finally:
            time.sleep(1)

    if errors:
        raise RuntimeError("One or more API requests failed")

    return all_groups


def normalize_groups(groups: list) -> list:
    """Convert the nested API response into flat CSV rows."""
    rows = []

    for group in groups:
        is_arrival = group["arrival"]

        for record in group.get("list", []):
            flights = record.get("flight", [])

            # Based on spot checks, treat the first listed flight
            # as the primary flight and the rest as codeshare.
            primary_flight = flights[0] if flights else {}
            codeshare_flights = flights[1:]

            if is_arrival:
                origin = " → ".join(record.get("origin", []))
                destination = "HKG"
            else:
                origin = "HKG"
                destination = " → ".join(record.get("destination", []))

            row = {
                "date": group["date"],
                "direction": ("arrival" if is_arrival else "departure"),
                "service_type": ("cargo" if group["cargo"] else "passenger"),
                "time": record.get("time", ""),
                "primary_flight_number": (primary_flight.get("no", "")),
                "primary_airline": (primary_flight.get("airline", "")),
                "codeshare_flight_numbers": " / ".join(
                    flight["no"] for flight in codeshare_flights
                ),
                "codeshare_airlines": " / ".join(
                    flight["airline"] for flight in codeshare_flights
                ),
                "codeshare_count": len(codeshare_flights),
                "origin": origin,
                "destination": destination,
                "status": record.get("status", ""),
            }

            rows.append(row)

    return rows


def save_csv(rows: list, output_path: Path) -> None:
    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    df = pd.DataFrame(
        rows,
        columns=FIELDNAMES,
    )

    df.to_csv(
        output_path,
        index=False,
        encoding="utf-8-sig",
    )


def main() -> None:
    groups = fetch_groups()
    rows = normalize_groups(groups=groups)

    if len(rows) < 1000:
        raise RuntimeError(f"Only {len(rows)} records were collected")

    if any(not row["origin"] or not row["destination"] for row in rows):
        raise ValueError("At least one row is missing an airport")

    data_dir = Path(__file__).resolve().parent.parent / "data"
    output_path = data_dir / "HKG_20260831_data.csv"

    save_csv(rows, output_path)

    print(f"Saved {len(rows)} records " f"to {output_path}")


if __name__ == "__main__":
    main()
