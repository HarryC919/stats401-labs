async function loadData() {
    const data = await d3.json("../data/lab6_assignment_gdp.json");
    if (!data) {
        throw new Error("Failed to load hierarchy JSON");
    }
    return data;
}
function drawTree(data) {
    const width = 1000;
    const nodeHeight = 26;
    const nodeWidth = 170;
    const marginTop = 20;
    const marginBottom = 20;
    const root = d3.hierarchy(data);
    root.sum((d) => d.gdp_amount ?? 0);
    const treeLayout = d3
        .tree()
        .nodeSize([nodeHeight, nodeWidth]);
    const svg = d3.select("#tree").append("svg").attr("width", width);
    const treeGroup = svg.append("g");
    const linkGenerator = d3
        .linkHorizontal()
        .x((d) => d.y)
        .y((d) => d.x);
    function updateTree() {
        const treeRoot = treeLayout(root);
        let minX = Infinity;
        let maxX = -Infinity;
        treeRoot.each((d) => {
            if (d.x < minX)
                minX = d.x;
            if (d.x > maxX)
                maxX = d.x;
        });
        svg.attr("height", maxX - minX + marginTop + marginBottom);
        treeGroup.attr("transform", `translate(100,${marginTop - minX})`);
        treeGroup
            .selectAll("path.link")
            .data(treeRoot.links(), (d) => d.target.data.name)
            .join("path")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke", "#999")
            .attr("d", linkGenerator);
        const nodes = treeGroup
            .selectAll("g.node")
            .data(treeRoot.descendants(), (d) => d.data.name)
            .join((enter) => {
            const g = enter.append("g").attr("class", "node");
            g.append("circle").attr("r", 6);
            g.append("text").attr("dy", "0.35em");
            g.on("click", (event, d) => toggleNode(d));
            return g;
        });
        nodes.attr("transform", (d) => `translate(${d.y},${d.x})`);
        nodes
            .select("circle")
            .attr("fill", (d) => d.children || d._children ? "steelblue" : "orange");
        nodes
            .select("text")
            .attr("x", (d) => (d.children || d._children ? -10 : 10))
            .attr("text-anchor", (d) => d.children || d._children ? "end" : "start")
            .text((d) => d.data.name);
    }
    function toggleNode(d) {
        if (d.children) {
            d._children = d.children;
            d.children = undefined;
        }
        else {
            d.children = d._children;
            d._children = undefined;
        }
        updateTree();
    }
    updateTree();
}
function getAncestor(d, depth) {
    let current = d;
    while (current.depth > depth && current.parent) {
        current = current.parent;
    }
    return current.data.name;
}
const statusScale = d3
    .scaleOrdinal()
    .domain(["Increase", "Unchanged", "Decrease"])
    .range(["#2ca02c", "#7f7f7f", "#d62728"]);
function drawStatusLegend() {
    const items = d3
        .select("#status-legend")
        .selectAll("span")
        .data(statusScale.domain())
        .join("span")
        .attr("class", "legend-item");
    items
        .append("span")
        .style("display", "inline-block")
        .style("width", "12px")
        .style("height", "12px")
        .style("margin-right", "6px")
        .style("vertical-align", "middle")
        .style("border-radius", "2px")
        .style("background", (d) => statusScale(d));
    items
        .append("span")
        .style("margin-right", "14px")
        .text((d) => d);
}
function drawGdpTreemap(containerId, data, tile) {
    const width = 900;
    const height = 550;
    const hierarchy = d3
        .hierarchy(data)
        .sum((d) => d.gdp_amount ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const treemapLayout = d3
        .treemap()
        .tile(tile)
        .size([width, height])
        .paddingInner(2)
        .paddingOuter(4);
    const root = treemapLayout(hierarchy);
    const svg = d3
        .select(containerId)
        .append("svg")
        .attr("width", width)
        .attr("height", height);
    const tooltip = d3.select("#tooltip");
    const cell = svg
        .selectAll("g.cell")
        .data(root.leaves())
        .join("g")
        .attr("class", "cell")
        .attr("transform", (d) => `translate(${d.x0},${d.y0})`);
    cell.append("rect")
        .attr("width", (d) => d.x1 - d.x0)
        .attr("height", (d) => d.y1 - d.y0)
        .attr("fill", (d) => statusScale(d.data.gdp_status ?? "Unchanged"));
    cell.append("text")
        .attr("fill", "#fff")
        .attr("x", 5)
        .attr("y", 18)
        .text((d) => (d.x1 - d.x0 > 34 && d.y1 - d.y0 > 16 ? d.data.name : ""));
    cell.on("mouseover", (event, d) => {
        tooltip.style("opacity", 1).html(`
            <strong>${d.data.name}</strong>
            <br>
            ${getAncestor(d, 1)} / ${getAncestor(d, 2)}
            <br>
            GDP: ${d.data.gdp_amount} billion USD
            <br>
            Status: ${d.data.gdp_status}
        `);
    })
        .on("mousemove", (event) => {
        tooltip
            .style("left", `${event.pageX + 10}px`)
            .style("top", `${event.pageY + 10}px`);
    })
        .on("mouseout", () => {
        tooltip.style("opacity", 0);
    });
}
async function main() {
    const data = await loadData();
    drawTree(data);
    drawStatusLegend();
    drawGdpTreemap("#treemap-squarify", data, d3.treemapSquarify);
    drawGdpTreemap("#treemap-slicedice", data, d3.treemapSliceDice);
}
main();
export {};
//# sourceMappingURL=lab6.js.map