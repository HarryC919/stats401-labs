export {};

// ---------------------------------------------------------------------------
// Lab 8 — Interactive exploration of the DKU Undergraduate Bulletin
//
// View 1: semantic embedding map (one point per passage).
// View 2: topic × section matrix (formal structure vs. semantic structure).
//
// All datasets are produced offline by lab8/prepare_corpus.py and
// lab8/analyze_corpus.py and live in ../data/lab8_*.
// ---------------------------------------------------------------------------

interface PassageDatum {
    passage_id: string;
    chapter: string;
    section: string;
    section_id: string;
    subsection: string;
    page: number;
    page_end: number;
    text: string;
    text_clean: string;
    word_count: number;
    cluster: number;
    cluster_name: string;
    x: number;
    y: number;
}

interface SectionSummaryDatum {
    section_id: string;
    chapter: string;
    section: string;
    passage_count: number;
    average_word_count: number;
    median_word_count: number;
    total_words: number;
}

interface TermScore {
    term: string;
    mean_tfidf: number;
}

interface CorpusSummary {
    passage_count: number;
    section_count: number;
    length_statistics: Record<string, number>;
    top_tfidf_terms: TermScore[];
}

interface CorpusQuality {
    title: string;
    academic_year: string;
    publication_date: string;
    source_url: string;
    accessed_date: string;
    source_sha256: string;
    page_count: number;
    raw_passage_count: number;
    clean_passage_count: number;
    mean_word_count: number;
    section_count: number;
}

interface TopicLabel {
    name: string;
    rationale: string;
    evidence_passage_ids: string[];
    caveat: string;
}

interface NeighborEntry {
    passage_id: string;
    similarity: number;
    cross_section: boolean;
}

interface MatrixDatum {
    section_id: string;
    chapter: string;
    section: string;
    cluster: number;
    cluster_name: string;
    count: number;
    section_total: number;
    proportion: number;
}

// One shared interaction state for search, filters, selection, and the
// passages explicitly revealed despite active filters (Part F).
interface AppState {
    search: string;
    sectionId: string; // "all" or a section_id
    topic: number | null; // null = all topics
    selectedId: string | null;
    revealed: Set<string>;
}

const MAP_W = 960;
const MAP_H = 620;

// Topic colors follow corpus cluster order 0–7 (Tableau-style palette
// consistent with the earlier labs).
const TOPIC_COLORS: string[] = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc948",
    "#b07aa1",
    "#9467bd",
];

// Short column/legend labels; full names come from lab8_topic_labels.json.
const TOPIC_SHORT: string[] = [
    "STEM courses",
    "Language & writing",
    "Electives",
    "Politics & econ",
    "History & arts",
    "Calendar",
    "Mission & services",
    "Progress & grading",
];

const INK = "#172033";

const state: AppState = {
    search: "",
    sectionId: "all",
    topic: null,
    selectedId: null,
    revealed: new Set(),
};

let passages: PassageDatum[] = [];
const byId = new Map<string, PassageDatum>();
let neighborIds = new Set<string>();

let pointSel:
    | d3.Selection<SVGCircleElement, PassageDatum, SVGGElement, undefined>
    | null = null;
let matrixCells:
    | d3.Selection<SVGRectElement, MatrixDatum, SVGGElement, undefined>
    | null = null;
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
let zoomIn: () => void = () => {};
let zoomOut: () => void = () => {};
let zoomReset: () => void = () => {};
let matrixMode: "count" | "proportion" = "count";
let matrixColor: (t: number) => string = d3.interpolateBlues;

const tooltip = d3.select("#tooltip");

const fmtInt = d3.format(",");
const fmtPct = d3.format(".1%");
const fmtSim = d3.format(".3f");
const fmtLen = d3.format(".1f");

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function snippet(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function pageLabel(d: PassageDatum): string {
    return d.page_end > d.page
        ? `pp. ${d.page}–${d.page_end}`
        : `p. ${d.page}`;
}

function sectionLabel(chapter: string, section: string): string {
    return `${chapter} › ${section}`;
}

function showError(containerId: string, message: string): void {
    d3.select(`#${containerId}`)
        .append("p")
        .attr("class", "status-message error")
        .text(message);
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface Dataset {
    quality: CorpusQuality;
    summary: CorpusSummary;
    sectionSummary: SectionSummaryDatum[];
    topicLabels: Record<string, TopicLabel>;
    neighbors: Record<string, NeighborEntry[]>;
    matrixRows: MatrixDatum[];
}

async function loadData(): Promise<Dataset> {
    const [
        quality,
        summary,
        sectionSummary,
        topicLabels,
        neighbors,
        mapRows,
        matrixRows,
    ] = await Promise.all([
        d3.json<CorpusQuality>("../data/lab8_corpus_quality.json"),
        d3.json<CorpusSummary>("../data/lab8_corpus_summary.json"),
        d3.csv("../data/lab8_section_summary.csv", (d) => ({
            section_id: d.section_id as string,
            chapter: d.chapter as string,
            section: d.section as string,
            passage_count: +(d.passage_count as string),
            average_word_count: +(d.average_word_count as string),
            median_word_count: +(d.median_word_count as string),
            total_words: +(d.total_words as string),
        })),
        d3.json<Record<string, TopicLabel>>("../data/lab8_topic_labels.json"),
        d3.json<Record<string, NeighborEntry[]>>("../data/lab8_neighbors.json"),
        d3.csv("../data/lab8_embedding_map.csv", (d) => ({
            passage_id: d.passage_id as string,
            chapter: d.chapter as string,
            section: d.section as string,
            section_id: d.section_id as string,
            subsection: (d.subsection as string) || "",
            page: +(d.page as string),
            page_end: +(d.page_end as string),
            text: d.text as string,
            text_clean: d.text_clean as string,
            word_count: +(d.word_count as string),
            cluster: +(d.cluster as string),
            cluster_name: d.cluster_name as string,
            x: +(d.x as string),
            y: +(d.y as string),
        })),
        d3.csv("../data/lab8_topic_section_matrix.csv", (d) => ({
            section_id: d.section_id as string,
            chapter: d.chapter as string,
            section: d.section as string,
            cluster: +(d.cluster as string),
            cluster_name: d.cluster_name as string,
            count: +(d.count as string),
            section_total: +(d.section_total as string),
            proportion: +(d.proportion as string),
        })),
    ]);

    if (
        !quality ||
        !summary ||
        !sectionSummary.length ||
        !topicLabels ||
        !neighbors ||
        !mapRows.length ||
        !matrixRows.length
    ) {
        throw new Error("One or more Lab 8 data files failed to load");
    }

    passages = mapRows;
    passages.forEach((d) => byId.set(d.passage_id, d));

    return {
        quality,
        summary,
        sectionSummary,
        topicLabels,
        neighbors,
        matrixRows,
    };
}

// ---------------------------------------------------------------------------
// Part A — source description and corpus statistics
// ---------------------------------------------------------------------------

function fillStats(quality: CorpusQuality, summary: CorpusSummary): void {
    d3.select("#stat-passages").text(fmtInt(summary.passage_count));
    d3.select("#stat-raw-passages").text(fmtInt(quality.raw_passage_count));
    d3.select("#stat-sections").text(fmtInt(summary.section_count));
    d3.select("#stat-mean-length").text(`${fmtLen(summary.length_statistics.mean)} words`);
    d3.select("#stat-median-length").text(
        `${fmtInt(summary.length_statistics["50%"])} words`,
    );
    d3.select("#stat-range").text(
        `${fmtInt(summary.length_statistics.min)}–${fmtInt(summary.length_statistics.max)}`,
    );
    d3.select("#stat-pages").text(fmtInt(quality.page_count));

    d3.select("#source-title").text(
        `${quality.title} (${quality.academic_year}, published ${quality.publication_date})`,
    );
    d3.select("#source-url")
        .attr("href", quality.source_url)
        .text(quality.source_url);
    d3.select("#source-accessed").text(quality.accessed_date);
    d3.select("#source-sha").text(`${quality.source_sha256.slice(0, 32)}…`);
}

// ---------------------------------------------------------------------------
// Part B — corpus overview charts (two required summaries + TF-IDF terms)
// ---------------------------------------------------------------------------

interface BarDatum {
    label: string;
    sub: string;
    value: number;
}

function drawBarChart(
    containerId: string,
    data: BarDatum[],
    valueFormat: (n: number) => string,
    labelWidth: number,
): void {
    const rowHeight = 17;
    const margin = {
        top: 8,
        right: 34,
        bottom: 30,
        left: labelWidth,
    };
    const width = 1000;
    const height = data.length * rowHeight + margin.top + margin.bottom;

    const svg = d3
        .select(`#${containerId}`)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", width)
        .attr("height", height);

    const x = d3
        .scaleLinear()
        .domain([0, d3.max(data, (d) => d.value) ?? 0])
        .range([margin.left, width - margin.right]);

    const y = d3
        .scaleBand()
        .domain(data.map((d) => d.label))
        .range([margin.top, height - margin.bottom])
        .padding(0.22);

    const barW = y.bandwidth();

    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(
            d3
                .axisBottom(x)
                .ticks(5)
                .tickFormat((n) => fmtInt(n as number))
                .tickSizeOuter(0),
        );

    svg.append("g")
        .selectAll("text")
        .data(data)
        .join("text")
        .attr("x", margin.left - 8)
        .attr("y", (d) => (y(d.label) ?? 0) + barW / 2 + 3.5)
        .attr("text-anchor", "end")
        .attr("font-size", 10.5)
        .attr("fill", "#667085")
        .text((d) => snippet(d.label, 42));

    svg.append("g")
        .selectAll("rect")
        .data(data)
        .join("rect")
        .attr("x", margin.left)
        .attr("y", (d) => y(d.label) ?? 0)
        .attr("width", (d) => Math.max(0, x(d.value) - margin.left))
        .attr("height", barW)
        .attr("rx", 2.5)
        .style("fill", "var(--blue)")
        .on("mouseover", function (event, d) {
            d3.select(this).style("fill", "var(--blue-dark)");
            tooltip
                .style("opacity", 1)
                .html(
                    `<strong>${escapeHtml(d.label)}</strong><br>` +
                        `${escapeHtml(d.sub)}<br>` +
                        `${valueFormat(d.value)}`,
                );
        })
        .on("mousemove", (event) => {
            tooltip
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY + 12}px`);
        })
        .on("mouseout", function () {
            d3.select(this).style("fill", "var(--blue)");
            tooltip.style("opacity", 0);
        });
}

function drawOverview(sectionSummary: SectionSummaryDatum[], summary: CorpusSummary): void {
    const byCount = [...sectionSummary]
        .sort((a, b) => d3.descending(a.passage_count, b.passage_count))
        .map((d) => ({
            label: d.section,
            sub: sectionLabel(d.chapter, d.section),
            value: d.passage_count,
        }));

    const byLength = [...sectionSummary]
        .sort((a, b) => d3.descending(a.average_word_count, b.average_word_count))
        .map((d) => ({
            label: d.section,
            sub: sectionLabel(d.chapter, d.section),
            value: d.average_word_count,
        }));

    const terms = summary.top_tfidf_terms.slice(0, 20).map((d) => ({
        label: d.term,
        sub: `Mean TF-IDF weight (1–2 word terms, min document frequency 3)`,
        value: d.mean_tfidf,
    }));

    drawBarChart("chart-by-section", byCount, (n) => `${fmtInt(n)} passages`, 300);
    drawBarChart(
        "chart-by-length",
        byLength,
        (n) => `${fmtLen(n)} words / passage`,
        300,
    );
    drawBarChart("chart-tfidf", terms, (n) => n.toFixed(3), 130);
}

// ---------------------------------------------------------------------------
// Part D — View 1: semantic embedding map
// ---------------------------------------------------------------------------

function drawMap(): void {
    const svg = d3
        .select("#map")
        .append("svg")
        .attr("viewBox", `0 0 ${MAP_W} ${MAP_H}`)
        .attr("width", MAP_W)
        .attr("height", MAP_H);

    const xScale = d3
        .scaleLinear()
        .domain(d3.extent(passages, (d) => d.x) as [number, number])
        .range([36, MAP_W - 14]);

    const yScale = d3
        .scaleLinear()
        .domain(d3.extent(passages, (d) => d.y) as [number, number])
        .range([MAP_H - 28, 22]);

    const rScale = d3
        .scaleSqrt()
        .domain([0, d3.max(passages, (d) => d.word_count) ?? 1])
        .range([2.1, 9.5]);

    const viewport = svg.append("g").attr("class", "map-viewport");

    // Capture pans on empty space; clicking it also clears the selection.
    viewport
        .append("rect")
        .attr("x", -2000)
        .attr("y", -2000)
        .attr("width", MAP_W + 4000)
        .attr("height", MAP_H + 4000)
        .attr("fill", "transparent")
        .on("click", () => clearSelection());

    pointSel = viewport
        .selectAll<SVGCircleElement, PassageDatum>("circle")
        .data(passages, (d) => d.passage_id)
        .join("circle")
        .attr("class", "passage-point")
        .attr("cx", (d) => xScale(d.x))
        .attr("cy", (d) => yScale(d.y))
        .attr("r", (d) => rScale(d.word_count))
        .style("fill", (d) => TOPIC_COLORS[d.cluster])
        .attr("opacity", 1)
        .on("click", (event: MouseEvent, d) => {
            event.stopPropagation();
            selectPassage(d.passage_id);
        })
        .on("mouseover", (event: MouseEvent, d) => {
            tooltip
                .style("opacity", 1)
                .html(
                    `<strong>${escapeHtml(d.section)}</strong><br>` +
                        `${escapeHtml(d.cluster_name)}<br>` +
                        `${pageLabel(d)} · ${d.word_count} words<br>` +
                        `<span class="tooltip-id">${escapeHtml(d.passage_id)}</span><br>` +
                        escapeHtml(snippet(d.text_clean, 130)),
                );
        })
        .on("mousemove", (event: MouseEvent) => {
            tooltip
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY + 12}px`);
        })
        .on("mouseout", () => tooltip.style("opacity", 0));

    // Zoom/pan stays local to the map viewport: drag to pan, Ctrl/⌘+scroll
    // or double-click to zoom, so ordinary page scrolling still works.
    zoomBehavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 12])
        .filter((event) => {
            if (event.type === "wheel") {
                return event.ctrlKey || event.metaKey;
            }
            return event.type === "mousedown" ? event.button === 0 : true;
        })
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
            viewport.attr("transform", event.transform.toString());
        });

    const zb = zoomBehavior;
    svg.call(zb);

    zoomIn = () => {
        zb.scaleBy(svg, 1.5);
    };
    zoomOut = () => {
        zb.scaleBy(svg, 1 / 1.5);
    };
    zoomReset = () => {
        zb.transform(svg, d3.zoomIdentity);
    };

    d3.select("#zoom-in").on("click", () => zoomIn());
    d3.select("#zoom-out").on("click", () => zoomOut());
}

function drawMapLegends(): void {
    const topicLegend = d3.select("#topic-legend");
    TOPIC_SHORT.forEach((short, c) => {
        const item = topicLegend
            .append("button")
            .attr("class", "legend-item legend-chip")
            .attr("type", "button")
            .attr("data-cluster", String(c))
            .attr(
                "title",
                `${topicName(c)} — click to filter by this topic`,
            )
            .on("click", () => {
                state.topic = state.topic === c ? null : c;
                syncControls();
                applyState();
            });
        item.append("span")
            .attr("class", "legend-swatch")
            .style("background", TOPIC_COLORS[c]);
        item.append("span").text(short);
    });

    // Size legend: reference circles on a square-root radius scale.
    const sizeLegend = d3.select("#size-legend").append("svg").attr("width", 240).attr("height", 54);
    const rScale = d3
        .scaleSqrt()
        .domain([0, d3.max(passages, (d) => d.word_count) ?? 1])
        .range([2.1, 9.5]);
    const median = d3.median(passages, (d) => d.word_count) ?? 0;
    const marks: { value: number; label: string }[] = [
        { value: 20, label: "20" },
        { value: Math.round(median), label: `${Math.round(median)} (median)` },
        { value: d3.max(passages, (d) => d.word_count) ?? 1, label: "max" },
    ];
    let cx = 22;
    marks.forEach((m) => {
        const r = rScale(m.value);
        sizeLegend
            .append("circle")
            .attr("cx", cx + r)
            .attr("cy", 24)
            .attr("r", r)
            .style("fill", "var(--blue-soft)")
            .attr("stroke", "#2563eb")
            .attr("stroke-width", 1.2);
        sizeLegend
            .append("text")
            .attr("x", cx + r)
            .attr("y", 46)
            .attr("text-anchor", "middle")
            .attr("font-size", 9.5)
            .attr("fill", "#667085")
            .text(m.label);
        cx += r * 2 + 34;
    });
    d3.select("#size-legend")
        .append("p")
        .attr("class", "legend-note")
        .text(
            "Circle area ∝ passage length (word count, square-root radius scale).",
        );
}

// ---------------------------------------------------------------------------
// Part E — View 2: topic × section matrix
// ---------------------------------------------------------------------------

function drawMatrix(matrixRows: MatrixDatum[]): void {
    const sections: { section_id: string; chapter: string; section: string }[] =
        [];
    const seen = new Set<string>();
    matrixRows.forEach((d) => {
        if (!seen.has(d.section_id)) {
            seen.add(d.section_id);
            sections.push({
                section_id: d.section_id,
                chapter: d.chapter,
                section: d.section,
            });
        }
    });

    const labelW = 290;
    const colW = 90;
    const rowH = 21;
    const headerH = 108;
    const width = labelW + TOPIC_SHORT.length * colW;
    const height = headerH + sections.length * rowH + 10;

    const svg = d3
        .select("#matrix")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", width)
        .attr("height", height);

    const rowIndex = new Map(sections.map((s, i) => [s.section_id, i]));

    // Rotated column headers (short topic labels; full names in tooltips).
    TOPIC_SHORT.forEach((short, c) => {
        svg.append("text")
            .attr(
                "transform",
                `translate(${labelW + c * colW + 16},${headerH - 10}) rotate(-48)`,
            )
            .attr("text-anchor", "start")
            .attr("font-size", 11)
            .attr("font-weight", 700)
            .attr("fill", "#344054")
            .text(short);
    });

    // Row labels in bulletin (document) order.
    svg.append("g")
        .selectAll("text")
        .data(sections)
        .join("text")
        .attr("x", labelW - 8)
        .attr(
            "y",
            (d) => headerH + (rowIndex.get(d.section_id) ?? 0) * rowH + rowH / 2 + 3.5,
        )
        .attr("text-anchor", "end")
        .attr("font-size", 10.5)
        .attr("fill", "#344054")
        .text((d) => snippet(d.section, 40))
        .append("title")
        .text((d) => sectionLabel(d.chapter, d.section));

    matrixCells = svg
        .append("g")
        .selectAll<SVGRectElement, MatrixDatum>("rect")
        .data(matrixRows, (d) => `${d.section_id}|${d.cluster}`)
        .join("rect")
        .attr("class", "matrix-cell")
        .attr("x", (d) => labelW + d.cluster * colW + 1.5)
        .attr(
            "y",
            (d) => headerH + (rowIndex.get(d.section_id) ?? 0) * rowH + 1.5,
        )
        .attr("width", colW - 3)
        .attr("height", rowH - 3)
        .attr("rx", 3)
        .on("click", (event: MouseEvent, d) => {
            event.stopPropagation();
            // Coordinated interaction (Part F): a cell click applies its
            // section + topic filters to the semantic map.
            state.sectionId = d.section_id;
            state.topic = d.cluster;
            syncControls();
            applyState();
            document
                .getElementById("semantic-map")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
        })
        .on("mouseover", (event: MouseEvent, d) => {
            tooltip
                .style("opacity", 1)
                .html(
                    `<strong>${escapeHtml(sectionLabel(d.chapter, d.section))}</strong><br>` +
                        `Topic: ${escapeHtml(d.cluster_name)}<br>` +
                        `${d.count} passage${d.count === 1 ? "" : "s"} ` +
                        `(${fmtPct(d.proportion)} of ${d.section_total} in this section)`,
                );
        })
        .on("mousemove", (event: MouseEvent) => {
            tooltip
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY + 12}px`);
        })
        .on("mouseout", () => tooltip.style("opacity", 0));

    updateMatrixFill();
}

function updateMatrixFill(): void {
    if (!matrixCells) {
        return;
    }

    const maxCount = d3.max(matrixCells.data(), (d) => d.count) ?? 1;
    const color =
        matrixMode === "count"
            ? d3.scaleSequential(d3.interpolateBlues).domain([0, maxCount])
            : d3.scaleSequential(d3.interpolateBlues).domain([0, 1]);
    matrixColor = color;

    matrixCells
        .attr("fill", (d) =>
            matrixMode === "count" ? color(d.count) : color(d.proportion),
        )
        .attr("stroke", null)
        .attr("stroke-width", null)
        .attr("stroke-dasharray", null);

    // Color-ramp legend reflects the active encoding.
    const ramp = d3.select("#matrix-ramp").html("");
    const rampSvg = ramp.append("svg").attr("width", 240).attr("height", 40);
    const gradId = "matrix-ramp-gradient";
    const defs = rampSvg.append("defs");
    const gradient = defs
        .append("linearGradient")
        .attr("id", gradId)
        .attr("x1", "0%")
        .attr("x2", "100%")
        .attr("y1", "0%")
        .attr("y2", "0%");
    for (let t = 0; t <= 10; t += 1) {
        gradient
            .append("stop")
            .attr("offset", `${t * 10}%`)
            .attr("stop-color", color(t / 10));
    }
    rampSvg
        .append("rect")
        .attr("x", 4)
        .attr("y", 8)
        .attr("width", 200)
        .attr("height", 12)
        .attr("rx", 3)
        .attr("fill", `url(#${gradId})`)
        .attr("stroke", "#dce3ee");
    rampSvg
        .append("text")
        .attr("x", 4)
        .attr("y", 34)
        .attr("font-size", 10)
        .attr("fill", "#667085")
        .text(matrixMode === "count" ? "0" : "0%");
    rampSvg
        .append("text")
        .attr("x", 204)
        .attr("y", 34)
        .attr("text-anchor", "end")
        .attr("font-size", 10)
        .attr("fill", "#667085")
        .text(matrixMode === "count" ? `${fmtInt(maxCount)} passages` : "100% of section");
    ramp
        .append("span")
        .attr("class", "legend-note")
        .text(
            matrixMode === "count"
                ? "Cell color = passage count (full corpus; filters do not change shading)."
                : "Cell color = share of the section's passages (denominator: section total).",
        );
}

// ---------------------------------------------------------------------------
// Shared state — search, filters, selection, neighbors (Parts D & F)
// ---------------------------------------------------------------------------

function isEligible(d: PassageDatum): boolean {
    const inSection = state.sectionId === "all" || d.section_id === state.sectionId;
    const inTopic = state.topic === null || d.cluster === state.topic;
    return inSection && inTopic;
}

function matchesSearch(d: PassageDatum): boolean {
    return state.search === "" || d.text_clean.includes(state.search);
}

function applyState(): void {
    if (!pointSel || !matrixCells) {
        return;
    }

    let eligibleCount = 0;
    let matchCount = 0;

    pointSel
        .attr("opacity", (d) => {
            const eligible = isEligible(d);
            if (eligible) {
                eligibleCount += 1;
            }
            const match = eligible && matchesSearch(d);
            if (match) {
                matchCount += 1;
            }
            if (match) {
                return 1;
            }
            if (state.revealed.has(d.passage_id)) {
                return 0.9;
            }
            return eligible ? 0.16 : 0.05;
        })
        .attr("stroke", (d) =>
            d.passage_id === state.selectedId || neighborIds.has(d.passage_id)
                ? INK
                : null,
        )
        .attr("stroke-width", (d) => {
            if (d.passage_id === state.selectedId) {
                return 2.6;
            }
            return neighborIds.has(d.passage_id) ? 1.8 : null;
        })
        .attr("stroke-dasharray", (d) =>
            state.revealed.has(d.passage_id) && !isEligible(d) ? "3 2" : null,
        )
        .attr("pointer-events", (d) =>
            d.passage_id === state.selectedId ||
            neighborIds.has(d.passage_id) ||
            (isEligible(d) && matchesSearch(d))
                ? "auto"
                : "none",
        )
        .raise();

    // Status line + explicit zero-match state.
    d3.select("#map-status").html(
        `<strong>${fmtInt(matchCount)}</strong> of ${fmtInt(passages.length)} passages highlighted` +
            (state.search
                ? ` for &ldquo;${escapeHtml(state.search)}&rdquo;`
                : "") +
            ` &middot; ${fmtInt(eligibleCount)} eligible under current filters` +
            (state.selectedId
                ? ` &middot; selected: ${escapeHtml(state.selectedId)}`
                : ""),
    );

    const emptyBox = d3.select("#map-empty");
    if (matchCount === 0) {
        emptyBox
            .attr("hidden", null)
            .select(".map-empty-text")
            .html(
                eligibleCount === 0
                    ? "No passages match the current section/topic filters. Adjust the filters or press Reset."
                    : state.search
                      ? `No passages match &ldquo;${escapeHtml(state.search)}&rdquo; within the current filters.`
                      : "No passages to display.",
            );
    } else {
        emptyBox.attr("hidden", "");
    }

    // Matrix strokes: blue outline = active section+topic filter combo;
    // dark dashed outline = the selected passage's cell.
    matrixCells
        .attr("stroke", (d) => {
            const isFilterCell =
                state.sectionId === d.section_id && state.topic === d.cluster;
            const selected = byId.get(state.selectedId ?? "");
            const isSelectedCell =
                selected !== undefined &&
                selected.section_id === d.section_id &&
                selected.cluster === d.cluster;
            if (isFilterCell) {
                return "#2563eb";
            }
            return isSelectedCell ? INK : null;
        })
        .attr("stroke-width", (d) => {
            const isFilterCell =
                state.sectionId === d.section_id && state.topic === d.cluster;
            const selected = byId.get(state.selectedId ?? "");
            const isSelectedCell =
                selected !== undefined &&
                selected.section_id === d.section_id &&
                selected.cluster === d.cluster;
            return isFilterCell ? 2.5 : isSelectedCell ? 2 : null;
        })
        .attr("stroke-dasharray", (d) => {
            const isFilterCell =
                state.sectionId === d.section_id && state.topic === d.cluster;
            const selected = byId.get(state.selectedId ?? "");
            const isSelectedCell =
                selected !== undefined &&
                selected.section_id === d.section_id &&
                selected.cluster === d.cluster;
            return isFilterCell ? null : isSelectedCell ? "4 2" : null;
        });

    // Legend chips reflect the active topic filter.
    d3.selectAll<HTMLButtonElement, unknown>(".legend-chip").classed(
        "active",
        function () {
            return state.topic === +(this.dataset.cluster ?? "-1");
        },
    );

    if (state.selectedId) {
        renderDetail(byId.get(state.selectedId)!);
    }
}

function selectPassage(passageId: string): void {
    state.selectedId = passageId;
    // A selected passage is always shown, even when filters would hide it.
    state.revealed.add(passageId);
    const neighbors = neighborIdsOf(passageId);
    neighborIds = neighbors.visibleIds;
    applyState();
    renderDetail(byId.get(passageId)!);
    renderNeighbors(passageId, neighbors.entries);
}

let neighborIndex: Record<string, NeighborEntry[]> = {};

function neighborIdsOf(
    passageId: string,
): { entries: NeighborEntry[]; visibleIds: Set<string> } {
    const entries = neighborIndex[passageId] ?? [];
    const visibleIds = new Set<string>();
    entries.forEach((n) => visibleIds.add(n.passage_id));
    return { entries, visibleIds };
}

function clearSelection(): void {
    state.selectedId = null;
    neighborIds = new Set();
    d3.select("#detail-panel").html(
        `<p class="detail-hint">Select a point on the map (or a matrix cell) to inspect a passage, its section, and its five nearest semantic neighbors.</p>`,
    );
    d3.select("#neighbors-panel").html(
        `<p class="detail-hint">Neighbors appear here after a passage is selected.</p>`,
    );
    applyState();
}

function renderDetail(d: PassageDatum): void {
    const panel = d3.select("#detail-panel").html("");
    panel.append("p").attr("class", "detail-topic").style("background", TOPIC_COLORS[d.cluster]).text(d.cluster_name);
    panel.append("h3").text(d.section);
    const dl = panel.append("dl").attr("class", "detail-fields");
    const add = (label: string, value: string) => {
        dl.append("dt").text(label);
        dl.append("dd").text(value);
    };
    add("Chapter", d.chapter);
    add("Section", d.section);
    add("Subsection", d.subsection || "—");
    add("Page", pageLabel(d));
    add("Passage ID", d.passage_id);
    add("Words", String(d.word_count));

    const quote = panel.append("blockquote").attr("class", "detail-text");
    // Insert the bulletin text as plain text content, never as HTML.
    quote.text(d.text);

    panel
        .append("button")
        .attr("class", "detail-clear")
        .attr("type", "button")
        .text("Clear selection")
        .on("click", () => clearSelection());
}

function renderNeighbors(passageId: string, entries: NeighborEntry[]): void {
    const panel = d3.select("#neighbors-panel").html("");
    panel
        .append("p")
        .attr("class", "neighbors-title")
        .html(
            `Five nearest semantic neighbors of <strong>${escapeHtml(passageId)}</strong> ` +
                `(cosine similarity on original embeddings)`,
        );

    entries.forEach((n) => {
        const other = byId.get(n.passage_id);
        if (!other) {
            return;
        }
        const item = panel.append("div").attr("class", "neighbor-item");
        const head = item.append("p").attr("class", "neighbor-head");
        head
            .append("span")
            .attr("class", "neighbor-sim")
            .text(fmtSim(n.similarity));
        head
            .append("span")
            .attr("class", "neighbor-section")
            .text(snippet(other.section, 42));
        if (n.cross_section) {
            head
                .append("span")
                .attr("class", "badge badge-cross")
                .attr("title", "Neighbor lies in a different formal section")
                .text("cross-section");
        }
        if (!isEligible(other)) {
            head
                .append("span")
                .attr("class", "badge badge-hidden")
                .attr(
                    "title",
                    "This neighbor is outside the active section/topic filters",
                )
                .text("outside filters");
        }
        item
            .append("p")
            .attr("class", "neighbor-text")
            .text(snippet(other.text_clean, 150));
        item
            .append("p")
            .attr("class", "neighbor-meta")
            .text(
                `${other.cluster_name} · ${pageLabel(other)} · ${other.passage_id}`,
            );
        const actions = item.append("p").attr("class", "neighbor-actions");
        actions
            .append("button")
            .attr("type", "button")
            .text("Select")
            .on("click", () => selectPassage(other.passage_id));
        if (!isEligible(other) && !state.revealed.has(other.passage_id)) {
            actions
                .append("button")
                .attr("type", "button")
                .attr("class", "secondary")
                .text("Show on map")
                .on("click", () => {
                    state.revealed.add(other.passage_id);
                    applyState();
                    renderNeighbors(passageId, entries);
                });
        }
    });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function syncControls(): void {
    d3.select("#search").property("value", state.search);
    d3.select("#section-filter").property("value", state.sectionId);
    d3.select("#topic-filter").property(
        "value",
        state.topic === null ? "all" : String(state.topic),
    );
}

function setupControls(sectionSummary: SectionSummaryDatum[]): void {
    const sectionSelect = d3.select("#section-filter");
    sectionSelect
        .selectAll("option.section-option")
        .data(sectionSummary)
        .join("option")
        .attr("class", "section-option")
        .attr("value", (d) => d.section_id)
        .text((d) => snippet(sectionLabel(d.chapter, d.section), 80));

    const topicSelect = d3.select("#topic-filter");
    TOPIC_SHORT.forEach((short, c) => {
        topicSelect
            .append("option")
            .attr("value", String(c))
            .text(`${c} · ${topicName(c)}`);
    });

    d3.select("#search").on("input", (event: Event) => {
        state.search = (event.target as HTMLInputElement).value
            .toLowerCase()
            .trim();
        applyState();
    });

    d3.select("#section-filter").on("change", (event: Event) => {
        state.sectionId = (event.target as HTMLSelectElement).value;
        applyState();
    });

    d3.select("#topic-filter").on("change", (event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        state.topic = value === "all" ? null : +value;
        applyState();
    });

    d3.select("#reset").on("click", () => {
        state.search = "";
        state.sectionId = "all";
        state.topic = null;
        matrixMode = "count";
        d3.select("#mode-count").classed("active", true);
        d3.select("#mode-proportion").classed("active", false);
        updateMatrixFill();
        zoomReset();
        syncControls();
        clearSelection();
    });

    d3.select("#mode-count").on("click", () => {
        matrixMode = "count";
        d3.select("#mode-count").classed("active", true);
        d3.select("#mode-proportion").classed("active", false);
        updateMatrixFill();
    });
    d3.select("#mode-proportion").on("click", () => {
        matrixMode = "proportion";
        d3.select("#mode-count").classed("active", false);
        d3.select("#mode-proportion").classed("active", true);
        updateMatrixFill();
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let topicLabelMap: Record<string, TopicLabel> = {};

function topicName(cluster: number): string {
    return topicLabelMap[String(cluster)]?.name ?? `Topic ${cluster}`;
}

async function main(): Promise<void> {
    try {
        const {
            quality,
            summary,
            sectionSummary,
            topicLabels,
            neighbors,
            matrixRows,
        } = await loadData();
        topicLabelMap = topicLabels;
        neighborIndex = neighbors;

        fillStats(quality, summary);
        drawOverview(sectionSummary, summary);
        drawMap();
        drawMapLegends();
        drawMatrix(matrixRows);
        setupControls(sectionSummary);
        clearSelection();
        applyState();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ["chart-by-section", "map", "matrix"].forEach((id) =>
            showError(
                id,
                `Failed to load Lab 8 data (${message}). Serve stats401-labs with python3 -m http.server and reload.`,
            ),
        );
    }
}

main();
