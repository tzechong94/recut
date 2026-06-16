from recut.core.queue import claim_next, complete, enqueue, fail, get_job, update_progress
from recut.core.storage import LocalStorage, content_hash


def test_local_storage_roundtrip(work_dir):
    st = LocalStorage(work_dir + "/store")
    key = st.put("a/b/c.bin", b"hello")
    assert st.exists(key)
    assert st.get(key) == b"hello"
    assert "c.bin" in st.url(key)


def test_content_hash_is_stable():
    assert content_hash(b"x") == content_hash(b"x")
    assert content_hash(b"x") != content_hash(b"y")


def test_queue_claim_complete():
    jid = enqueue("render_export", {"timeline_id": "tl_1"}, project_id="p1")
    job = claim_next()
    assert job is not None and job.id == jid and job.status == "running"
    assert claim_next() is None  # nothing left queued
    update_progress(jid, 0.5)
    complete(jid, {"asset_id": "a_out"})
    done = get_job(jid)
    assert done.status == "done" and done.progress == 1.0
    assert done.result["asset_id"] == "a_out"


def test_queue_retries_then_fails():
    jid = enqueue("generate_broll", {})
    # attempt 1
    claim_next()
    assert fail(jid, "boom") == "requeued"
    # attempt 2
    claim_next()
    assert fail(jid, "boom") == "requeued"
    # attempt 3 -> exhausted (job_max_attempts default 3)
    claim_next()
    assert fail(jid, "boom") == "failed"
    assert get_job(jid).status == "failed"
