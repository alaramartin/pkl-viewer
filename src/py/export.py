#!/usr/bin/env python3
"""One-shot pickle exporter: peek a pickle's shape, or convert it to JSON/CSV/Parquet.

Whole-file export only. This does NOT use the sidecar's handle registry -- that
work (feature 1) was reverted out of the working tree (see PLAN.md, feature 3
notes) and only exists in git history. Every invocation here unpickles the
file from scratch; there's no persistent process or subtree addressing.

Usage:
    export.py <path> --peek
    export.py <path> --format json|csv|parquet --out <dest>
"""
import argparse
import base64
import csv as csv_module
import json
import pickle
from decimal import Decimal
from datetime import date, datetime

TABULAR_KINDS = {"dataframe", "series", "ndarray", "list_of_dicts"}


def load(path):
    with open(path, "rb") as f:
        return pickle.load(f)


def detect_kind(obj):
    try:
        import pandas as pd
        if isinstance(obj, pd.DataFrame):
            return "dataframe"
        if isinstance(obj, pd.Series):
            return "series"
    except ImportError:
        pass
    try:
        import numpy as np
        if isinstance(obj, np.ndarray) and obj.ndim <= 2:
            return "ndarray"
    except ImportError:
        pass
    if isinstance(obj, list) and obj and all(isinstance(x, dict) for x in obj):
        return "list_of_dicts"
    return "other"


def parquet_engine():
    """Which parquet engine is usable, if any. Requires pandas either way."""
    try:
        import pandas  # noqa: F401
    except ImportError:
        return None
    try:
        import pyarrow  # noqa: F401
        return "pyarrow"
    except ImportError:
        pass
    try:
        import fastparquet  # noqa: F401
        return "fastparquet"
    except ImportError:
        pass
    return None


def cmd_peek(args):
    obj = load(args.path)
    print(json.dumps({
        "kind": detect_kind(obj),
        "parquetEngine": parquet_engine(),
    }))


class PklJSONEncoder(json.JSONEncoder):
    """Best-effort encoder for whatever a pickle happened to contain.

    Anything it doesn't recognize becomes {"__unserializable__": repr(x)}
    rather than failing the whole export.
    """

    def default(self, o):
        try:
            import numpy as np
            if isinstance(o, np.ndarray):
                return o.tolist()
            if isinstance(o, np.generic):
                return o.item()
        except ImportError:
            pass
        try:
            import pandas as pd
            if isinstance(o, pd.DataFrame):
                return json.loads(o.to_json(orient="records"))
            if isinstance(o, pd.Series):
                return json.loads(o.to_json(orient="records"))
            if isinstance(o, pd.Timestamp):
                return o.isoformat()
        except ImportError:
            pass
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return str(o)
        if isinstance(o, bytes):
            return base64.b64encode(o).decode("ascii")
        if isinstance(o, (set, frozenset)):
            return list(o)
        try:
            return {"__unserializable__": repr(o)}
        except Exception:
            return {"__unserializable__": "<unrepresentable>"}


def to_dataframe_like(obj, kind):
    import pandas as pd
    if kind == "dataframe":
        return obj
    if kind == "series":
        return obj.to_frame()
    if kind in ("ndarray", "list_of_dicts"):
        return pd.DataFrame(obj)
    raise ValueError(f"cannot convert kind '{kind}' to a table")


def export_json(obj, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(obj, f, cls=PklJSONEncoder, indent=2)


def export_csv(obj, kind, out_path):
    if kind not in TABULAR_KINDS:
        raise SystemExit(
            "This pickle isn't tabular data (DataFrame, Series, 2D array, or list "
            "of dicts), so it can't be exported as CSV. Try JSON instead."
        )
    try:
        import pandas  # noqa: F401
    except ImportError:
        if kind == "list_of_dicts":
            # pandas-free fallback -- the one tabular shape the stdlib can handle alone
            fieldnames = []
            for row in obj:
                for key in row.keys():
                    if key not in fieldnames:
                        fieldnames.append(key)
            with open(out_path, "w", newline="", encoding="utf-8") as f:
                writer = csv_module.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(obj)
            return
        raise SystemExit("CSV export for this data type needs pandas. Run: pip install pandas")

    df = to_dataframe_like(obj, kind)
    df.to_csv(out_path, index=(kind != "list_of_dicts"))


def export_parquet(obj, kind, out_path):
    if kind not in TABULAR_KINDS:
        raise SystemExit(
            "This pickle isn't tabular data (DataFrame, Series, 2D array, or list "
            "of dicts), so it can't be exported as Parquet. Try JSON instead."
        )
    engine = parquet_engine()
    if engine is None:
        raise SystemExit(
            "Parquet export needs pandas plus pyarrow (or fastparquet). "
            "Run: pip install pandas pyarrow"
        )
    df = to_dataframe_like(obj, kind)
    df.to_parquet(out_path, engine=engine, index=(kind != "list_of_dicts"))


def cmd_convert(args):
    obj = load(args.path)
    kind = detect_kind(obj)
    if args.format == "json":
        export_json(obj, args.out)
    elif args.format == "csv":
        export_csv(obj, kind, args.out)
    elif args.format == "parquet":
        export_parquet(obj, kind, args.out)
    else:
        raise SystemExit(f"unknown format: {args.format}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--peek", action="store_true")
    parser.add_argument("--format", choices=["json", "csv", "parquet"])
    parser.add_argument("--out")
    args = parser.parse_args()

    if args.peek:
        cmd_peek(args)
        return
    if not args.format or not args.out:
        raise SystemExit("--format and --out are required unless --peek is passed")
    cmd_convert(args)


if __name__ == "__main__":
    main()
