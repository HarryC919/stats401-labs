export {};

async function drawChart(): Promise<void> {
    interface NodeDatum extends d3.SimulationNodeDatum {
        id: string;
        name: string;
        group: string;
        activity_count: number;
        level: number;
    }
    interface LinkDatum extends d3.SimulationLinkDatum<NodeDatum> {
        weight: number;
        type: string;
    }

    Promise.all([
        d3.csv<NodeDatum>("../data/lab5_small_nodes.csv", (d) => ({
            id: d.id,
            name: d.name,
            group: d.group,
            activity_count: +d.activity_count,
            level: +d.level,
        })),
        d3.csv<LinkDatum>("../data/lab5_small_links.csv", (d) => ({
            source: d.source,
            target: d.target,
            weight: +d.weight,
            type: d.type,
        })),
    ]).then(([nodes, links]) => {
        const width = 900;
        const height = 600;

        const svg = d3
            .select("#chart")
            .append("svg")
            .attr("width", width)
            .attr("height", height);
        const tooltip = d3.select("#tooltip");

        const simulation = d3
            .forceSimulation(nodes)
            .force(
                "link",
                d3
                    .forceLink<NodeDatum, LinkDatum>(links)
                    .id((d) => d.id)
                    .distance(100),
            )
            .force("charge", d3.forceManyBody().strength(-250))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius(25));

        const link = svg
            .append("g")
            .attr("class", "links")
            .selectAll<SVGLineElement, LinkDatum>("line")
            .data(links)
            .join("line")
            .attr("stroke", "#999")
            .attr("stroke-opacity", 0.6);

        const node = svg
            .append("g")
            .attr("class", "nodes")
            .selectAll<SVGCircleElement, NodeDatum>("circle")
            .data(nodes)
            .join("circle")
            .attr("r", 10)
            .attr("fill", "steelblue");

        const sizeScale = d3
            .scaleSqrt()
            .domain(
                d3.extent(nodes, (d) => d.activity_count) as [number, number],
            )
            .range([6, 18]);

        node.attr("r", (d) => sizeScale(d.activity_count));

        const groups = Array.from(new Set(nodes.map((d) => d.group)));

        const colorScale = d3
            .scaleOrdinal()
            .domain(groups)
            .range(d3.schemeTableau10);

        node.attr("fill", (d) => colorScale(d.group) as string);

        const linkWidthScale = d3
            .scaleLinear()
            .domain(d3.extent(links, (d) => d.weight) as [number, number])
            .range([1, 6]);

        link.attr("stroke-width", (d) => linkWidthScale(d.weight));

        const linkTypes = Array.from(new Set(links.map((d) => d.type)));

        const linkColorScale = d3
            .scaleOrdinal()
            .domain(linkTypes)
            .range(d3.schemeSet2);

        link.attr("stroke", (d) => linkColorScale(d.type) as string);

        const label = svg
            .append("g")
            .selectAll<SVGTextElement, NodeDatum>("text")
            .data(nodes)
            .join("text")
            .text((d) => d.name)
            .attr("font-size", 12)
            .attr("dx", 12)
            .attr("dy", 4);

        simulation.on("tick", () => {
            link.attr("x1", (d) => (d.source as NodeDatum).x as number)
                .attr("y1", (d) => (d.source as NodeDatum).y as number)
                .attr("x2", (d) => (d.target as NodeDatum).x as number)
                .attr("y2", (d) => (d.target as NodeDatum).y as number);

            node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);

            label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
        });

        function dragStarted(
            event: d3.D3DragEvent<SVGCircleElement, NodeDatum, NodeDatum>,
            d: NodeDatum,
        ) {
            if (!event.active) {
                simulation.alphaTarget(0.3).restart();
            }

            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(
            event: d3.D3DragEvent<SVGCircleElement, NodeDatum, NodeDatum>,
            d: NodeDatum,
        ) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragEnded(
            event: d3.D3DragEvent<SVGCircleElement, NodeDatum, NodeDatum>,
            d: NodeDatum,
        ) {
            if (!event.active) {
                simulation.alphaTarget(0);
            }

            d.fx = null;
            d.fy = null;
        }

        node.call(
            d3
                .drag<SVGCircleElement, NodeDatum>()
                .on("start", dragStarted)
                .on("drag", dragged)
                .on("end", dragEnded),
        );

        function isConnected(nodeA: NodeDatum, nodeB: NodeDatum): boolean {
            return links.some(
                (link) =>
                    ((link.source as NodeDatum).id === nodeA.id &&
                        (link.target as NodeDatum).id === nodeB.id) ||
                    ((link.source as NodeDatum).id === nodeB.id &&
                        (link.target as NodeDatum).id === nodeA.id),
            );
        }

        node.on("mouseover", function (event, d) {
            node.attr("opacity", (other) =>
                other.id === d.id || isConnected(d, other) ? 1 : 0.15,
            );

            link.attr("opacity", (l) =>
                (l.source as NodeDatum).id === d.id ||
                (l.target as NodeDatum).id === d.id
                    ? 1
                    : 0.1,
            );

            label.attr("opacity", (other) =>
                other.id === d.id || isConnected(d, other) ? 1 : 0.15,
            );
        });

        node.on("mouseout", function () {
            node.attr("opacity", 1);
            link.attr("opacity", 0.6);
            label.attr("opacity", 1);
        });

        node.on("mouseover.tooltip", function (event, d) {
            tooltip.style("opacity", 1).html(`
                    <strong>${d.name}</strong>
                    <br>
                    Group: ${d.group}
                    <br>
                    Activity: ${d.activity_count}
                    <br>
                    Level: ${d.level}
                `);
        })
            .on("mousemove.tooltip", function (event) {
                tooltip
                    .style("left", `${event.pageX + 10}px`)
                    .style("top", `${event.pageY + 10}px`);
            })
            .on("mouseout.tooltip", function () {
                tooltip.style("opacity", 0);
            });

        const matrixData: {
            row: string;
            col: string;
            weight: number;
            type: string | null;
        }[] = [];

        nodes.forEach((rowNode) => {
            nodes.forEach((colNode) => {
                const foundLink = links.find(
                    (link) =>
                        ((link.source as NodeDatum).id === rowNode.id &&
                            (link.target as NodeDatum).id === colNode.id) ||
                        ((link.source as NodeDatum).id === colNode.id &&
                            (link.target as NodeDatum).id === rowNode.id),
                );

                matrixData.push({
                    row: rowNode.id,
                    col: colNode.id,
                    weight: foundLink ? foundLink.weight : 0,
                    type: foundLink ? foundLink.type : null,
                });
            });
        });

        const matrixSize = 500;

        const matrixX = d3
            .scaleBand()
            .domain(nodes.map((d) => d.id))
            .range([0, matrixSize])
            .padding(0.02);

        const matrixY = d3
            .scaleBand()
            .domain(nodes.map((d) => d.id))
            .range([0, matrixSize])
            .padding(0.02);

        const matrixSvg = d3
            .select("#matrix")
            .append("svg")
            .attr("width", 650)
            .attr("height", 650);

        const matrixGroup = matrixSvg
            .append("g")
            .attr("transform", "translate(100,50)");

        const opacityScale = d3
            .scaleLinear()
            .domain(d3.extent(links, (d) => d.weight) as [number, number])
            .range([0.25, 1]);

        matrixGroup
            .selectAll("rect")
            .data(matrixData)
            .join("rect")
            .attr("x", (d) => matrixX(d.col) as number)
            .attr("y", (d) => matrixY(d.row) as number)
            .attr("width", matrixX.bandwidth())
            .attr("height", matrixY.bandwidth())
            .attr("fill", (d) => (d.weight > 0 ? "steelblue" : "#f3f3f3"))
            .attr("fill-opacity", (d) =>
                d.weight > 0 ? opacityScale(d.weight) : 1,
            );
    });
}

drawChart();
