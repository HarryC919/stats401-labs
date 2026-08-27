export {};

async function drawChart(): Promise<void> {
    const width: number = 800;
    const height: number = 500;

    const margin = {
        top: 40 as number,
        right: 170 as number,
        bottom: 70 as number,
        left: 70 as number,
    };

    const data = await d3.csv("../data/cities_multivariate.csv", (d) => ({
        city: d.city as string,
        population: +d.population as number,
        temp_c: +d.temp_c as number,
        development_level: d.development_level as string,
        region: d.region as string,
    }));

    const grouped = d3.group(data, (d) => d.region);
    const regions: string[] = Array.from(grouped.keys());

    // Mapping functions
    const xOuter = d3
        .scaleBand<string>()
        .domain(regions)
        .range([margin.left, width - margin.right])
        .padding(0.2);

    const xInner = new Map<string, d3.ScaleBand<string>>(
        Array.from(grouped, ([regions, cities]) => [
            regions,
            d3
                .scaleBand<string>()
                .domain(cities.map((c) => c.city))
                .range([0, xOuter.bandwidth()])
                .paddingInner(0.1),
        ]),
    );

    const yScale = d3
        .scaleLinear()
        .domain([0, d3.max(data, (d) => d.population)] as [number, number])
        .nice()
        .range([height - margin.bottom, margin.top]);

    const [minTemp, maxTemp] = d3.extent(data, (d) => d.temp_c) as [
        number,
        number,
    ];

    const temperatureScale = d3
        .scaleSequential(d3.interpolateRdBu)
        .domain([maxTemp, minTemp]);

    const developmentLevelScale = d3
        .scaleOrdinal<string, number>()
        .domain(["Low", "Medium", "High"])
        .range([1, 2.5, 4]);

    // Tooltip
    const tooltip = d3.select("#tooltip");

    // Init SVG
    const svg = d3
        .select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    svg.append("g")
        .attr("transform", `translate(0, ${height - margin.bottom})`)
        .call(d3.axisBottom(xOuter));

    svg.append("g")
        .attr("transform", `translate(${margin.left}, 0)`)
        .call(d3.axisLeft(yScale));

    // xlabel
    svg.append("text")
        .attr("x", margin.left + (width - margin.left - margin.right) / 2)
        .attr("y", height - 20)
        .attr("text-anchor", "middle")
        .text("Region");

    // ylabel
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .text("Population (millions)");

    // Bars
    svg.selectAll("rect")
        .data(data)
        .join("rect")
        .attr("x", (d) => xOuter(d.region)! + xInner.get(d.region)!(d.city)!)
        .attr("width", (d) => xInner.get(d.region)!.bandwidth())
        .attr("y", (d) => yScale(d.population))
        .attr("height", (d) => yScale(0) - yScale(d.population))
        .attr("fill", (d) => temperatureScale(d.temp_c))
        .attr("stroke", "#333333")
        .attr("stroke-width", (d) => developmentLevelScale(d.development_level))
        .on("mouseover", function (event, d) {
            tooltip.style("opacity", 1).html(`
                    <strong>${d.city}</strong><br>
                    Region: ${d.region}<br>
                    Population: ${d.population}<br>
                    Temperature: ${d.temp_c}°C<br>
                    Development Level: ${d.development_level}<br>
                `);
        })
        .on("mousemove", function (event) {
            tooltip
                .style("left", `${event.pageX + 10}px`)
                .style("top", `${event.pageY + 10}px`);
        })
        .on("mouseout", function () {
            tooltip.style("opacity", 0);
        });

    // City Label
    svg.selectAll(".city-label")
        .data(data)
        .join("text")
        .attr("class", "city-label")
        .attr(
            "x",
            (d) =>
                xOuter(d.region)! +
                xInner.get(d.region)!(d.city)! +
                xInner.get(d.region)!.bandwidth() / 2,
        )
        .attr("y", (d) => yScale(d.population) - 4)
        .attr("text-anchor", "middle")
        .attr("font-size", 8)
        .text((d) => d.city);

    // Legends
    const legend = svg
        .append("g")
        .attr("transform", `translate(${width - margin.right + 25}, 60)`);

    legend
        .append("text")
        .attr("x", 60)
        .attr("y", -12)
        .attr("text-anchor", "middle")
        .attr("font-weight", "bold")
        .text("Development Level");

    const developmentLevel: string[] = ["Low", "Medium", "High"];

    const legendDevelopmentLevel = legend
        .selectAll(".legend-item")
        .data(developmentLevel)
        .join("g")
        .attr("class", "legend-item")
        .attr("transform", (d, i) => `translate(0, ${i * 28})`);

    legendDevelopmentLevel
        .append("rect")
        .attr("height", 12)
        .attr("width", 12)
        .attr("stroke", "#333333")
        .attr("fill", "#FFFFFF")
        .attr("stroke-width", (d) => developmentLevelScale(d));

    legendDevelopmentLevel
        .append("text")
        .attr("x", 16)
        .attr("y", 12)
        .text((d) => d);

    const gradient = svg
        .append("defs")
        .append("linearGradient")
        .attr("id", "temp-gradient")
        .attr("x1", "0%")
        .attr("y1", "0%")
        .attr("x2", "100%")
        .attr("y2", "0%");

    const stopCount = 10;
    gradient
        .selectAll("stop")
        .data(d3.range(stopCount))
        .join("stop")
        .attr("offset", (d) => `${(d / (stopCount - 1)) * 100}%`)
        .attr("stop-color", (d) =>
            temperatureScale(
                minTemp + (d / (stopCount - 1)) * (maxTemp - minTemp),
            ),
        );

    const legendTemperature = svg
        .append("g")
        .attr(
            "transform",
            `translate(${width - margin.right + 25}, ${60 + 3 * 28 + 30})`,
        );

    legendTemperature
        .append("text")
        .attr("y", -8)
        .attr("font-weight", "bold")
        .text("Temperature (°C)");

    legendTemperature
        .append("rect")
        .attr("width", 120)
        .attr("height", 12)
        .style("fill", "url(#temp-gradient)")
        .attr("stroke", "#333333")
        .attr("stroke-width", 0.5);

    legendTemperature
        .append("text")
        .attr("x", 0)
        .attr("y", 32)
        .attr("font-size", 11)
        .text(`${minTemp}`);

    legendTemperature
        .append("text")
        .attr("x", 120)
        .attr("y", 32)
        .attr("text-anchor", "end")
        .attr("font-size", 11)
        .text(`${maxTemp}`);
}

void drawChart();
