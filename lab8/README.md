# Lab 8: Corpus and Semantic Analysis

This directory implements Tasks 1–3 of `Lab8/Plan.md` (assignment Parts A–C and the offline data needed for the later views). It does not implement the D3 interface. Python scripts live here; generated datasets and reports live in `../data/`.

## Source and Reproduction

The unchanged source is `../../Lab8/V2021-22_DKU_UG_Bulletin.pdf`: *Bulletin of Duke Kunshan University: Undergraduate Instruction*, academic year 2021–2022, dated July 2021, 400 PDF pages. The PDF was supplied locally by the owner. The assignment's source URL is recorded in `lab8_corpus_quality.json`; byte-for-byte identity with the remote file was not independently checked. PDF page numbers are one-based and match the printed numbers.

Run from `stats401-labs/` using its existing Python environment:

```bash
.venv/bin/python lab8/prepare_corpus.py
.venv/bin/python lab8/analyze_corpus.py
.venv/bin/python lab8/analyze_corpus.py --label-only --labels data/lab8_topic_labels.json
.venv/bin/python lab8/analyze_corpus.py --validate-only
.venv/bin/python -m unittest discover -s lab8 -p 'test_*.py' -v
```

Dependencies are recorded in `pyproject.toml` and `uv.lock`. New environments can be recreated with `uv sync --frozen` after permission to install dependencies. Both scripts pin the tokenizer/model to `sentence-transformers/all-MiniLM-L6-v2`, revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`. The first run needs a model download unless that revision is cached.

This execution used the temporary Hugging Face cache `/tmp/lab8-huggingface`. To reuse that cache while it exists, prefix preparation/analysis commands with `HF_HOME=/tmp/lab8-huggingface HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false`. Analysis also used `NUMBA_CACHE_DIR=/tmp/lab8-numba-cache MPLCONFIGDIR=/tmp/lab8-mpl`. The cache is not a deliverable; the embeddings and their alignment/provenance index are retained under `data/`.

Run label application only after inspecting `lab8_topic_review.json`. Cluster numbers are not intrinsic topic identities: a changed corpus, model, dependency version, or clustering configuration requires a fresh label review. The unlabelled analysis stage deliberately exports `Unreviewed topic N` until labels are supplied.

## Extraction Decisions

- Use PDF bookmarks for Part, section, and all deeper headings. Two actual bold course headings absent from the bookmarks—MEDIART 390 on page 336 and POLSCI 204 on page 359—are recovered from page typography and marked as inferred in the outline export.
- Define the formal `section` as a Part's immediate child bookmark. Preserve deeper titles in `subsection` and `hierarchy_path`. `section_id` includes the parent Part, so repeated names cannot collapse unrelated sections. Text before a Part's first section uses the explicit synthetic label `Chapter introduction`; publication notices use `Front matter`.
- Use paragraph gaps and heading boundaries for prose. Keep course descriptions and prerequisites together, with the original course title prepended for context. Read ruled tables in cell order, keeping wrapped codes/titles together. Calendar events and contact entries form individual short blocks.
- Separate footnotes at their page separator and associate them with the hierarchy of the matching superscript reference. They remain independent `footnote` passages, allowing body sentences to continue over page breaks without absorbing notes.
- Exclude the cover and contents pages (1, 3–9). Omit the spatial diagrams on page 19 and the upper part of page 24 from the paragraph corpus; their labels are not linear prose. Retain the surrounding explanatory text. Log these omissions, repeated table headers, isolated structural labels, and malformed fragments in `lab8_exclusions.json`.
- Normalize whitespace and remove soft hyphens. Preserve stop words and natural grammar for embeddings. Merge short labels into adjacent context while respecting new-page headings. Deduplicate exact normalized blocks within the full hierarchy path, retaining their occurrence pages. Retain identical text in different formal contexts, since those occurrences are relevant to the matrix.
- Split long prose at sentence boundaries and long tables between complete rows, with word-boundary fallback for an oversized sentence or row. Every final passage fits the model's 256-token limit including special tokens. Chunks retain their parent ID and full source page span; the span is conservative rather than a sentence-specific location.
- `raw_passage_ids` links cleaned passages to extracted source text in `lab8_raw_passages.csv`. `text` in the final corpus is readable normalized/chunked text, including the course title for course descriptions; it is not a facsimile of PDF line layout.

Raw counts are layout-derived candidate blocks after cover/contents/header/diagram handling, before fragment consolidation, duplicate removal, and token splitting. The quality report reconciles the final count as raw blocks minus merged fragments, duplicate blocks, and rejected blocks, plus additional token chunks.

## Analysis Decisions

Two required corpus summaries are exported: passage count by formal section and mean passage length by formal section. Word-count distribution statistics and corpus TF-IDF terms are included as additional context.

The model produces normalized 384-dimensional embeddings on CPU. KMeans uses the original vectors, eight clusters, seed 401, and ten initializations. UMAP independently projects the original vectors with two components, 15 neighbors, minimum distance 0.15, cosine distance, seed 401, and one worker. Neither axis has an independent semantic interpretation.

Each passage has five exact nearest neighbors using cosine similarity in the original vector space, excluding itself. Ties follow corpus order. Neighbor scores do not depend on UMAP coordinates. Cached embeddings are reused only when the pinned model/revision, ordered passage IDs, and cleaned text match their provenance index.

TF-IDF uses unigrams/bigrams with `min_df=3`, `max_df=0.85`, and sublinear term frequency. An English stop list plus common bulletin terms is used only for interpretation, not embeddings. Each topic review includes its top terms, five centroid-near passages, three peripheral passages, and the largest contributing sections. Topic labels describe observed clusters rather than a predefined list of academic policies.

The matrix contains every section–topic combination, including zeros. `count` is the full-corpus passage count; `proportion` is `count / section_total`. These denominators should remain explicit in the future interface.

## Outputs

- `lab8_bulletin_passages.csv`: cleaned, model-ready passages and source hierarchy.
- `lab8_raw_passages.csv`, `lab8_document_outline.json`, `lab8_exclusions.json`: extraction provenance and exclusions.
- `lab8_corpus_quality.json`, `lab8_corpus_audit.json`: source/corpus statistics and representative source-page audit.
- `lab8_section_summary.csv`, `lab8_corpus_summary.json`: two corpus summaries, length statistics, and TF-IDF overview.
- `lab8_embeddings.npy`, `lab8_embedding_index.json`: cached vectors and ordered IDs/model/text identity; the frontend need not load them.
- `lab8_embedding_map.csv`: all passage fields plus `cluster`, reviewed `cluster_name`, `x`, and `y`.
- `lab8_neighbors.json`: passage-ID keys mapped to five neighbor IDs and cosine scores.
- `lab8_topic_section_matrix.csv`: section/topic identifiers, labels, counts, totals, and proportions.
- `lab8_topic_review.json`, `lab8_topic_labels.json`, `lab8_model_metadata.json`: labeling evidence, reviewed labels, and model configuration.
- `lab8_validation.json`: programmatic data-integrity results. Execution/test logs are separate from the datasets.

## Validation and Limits

Regression tests cover within-hierarchy deduplication, preserving cross-context occurrences, token splitting, short-title attachment, a vertically offset calendar date, unbookmarked courses, footnotes across page breaks, a new-page policy heading, cosine ties/self-exclusion, and matrix zero cells/denominators. The export validator also checks source ranges, finite coordinates, normalized vectors, ID alignment, counts, and every exported neighbor score against the original vectors.

Representative source checks are not a proof that all 400 pages were segmented perfectly. Table blocks and course descriptions have different lengths, and token splitting affects passage-based counts. Formal sections also vary greatly in size: `Majors` and `Course Descriptions` are much larger than most policy sections. Repeated wording across different majors is deliberately retained and can produce a boilerplate-oriented topic. Eight clusters follow the assignment's starting configuration; they are not claimed to be an optimal or definitive taxonomy. No D3 or browser validation is claimed for this offline stage.

## Page and Views (Tasks 4–6)

The interactive page is `lab8/index.html` with source `src/lab8.ts` (compiled to `js/lab8.js`; never edit the generated JavaScript) and Lab 8–scoped styles at the end of `css/style.css`. It loads only the exported datasets under `../data/`:

| Page section | Data files |
| --- | --- |
| Corpus description and statistics | `lab8_corpus_quality.json`, `lab8_corpus_summary.json` |
| Corpus overview (passages by section, mean length by section, top TF-IDF terms) | `lab8_section_summary.csv`, `lab8_corpus_summary.json` |
| Semantic embedding map (Part D) | `lab8_embedding_map.csv`, `lab8_topic_labels.json` |
| Nearest semantic neighbors (Part D) | `lab8_neighbors.json` |
| Topic × section matrix (Part E) | `lab8_topic_section_matrix.csv` |

Interactions: case-insensitive text search, formal-section and semantic-topic filters (combined by intersection), zoom/pan (drag to pan; double-click, Ctrl/⌘+scroll, or the +/− buttons to zoom), click-for-details with the original passage text, five precomputed nearest neighbors with cross-section badges, an explicit reveal action for neighbors hidden by active filters, a count/proportion toggle on the matrix, and two coordinated interactions (matrix cell → map filters; map point → matrix outline). Matrix cells always encode full-corpus counts so filtering never erases context. Reset restores filters, selection, and zoom together.

Findings and the 200–300-word design description are rendered on the page; the numbers are derived from the exported datasets (topic sizes, per-section topic entropy, neighbor similarities, and keyword distributions for `credit`, `graduation`, `registration`, and `academic integrity`).

Preview after building:

```bash
cd stats401-labs
npm run check
npm run build
python3 -m http.server 8000
# open http://localhost:8000/lab8/
```

Verification performed on 2026-09-22 is recorded in `Lab8/reports/validation.md`.
