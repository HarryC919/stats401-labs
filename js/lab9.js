async function loadData() {
    const data = await d3.csv("../data/lab9_gdp_2025_top50.csv", (d) => ({
        iso3: d.iso3,
        country: d.country,
        gdp_2025_billion_usd: +d.gdp_2025_billion_usd,
        rank: +d.rank,
    }));
    if (!data.length) {
        throw new Error("No data loaded");
    }
    return data;
}
export {};
//# sourceMappingURL=lab9.js.map