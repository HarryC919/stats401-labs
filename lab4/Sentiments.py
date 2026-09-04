import re
from pathlib import Path
from typing import Any, cast

import pandas as pd
from transformers import pipeline

MODEL_NAME = "cardiffnlp/twitter-roberta-base-sentiment-latest"

# RoBERTa tops out at 512 tokens. This checkpoint's tokenizer reports
# an effectively unbounded model_max_length, so truncation=True alone
# never truncates; max_length must be passed explicitly.
MAX_TOKENS = 512
BATCH_SIZE = 16

TWEET_COLUMNS = [
    "tweet_id",
    "created_at",
    "date",
    "hour",
    "weekday",
    "account_name",
    "client_clean",
    "hashtags",
    "text_clean",
    "favorite_count",
    "retweet_count",
    "view_count",
    "sentiment",
    "sentiment_score",
    "sentiment_negative",
    "sentiment_neutral",
    "sentiment_positive",
]


def prepare_for_roberta(text: object) -> str:
    """Lightly normalize a tweet, keeping sentiment-bearing signals."""
    text = str(text)
    text = re.sub(r"@\w+", "@user", text)
    text = re.sub(r"https?://\S+|www\.\S+", "http", text)

    return text.strip()


def analyze_sentiment(texts: list) -> pd.DataFrame:
    """Score every tweet with the RoBERTa sentiment model."""
    sentiment_model = pipeline(
        "text-classification",
        model=MODEL_NAME,
        top_k=None,
        device="cpu",
    )

    results = sentiment_model(
        texts,
        truncation=True,
        max_length=MAX_TOKENS,
        batch_size=BATCH_SIZE,
    )

    # The pipeline stubs do not describe the top_k=None return shape;
    # at runtime each item is a list of {"label": ..., "score": ...}.
    rows = []

    for scores in cast(list[list[dict[str, Any]]], results):
        score_dict = {
            item["label"].lower(): item["score"] for item in scores
        }
        rows.append(
            {
                "sentiment_negative": score_dict.get("negative", 0),
                "sentiment_neutral": score_dict.get("neutral", 0),
                "sentiment_positive": score_dict.get("positive", 0),
            }
        )

    return pd.DataFrame(rows)


def build_tidy_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Derive labels and time attributes, then select tidy columns."""
    df = df.copy()

    df["sentiment_score"] = (
        df["sentiment_positive"] - df["sentiment_negative"]
    )

    label_scores = df[
        ["sentiment_negative", "sentiment_neutral", "sentiment_positive"]
    ]
    df["sentiment"] = (
        # idxmax returns column labels (strings) at runtime, but the
        # pandas stubs type them as int; astype(str) reflects reality.
        label_scores.idxmax(axis=1)
        .astype(str)
        .str.replace("sentiment_", "", regex=False)
        .str.capitalize()
    )

    df["created_at"] = pd.to_datetime(df["created_at"])
    df["date"] = df["created_at"].dt.date.astype("string")
    df["hour"] = df["created_at"].dt.hour
    df["weekday"] = df["created_at"].dt.day_name()

    return df[TWEET_COLUMNS]


def save_csv(df: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    df.to_csv(
        output_path,
        index=False,
        encoding="utf-8-sig",
    )


def save_aggregates(vis_df: pd.DataFrame, data_dir: Path) -> None:
    """Export one-row-per-group tables for D3 (Task 14)."""
    sentiment_counts = (
        vis_df["sentiment"]
        .value_counts()
        .rename_axis("sentiment")
        .reset_index(name="count")
    )
    save_csv(sentiment_counts, data_dir / "lab4_sentiment_counts.csv")

    sentiment_client = (
        vis_df.groupby(["client_clean", "sentiment"])
        .size()
        .reset_index(name="count")
    )
    save_csv(sentiment_client, data_dir / "lab4_sentiment_by_client.csv")

    sentiment_weekday = (
        vis_df.groupby("weekday")["sentiment_score"]
        .mean()
        .reset_index()
    )
    save_csv(sentiment_weekday, data_dir / "lab4_sentiment_by_weekday.csv")


def main() -> None:
    data_dir = Path(__file__).resolve().parent.parent / "data"
    input_path = data_dir / "Cleaned_Tweets_Database.csv"

    df = pd.read_csv(input_path)

    texts = df["text"].fillna("").map(prepare_for_roberta).tolist()
    sentiment_df = analyze_sentiment(texts)
    df = pd.concat([df, sentiment_df], axis=1)

    vis_df = build_tidy_frame(df)

    if len(vis_df) < 1000:
        raise RuntimeError(f"Only {len(vis_df)} tweets were collected")

    if vis_df["sentiment"].isna().any():
        raise ValueError("At least one tweet is missing a sentiment")

    save_csv(vis_df, data_dir / "lab4_clean_tweets.csv")
    save_aggregates(vis_df, data_dir)

    print(f"Saved {len(vis_df)} tweets to {data_dir / 'lab4_clean_tweets.csv'}")
    print(vis_df["sentiment"].value_counts().to_string())


if __name__ == "__main__":
    main()
