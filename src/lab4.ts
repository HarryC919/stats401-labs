export {};

interface TweetRow {
    date: Date;
    sentimentScore: number;
}

interface DailySentiment {
    date: Date;
    mean: number;
    count: number;
}

interface WeeklySentiment {
    date: Date;
    mean: number;
}

async function drawChart(): Promise<void> {
    const width: number = 800;
    const height: number = 500;

    const margin = {
        top: 40 as number,
        right: 40 as number,
        bottom: 70 as number,
        left: 70 as number,
    };

    const parseDate = d3.timeParse("%Y-%m-%d");

    const raw = await d3.csv("../data/lab4_clean_tweets.csv");

    const data: TweetRow[] = raw
        .map((d): TweetRow | null => {
            const date = parseDate(d.date ?? "");
            const score = Number(d.sentiment_score);

            if (date === null || Number.isNaN(score)) {
                return null;
            }

            return { date, sentimentScore: score };
        })
        .filter((d): d is TweetRow => d !== null);

    const daily: DailySentiment[] = d3
        .rollups(
            data,
            (v) => ({
                mean: d3.mean(v, (d) => d.sentimentScore) ?? 0,
                count: v.length,
            }),
            (d) => d3.timeDay.floor(d.date).getTime(),
        )
        .map(([time, stats]) => ({
            date: new Date(time),
            mean: stats.mean,
            count: stats.count,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    const weekly: WeeklySentiment[] = d3
        .rollups(
            data,
            (v) => ({
                mean: d3.mean(v, (d) => d.sentimentScore) ?? 0,
                // Plot at the average date of the week's tweets, so
                // partial first/last weeks stay inside the data range.
                date: new Date(d3.mean(v, (d) => d.date.getTime()) ?? 0),
            }),
            (d) => d3.timeWeek.floor(d.date).getTime(),
        )
        .map(([, stats]) => ({ date: stats.date, mean: stats.mean }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Mapping functions
    const xScale = d3
        .scaleTime()
        .domain(d3.extent(daily, (d) => d.date) as [Date, Date])
        .range([margin.left, width - margin.right]);

    const [minMean, maxMean] = d3.extent(daily, (d) => d.mean) as [
        number,
        number,
    ];
    const yPadding = (maxMean - minMean) * 0.15;

    const yScale = d3
        .scaleLinear()
        .domain([minMean - yPadding, maxMean + yPadding])
        .nice()
        .range([height - margin.bottom, margin.top]);

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
        .call(
            d3
                .axisBottom(xScale)
                .ticks(d3.timeMonth)
                .tickFormat(d3.timeFormat("%b") as never),
        );

    svg.append("g")
        .attr("transform", `translate(${margin.left}, 0)`)
        .call(d3.axisLeft(yScale));

    // Neutral baseline
    svg.append("line")
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", yScale(0))
        .attr("y2", yScale(0))
        .attr("stroke", "#333333")
        .attr("stroke-dasharray", "4 4")
        .attr("opacity", 0.4);

    // xlabel
    svg.append("text")
        .attr("x", margin.left + (width - margin.left - margin.right) / 2)
        .attr("y", height - 25)
        .attr("text-anchor", "middle")
        .text("Date (2026)");

    // ylabel
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .text("Average sentiment score");

    // Daily averages
    svg.selectAll(".daily-dot")
        .data(daily)
        .join("circle")
        .attr("class", "daily-dot")
        .attr("cx", (d) => xScale(d.date))
        .attr("cy", (d) => yScale(d.mean))
        .attr("r", 3)
        .attr("fill", "#4C78A8")
        .attr("opacity", 0.35)
        .on("mouseover", function (event, d) {
            d3.select(this).attr("opacity", 1);
            tooltip.style("opacity", 1).html(`
                    <strong>${d3.timeFormat("%b %d, %Y")(d.date)}</strong><br>
                    Avg sentiment: ${d.mean.toFixed(3)}<br>
                    Tweets: ${d.count}<br>
                `);
        })
        .on("mousemove", function (event) {
            tooltip
                .style("left", `${event.pageX + 10}px`)
                .style("top", `${event.pageY + 10}px`);
        })
        .on("mouseout", function () {
            d3.select(this).attr("opacity", 0.35);
            tooltip.style("opacity", 0);
        });

    // Weekly trend line
    const line = d3
        .line<WeeklySentiment>()
        .x((d) => xScale(d.date))
        .y((d) => yScale(d.mean))
        .curve(d3.curveMonotoneX);

    svg.append("path")
        .datum(weekly)
        .attr("fill", "none")
        .attr("stroke", "#E45756")
        .attr("stroke-width", 2.5)
        .attr("d", line);

    // Legend
    const legend = svg
        .append("g")
        .attr(
            "transform",
            `translate(${width - margin.right - 150}, ${margin.top})`,
        );

    legend
        .append("circle")
        .attr("cx", 6)
        .attr("cy", 0)
        .attr("r", 4)
        .attr("fill", "#4C78A8")
        .attr("opacity", 0.6);

    legend.append("text").attr("x", 18).attr("y", 4).text("Daily average");

    legend
        .append("line")
        .attr("x1", 0)
        .attr("x2", 12)
        .attr("y1", 24)
        .attr("y2", 24)
        .attr("stroke", "#E45756")
        .attr("stroke-width", 2.5);

    legend.append("text").attr("x", 18).attr("y", 28).text("Weekly average");
}

void drawChart();
