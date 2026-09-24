"""Compute corpus summaries, embeddings, topics, UMAP, and semantic neighbors.

Run after prepare_corpus.py. Review lab8_topic_review.json before supplying
human-reviewed names with --label-only --labels ../data/lab8_topic_labels.json.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

from prepare_corpus import DATA, MODEL, REVISION, write_json

SEED = 401
N_CLUSTERS = 8


def nearest_neighbors(vectors: np.ndarray, ids: list[str], count: int = 5) -> dict:
    """Exact cosine neighbors in batches, with deterministic ties and no self."""
    from sklearn.preprocessing import normalize
    vectors = normalize(vectors)
    result = {}
    for start in range(0, len(ids), 256):
        scores = vectors[start:start + 256] @ vectors.T
        for offset, row in enumerate(scores):
            index = start + offset
            row[index] = -np.inf
            neighbors = np.argsort(-row, kind="stable")[:min(count, len(ids) - 1)]
            result[ids[index]] = [dict(passage_id=ids[j], similarity=float(np.clip(row[j], -1, 1)))
                                  for j in neighbors]
    return result


def topic_matrix(df: pd.DataFrame, names: dict[int, str]) -> pd.DataFrame:
    """Use full-corpus section totals as the proportion denominator."""
    sections = df[["section_id", "chapter", "section"]].drop_duplicates()
    counts = df.groupby(["section_id", "cluster"]).size()
    totals = df.groupby("section_id").size()
    rows = []
    for section in sections.to_dict("records"):
        for cluster, name in sorted(names.items()):
            count = int(counts.get((section["section_id"], cluster), 0))
            total = int(totals[section["section_id"]])
            rows.append({**section, "cluster": cluster, "cluster_name": name,
                         "count": count, "section_total": total, "proportion": count / total})
    return pd.DataFrame(rows)


def corpus_summaries(df: pd.DataFrame, output: Path):
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
    # This stop list affects interpretation only; embeddings use natural text.
    stop_words = sorted(set(ENGLISH_STOP_WORDS) | {
        "course", "courses", "student", "students", "credits", "credit",
        "prerequisite", "prerequisites", "duke", "kunshan", "university"})
    vectorizer = TfidfVectorizer(stop_words=stop_words, ngram_range=(1, 2),
                                 min_df=3, max_df=0.85, sublinear_tf=True,
                                 token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z-]{2,}\b")
    tfidf = vectorizer.fit_transform(df.text_clean)
    terms = vectorizer.get_feature_names_out()
    means = np.asarray(tfidf.mean(axis=0)).ravel()
    top = np.argsort(-means, kind="stable")[:30]
    sections = df.groupby(["section_id", "chapter", "section"], sort=False).agg(
        passage_count=("passage_id", "size"), average_word_count=("word_count", "mean"),
        median_word_count=("word_count", "median"), total_words=("word_count", "sum")).reset_index()
    sections.to_csv(output / "lab8_section_summary.csv", index=False)
    summary = dict(passage_count=len(df), section_count=len(sections),
                   length_statistics=df.word_count.describe().to_dict(),
                   by_section=sections.to_dict("records"),
                   top_tfidf_terms=[dict(term=terms[i], mean_tfidf=float(means[i])) for i in top],
                   tfidf_settings=dict(ngram_range=[1, 2], min_df=3, max_df=0.85,
                                       sublinear_tf=True, stop_words=stop_words))
    write_json(output / "lab8_corpus_summary.json", summary)
    return tfidf, terms


def review_topics(df, vectors, centers, tfidf, terms):
    reviews = []
    for cluster in range(len(centers)):
        indices = np.flatnonzero(df.cluster.to_numpy() == cluster)
        characteristic = np.asarray(tfidf[indices].mean(axis=0)).ravel()
        term_indices = np.argsort(-characteristic, kind="stable")[:20]
        distances = np.linalg.norm(vectors[indices] - centers[cluster], axis=1)
        ranked = indices[np.argsort(distances, kind="stable")]
        # Representative and peripheral examples reveal mixed themes.
        examples = list(ranked[:5]) + list(ranked[-3:])
        reviews.append(dict(cluster=cluster, passage_count=len(indices),
                            top_terms=[str(terms[i]) for i in term_indices],
                            top_sections=df.iloc[indices].groupby(["chapter", "section"]).size()
                            .sort_values(ascending=False).head(8).reset_index(name="count").to_dict("records"),
                            examples=[dict(role="representative" if n < 5 else "peripheral",
                                           **df.iloc[i][["passage_id", "chapter", "section", "subsection", "page", "text"]].to_dict())
                                      for n, i in enumerate(examples)]))
    return reviews


def validate_outputs(output: Path) -> dict:
    df = pd.read_csv(output / "lab8_embedding_map.csv", keep_default_na=False)
    matrix = pd.read_csv(output / "lab8_topic_section_matrix.csv", keep_default_na=False)
    neighbors = json.loads((output / "lab8_neighbors.json").read_text())
    summary = json.loads((output / "lab8_corpus_summary.json").read_text())
    quality = json.loads((output / "lab8_corpus_quality.json").read_text())
    embedding_index = json.loads((output / "lab8_embedding_index.json").read_text())
    vectors = np.load(output / "lab8_embeddings.npy")
    ids = df.passage_id.tolist()
    id_set = set(ids)
    prepared = pd.read_csv(output / "lab8_bulletin_passages.csv", keep_default_na=False)
    assert prepared.passage_id.tolist() == ids
    assert prepared.text_clean.tolist() == df.text_clean.tolist()
    corpus_digest = hashlib.sha256(json.dumps(list(zip(df.passage_id, df.text_clean)), ensure_ascii=False).encode()).hexdigest()
    assert corpus_digest == embedding_index["corpus_sha256"]
    assert embedding_index["model"] == MODEL and embedding_index["revision"] == REVISION
    assert len(id_set) == len(df) == quality["clean_passage_count"]
    assert len(df) == quality["raw_passage_count"] - quality["fragments_merged_into_context"] - quality["duplicate_blocks_removed"] - quality["malformed_blocks_removed"] + quality["additional_chunks_from_token_splitting"]
    assert df.text_clean.str.len().min() > 0
    assert df.token_count.max() <= 256
    assert df.page.between(2, 400).all() and (df.page_end >= df.page).all()
    assert np.isfinite(df[["x", "y"]].to_numpy()).all()
    assert vectors.shape == (len(df), 384) and np.isfinite(vectors).all()
    assert embedding_index["passage_ids"] == ids
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-5)
    assert int(matrix["count"].sum()) == len(df)
    assert len(matrix) == df.section_id.nunique() * df.cluster.nunique()
    assert np.allclose(matrix.groupby("section_id").proportion.sum(), 1)
    assert sum(s["passage_count"] for s in summary["by_section"]) == len(df)
    assert set(neighbors) == id_set
    positions = {pid: i for i, pid in enumerate(ids)}
    sections_by_id = df.set_index("passage_id").section_id.to_dict()
    for pid, items in neighbors.items():
        assert len(items) == 5 and len({item["passage_id"] for item in items}) == 5
        assert all(item["passage_id"] in id_set and item["passage_id"] != pid for item in items)
        scores = [item["similarity"] for item in items]
        assert scores == sorted(scores, reverse=True)
        for item in items:
            actual = float(vectors[positions[pid]] @ vectors[positions[item["passage_id"]]])
            assert abs(actual - item["similarity"]) < 2e-5
            assert item["cross_section"] == (sections_by_id[pid] != sections_by_id[item["passage_id"]])
    result = dict(status="passed", passage_count=len(df), section_count=int(df.section_id.nunique()),
                  topic_count=int(df.cluster.nunique()), matrix_cells=len(matrix),
                  neighbor_edges=sum(map(len, neighbors.values())),
                  checks=["unique IDs and reconciled corpus counts", "nonempty passages and model token limit",
                          "source page ranges", "finite coordinates and normalized 384D embeddings",
                          "prepared/exported text identity and embedding row alignment", "complete matrix and section denominators",
                          "summary totals", "neighbor validity, descending scores, and original-vector cosine consistency"])
    write_json(output / "lab8_validation.json", result)
    return result


def apply_labels(output: Path, labels: Path):
    names_input = json.loads(labels.read_text())
    names = {int(key): value["name"] for key, value in names_input.items()}
    df = pd.read_csv(output / "lab8_embedding_map.csv", keep_default_na=False)
    if set(names) != set(df.cluster.unique()) or len(set(names.values())) != len(names):
        raise ValueError("Labels must cover every cluster exactly once, with unique names")
    df["cluster_name"] = df.cluster.map(names)
    df.to_csv(output / "lab8_embedding_map.csv", index=False)
    topic_matrix(df, names).to_csv(output / "lab8_topic_section_matrix.csv", index=False)
    metadata = json.loads((output / "lab8_model_metadata.json").read_text())
    metadata["labeling_status"] = "Reviewed using centroid-near examples, peripheral examples, and TF-IDF terms"
    metadata["topic_labels"] = names_input
    write_json(output / "lab8_model_metadata.json", metadata)
    print(json.dumps(validate_outputs(output), indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DATA)
    parser.add_argument("--labels", type=Path)
    parser.add_argument("--label-only", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    if args.validate_only:
        print(json.dumps(validate_outputs(args.output), indent=2))
        return
    if args.label_only:
        if not args.labels:
            parser.error("--label-only requires --labels")
        apply_labels(args.output, args.labels)
        return
    from sentence_transformers import SentenceTransformer
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score
    import torch
    import umap

    df = pd.read_csv(args.output / "lab8_bulletin_passages.csv", keep_default_na=False)
    tfidf, terms = corpus_summaries(df, args.output)
    digest = hashlib.sha256(json.dumps(list(zip(df.passage_id, df.text_clean)), ensure_ascii=False).encode()).hexdigest()
    index_path = args.output / "lab8_embedding_index.json"
    index = dict(model=MODEL, revision=REVISION, corpus_sha256=digest, passage_ids=df.passage_id.tolist())
    vector_path = args.output / "lab8_embeddings.npy"
    model = SentenceTransformer(MODEL, revision=REVISION, device="cpu")
    assert model.max_seq_length == 256
    if vector_path.exists() and index_path.exists() and json.loads(index_path.read_text()) == index:
        vectors = np.load(vector_path)
        print("Reusing embeddings with matching model, revision, text, and passage IDs", flush=True)
    else:
        torch.manual_seed(SEED)
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        vectors = model.encode(df.text_clean.tolist(), normalize_embeddings=True,
                               batch_size=32, show_progress_bar=True, convert_to_numpy=True)
        np.save(vector_path, vectors)
        write_json(index_path, index)
    print("Clustering original embeddings and projecting with UMAP", flush=True)
    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=SEED, n_init=10)
    df["cluster"] = kmeans.fit_predict(vectors)
    reducer = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.15,
                        metric="cosine", random_state=SEED, n_jobs=1)
    coords = reducer.fit_transform(vectors)
    df["x"], df["y"] = coords[:, 0], coords[:, 1]
    names = {i: f"Unreviewed topic {i}" for i in range(N_CLUSTERS)}
    df["cluster_name"] = df.cluster.map(names)
    df.to_csv(args.output / "lab8_embedding_map.csv", index=False)
    topic_matrix(df, names).to_csv(args.output / "lab8_topic_section_matrix.csv", index=False)
    neighbors = nearest_neighbors(vectors, df.passage_id.tolist())
    sections_by_id = df.set_index("passage_id").section_id.to_dict()
    for pid, entries in neighbors.items():
        for entry in entries:
            entry["cross_section"] = sections_by_id[pid] != sections_by_id[entry["passage_id"]]
    write_json(args.output / "lab8_neighbors.json", neighbors)
    write_json(args.output / "lab8_topic_review.json", review_topics(df, vectors, kmeans.cluster_centers_, tfidf, terms))
    metadata = dict(model=MODEL, revision=REVISION, embedding_dimension=int(vectors.shape[1]),
                    normalized=True, device="cpu", maximum_sequence_length=model.max_seq_length,
                    corpus_sha256=digest, random_seed=SEED,
                    umap=dict(n_components=2, n_neighbors=15, min_dist=0.15, metric="cosine", random_state=SEED, n_jobs=1),
                    clustering=dict(method="KMeans", space="original normalized embeddings", n_clusters=N_CLUSTERS,
                                    n_init=10, random_state=SEED,
                                    cosine_silhouette=float(silhouette_score(vectors, df.cluster, metric="cosine"))),
                    nearest_neighbors=dict(metric="cosine", space="original normalized embeddings", count=5,
                                           tie_break="corpus row order", self_excluded=True),
                    labeling_status="Unreviewed; inspect lab8_topic_review.json before naming topics",
                    package_versions={p: importlib.metadata.version(p) for p in
                                      ["pypdf", "pdfplumber", "pandas", "numpy", "scikit-learn", "torch", "transformers", "sentence-transformers", "umap-learn"]},
                    references=["https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
                                "https://umap-learn.readthedocs.io/en/latest/parameters.html"],
                    interpretation_notes=["UMAP axes have no independent semantic meaning; 2D distances are approximate.",
                                          "Eight topics follow the assignment starting configuration, not a proven optimal topic count.",
                                          "Topic labels summarize mixed clusters and are interpretive rather than ground truth."])
    write_json(args.output / "lab8_model_metadata.json", metadata)
    if args.labels:
        apply_labels(args.output, args.labels)
    else:
        print(json.dumps(validate_outputs(args.output), indent=2))


if __name__ == "__main__":
    main()
