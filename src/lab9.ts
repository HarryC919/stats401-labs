export {};

interface GDPDatum {
    iso3: string;
    country: string;
    gdp_2025_billion_usd: number;
    rank: number;
}

async function loadData(): Promise<GDPDatum[]> {
    const data = await d3.csv("../data/lab9_gdp_2025_top50.csv", (d) => ({
        iso3: d.iso3 as string,
        country: d.country as string,
        gdp_2025_billion_usd: +d.gdp_2025_billion_usd,
        rank: +d.rank,
    }));

    if (!data.length) {
        throw new Error("No data loaded");
    }

    return data as GDPDatum[];
}
