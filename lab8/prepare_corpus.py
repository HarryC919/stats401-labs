"""Extract bookmark-aware passages from the supplied DKU 2021–2022 bulletin.

Run from stats401-labs: .venv/bin/python lab8/prepare_corpus.py
The PDF is read only. All generated data is written under ../data/.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
DEFAULT_PDF = HERE.parents[1] / "Lab8" / "V2021-22_DKU_UG_Bulletin.pdf"
MODEL = "sentence-transformers/all-MiniLM-L6-v2"
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
SOURCE_URL = "https://dku-web-admissions.s3.cn-north-1.amazonaws.com.cn/dkumain/files/V2021-22_DKU_UG_Bulletin.pdf"


def clean_text(text: str) -> str:
    """Normalize layout whitespace without deleting stop words or punctuation."""
    return re.sub(r"\s+", " ", text.replace("\u00ad", "")).strip()


def key_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        raise ValueError(f"Refusing to export an empty corpus: {path}")
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def deduplicate(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Deduplicate within a full hierarchy path; retain cross-section evidence."""
    seen, kept, removed = {}, [], []
    for row in rows:
        key = (row["hierarchy_path"], clean_text(row["text"]))
        if key in seen:
            original = seen[key]
            original["occurrence_pages"].append(row["page"])
            removed.append({**row, "reason": "exact_duplicate_within_hierarchy"})
        else:
            row = {**row, "occurrence_pages": [row["page"]]}
            kept.append(row)
            seen[key] = row
    return kept, removed


def merge_fragments(rows: list[dict]) -> tuple[list[dict], int]:
    """Attach short unbookmarked labels to adjacent text in the same context."""
    merged, count = [], 0
    for row in rows:
        if merged:
            previous = merged[-1]
            short_label = ((len(previous["text"].split()) < 12
                            and not re.search(r"[.!?]$", previous["text"].strip()))
                           or previous["text"].rstrip().endswith(":"))
            same_context = row["hierarchy_path"] == previous["hierarchy_path"]
            adjacent = row["page"] <= previous["page_end"] + 1
            url_continuation = clean_text(row["text"]).startswith("http")
            if (same_context and adjacent and (short_label or url_continuation)
                    and not (row.get("starts_with_heading", False) and row["page"] > previous["page_end"])
                    and row["passage_kind"] != "footnote"
                    and previous["passage_kind"] not in ("contact", "calendar_event", "footnote")):
                previous["text"] += "\n" + row["text"]
                previous["page_end"] = row["page_end"]
                if row["passage_kind"] == "table_block":
                    previous["passage_kind"] = "table_block"
                if "raw_passage_ids" in previous:
                    previous["raw_passage_ids"] += ";" + row["raw_passage_ids"]
                count += 1
                continue
        merged.append(dict(row))
    return merged, count


def split_for_model(text: str, token_count, limit: int = 256) -> list[str]:
    """Pack complete sentences; split oversized sentences at word boundaries."""
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9•])|\n+", text)
    output, current = [], ""
    for sentence in sentences:
        sentence = clean_text(sentence)
        if not sentence:
            continue
        candidate = clean_text(current + " " + sentence)
        if token_count(candidate) <= limit:
            current = candidate
            continue
        if current:
            output.append(current)
            current = ""
        if token_count(sentence) <= limit:
            current = sentence
            continue
        for word in sentence.split():
            candidate = clean_text(current + " " + word)
            if token_count(candidate) > limit:
                if not current:
                    raise ValueError("One word exceeds the model input limit")
                output.append(current)
                current = word
            else:
                current = candidate
    if current:
        output.append(current)
    return output


def passage_chunks(row: dict, token_count, limit: int = 256) -> list[str]:
    """Preserve table rows when chunking and retain course-title context."""
    text = row["text"] if row["passage_kind"] == "table_block" else clean_text(row["text"])
    if row["passage_kind"] == "course_description":
        text = row["hierarchy_path"].split(" > ")[-1] + ". " + text
    return split_for_model(text, token_count, limit)


def extract_outline(reader) -> list[dict]:
    output = []

    def walk(items, parents=()):
        previous = None
        for item in items:
            if isinstance(item, list):
                walk(item, parents + (previous,))
            else:
                title = clean_text(re.sub(r"\d+F$", "", item.title))
                page = reader.get_destination_page_number(item) + 1
                output.append(dict(title=title, depth=len(parents), page=page,
                                   top=float(reader.pages[page - 1].mediabox.height) - float(item.get("/Top", 720)),
                                   path=list(parents) + [title]))
                previous = title
    walk(reader.outline)
    return sorted(output, key=lambda row: (row["page"], row["top"], row["depth"]))


def metadata(path: list[str]) -> dict:
    chapter = path[0]
    section = path[1] if len(path) > 1 else "Chapter introduction"
    # Keep the literal second bookmark level as the formal matrix section.
    section_id = hashlib.sha256((chapter + " > " + section).encode()).hexdigest()[:12]
    return dict(chapter=chapter, section=section, section_id=section_id,
                subsection=" > ".join(path[2:]), hierarchy_path=" > ".join(path))


def calendar_table_lines(page) -> list[dict]:
    """Read ruled tables by cells, preserving wrapped titles and calendar dates."""
    tables = page.find_tables()
    lines = [line for line in page.extract_text_lines(layout=False, strip=True)
             if not any(table.bbox[1] - 2 <= line["top"] < table.bbox[3] for table in tables)]
    for table in tables:
        for row, values in zip(table.rows, table.extract()):
            lines.append(dict(top=row.bbox[1], bottom=row.bbox[3],
                              text=" ".join(clean_text(value) for value in values if value),
                              chars=[c for c in page.chars if row.bbox[1] <= c["top"] < row.bbox[3]],
                              table_row=True))
    return sorted(lines, key=lambda line: line["top"])


def bold_heading(line: dict) -> bool:
    if line.get("table_row"):
        return False
    chars = [c for c in line.get("chars", []) if c["text"].strip()]
    return bool(chars) and sum("Bold" in c["fontname"] for c in chars) / len(chars) > 0.8


def extract_passages(pdf_path: Path) -> tuple[list[dict], list[dict], dict]:
    import pdfplumber
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    outline = extract_outline(reader)
    events_by_page = defaultdict(list)
    for event in outline:
        events_by_page[event["page"]].append(event)
    raw, excluded = [], []
    path = ["Front matter", "Publication and institutional notices"]
    current, current_meta = [], None
    current_page, current_end = 2, 2
    current_kind = "paragraph"
    current_starts_with_heading = False
    last_bottom = None
    footnote_rows, reference_paths = [], {}

    def flush():
        nonlocal current, current_meta
        if current:
            raw.append({**current_meta, "page": current_page, "page_end": current_end,
                        "passage_kind": current_kind, "starts_with_heading": current_starts_with_heading,
                        "text": "\n".join(current)})
        current, current_meta = [], None

    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            if page_number == 1 or 3 <= page_number <= 9:
                excluded.append(dict(page=page_number, reason="cover_or_table_of_contents"))
                continue
            lines = calendar_table_lines(page) if page_number < 217 or page_number >= 397 else page.extract_text_lines(layout=False, strip=True)
            lines = [line for line in lines if line["top"] < 735 and line["bottom"] > 60]
            separators = [edge["top"] for edge in page.edges if edge["top"] > 500
                          and abs(edge["x0"] - 72) < 1 and abs(edge["x1"] - 216) < 1
                          and abs(edge["bottom"] - edge["top"]) < 1]
            footnote_lines = []
            if separators:
                cutoff = min(separators)
                footnote_lines = [line for line in lines if line["top"] > cutoff]
                lines = [line for line in lines if line["top"] <= cutoff]
            # These two diagrams have multiple spatial columns, not paragraph order.
            # Their surrounding prose states the same requirements; log the omissions.
            if page_number == 19:
                excluded.append(dict(page=19, reason="diagram_not_linear_prose", text="Figure 1 and its labels"))
                flush()
                continue
            if page_number == 24:
                excluded.append(dict(page=24, reason="diagram_not_linear_prose", text="Figure 2 and its labels above Credits Required for Degree"))
                lines = [line for line in lines if line["top"] >= 320]
            events = events_by_page[page_number]
            heading_indices, event_indices = set(), defaultdict(list)
            for event in events:
                target = key_text(event["title"])
                candidates = [(idx, line) for idx, line in enumerate(lines)
                              if abs(line["top"] - event["top"]) < 40
                              and (target.startswith(key_text(line["text"])[:24])
                                   or key_text(line["text"]).startswith(target[:24]))]
                if not candidates:
                    raise ValueError(f"Unmatched bookmark on page {page_number}: {event['title']}")
                idx, _ = min(candidates, key=lambda pair: abs(pair[1]["top"] - event["top"]))
                event_indices[idx].append(event)
                accumulated = ""
                for j in range(idx, min(idx + 5, len(lines))):
                    fragment = key_text(lines[j]["text"])
                    if j > idx and not target.startswith(accumulated + fragment[:12]):
                        break
                    accumulated += fragment
                    heading_indices.add(j)
                    if len(accumulated) >= len(target) - 3:
                        break
            # Ruled course/fee/calendar tables are kept as policy blocks.
            tables = page.find_tables() if page_number < 217 or page_number >= 397 else []
            table_boxes = [table.bbox for table in tables]
            prior_table = None
            for idx, line in enumerate(lines):
                text = clean_text(line["text"])
                if idx in event_indices:
                    flush()
                    path = event_indices[idx][-1]["path"]
                elif (217 <= page_number <= 396 and bold_heading(line)
                      and re.match(r"^[A-Z]{2,}\s+\d{2,3}[A-Z]?\b", text)):
                    # The PDF omits a few actual course headings from its bookmarks.
                    flush()
                    title = text
                    heading_indices.add(idx)
                    for j in range(idx + 1, min(idx + 4, len(lines))):
                        if not bold_heading(lines[j]) or lines[j]["top"] - lines[j - 1]["bottom"] > 7:
                            break
                        title += " " + clean_text(lines[j]["text"])
                        heading_indices.add(j)
                    path = path[:3] + [title]
                    outline.append(dict(title=title, depth=3, page=page_number, top=line["top"],
                                        path=list(path), source="inferred_from_bold_course_heading"))
                small_chars = sorted((c for c in line.get("chars", [])
                                      if c["size"] < 9 and c["text"].isdigit()), key=lambda c: (c["top"], c["x0"]))
                groups, previous = [], None
                for char in small_chars:
                    if previous and abs(char["top"] - previous["top"]) < 2 and char["x0"] - previous["x1"] < 3:
                        groups[-1] += char["text"]
                    else:
                        groups.append(char["text"])
                    previous = char
                for number in groups:
                    reference_paths[number] = list(path)
                if idx in heading_indices:
                    last_bottom = line["bottom"]
                    continue
                if not text or text == str(page_number):
                    continue
                table = next((i for i, box in enumerate(table_boxes)
                              if box[1] - 2 <= line["top"] < box[3]), None)
                if (set(text.lower().split()) <= {"course", "code", "name", "credit", "credits"}
                        and "course" in text.lower()):
                    excluded.append(dict(page=page_number, text=text, reason="repeated_table_header"))
                    continue
                meta = metadata(path)
                same_context = current_meta == meta
                gap = line["top"] - last_bottom if last_bottom is not None else 0
                new_page = bool(current and current_end != page_number)
                course = len(path) >= 4 and path[1] == "Course Descriptions"
                table_continuation = table is not None and prior_table == table
                prerequisite = text.startswith(("Prerequisite", "Corequisite", "Co-requisite", "Cross-listed"))
                unbookmarked_heading = bold_heading(line) and len(text.split()) <= 16 and not text.endswith(".")
                calendar_event = 397 <= page_number <= 399 and bool(re.match(
                    r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d", text))
                contact = page_number == 400 and text.startswith("•")
                # Course descriptions and prerequisites form one self-contained block.
                paragraph_break = gap > 8 and not (table_continuation or course or prerequisite)
                # Continue incomplete prose over a page boundary, but not unrelated blocks.
                if new_page:
                    paragraph_break = bool(re.search(r"[.!?:][\"”’)]?$", current[-1]))
                    if course:
                        paragraph_break = False
                if current and (not same_context or paragraph_break or calendar_event or contact or unbookmarked_heading
                                or (prior_table is not None and table != prior_table)):
                    flush()
                if not current:
                    current_meta = meta
                    current_page = page_number
                    current_kind = ("contact" if contact else "calendar_event" if calendar_event else
                                    "course_description" if course else "table_block" if table is not None else "paragraph")
                    current_starts_with_heading = unbookmarked_heading
                current.append(text)
                if table is not None and current_kind == "paragraph":
                    current_kind = "table_block"
                current_end = page_number
                last_bottom = line["bottom"]
                prior_table = table
            note_number, note_text = None, []
            def save_note():
                if note_text:
                    if note_number not in reference_paths:
                        raise ValueError(f"Unresolved footnote {note_number} on page {page_number}")
                    footnote_rows.append({**metadata(reference_paths[note_number]), "page": page_number,
                                          "page_end": page_number, "passage_kind": "footnote",
                                          "starts_with_heading": False, "text": "\n".join(note_text)})
            for line in footnote_lines:
                match = re.match(r"^(\d{1,2})\s+", line["text"])
                if match:
                    save_note()
                    note_number, note_text = match[1], []
                note_text.append(line["text"])
            save_note()
            last_bottom = None
            if page_number % 50 == 0:
                print(f"Extracted {page_number}/{len(pdf.pages)} pages", flush=True)
            page.close()
    flush()
    raw.extend(footnote_rows)
    raw.sort(key=lambda row: row["page"])
    outline.sort(key=lambda event: (event["page"], event["top"], event["depth"]))
    return raw, outline, dict(page_count=len(reader.pages), exclusions=excluded)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--output", type=Path, default=DATA)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
    token_count = lambda text: len(tokenizer.encode(text, add_special_tokens=True))
    raw, outline, extraction = extract_passages(args.pdf)
    for i, row in enumerate(raw, 1):
        row["raw_passage_ids"] = f"r{i:05d}"
    write_csv(args.output / "lab8_raw_passages.csv", raw)
    write_json(args.output / "lab8_document_outline.json", outline)
    merged, merged_count = merge_fragments(raw)
    kept, duplicates = deduplicate(merged)
    passages, rejected = [], []
    split_count = 0
    for i, row in enumerate(kept, 1):
        text = clean_text(row["text"])
        if text == "Chinese as Second Language Courses":
            rejected.append({**row, "reason": "structural_heading_without_body"})
            continue
        if not re.search(r"[A-Za-z]{2}", text):
            rejected.append({**row, "reason": "no_meaningful_text"})
            continue
        chunks = passage_chunks(row, token_count)
        split_count += len(chunks) - 1
        for j, chunk in enumerate(chunks, 1):
            passages.append({"passage_id": f"p{i:05d}_{j:02d}", "parent_passage_id": f"p{i:05d}",
                             **{k: v for k, v in row.items() if k not in ("text", "occurrence_pages")},
                             "text": chunk, "text_clean": chunk,
                             "word_count": len(chunk.split()), "token_count": token_count(chunk),
                             "chunk_index": j, "chunk_count": len(chunks),
                             "occurrence_pages": json.dumps(row["occurrence_pages"])})
    write_csv(args.output / "lab8_bulletin_passages.csv", passages)
    write_json(args.output / "lab8_exclusions.json", extraction["exclusions"] + duplicates + rejected)
    quality = {
        "title": "Bulletin of Duke Kunshan University: Undergraduate Instruction",
        "academic_year": "2021-2022", "publication_date": "July 2021",
        "source_url": SOURCE_URL, "source_acquisition": "User-supplied local PDF; remote identity not independently verified",
        "local_source": str(args.pdf.resolve().relative_to(HERE.parents[1])),
        "accessed_date": date.today().isoformat(),
        "source_sha256": hashlib.sha256(args.pdf.read_bytes()).hexdigest(),
        "page_count": extraction["page_count"], "page_convention": "1-based PDF page; matches printed page numbers; page_end is inclusive",
        "raw_passage_count": len(raw), "duplicate_blocks_removed": len(duplicates),
        "fragments_merged_into_context": merged_count,
        "malformed_blocks_removed": len(rejected), "additional_chunks_from_token_splitting": split_count,
        "clean_passage_count": len(passages), "mean_word_count": sum(p["word_count"] for p in passages) / len(passages),
        "section_count": len({p["section_id"] for p in passages}), "maximum_token_count": max(p["token_count"] for p in passages),
        "token_limit_including_special_tokens": 256,
        "section_definition": "Direct child of a Part bookmark; synthetic Chapter introduction for text preceding the first section. Deeper headings retained in subsection and hierarchy_path.",
        "deduplication": "Exact normalized text within the full hierarchy path; cross-hierarchy repetitions retained with provenance.",
        "excluded_pages": [1, 3, 4, 5, 6, 7, 8, 9],
        "exclusion_counts": dict(Counter(r["reason"] for r in extraction["exclusions"] + duplicates + rejected)),
        "limitations": ["Automated layout-based segmentation; representative manual audit does not guarantee every boundary.",
                       "Split chunks retain their parent page span; individual sentence coordinates are not exported.",
                       "Formal sections differ greatly in size, particularly Majors and Course Descriptions."]}
    assert len(passages) == len(raw) - merged_count - len(duplicates) - len(rejected) + split_count
    write_json(args.output / "lab8_corpus_quality.json", quality)
    print(json.dumps(quality, indent=2))


if __name__ == "__main__":
    main()
