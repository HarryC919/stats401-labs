export {};

interface WeatherDatum {
    date: Date;
    city: string;
    country: string;
    temperature_c: number;
    humidity_pct: number;
    wind_speed_mps: number;
    pressure_hpa: number;
    precipitation_mm: number;
}

async function loadData(): Promise<WeatherDatum[]> {
    // Task 1 & 2
    const data = await d3.csv<WeatherDatum>(
        "../data/lab7_historical_weather.csv",
        (d) => ({
            date: d3.timeParse("%Y-%m-%d")(d.date) as Date,
            city: d.city as string,
            country: d.country as string,
            temperature_c: +d.temperature_c,
            humidity_pct: +d.humidity_pct,
            wind_speed_mps: +d.wind_speed_mps,
            pressure_hpa: +d.pressure_hpa,
            precipitation_mm: +d.precipitation_mm,
        }),
    );
    if (!data) {
        throw new Error("Failed to load weather CSV");
    }
    return data;
}

function drawSVG(data: WeatherDatum[]): void {
    // Task 3
    const cityData = data
        .filter((d) => d.city === "Tokyo")
        .sort((a, b) => d3.ascending(a.date, b.date));

    if (cityData.length === 0) {
        d3.select("#chart").append("p").text("No data for the selected city");
        return;
    }

    const width = 900;
    const height = 500;

    const margin = {
        top: 40,
        right: 40,
        bottom: 70,
        left: 70,
    };

    const svg = d3
        .select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    const [dateMin, dateMax] = d3.extent(cityData, (d) => d.date);

    const xScale = d3
        .scaleTime()
        .domain([dateMin!, dateMax!])
        .range([margin.left, width - margin.right]);

    const [tempMin, tempMax] = d3.extent(cityData, (d) => d.temperature_c);

    const yScale = d3
        .scaleLinear()
        .domain([tempMin!, tempMax!])
        .nice()
        .range([height - margin.bottom, margin.top]);

    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(xScale));

    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(yScale));

    const line = d3
        .line<WeatherDatum>()
        .x((d) => xScale(d.date))
        .y((d) => yScale(d.temperature_c));

    svg.append("path")
        .datum(cityData)
        .attr("fill", "none")
        .attr("stroke", "steelblue")
        .attr("stroke-width", 2)
        .attr("d", line);

    // Task 4
    const selectedCities = ["Tokyo", "London", "New York"];

    const filteredData = data.filter((d) => selectedCities.includes(d.city));

    const grouped = d3.group(filteredData, (d) => d.city);

    const colorScale = d3
        .scaleOrdinal<string>()
        .domain(selectedCities)
        .range(d3.schemeTableau10);

    svg.selectAll(".city-line")
        .data(grouped)
        .join("path")
        .attr("class", "city-line")
        .attr("fill", "none")
        .attr("stroke", (d) => colorScale(d[0]))
        .attr("stroke-width", 2)
        .attr("d", (d) => line(d[1]));
}
