import pandas as pd
import html
import re
from pathlib import Path

data_dir = Path(__file__).resolve().parent.parent / "data"
input_path = data_dir / "Tweets_Database.csv"
output_path = data_dir / "Cleaned_Tweets_Database.csv"

df = pd.read_csv(input_path)

df.dropna(subset=["text"], inplace=True)
df = df[df["language"] == "en"]
df = df[df["type"] == "Tweet"]
df["created_at"] = pd.to_datetime(df["created_at"], errors="coerce")
df = df.dropna(subset=["created_at"])
df = df[df["created_at"] >= "2026-01-01"]
# The raw file is a concatenation of per-account CSVs; rows whose
# account_name is the file name are embedded header rows, not tweets.
df = df[df["account_name"] != "Tweets_Database.csv"]
df["tweet_id"] = df["tweet_id"].astype("string").str.strip("'")
df.drop_duplicates(subset=["tweet_id"], inplace=True)

count_cols = [
    "bookmark_count",
    "favorite_count",
    "retweet_count",
    "reply_count",
    "view_count",
]
for col in count_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

whitespace_pattern = re.compile(r"\s+")
html_tag_pattern = re.compile(r"<[^>]+>")


def clean_text(value):
    if pd.isna(value):
        return pd.NA

    value = html.unescape(str(value))
    value = value.replace("\u2028", " ").replace("\u2029", " ")
    value = whitespace_pattern.sub(" ", value).strip()

    return value


def clean_client(value):
    if pd.isna(value):
        return pd.NA

    value = html_tag_pattern.sub("", str(value))
    value = html.unescape(value)
    value = whitespace_pattern.sub(" ", value).strip()

    return value


df["text_clean"] = df["text"].map(clean_text)
df["client_clean"] = df["client"].map(clean_client)

print(f"Shape of cleaned DataFrame: {df.shape}")

df.to_csv(output_path, index=False)
