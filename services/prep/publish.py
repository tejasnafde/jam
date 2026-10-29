"""Publishes prep outputs: every blob first, then every Sample doc. All or nothing.

No Google imports here, so the unit tests run with requirements-audio.txt only.
`samples` is a Firestore collection and `bucket` a GCS bucket, or fakes with the same calls.
"""

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("prep")


@dataclass
class Output:
    """One finished WAV. `doc` is the Sample doc without id, name and storagePath."""

    path: Path
    doc: dict[str, Any]
    names: list[str]


# create(ref, doc, names) writes doc with the first free name in one transaction and returns that name.
CreateUnique = Callable[[Any, dict[str, Any], list[str]], str]


def publish(samples: Any, bucket: Any, uid: str, outputs: Iterable[Output], create: CreateUnique) -> list[str]:
    """Uploads each output as it is made and deletes the local file, then creates the docs.

    If anything fails, it deletes the docs and blobs that this run made, so a failed
    job leaves no orphan samples, and re-raises.
    """
    blobs: list[Any] = []
    docs: list[Any] = []
    try:
        planned = []
        for out in outputs:
            ref = samples.document()
            path = f"users/{uid}/samples/{ref.id}.wav"
            blob = bucket.blob(path)
            blob.upload_from_filename(str(out.path), content_type="audio/wav")
            blobs.append(blob)
            out.path.unlink(missing_ok=True)  # /tmp is memory on Cloud Run
            planned.append((ref, path, out))
        for ref, path, out in planned:
            name = create(ref, {**out.doc, "id": ref.id, "storagePath": path}, out.names)
            docs.append(ref)
            log.info("made %s (%s)", name, ref.id)
        return [ref.id for ref in docs]
    except BaseException:
        for item in [*docs, *blobs]:
            try:
                item.delete()
            except Exception:  # noqa: BLE001 - clean up what we can, then raise the first error
                log.exception("could not delete %s", getattr(item, "id", getattr(item, "name", item)))
        raise
