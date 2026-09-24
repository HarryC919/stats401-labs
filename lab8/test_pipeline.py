"""Focused regression tests for corpus boundaries and semantic exports."""

import importlib.util
import unittest


class CorpusTests(unittest.TestCase):
    def implementation(self):
        spec = importlib.util.find_spec("prepare_corpus")
        self.assertIsNotNone(spec, "The corpus preparation module must exist")
        import prepare_corpus
        return prepare_corpus

    def test_clean_preserves_words_and_normalizes_whitespace(self):
        module = self.implementation()
        self.assertEqual(module.clean_text("  Students\n must\tregister.  "), "Students must register.")

    def test_identical_text_in_different_sections_keeps_provenance(self):
        module = self.implementation()
        rows = [dict(text="Students must register.", hierarchy_path="A", page=10),
                dict(text="Students must register.", hierarchy_path="B", page=20),
                dict(text="Students must register.", hierarchy_path="A", page=11)]
        kept, removed = module.deduplicate(rows)
        self.assertEqual(len(kept), 2)
        self.assertEqual(len(removed), 1)
        self.assertEqual(kept[0]["occurrence_pages"], [10, 11])

    def test_token_chunks_preserve_all_words(self):
        module = self.implementation()
        text = "First sentence is here. Second sentence is longer. Third sentence ends."
        chunks = module.split_for_model(text, lambda s: len(s.split()) + 2, limit=8)
        self.assertEqual(" ".join(chunks), text)
        self.assertTrue(all(len(c.split()) + 2 <= 8 for c in chunks))
        self.assertEqual(chunks[0], "First sentence is here.")

    def test_table_chunks_end_between_rows(self):
        module = self.implementation()
        self.assertTrue(hasattr(module, "passage_chunks"))
        row = dict(text="ECON 101 Economics 4\nECON 102 Economics 4", passage_kind="table_block")
        chunks = module.passage_chunks(row, lambda text: len(text.split()) + 2, limit=8)
        self.assertEqual(chunks, ["ECON 101 Economics 4", "ECON 102 Economics 4"])

    def test_short_heading_attaches_to_its_policy_without_crossing_sections(self):
        module = self.implementation()
        self.assertTrue(hasattr(module, "merge_fragments"))
        rows = [dict(text="Eligibility", hierarchy_path="A", page=73, page_end=73, passage_kind="paragraph"),
                dict(text="Students must apply and receive approval before they participate in study away programs.", hierarchy_path="A", page=73, page_end=73, passage_kind="paragraph"),
                dict(text="Different section", hierarchy_path="B", page=74, page_end=74, passage_kind="paragraph")]
        merged, count = module.merge_fragments(rows)
        self.assertEqual(count, 1)
        self.assertEqual(len(merged), 2)
        self.assertTrue(merged[0]["text"].startswith("Eligibility\nStudents"))

    def test_calendar_row_keeps_vertically_offset_date_with_its_event(self):
        module = self.implementation()
        self.assertTrue(hasattr(module, "calendar_table_lines"))
        import pdfplumber
        with pdfplumber.open(module.DEFAULT_PDF) as pdf:
            lines = module.calendar_table_lines(pdf.pages[397])
        row = next(line["text"] for line in lines if "January 31" in line["text"])
        self.assertIn("Spring Festival", row)


class SemanticTests(unittest.TestCase):
    def implementation(self):
        spec = importlib.util.find_spec("analyze_corpus")
        self.assertIsNotNone(spec, "The semantic analysis module must exist")
        import analyze_corpus
        return analyze_corpus

    def test_neighbors_use_cosine_and_exclude_self_even_with_ties(self):
        import numpy as np
        module = self.implementation()
        vectors = np.array([[1., 0.], [1., 0.], [0., 1.], [-1., 0.]])
        result = module.nearest_neighbors(vectors, ["a", "b", "c", "d"], 2)
        self.assertEqual(result["a"][0]["passage_id"], "b")
        for key, entries in result.items():
            self.assertNotIn(key, [entry["passage_id"] for entry in entries])
            self.assertEqual(len(entries), 2)

    def test_matrix_includes_zero_cells_and_correct_denominators(self):
        import pandas as pd
        module = self.implementation()
        data = pd.DataFrame([
            dict(section_id="a", chapter="C", section="A", cluster=0),
            dict(section_id="a", chapter="C", section="A", cluster=0),
            dict(section_id="b", chapter="C", section="B", cluster=1),
        ])
        matrix = module.topic_matrix(data, {0: "First", 1: "Second"})
        self.assertEqual(len(matrix), 4)
        self.assertEqual(int(matrix["count"].sum()), 3)
        self.assertEqual(matrix.query("section_id == 'a' and cluster == 1").iloc[0]["count"], 0)
        self.assertTrue((matrix.groupby("section_id")["proportion"].sum() == 1).all())


class BulletinBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import prepare_corpus
        cls.rows, _, _ = prepare_corpus.extract_passages(prepare_corpus.DEFAULT_PDF)

    def test_unbookmarked_courses_have_their_own_hierarchy(self):
        for title in ("MEDIART 390 Junior Seminar", "POLSCI 204 The U.S. Constitution"):
            self.assertTrue(any(title in row["hierarchy_path"] for row in self.rows), title)
        previous = [row for row in self.rows if "MEDIART 313" in row["hierarchy_path"]]
        self.assertFalse(any("MEDIART 390" in row["text"] for row in previous))

    def test_footnotes_do_not_interrupt_cross_page_sentence(self):
        import prepare_corpus
        self.assertTrue(any("Generally speaking the review" in prepare_corpus.clean_text(row["text"])
                            for row in self.rows))

    def test_new_page_heading_starts_a_new_policy_block(self):
        import prepare_corpus
        merged, _ = prepare_corpus.merge_fragments(self.rows)
        admissions = [row for row in merged if "Chinese Students:" in row["text"]]
        self.assertTrue(admissions)
        self.assertFalse(any("Regular Decision (International Students)" in row["text"] for row in admissions))


if __name__ == "__main__":
    unittest.main()
