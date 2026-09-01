export {};

type FlightRow = Record<string, string | undefined>;

interface ColumnDef {
    key: string;
    label: string;
    format?: (value: string) => string;
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function shortDate(value: string): string {
    const [, month, day] = value.split("-");
    return `${month}/${day}`;
}

function formatSharedCodes(value: string): string {
    return value !== "" ? value : "-";
}

const COLUMNS: ColumnDef[] = [
    { key: "date", label: "Target Date", format: shortDate },
    { key: "time", label: "Scheduled Time" },
    { key: "primary_flight_number", label: "Flight Code" },
    { key: "primary_airline", label: "Airline" },
    {
        key: "codeshare_flight_numbers",
        label: "Shared Code",
        format: formatSharedCodes,
    },
    { key: "direction", label: "Direction", format: capitalize },
    { key: "service_type", label: "Type", format: capitalize },
    { key: "origin", label: "Origin" },
    { key: "destination", label: "Destination" },
    { key: "status", label: "Status" },
];

async function displayTable(): Promise<void> {
    const data = (await d3.csv(
        "../data/HKG_20260831_data.csv",
    )) as unknown as FlightRow[];

    const original = data.slice();
    let sortKey: string | null = null;
    let ascending = true;

    const table = d3.select("#data-table");

    table
        .select("thead")
        .append("tr")
        .selectAll("th")
        .data(COLUMNS)
        .join("th")
        .on("click", function (event, column) {
            if (sortKey !== column.key) {
                sortKey = column.key;
                ascending = true;
            } else if (ascending) {
                ascending = false;
            } else {
                sortKey = null;
            }

            if (sortKey === null) {
                data.splice(0, data.length, ...original);
            } else {
                data.sort((a, b) =>
                    ascending
                        ? d3.ascending(a[column.key], b[column.key])
                        : d3.descending(a[column.key], b[column.key]),
                );
            }

            updateHeader();
            updateRows();
        });

    function updateHeader(): void {
        table
            .select("thead")
            .selectAll("th")
            .data(COLUMNS)
            .text(
                (d) =>
                    d.label +
                    (sortKey === d.key ? (ascending ? " ▲" : " ▼") : ""),
            );
    }

    function updateRows(): void {
        const rows = table.select("tbody").selectAll("tr").data(data);

        rows.join("tr")
            .selectAll("td")
            .data((row) =>
                COLUMNS.map((column) => {
                    const value = row[column.key] ?? "";
                    return column.format ? column.format(value) : value;
                }),
            )
            .join("td")
            .text((d) => d);
    }

    updateHeader();
    updateRows();
}

void displayTable();
