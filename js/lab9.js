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
async function loadGeoData() {
    const geo = await d3.json("../data/ne_50m_admin_0_countries.geojson");
    if (!geo ||
        geo.type !== "FeatureCollection" ||
        !Array.isArray(geo.features)) {
        throw new Error("Failed to load world GeoJSON");
    }
    return geo;
}
/**
 * ISO-3 key of a Natural Earth feature. A few admin-0 units (classic
 * offenders: France, Norway) carry "-99" in ISO_A3, which would silently
 * break the join; fall back to ADM0_A3, which is always populated.
 * ISO_A3_EH would also repair France/Norway, but it maps external
 * territories (Indian Ocean Territories, Ashmore and Cartier Islands) onto
 * "AUS" and would wrongly join those features to Australia's GDP row.
 */
function featureIso3(feature) {
    const iso = feature.properties.ISO_A3;
    if (iso && iso !== "-99") {
        return iso;
    }
    const adm = feature.properties.ADM0_A3;
    return adm && adm !== "-99" ? adm : "";
}
/**
 * Attach each top-50 GDP datum onto the matching feature via the ISO-3
 * Map, then verify the join BEFORE anything is drawn. Countries outside
 * the top 50 keep their joined value undefined — missing data, never 0.
 */
function joinGdp(geoData, stats) {
    const features = geoData.features;
    const gdpByIso3 = new Map(stats.map((d) => [d.iso3, d]));
    const joined = new Set();
    for (const feature of features) {
        const datum = gdpByIso3.get(featureIso3(feature));
        if (!datum) {
            continue; // no data is not zero GDP
        }
        feature.properties.country = datum.country;
        feature.properties.gdp_2025_billion_usd = datum.gdp_2025_billion_usd;
        feature.properties.rank = datum.rank;
        joined.add(datum.iso3);
    }
    // Verify the join before drawing (expect all 50 rows to match).
    console.log(`GDP join: matched ${joined.size}/${stats.length} CSV rows`);
    for (const datum of stats) {
        if (!joined.has(datum.iso3)) {
            console.warn(`No GeoJSON feature matches CSV iso3 "${datum.iso3}"`);
        }
    }
    for (const feature of features) {
        const iso = feature.properties.ISO_A3;
        if (!iso || iso === "-99") {
            console.warn(`"${feature.properties.ADMIN}" has ISO_A3 "${iso}"; joined via ADM0_A3 "${featureIso3(feature)}"`);
        }
    }
    if (joined.size !== stats.length) {
        throw new Error(`Incomplete GDP join: ${joined.size}/${stats.length} rows matched`);
    }
    return features;
}
// PART D — Shared state (declared early: both maps restyle through
// updateHighlight(), so the two views can never disagree)
/** One shared piece of state driving BOTH maps. */
let selectedIso3 = null;
/** A click pins the selection; while pinned, hovering cannot clear it. */
let selectionLocked = false;
const REST_STROKE = "white";
const REST_STROKE_WIDTH = 1;
const HOVER_STROKE = "#111";
const HOVER_STROKE_WIDTH = 2;
const SELECTED_STROKE = "#0b3954";
const SELECTED_STROKE_WIDTH = 2.5;
const DIM_OPACITY = 0.45;
// Each map keeps its exact selection type; the shared logic below is
// generic over element and parent types, so applying one handler set or
// one restyle pass to both maps needs no type assertions.
let choroplethPaths;
let cartogramCircles;
function featureOf(d) {
    return "feature" in d ? d.feature : d;
}
function isoOf(d) {
    return featureIso3(featureOf(d));
}
function countryName(d) {
    const feature = featureOf(d);
    return feature.properties.country ?? feature.properties.ADMIN;
}
function strokeOf(d) {
    return isoOf(d) === selectedIso3 ? SELECTED_STROKE : REST_STROKE;
}
function strokeWidthOf(d) {
    return isoOf(d) === selectedIso3
        ? SELECTED_STROKE_WIDTH
        : REST_STROKE_WIDTH;
}
/**
 * Restyle one map from the shared selection state: outline the selected
 * country and dim everything else. Generic over the element/datum/parent
 * types so each map's exact selection is accepted as-is.
 */
function restyleSelection(selection) {
    selection
        .attr("opacity", (d) => selectedIso3 && isoOf(d) !== selectedIso3 ? DIM_OPACITY : 1)
        .attr("stroke", strokeOf)
        .attr("stroke-width", strokeWidthOf);
}
/**
 * The ONLY place that restyles the maps from the shared selection state,
 * so the two views can never disagree.
 */
function updateHighlight() {
    if (!choroplethPaths || !cartogramCircles) {
        return; // both maps must exist before any interaction
    }
    restyleSelection(choroplethPaths);
    restyleSelection(cartogramCircles);
}
// Shared per-country interaction (tooltip + selection + hover highlight)
const tooltip = d3.select("#tooltip");
const FORMAT_BILLIONS = d3.format(",.0f");
function showTooltip(event, d) {
    const value = featureOf(d).properties.gdp_2025_billion_usd;
    tooltip
        .style("opacity", 1)
        .html(`<strong>${countryName(d)}</strong><br>2025 GDP: ${value == null ? "No data" : `${FORMAT_BILLIONS(value)} B USD`}`);
    moveTooltip(event);
}
function moveTooltip(event) {
    tooltip
        .style("left", `${event.pageX + 12}px`)
        .style("top", `${event.pageY + 12}px`);
}
function hideTooltip() {
    tooltip.style("opacity", 0);
}
/**
 * Shared handlers for both maps: tooltip, selection events that feed the
 * linked highlighting (hover sets/clears, click pins/unpins), and the
 * hover highlight. Namespaced events keep the three concerns from
 * overwriting each other; .select is registered BEFORE .highlight so the
 * black hover stroke is applied after updateHighlight() on the same
 * mouseover.
 */
function attachCountryHandlers(selection) {
    selection
        .on("mouseover", (event, d) => showTooltip(event, d))
        .on("mousemove", (event) => moveTooltip(event))
        .on("mouseout", () => hideTooltip())
        .on("mouseover.select", (_event, d) => {
        if (selectionLocked) {
            return;
        }
        selectedIso3 = isoOf(d);
        updateHighlight();
    })
        .on("mouseout.select", () => {
        if (selectionLocked) {
            return;
        }
        selectedIso3 = null;
        updateHighlight();
    })
        .on("click.select", (_event, d) => {
        const iso = isoOf(d);
        if (selectionLocked && selectedIso3 === iso) {
            selectedIso3 = null; // a second click clears the pin
            selectionLocked = false;
        }
        else {
            selectedIso3 = iso;
            selectionLocked = true;
        }
        updateHighlight();
    })
        .on("mouseover.highlight", function () {
        d3.select(this)
            .attr("stroke", HOVER_STROKE)
            .attr("stroke-width", HOVER_STROKE_WIDTH);
    })
        .on("mouseout.highlight", function (_event, d) {
        d3.select(this)
            .attr("stroke", strokeOf(d))
            .attr("stroke-width", strokeWidthOf(d));
    });
}
// PART B — Choropleth (color encodes GDP)
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;
/** Neutral grey for missing data, distinct from the Blues ramp's pale end. */
const NO_DATA_COLOR = "#e9e9e9";
/** Fraction of the cartogram canvas covered by the circles combined. */
const CARTOGRAM_FILL = 0.5;
/**
 * GDP spans 300 → 30,616 billion USD and is heavily right-skewed, so a
 * linear Blues ramp paints almost every country the same pale blue. The
 * scale is log-transformed (equal color steps for equal ratios) with a
 * strictly positive domain computed over JOINED values only — missing
 * countries never enter the domain as 0. Justified in the writeup.
 */
function createColorScale(features) {
    const values = features
        .map((f) => f.properties.gdp_2025_billion_usd)
        .filter((v) => v != null);
    const [min, max] = d3.extent(values);
    return d3.scaleSequentialLog(d3.interpolateBlues).domain([min, max]);
}
function drawChoropleth(features, path, colorScale) {
    // One <g> for everything geographic so zoom can transform it at once.
    const svg = d3
        .select("#choropleth-map")
        .append("svg")
        .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    const mapGroup = svg.append("g");
    const fillFor = (d) => {
        const value = d.properties.gdp_2025_billion_usd;
        return value == null ? NO_DATA_COLOR : colorScale(value);
    };
    choroplethPaths = mapGroup
        .selectAll("path.country")
        .data(features)
        .join("path")
        .attr("class", "country")
        .attr("d", path)
        .attr("fill", fillFor)
        .attr("stroke", REST_STROKE)
        .attr("stroke-width", REST_STROKE_WIDTH);
    attachCountryHandlers(choroplethPaths);
    // Zoom/pan, kept local to this SVG so the cartogram is unaffected.
    const zoom = d3
        .zoom()
        .scaleExtent([1, 8])
        .on("zoom", (event) => {
        mapGroup.attr("transform", event.transform.toString());
    });
    svg.call(zoom);
}
/** Quantitative legend: Blues ramp + log-spaced labeled ticks + "No data". */
function drawLegend(colorScale) {
    const root = d3.select("#choropleth-legend");
    const RAMP_X = 30;
    const RAMP_WIDTH = 360;
    const RAMP_HEIGHT = 12;
    const TICK_HEIGHT = 5;
    const LABEL_BASELINE = 27;
    const rampGroup = root
        .append("div")
        .attr("class", "legend-group legend-group-wide");
    rampGroup
        .append("p")
        .attr("class", "legend-title")
        .text("2025 GDP, billions USD (log scale)");
    const legendSvg = rampGroup
        .append("svg")
        .attr("width", RAMP_X + RAMP_WIDTH + 40)
        .attr("height", LABEL_BASELINE + 4)
        .attr("viewBox", `0 0 ${RAMP_X + RAMP_WIDTH + 40} ${LABEL_BASELINE + 4}`);
    // Evenly sampled stops of the interpolator = an even color ramp; the
    // log transform shows up in where the ticks sit below it.
    const stops = legendSvg
        .append("defs")
        .append("linearGradient")
        .attr("id", "gdp-legend-ramp")
        .attr("x1", "0%")
        .attr("x2", "100%")
        .attr("y1", "0%")
        .attr("y2", "0%");
    const STEP_COUNT = 8;
    for (let i = 0; i <= STEP_COUNT; i++) {
        stops
            .append("stop")
            .attr("offset", `${(i / STEP_COUNT) * 100}%`)
            .attr("stop-color", d3.interpolateBlues(i / STEP_COUNT));
    }
    legendSvg
        .append("rect")
        .attr("x", RAMP_X)
        .attr("y", 0)
        .attr("width", RAMP_WIDTH)
        .attr("height", RAMP_HEIGHT)
        .attr("rx", 3)
        .attr("fill", "url(#gdp-legend-ramp)")
        .attr("stroke", "#bbb");
    const [min, max] = colorScale.domain();
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const xOf = (value) => RAMP_X + (RAMP_WIDTH * (Math.log(value) - logMin)) / (logMax - logMin);
    // Log-nice ticks: 300/1000/3000/10000/30000 are ~equally spaced decades.
    for (const value of [300, 1000, 3000, 10000, 30000]) {
        const x = xOf(value);
        legendSvg
            .append("line")
            .attr("x1", x)
            .attr("x2", x)
            .attr("y1", RAMP_HEIGHT)
            .attr("y2", RAMP_HEIGHT + TICK_HEIGHT)
            .attr("stroke", "#666");
        legendSvg
            .append("text")
            .attr("x", x)
            .attr("y", LABEL_BASELINE)
            .attr("text-anchor", "middle")
            .attr("class", "legend-tick")
            .text(FORMAT_BILLIONS(value));
    }
    const missingGroup = root.append("div").attr("class", "legend-group");
    missingGroup.append("p").attr("class", "legend-title").text("Coverage");
    const item = missingGroup
        .append("div")
        .attr("class", "legend-items")
        .append("span")
        .attr("class", "legend-item");
    item.append("span")
        .attr("class", "legend-swatch")
        .style("background", NO_DATA_COLOR)
        .style("border", "1px solid #bbb");
    item.append("span").text("No data (outside top 50)");
}
const HOME_PULL = 0.08; // spring toward the true centroid, per iteration
const PUSH_FRACTION = 0.5; // fraction of each overlap resolved per step
const MAX_ITERATIONS = 300;
function buildCartogramNodes(features, path) {
    const nodes = [];
    for (const feature of features) {
        const value = feature.properties.gdp_2025_billion_usd;
        if (value == null) {
            continue; // no data → no circle
        }
        const [homeX, homeY] = path.centroid(feature);
        nodes.push({
            feature,
            iso3: featureIso3(feature),
            value,
            homeX,
            homeY,
            x: homeX,
            y: homeY,
            r: 0,
        });
    }
    // radius ∝ sqrt(GDP) so that AREA ∝ GDP; k sizes the ensemble to fill
    // a fixed fraction of the canvas.
    const totalValue = d3.sum(nodes, (n) => n.value);
    const k = Math.sqrt((CARTOGRAM_FILL * MAP_WIDTH * MAP_HEIGHT) / (Math.PI * totalValue));
    for (const node of nodes) {
        node.r = k * Math.sqrt(node.value);
    }
    // Draw large circles first so small ones stay visible on top.
    return nodes.sort((a, b) => b.r - a.r);
}
function relaxCartogram(nodes) {
    const pad = 2;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        for (const node of nodes) {
            node.x += (node.homeX - node.x) * HOME_PULL;
            node.y += (node.homeY - node.y) * HOME_PULL;
        }
        let maxOverlap = 0;
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.hypot(dx, dy);
                const minDist = a.r + b.r + pad;
                if (dist >= minDist) {
                    continue;
                }
                if (dist < 1e-6) {
                    dx = 1;
                    dy = 0;
                    dist = 1;
                }
                const overlap = (minDist - dist) * PUSH_FRACTION;
                // Larger circles move less: weight by the other's size share.
                const shareA = b.r / (a.r + b.r);
                const ux = dx / dist;
                const uy = dy / dist;
                a.x -= ux * overlap * shareA;
                a.y -= uy * overlap * shareA;
                b.x += ux * overlap * (1 - shareA);
                b.y += uy * overlap * (1 - shareA);
                maxOverlap = Math.max(maxOverlap, overlap);
            }
        }
        // Keep circles inside the canvas.
        for (const node of nodes) {
            node.x = Math.min(Math.max(node.x, node.r + pad), MAP_WIDTH - node.r - pad);
            node.y = Math.min(Math.max(node.y, node.r + pad), MAP_HEIGHT - node.r - pad);
        }
        if (iter > 10 && maxOverlap < 0.05) {
            break; // settled
        }
    }
}
function drawCartogram(features, path, colorScale) {
    const nodes = buildCartogramNodes(features, path);
    relaxCartogram(nodes);
    const svg = d3
        .select("#cartogram-map")
        .append("svg")
        .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    cartogramCircles = svg
        .selectAll("circle.country")
        .data(nodes, (d) => d.iso3)
        .join("circle")
        .attr("class", "country")
        .attr("cx", (d) => d.x)
        .attr("cy", (d) => d.y)
        .attr("r", (d) => d.r)
        // Same color scale as the choropleth: only the area encoding differs.
        .attr("fill", (d) => colorScale(d.value))
        .attr("stroke", REST_STROKE)
        .attr("stroke-width", REST_STROKE_WIDTH);
    attachCountryHandlers(cartogramCircles);
    // Visible on the chart itself, in addition to the note above it.
    svg.append("text")
        .attr("x", 12)
        .attr("y", MAP_HEIGHT - 12)
        .attr("class", "cartogram-note")
        .text("Circle area = 2025 GDP (billions USD) — not geographic size");
}
// main
async function main() {
    const [geoData, stats] = await Promise.all([loadGeoData(), loadData()]);
    const features = joinGdp(geoData, stats); // verifies the join first
    const projection = d3
        .geoNaturalEarth1()
        .fitSize([MAP_WIDTH, MAP_HEIGHT], geoData);
    const path = d3.geoPath().projection(projection);
    const colorScale = createColorScale(features);
    drawChoropleth(features, path, colorScale);
    drawLegend(colorScale);
    drawCartogram(features, path, colorScale);
}
main().catch((error) => {
    console.error(error);
    for (const id of ["#choropleth-map", "#cartogram-map"]) {
        d3.select(id)
            .append("p")
            .attr("class", "scale-note")
            .text("The map data failed to load — see the browser console for details.");
    }
});
export {};
//# sourceMappingURL=lab9.js.map