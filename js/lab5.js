const districtOrder = ["Central", "North", "South", "East", "West"];
const stationTypeOrder = ["Terminal", "Transfer", "Local"];
const routeTypeOrder = ["Metro", "Express", "Shuttle"];
const districtColors = {
    Central: "#4e79a7",
    North: "#f28e2b",
    South: "#e15759",
    East: "#76b7b2",
    West: "#59a14f",
};
const routeTypeColors = {
    Metro: "#66c2a5",
    Express: "#fc8d62",
    Shuttle: "#8da0cb",
};
const stationShapes = {
    Local: d3.symbolCircle,
    Transfer: d3.symbolSquare,
    Terminal: d3.symbolTriangle,
};
async function drawLab5() {
    const [stations, routes] = await Promise.all([
        d3.csv("../data/lab5_assignment_stations.csv", (d) => ({
            id: d.id,
            station_name: d.station_name,
            district: d.district,
            daily_passengers: +d.daily_passengers,
            station_type: d.station_type,
        })),
        d3.csv("../data/lab5_assignment_routes.csv", (d) => ({
            source: d.source,
            target: d.target,
            travel_time_min: +d.travel_time_min,
            route_type: d.route_type,
        })),
    ]);
    drawNodeLink(stations, routes);
    drawMatrix(stations, routes);
}
// Part A — force-directed node-link diagram
function drawNodeLink(stations, routes) {
    const width = 1000;
    const height = 700;
    const svg = d3
        .select("#chart")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", width)
        .attr("height", height);
    const tooltip = d3.select("#tooltip");
    const sizeScale = d3
        .scaleLinear()
        .domain([0, d3.max(stations, (d) => d.daily_passengers)])
        .range([0, 420]);
    const timeWidthScale = d3
        .scaleLinear()
        .domain(d3.extent(routes, (d) => d.travel_time_min))
        .range([1, 6]);
    // sqrt(area) encloses each circle, square, and equilateral triangle.
    const nodeRadius = (d) => Math.sqrt(sizeScale(d.daily_passengers));
    const link = svg
        .append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(routes)
        .join("line")
        .attr("stroke", (d) => routeTypeColors[d.route_type])
        .attr("stroke-opacity", 0.65)
        .attr("stroke-width", (d) => timeWidthScale(d.travel_time_min));
    const node = svg
        .append("g")
        .attr("class", "nodes")
        .selectAll("path")
        .data(stations)
        .join("path")
        .attr("d", (d) => d3.symbol(stationShapes[d.station_type], sizeScale(d.daily_passengers))())
        .attr("fill", (d) => districtColors[d.district])
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.2);
    const simulation = d3
        .forceSimulation(stations)
        .force("link", d3
        .forceLink(routes)
        .id((d) => d.id)
        .distance(80))
        .force("charge", d3.forceManyBody().strength(-140))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius((d) => nodeRadius(d) + 3));
    simulation.on("tick", () => {
        stations.forEach((d) => {
            const r = nodeRadius(d) + 2;
            d.x = Math.max(r, Math.min(width - r, d.x ?? width / 2));
            d.y = Math.max(r, Math.min(height - r, d.y ?? height / 2));
        });
        link.attr("x1", (d) => d.source.x)
            .attr("y1", (d) => d.source.y)
            .attr("x2", (d) => d.target.x)
            .attr("y2", (d) => d.target.y);
        node.attr("transform", (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });
    function dragStarted(event, d) {
        if (!event.active) {
            simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
    }
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    function dragEnded(event, d) {
        if (!event.active) {
            simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
    }
    node.call(d3
        .drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded));
    function isConnected(a, b) {
        return routes.some((r) => (r.source.id === a.id &&
            r.target.id === b.id) ||
            (r.source.id === b.id &&
                r.target.id === a.id));
    }
    node.on("mouseover.highlight", function (event, d) {
        node.attr("opacity", (other) => other.id === d.id || isConnected(d, other) ? 1 : 0.15);
        link.attr("stroke-opacity", (r) => r.source.id === d.id ||
            r.target.id === d.id
            ? 1
            : 0.08);
    });
    node.on("mouseout.highlight", function () {
        node.attr("opacity", 1);
        link.attr("stroke-opacity", 0.65);
    });
    node.on("mouseover.tooltip", function (event, d) {
        tooltip.style("opacity", 1).html(`
            <strong>${d.station_name}</strong><br>
            District: ${d.district}<br>
            Type: ${d.station_type}<br>
            Daily passengers: ${d.daily_passengers.toLocaleString()}
        `);
    })
        .on("mousemove.tooltip", function (event) {
        tooltip
            .style("left", `${event.pageX + 12}px`)
            .style("top", `${event.pageY + 12}px`);
    })
        .on("mouseout.tooltip", function () {
        tooltip.style("opacity", 0);
    });
    buildNodeLinkLegend();
}
function buildNodeLinkLegend() {
    const shapeLegend = d3.select("#shape-legend");
    stationTypeOrder.forEach((type) => {
        const item = shapeLegend.append("span").attr("class", "legend-item");
        item.append("svg")
            .attr("width", 16)
            .attr("height", 16)
            .append("path")
            .attr("d", d3.symbol(stationShapes[type], 110)())
            .attr("transform", "translate(8,8)")
            .attr("fill", "#667085");
        item.append("span").text(type);
    });
    const swatchRow = (container, entries) => {
        const root = d3.select(container);
        Object.entries(entries).forEach(([label, color]) => {
            const item = root.append("span").attr("class", "legend-item");
            item.append("span")
                .attr("class", "legend-swatch")
                .style("background", color);
            item.append("span").text(label);
        });
    };
    swatchRow("#district-legend", districtColors);
    swatchRow("#route-legend", routeTypeColors);
}
// Part B — adjacency matrix
function drawMatrix(stations, routes) {
    const ordered = [...stations].sort((a, b) => {
        const byDistrict = districtOrder.indexOf(a.district) -
            districtOrder.indexOf(b.district);
        if (byDistrict !== 0)
            return byDistrict;
        const byType = stationTypeOrder.indexOf(a.station_type) -
            stationTypeOrder.indexOf(b.station_type);
        if (byType !== 0)
            return byType;
        return parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10);
    });
    const orderIndex = new Map(ordered.map((d, i) => [d.id, i]));
    const byId = new Map(stations.map((d) => [d.id, d]));
    const cells = [];
    ordered.forEach((rowStation) => {
        ordered.forEach((colStation) => {
            const found = routes.find((r) => (r.source.id === rowStation.id &&
                r.target.id === colStation.id) ||
                (r.source.id === colStation.id &&
                    r.target.id === rowStation.id));
            cells.push({
                row: rowStation.id,
                col: colStation.id,
                travel_time_min: found ? found.travel_time_min : 0,
                route_type: found ? found.route_type : null,
            });
        });
    });
    const matrixSize = 620;
    const labelSpace = 92;
    const band = d3
        .scaleBand()
        .domain(ordered.map((d) => d.id))
        .range([0, matrixSize])
        .padding(0.05);
    const timeOpacityScale = d3
        .scaleLinear()
        .domain(d3.extent(routes, (d) => d.travel_time_min))
        .range([0.35, 1]);
    const matrixSvg = d3
        .select("#matrix")
        .append("svg")
        .attr("viewBox", `0 0 ${matrixSize + labelSpace + 8} ${matrixSize + labelSpace + 8}`)
        .attr("width", matrixSize + labelSpace + 8)
        .attr("height", matrixSize + labelSpace + 8);
    const g = matrixSvg
        .append("g")
        .attr("transform", `translate(${labelSpace},${labelSpace})`);
    const tooltip = d3.select("#tooltip");
    g.selectAll("rect.cell")
        .data(cells)
        .join("rect")
        .attr("class", "cell")
        .attr("x", (d) => band(d.col))
        .attr("y", (d) => band(d.row))
        .attr("width", band.bandwidth())
        .attr("height", band.bandwidth())
        .attr("fill", (d) => {
        if (d.route_type)
            return routeTypeColors[d.route_type];
        return d.row === d.col ? "#dde4ee" : "#f4f6f9";
    })
        .attr("fill-opacity", (d) => d.route_type ? timeOpacityScale(d.travel_time_min) : 1)
        .on("mouseover", function (event, d) {
        d3.select(this).attr("stroke", "#172033").attr("stroke-width", 1);
        const rowStation = byId.get(d.row);
        const colStation = byId.get(d.col);
        tooltip.style("opacity", 1).html(d.route_type
            ? `
                    <strong>${rowStation.station_name} &harr; ${colStation.station_name}</strong><br>
                    Route type: ${d.route_type}<br>
                    Travel time: ${d.travel_time_min} min
                `
            : `
                    <strong>${rowStation.station_name} &harr; ${colStation.station_name}</strong><br>
                    No direct connection
                `);
    })
        .on("mousemove", function (event) {
        tooltip
            .style("left", `${event.pageX + 12}px`)
            .style("top", `${event.pageY + 12}px`);
    })
        .on("mouseout", function () {
        d3.select(this).attr("stroke", null);
        tooltip.style("opacity", 0);
    });
    g.selectAll("text.row-label")
        .data(ordered)
        .join("text")
        .attr("class", "matrix-label")
        .attr("x", -6)
        .attr("y", (d) => band(d.id) + band.bandwidth() / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .attr("fill", (d) => districtColors[d.district])
        .text((d) => d.station_name);
    g.selectAll("text.col-label")
        .data(ordered)
        .join("text")
        .attr("class", "matrix-label")
        .attr("transform", (d) => `translate(${band(d.id) + band.bandwidth() / 2}, -6) rotate(-90)`)
        .attr("text-anchor", "start")
        .attr("dominant-baseline", "middle")
        .attr("fill", (d) => districtColors[d.district])
        .text((d) => d.station_name);
}
drawLab5();
export {};
//# sourceMappingURL=lab5.js.map