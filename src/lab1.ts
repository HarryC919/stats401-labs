export {};

interface Student {
    name: string;
    score: number;
}

const chart = d3.select<HTMLDivElement, unknown>("#chart");
const statusMessage = d3.select<HTMLParagraphElement, unknown>("#status");

async function drawChart(): Promise<void> {
    try {
        const data = await d3.csv<Student>("../data/students.csv", d => ({
            name: d.name,
            score: +d.score
        }));

        const width = 920;
        const height = 500;
        const margin = { top: 24, right: 24, bottom: 120, left: 24 };
        const baseline = height - margin.bottom;

        const x = d3.scaleBand<string>()
            .domain(data.map(d => d.name))
            .range([margin.left, width - margin.right])
            .padding(0.28);

        const y = d3.scaleLinear()
            .domain([0, 100])
            .range([baseline, margin.top]);

        const svg = chart
            .append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("role", "img")
            .attr("aria-labelledby", "chart-title chart-description");

        svg.append("title")
            .attr("id", "chart-title")
            .text("Student score bar chart");

        svg.append("desc")
            .attr("id", "chart-description")
            .text("Eight vertical bars compare student scores from 66 to 95.");

        svg.append("line")
            .attr("class", "chart-baseline")
            .attr("x1", margin.left)
            .attr("x2", width - margin.right)
            .attr("y1", baseline)
            .attr("y2", baseline);

        const bars = svg
            .selectAll<SVGRectElement, Student>("rect")
            .data(data)
            .join("rect")
            .attr("class", "score-bar")
            .attr("x", d => x(d.name) ?? 0)
            .attr("y", d => y(d.score))
            .attr("width", x.bandwidth())
            .attr("height", d => baseline - y(d.score))
            .attr("rx", 8);

        bars.append("title")
            .text(d => `${d.name}: ${d.score}`);

        const labels = svg
            .selectAll<SVGGElement, Student>("g.student-label")
            .data(data)
            .join("g")
            .attr("class", "student-label")
            .attr("transform", d => {
                const center = (x(d.name) ?? 0) + x.bandwidth() / 2;
                return `translate(${center}, ${baseline})`;
            });

        labels.append("text")
            .attr("class", "score-label")
            .attr("y", 34)
            .text(d => d.score);

        labels.append("text")
            .attr("class", "name-label")
            .attr("y", 64)
            .text(d => d.name);

        statusMessage.remove();
    } catch (error: unknown) {
        statusMessage
            .classed("error", true)
            .text("The student data could not be loaded. Run this site from a local web server and try again.");
        console.error("Unable to draw the student score chart:", error);
    }
}

void drawChart();
