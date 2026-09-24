# Lab 8 Offline Pipeline Validation

Scope: Tasks 1–3 of `Lab8/Plan.md`, using the owner-supplied 2021–2022 bulletin. No frontend implementation or browser validation is included.

## Results

- Source: 400 PDF pages; SHA-256 `431bd3fdcdfdf7722783c29502a7600e8ac21ae45fd4785d230d1ab387dc9133`.
- Raw layout-derived blocks: 1,495.
- Short fragments merged into neighboring context: 55.
- Duplicate blocks removed within a hierarchy: 1.
- Other rejected blocks/isolated headings: 2.
- Additional passages from token splitting: 23.
- Final passages: `1495 - 55 - 1 - 2 + 23 = 1460`.
- Mean passage length: 77.4322 whitespace-delimited words.
- Formal section groups: 84, including explicitly identified introductory/front-matter groups.
- Embeddings: 1,460 × 384, normalized, with no passage exceeding the 256-token input limit.
- Topics: 8, interpreted using TF-IDF terms, centroid-near passages, and peripheral examples.
- Matrix: 672 cells, including zero-count combinations; counts sum to 1,460 and proportions sum to one per section.
- Neighbors: 7,300 directed edges; five per passage, excluding self; scores checked against original-vector cosine similarity. Cross-section flags are included.
- All 24 passage references supporting the eight topic labels belong to their stated clusters.

The cosine silhouette is approximately 0.104. The themes overlap substantially; the eight labels are descriptive summaries, not evidence of sharply separated or optimal natural categories. One cluster captures repeated elective-selection/course-availability wording rather than a substantive academic discipline.

## Source Audit

`lab8_corpus_audit.json` records 29 inspected passages, with samples drawn across 24 source pages plus targeted regression cases. Rendered pages 19, 24, 66, 87, 200, 218, 336, 359, and 397 were also inspected. Text, hierarchy, course-title boundaries, cross-page continuation, and table cell order were checked. This is representative QA, not an exhaustive visual audit of every page.

Two samples intentionally differ from PDF baseline text order: wrapped table cells and a calendar row with a vertically offset date. Cell-based reading preserves their logical order. The supplied source PDF remains unchanged.

## Independent Review and Corrections

A read-only reviewer checked the pipeline and independently reproduced matrix counts and all nearest-neighbor IDs/scores on an intermediate output. The review found three important extraction defects, subsequently covered by failing-then-passing source-PDF regression tests:

1. MEDIART 390 and POLSCI 204 headings absent from PDF bookmarks were absorbed into previous courses. Typography-based recovery now gives each its own hierarchy and passage.
2. Footnotes on page 66 interrupted a body sentence continued on page 67. Notes are now separated and associated with their superscript reference; the body sentence remains intact.
3. The Chinese application heading on page 28 was merged with international application dates on page 27. New-page headings now establish a boundary respected during fragment merging.

A model-provenance concern was also resolved by constraining both scripts to the same explicit model revision, rather than allowing an arbitrary model path with a fixed cache identity. Additional focused checks cover deduplication, token limits, table-row chunking, calendar cell alignment, cosine ties, and matrix zeros.

## Deliberate Decisions and Limits

- Omit the cover/contents and two non-linear diagrams, with exclusions recorded. This corpus therefore represents extracted textual passages, not every graphical element in the PDF.
- Retain repeated text in distinct hierarchy paths, preserving formal distribution at the cost of boilerplate influencing topics.
- Use the literal second bookmark level as the section grouping; large major/course sections can dominate counts. Deeper metadata remains available for a future finer-grained view.
- Keep conservative parent page spans for token chunks. The original raw blocks can be recovered through `raw_passage_ids`.
- Label inspection and source-page audit are recorded human-readable evidence; rerunning the corpus or clustering requires reviewing those records again.

No critical or important review finding remains open. No deferred minor finding remains from the review. Final automated checks are recorded in `lab8_tests.log` and `lab8_validation.json`. No Git history operations were performed.
