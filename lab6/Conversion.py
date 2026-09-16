import json
from pathlib import Path

import pandas as pd

data_dir = Path(__file__).resolve().parent.parent / "data"
small = data_dir / "lab6_assignment_gdp.csv"
output_path = data_dir / "lab6_assignment_gdp.json"


def build_hierarchy(dataframe, levels, gdp_column, gdp_status_column):

    if len(levels) == 1:

        return [
            {"name": row[levels[0]], "gdp_amount": row[gdp_column], "gdp_status": row[gdp_status_column]}
            for _, row in dataframe.iterrows()
        ]

    current_level = levels[0]

    children = []

    for value, group in dataframe.groupby(current_level):

        children.append(
            {
                "name": value,
                "children": build_hierarchy(group, levels[1:], gdp_column, gdp_status_column),
            }
        )

    return children


def main():
    df = pd.read_csv(small)

    hierarchy = {
        "name": "World",
        "children": build_hierarchy(
            df, ["continent", "area", "country"], "gdp_billion_usd", "gdp_status"
        ),
    }

    with open(output_path, "w", encoding="utf-8") as f:

        json.dump(hierarchy, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
