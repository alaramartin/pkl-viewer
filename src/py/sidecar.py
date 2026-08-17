"""
Long-lived JSON-RPC sidecar for the tree explorer (feature 1 of PLAN.md).

Speaks line-delimited JSON over stdin/stdout: one JSON object per line in,
one JSON object per line out, matched by "id". The unpickled object graph
stays resident in `Sidecar.registry` for the life of the process, so
expanding a subtree is a dict lookup rather than a full re-parse.

Nodes are addressed by opaque integer handles, not paths, so cycles and
shared references (two keys pointing at the same object) work without
special-casing: a handle is just an index into `HandleRegistry.objects`.

Methods: open, expand, search. See PLAN.md section 1.0 for the wire format.

This process never executes anything from the pickle beyond what
`pickle.load` itself does -- it is exactly as trusted as the existing
"python -m pickle" full view, no more, no less. (Safe, non-executing
inspection is stretch goal S1, not this.)
"""
import sys
import os
import json
import pickle
import gzip
import bz2
import lzma

PREVIEW_LIMIT = 200
DEFAULT_SEARCH_MAX_NODES = 20000


class HandleRegistry:
    """Maps integer handles to live Python objects, and tracks the parent
    handle each object was discovered through so cycles can be detected by
    walking the ancestor chain.

    A handle is stable for the life of the process: registering the same
    object twice (by identity) returns the same handle, whether it's
    discovered again via `expand` (revisited through pagination) or via
    `search` (an independent traversal). Callers -- notably the webview's
    "jump to search hit" flow -- expand a node via one RPC and are handed a
    handle to look up from a *different* RPC; if re-registering minted a new
    handle every time, those handles would never match up. Objects here stay
    alive for as long as they're reachable from the root the file was opened
    with, so `id()` can't be recycled out from under a live entry."""

    def __init__(self):
        self.objects = {}
        self.parents = {}
        self.by_identity = {}
        self.next_handle = 0

    def register(self, obj, parent=None):
        key = id(obj)
        existing = self.by_identity.get(key)
        if existing is not None:
            return existing
        handle = self.next_handle
        self.next_handle += 1
        self.objects[handle] = obj
        self.parents[handle] = parent
        self.by_identity[key] = handle
        return handle

    def ancestor_handle_for(self, from_handle, obj):
        """If `obj` is already an ancestor of `from_handle` (by identity),
        return that ancestor's handle so the caller can render a
        non-expandable back-reference instead of looping forever."""
        handle = from_handle
        while handle is not None:
            if self.objects.get(handle) is obj:
                return handle
            handle = self.parents.get(handle)
        return None


def open_pickle_file(path):
    lower = path.lower()
    if lower.endswith(".gz"):
        opener = gzip.open
    elif lower.endswith(".bz2"):
        opener = bz2.open
    elif lower.endswith(".xz"):
        opener = lzma.open
    else:
        opener = open
    with opener(path, "rb") as f:
        return pickle.load(f)


def type_name(obj):
    t = type(obj)
    if t.__module__ in ("builtins", "__builtin__"):
        return t.__name__
    return f"{t.__module__}.{t.__name__}"


def get_children(obj):
    """Returns a list of (key, value) pairs representing obj's members,
    for whichever container/attribute shape applies. Empty list means
    "not expandable"."""
    if isinstance(obj, dict):
        return list(obj.items())
    if isinstance(obj, (list, tuple)):
        return list(enumerate(obj))
    if isinstance(obj, (set, frozenset)):
        return list(enumerate(obj))
    slots = getattr(type(obj), "__slots__", None)
    if slots:
        names = [slots] if isinstance(slots, str) else list(slots)
        return [(name, getattr(obj, name)) for name in names if hasattr(obj, name)]
    d = getattr(obj, "__dict__", None)
    if isinstance(d, dict):
        return list(d.items())
    return []


def safe_repr(obj, limit=PREVIEW_LIMIT):
    try:
        r = repr(obj)
    except Exception:
        r = f"<unrepr'able {type(obj).__name__}>"
    if len(r) > limit:
        r = r[:limit] + "…"
    return r


def preview_for(obj, children):
    if isinstance(obj, dict):
        return f"{len(children)} key{'s' if len(children) != 1 else ''}"
    if isinstance(obj, (list, tuple, set, frozenset)):
        return f"{len(children)} item{'s' if len(children) != 1 else ''}"
    return safe_repr(obj)


def approx_bytes(obj):
    try:
        return sys.getsizeof(obj)
    except Exception:
        return 0


class Sidecar:
    def __init__(self):
        self.registry = HandleRegistry()

    def handle_open(self, params):
        path = params["path"]
        obj = open_pickle_file(path)
        handle = self.registry.register(obj, parent=None)
        children = get_children(obj)
        return {
            "handle": handle,
            "type": type_name(obj),
            "children": len(children),
            "bytes": os.path.getsize(path),
        }

    def handle_expand(self, params):
        handle = params["handle"]
        offset = params.get("offset", 0)
        limit = params.get("limit", 200)
        if handle not in self.registry.objects:
            raise ValueError(f"unknown handle {handle}")
        obj = self.registry.objects[handle]
        children = get_children(obj)
        total = len(children)
        page = children[offset:offset + limit]

        nodes = []
        for key, value in page:
            cycle_handle = self.registry.ancestor_handle_for(handle, value)
            value_children = get_children(value) if cycle_handle is None else []
            node = {
                "key": str(key),
                "type": type_name(value),
                "preview": preview_for(value, value_children),
                "bytes": approx_bytes(value),
                "expandable": bool(value_children) and cycle_handle is None,
            }
            if cycle_handle is not None:
                node["handle"] = cycle_handle
                node["cycle"] = True
            else:
                node["handle"] = self.registry.register(value, parent=handle)
            nodes.append(node)

        return {"total": total, "nodes": nodes}

    def handle_search(self, params):
        query = params["query"].lower()
        scope = params.get("scope", "keys+values")
        limit = params.get("limit", 100)
        max_nodes = params.get("max_nodes", DEFAULT_SEARCH_MAX_NODES)
        # Scope the traversal to a subtree instead of the whole file by starting from a
        # non-root handle -- e.g. the node currently selected in the tree UI.
        root_handle = params.get("root", 0)
        if root_handle not in self.registry.objects:
            raise ValueError(f"unknown handle {root_handle}")

        hits = []
        state = {"visited": 0, "truncated": False}

        def walk(handle, path, ancestors):
            if len(hits) >= limit or state["truncated"]:
                return
            obj = self.registry.objects[handle]
            for key, value in get_children(obj):
                if len(hits) >= limit:
                    return
                state["visited"] += 1
                if state["visited"] > max_nodes:
                    state["truncated"] = True
                    return

                key_str = str(key)
                connector = f"[{key_str}]" if isinstance(obj, (list, tuple, set, frozenset)) else f".{key_str}"
                child_path = path + connector

                cycle_handle = self.registry.ancestor_handle_for(handle, value)
                value_children = get_children(value) if cycle_handle is None else []
                value_handle = cycle_handle if cycle_handle is not None else self.registry.register(value, parent=handle)

                matched = False
                if scope in ("keys", "keys+values") and query in key_str.lower():
                    matched = True
                if not matched and scope in ("values", "keys+values") and query in safe_repr(value).lower():
                    matched = True

                if matched:
                    hits.append({
                        "handle": value_handle,
                        "path": child_path,
                        "preview": preview_for(value, value_children),
                        # Handles of every node strictly between the search root and this
                        # hit's parent, in top-down order. The client walks this list,
                        # lazily paginating each node's children as needed, to expand the
                        # tree down to the hit before selecting it.
                        "ancestors": list(ancestors),
                    })
                    if len(hits) >= limit:
                        return

                if cycle_handle is None and value_children:
                    walk(value_handle, child_path, ancestors + [value_handle])
                    if len(hits) >= limit or state["truncated"]:
                        return

        walk(root_handle, "$", [])

        return {"hits": hits, "truncated": state["truncated"], "visited": state["visited"]}


def main():
    sidecar = Sidecar()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        req_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {})

        try:
            if method == "open":
                result = sidecar.handle_open(params)
            elif method == "expand":
                result = sidecar.handle_expand(params)
            elif method == "search":
                result = sidecar.handle_search(params)
            else:
                raise ValueError(f"unknown method {method!r}")
            response = {"id": req_id, "result": result}
        except Exception as e:
            response = {"id": req_id, "error": {"message": str(e)}}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
