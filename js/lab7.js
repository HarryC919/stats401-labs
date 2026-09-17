const WIDTH = 960;
const HEIGHT = 620;
const TOTAL_DAYS = 60;
const FRAME_MS = 800;
const SECTOR_COLORS = {
    Manufacturing: "#4e79a7",
    Logistics: "#f28e2b",
    Retail: "#e15759",
    Food: "#59a14f",
    Technology: "#76b7b2",
    Wholesale: "#edc948",
    Materials: "#b07aa1",
};
const REGION_STROKES = {
    Asia: "#172033",
    Europe: "#172033",
    "North America": "#ffffff",
};
const REGION_DASHES = {
    Asia: null,
    Europe: "3 2",
    "North America": null,
};
const TYPE_COLORS = {
    goods: "#9467bd",
    shipping: "#17becf",
    components: "#bcbd22",
    materials: "#7f7f7f",
    services: "#e377c2",
};
const formatUsd = d3.format("$,.0f");
function linkKey(source, target) {
    return [source, target].sort().join("|");
}
async function loadData() {
    const [companies, transactions] = await Promise.all([
        d3.csv("../data/lab7_assignment_companies.csv", (d) => ({
            id: d.id,
            company_name: d.company_name,
            sector: d.sector,
            region: d.region,
        })),
        d3.csv("../data/lab7_assignment_transactions_60days.csv", (d) => ({
            date: d3.timeParse("%Y-%m-%d")(d.date),
            day: +d.day,
            source: d.source,
            target: d.target,
            amount_usd: +d.amount_usd,
            transaction_type: d.transaction_type,
            transaction_count: +d.transaction_count,
        })),
    ]);
    if (!companies.length || !transactions.length) {
        throw new Error("Failed to load assignment CSV files");
    }
    return [companies, transactions];
}
// Part B — current transaction volume per company
function calculateVolume(companyId, currentLinks) {
    return d3.sum(currentLinks.filter((d) => d.source === companyId || d.target === companyId), (d) => d.amount_usd);
}
// Part D — compute one stable layout from the aggregated 60-day network,
// then fix node positions so frames never rearrange the graph.
function computeStableLayout(companies, transactions) {
    const pairTotals = d3.rollup(transactions, (v) => d3.sum(v, (d) => d.amount_usd), (d) => linkKey(d.source, d.target));
    const layoutLinks = Array.from(pairTotals, ([key, total]) => {
        const [source, target] = key.split("|");
        return { source, target, total_amount: total };
    });
    const simulation = d3
        .forceSimulation(companies)
        .force("link", d3
        .forceLink(layoutLinks)
        .id((d) => d.id)
        .distance(150))
        .force("charge", d3.forceManyBody().strength(-420))
        .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
        .force("collision", d3.forceCollide(34))
        .stop();
    for (let i = 0; i < 400; i += 1) {
        simulation.tick();
    }
    companies.forEach((d) => {
        d.x = Math.max(70, Math.min(WIDTH - 70, d.x ?? WIDTH / 2));
        d.y = Math.max(70, Math.min(HEIGHT - 60, d.y ?? HEIGHT / 2));
        d.fx = d.x;
        d.fy = d.y;
    });
}
function buildLegends() {
    const sectorLegend = d3.select("#sector-legend");
    Object.entries(SECTOR_COLORS).forEach(([sector, color]) => {
        const item = sectorLegend.append("span").attr("class", "legend-item");
        item.append("span")
            .attr("class", "legend-swatch")
            .style("background", color);
        item.append("span").text(sector);
    });
    const regionLegend = d3.select("#region-legend");
    Object.entries(REGION_STROKES).forEach(([region, stroke]) => {
        const item = regionLegend.append("span").attr("class", "legend-item");
        const swatch = item.append("svg").attr("width", 18).attr("height", 18);
        swatch
            .append("circle")
            .attr("cx", 9)
            .attr("cy", 9)
            .attr("r", 6)
            .attr("fill", "#cbd5e1")
            .attr("stroke", stroke)
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", REGION_DASHES[region]);
        item.append("span").text(region);
    });
    const typeLegend = d3.select("#type-legend");
    Object.entries(TYPE_COLORS).forEach(([type, color]) => {
        const item = typeLegend.append("span").attr("class", "legend-item");
        item.append("svg")
            .attr("width", 26)
            .attr("height", 10)
            .append("line")
            .attr("x1", 1)
            .attr("x2", 25)
            .attr("y1", 5)
            .attr("y2", 5)
            .attr("stroke", color)
            .attr("stroke-width", 3)
            .attr("stroke-linecap", "round");
        item.append("span").text(type);
    });
}
// Greedy label placement: each label tries above / below / right / left of
// its node and takes the first candidate that does not overlap an
// already-placed label.
function placeLabels(companies) {
    const placedBoxes = [];
    const placements = new Map();
    companies.forEach((d) => {
        const width = d.company_name.length * 6.4 + 6;
        const height = 12;
        const cx = d.x ?? 0;
        const cy = d.y ?? 0;
        const candidates = [
            { x: cx, y: cy - 28, anchor: "middle" },
            { x: cx, y: cy + 38, anchor: "middle" },
            { x: cx + 28, y: cy + 4, anchor: "start" },
            { x: cx - 28, y: cy + 4, anchor: "end" },
        ];
        const toBox = (p) => {
            const x0 = p.anchor === "middle"
                ? p.x - width / 2
                : p.anchor === "start"
                    ? p.x
                    : p.x - width;
            return [x0, p.y - height + 2, x0 + width, p.y + 3];
        };
        const overlapArea = (b) => placedBoxes.reduce((sum, other) => {
            const ix = Math.max(0, Math.min(b[2], other[2]) - Math.max(b[0], other[0]));
            const iy = Math.max(0, Math.min(b[3], other[3]) - Math.max(b[1], other[1]));
            return sum + ix * iy;
        }, 0);
        let best = candidates[0];
        let bestOverlap = Infinity;
        candidates.forEach((c) => {
            const area = overlapArea(toBox(c));
            if (area < bestOverlap) {
                bestOverlap = area;
                best = c;
            }
        });
        placedBoxes.push(toBox(best));
        placements.set(d.id, best);
    });
    return placements;
}
function drawNetwork(companies, transactions) {
    const svg = d3
        .select("#network")
        .append("svg")
        .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
        .attr("width", WIDTH)
        .attr("height", HEIGHT);
    const tooltip = d3.select("#tooltip");
    const byId = new Map(companies.map((d) => [d.id, d]));
    const dateByDay = new Map(transactions.map((d) => [d.day, d.date]));
    const maxDailyVolume = d3.max(transactions, (d) => Math.max(calculateVolume(d.source, transactions.filter((t) => t.day === d.day)), calculateVolume(d.target, transactions.filter((t) => t.day === d.day)))) ?? 0;
    const sizeScale = d3.scaleSqrt().domain([0, maxDailyVolume]).range([7, 24]);
    const widthScale = d3
        .scaleLinear()
        .domain(d3.extent(transactions, (d) => d.amount_usd))
        .range([1.5, 6]);
    const linkGroup = svg.append("g").attr("class", "links");
    const nodeGroup = svg.append("g").attr("class", "nodes");
    const labelGroup = svg.append("g").attr("class", "labels");
    let displayedLinks = [];
    // Nodes are joined once and reused across all frames (Part D).
    const node = nodeGroup
        .selectAll("circle")
        .data(companies, (d) => d.id)
        .join("circle")
        .attr("cx", (d) => d.x ?? 0)
        .attr("cy", (d) => d.y ?? 0)
        .attr("fill", (d) => SECTOR_COLORS[d.sector])
        .attr("stroke", (d) => REGION_STROKES[d.region])
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", (d) => REGION_DASHES[d.region]);
    const labelPlacements = placeLabels(companies);
    labelGroup
        .selectAll("text")
        .data(companies, (d) => d.id)
        .join("text")
        .attr("x", (d) => labelPlacements.get(d.id)?.x ?? 0)
        .attr("y", (d) => labelPlacements.get(d.id)?.y ?? 0)
        .attr("text-anchor", (d) => labelPlacements.get(d.id)?.anchor ?? "middle")
        .attr("font-size", 11)
        .attr("fill", "#344054")
        .attr("pointer-events", "none")
        .text((d) => d.company_name);
    node.on("mouseover", function (event, d) {
        d3.select(this).attr("stroke-width", 3.5);
        const volume = calculateVolume(d.id, displayedLinks);
        tooltip.style("opacity", 1).html(`
                <strong>${d.company_name}</strong><br>
                Sector: ${d.sector}<br>
                Region: ${d.region}<br>
                Volume this day: ${volume > 0 ? formatUsd(volume) : "no transactions"}
            `);
    })
        .on("mousemove", function (event) {
        tooltip
            .style("left", `${event.pageX + 12}px`)
            .style("top", `${event.pageY + 12}px`);
    })
        .on("mouseout", function () {
        d3.select(this).attr("stroke-width", 2);
        tooltip.style("opacity", 0);
    });
    function updateStats(day, currentLinks) {
        const activeCompanies = new Set(currentLinks.flatMap((d) => [d.source, d.target])).size;
        const totalValue = d3.sum(currentLinks, (d) => d.amount_usd);
        d3.select("#stat-day").text(`${day} / ${TOTAL_DAYS}`);
        d3.select("#stat-date").text(d3.timeFormat("%Y-%m-%d")(dateByDay.get(day)));
        d3.select("#stat-companies").text(`${activeCompanies}`);
        d3.select("#stat-links").text(`${currentLinks.length}`);
        d3.select("#stat-value").text(formatUsd(totalValue));
    }
    // Part A & C — filter the day's transactions and join links by pair key
    // so new relationships fade in and disappearing ones fade out.
    function showDay(day) {
        const currentLinks = transactions.filter((d) => d.day === day);
        displayedLinks = currentLinks;
        linkGroup
            .selectAll("line")
            .data(currentLinks, (d) => linkKey(d.source, d.target))
            .join((enter) => enter
            .append("line")
            .attr("x1", (d) => byId.get(d.source)?.x ?? 0)
            .attr("y1", (d) => byId.get(d.source)?.y ?? 0)
            .attr("x2", (d) => byId.get(d.target)?.x ?? 0)
            .attr("y2", (d) => byId.get(d.target)?.y ?? 0)
            .attr("stroke", (d) => TYPE_COLORS[d.transaction_type])
            .attr("stroke-width", (d) => widthScale(d.amount_usd))
            .attr("opacity", 0)
            .call((enterSelection) => enterSelection
            .transition()
            .duration(400)
            .attr("opacity", 0.75)), (update) => update.call((updateSelection) => updateSelection
            .transition()
            .duration(400)
            .attr("stroke", (d) => TYPE_COLORS[d.transaction_type])
            .attr("stroke-width", (d) => widthScale(d.amount_usd))
            .attr("opacity", 0.75)), (exit) => exit.transition().duration(400).attr("opacity", 0).remove())
            .on("mouseover", function (event, d) {
            d3.select(this).attr("opacity", 1);
            const source = byId.get(d.source);
            const target = byId.get(d.target);
            tooltip.style("opacity", 1).html(`
                    <strong>${source.company_name} &harr; ${target.company_name}</strong><br>
                    Type: ${d.transaction_type}<br>
                    Amount: ${formatUsd(d.amount_usd)}<br>
                    Transactions: ${d.transaction_count}
                `);
        })
            .on("mousemove", function (event) {
            tooltip
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY + 12}px`);
        })
            .on("mouseout", function () {
            d3.select(this).attr("opacity", 0.75);
            tooltip.style("opacity", 0);
        });
        // Part B — node size encodes the day's transaction volume.
        node.transition()
            .duration(400)
            .attr("r", (d) => sizeScale(calculateVolume(d.id, currentLinks)))
            .attr("opacity", (d) => calculateVolume(d.id, currentLinks) > 0 ? 1 : 0.3);
        d3.select("#time-slider").property("value", day);
        updateStats(day, currentLinks);
    }
    // Part C — Play, Pause, Reset, and a scrubbable time slider.
    let currentDay = 1;
    let timer = null;
    function play() {
        if (timer)
            return;
        if (currentDay > TOTAL_DAYS) {
            currentDay = 1;
        }
        timer = d3.interval(() => {
            showDay(currentDay);
            currentDay += 1;
            if (currentDay > TOTAL_DAYS) {
                pause();
            }
        }, FRAME_MS);
    }
    function pause() {
        if (timer) {
            timer.stop();
            timer = null;
        }
    }
    function reset() {
        pause();
        currentDay = 1;
        showDay(1);
    }
    d3.select("#play").on("click", play);
    d3.select("#pause").on("click", pause);
    d3.select("#reset").on("click", reset);
    d3.select("#time-slider").on("input", (event) => {
        pause();
        currentDay = +event.target.value;
        showDay(currentDay);
    });
    showDay(1);
}
async function main() {
    const [companies, transactions] = await loadData();
    computeStableLayout(companies, transactions);
    buildLegends();
    drawNetwork(companies, transactions);
}
main();
export {};
//# sourceMappingURL=lab7.js.map