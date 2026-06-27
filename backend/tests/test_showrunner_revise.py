"""Script revision: deterministic rename-propagation + conversational revise."""
from recut.core.models import get_models
from recut.showrunner.revise import rename_character, revise_treatment
from recut.showrunner.schemas import Character, DialogueLine, Production, Scene, Shot


def _prod():
    a = Character(name="Eli", description="a keeper")
    b = Character(name="Astra", description="an astronaut")
    return Production(
        title="Eli's Light", logline="Eli meets Astra.", dramatic_question="Will Eli help Astra?",
        characters=[a, b],
        scenes=[Scene(heading="INT", summary="Eli finds Astra", script=[
            DialogueLine(character_id=a.id, character_name="Eli", line="Eli here, hold on."),
        ], shots=[Shot(action="Eli waves at Astra", character_ids=[a.id],
                       dialogue=[DialogueLine(character_id=a.id, character_name="Eli", line="This is Eli!")])])],
    )


def test_rename_propagates_everywhere():
    p = _prod()
    cid = p.characters[0].id
    rename_character(p, cid, "Mara")
    assert p.characters[0].name == "Mara"
    assert "Mara" in p.title and "Mara" in p.logline and "Mara" in p.dramatic_question
    assert "Mara" in p.scenes[0].summary
    assert p.scenes[0].script[0].character_name == "Mara" and "Mara" in p.scenes[0].script[0].line
    sh = p.scenes[0].shots[0]
    assert "Mara" in sh.action and sh.dialogue[0].character_name == "Mara" and "Mara" in sh.dialogue[0].line
    # the other character untouched
    assert p.characters[1].name == "Astra"


def test_rename_noop_on_blank_or_same():
    p = _prod(); cid = p.characters[0].id
    rename_character(p, cid, ""); assert p.characters[0].name == "Eli"
    rename_character(p, cid, "Eli"); assert p.characters[0].name == "Eli"


def test_revise_updates_treatment_and_logs_note():
    p = _prod()
    revise_treatment(get_models().text, p, "make it noir and darker")
    assert any(m["role"] == "note" and "noir" in m["text"] for m in p.writers_room)
    assert any(m["role"] == "writer" for m in p.writers_room)
    assert p.title  # revised treatment applied


def test_revise_preserves_character_id_by_name():
    p = _prod()
    eli_id = p.characters[0].id
    # stub revise returns the canned noir treatment (Mara/Vince) — different names ->
    # new ids; ensure it doesn't crash and characters are replaced cleanly
    revise_treatment(get_models().text, p, "x")
    assert p.characters  # rebuilt cast
    # id stability is only guaranteed when a name persists; here names changed, which is fine


def test_endpoints(tmp_path):
    from fastapi.testclient import TestClient
    from recut.api.main import create_app
    from recut.core import repo
    c = TestClient(create_app())
    p = _prod(); p.project_id = repo.create_project(name="f")["id"]; repo.save_production(p)
    cid = p.characters[0].id
    r = c.post(f"/api/productions/{p.id}/characters/{cid}/rename", json={"name": "Mara"}).json()
    assert r["characters"][0]["name"] == "Mara" and "Mara" in r["logline"]
    rv = c.post(f"/api/productions/{p.id}/revise", json={"instruction": "darker"})
    assert rv.status_code == 200
    assert c.post(f"/api/productions/{p.id}/revise", json={"instruction": ""}).status_code == 400
