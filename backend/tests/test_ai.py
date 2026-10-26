import base64
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TMP = tempfile.mkdtemp()
os.environ["APP_DATA"] = TMP
os.environ.pop("ARK_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from pindou import ark, config, quota  # noqa: E402
from pindou.main import app  # noqa: E402

KEY = "sk-test-secret-123"


def png_b64(w=300, h=200, color=(200, 30, 30), mode="RGB"):
    im = Image.new(mode, (w, h), color)
    out = io.BytesIO()
    im.save(out, "PNG")
    return base64.b64encode(out.getvalue()).decode()


def data_url(**kw):
    return "data:image/png;base64," + png_b64(**kw)


class FakeResp:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


def chat(content):
    return FakeResp(200, {"choices": [{"message": {"content": content}}]})


def image(b64=None):
    return FakeResp(200, {"data": [{"b64_json": b64 or png_b64(2048, 2048)}]})


class Base(unittest.TestCase):
    def setUp(self):
        for f in Path(TMP).iterdir():
            f.unlink()
        self.c = TestClient(app)

    def set_key(self):
        os.environ["ARK_API_KEY"] = KEY
        self.addCleanup(os.environ.pop, "ARK_API_KEY", None)


class ArkTests(Base):
    def test_no_key_is_config_error(self):
        with self.assertRaises(ark.AiError) as cm:
            ark.plan("一只猫", "generate")
        self.assertEqual(cm.exception.kind, "config")

    def test_plan_parses_and_clamps(self):
        self.set_key()
        body = json.dumps({"prompt": "橘猫", "ratio": "7:5", "width": 500, "height": 36, "max_colors": 12, "reply": "好"})
        with mock.patch("pindou.ark.requests.post", return_value=chat("好的：\n" + body)) as post:
            p = ark.plan("一只猫", "generate")
        self.assertEqual((p["prompt"], p["ratio"], p["width"], p["height"], p["max_colors"]), ("橘猫", "1:1", None, 36, 12))
        sent = post.call_args.kwargs
        self.assertEqual(sent["headers"]["Authorization"], "Bearer " + KEY)
        self.assertTrue(post.call_args.args[0].endswith("/chat/completions"))
        self.assertIn("扁平色块", sent["json"]["messages"][0]["content"])

    def test_plan_retries_without_thinking_on_400(self):
        self.set_key()
        ok = chat(json.dumps({"prompt": "p"}))
        with mock.patch("pindou.ark.requests.post", side_effect=[FakeResp(400, {"error": {"message": "bad"}}), ok]) as post:
            self.assertEqual(ark.plan("x", "edit")["prompt"], "p")
        self.assertIn("thinking", post.call_args_list[0].kwargs["json"])
        self.assertNotIn("thinking", post.call_args_list[1].kwargs["json"])

    def test_plan_bad_json_is_parse_error(self):
        self.set_key()
        with mock.patch("pindou.ark.requests.post", return_value=chat("我不会")):
            with self.assertRaises(ark.AiError) as cm:
                ark.plan("x", "generate")
        self.assertEqual(cm.exception.kind, "parse")

    def test_error_messages_never_contain_key(self):
        self.set_key()
        for status, kind in ((401, "auth"), (429, "busy"), (500, "upstream"), (404, "upstream")):
            with mock.patch("pindou.ark.requests.post", return_value=FakeResp(status, {"error": {"message": "oops"}})):
                with self.assertRaises(ark.AiError) as cm:
                    ark.draw("p", "1:1")
            self.assertEqual(cm.exception.kind, kind)
            self.assertNotIn(KEY, cm.exception.message)

    def test_draw_generate_request_and_shrink(self):
        self.set_key()
        with mock.patch("pindou.ark.requests.post", return_value=image()) as post:
            png, w, h = ark.draw("一只猫", "3:4")
        body = post.call_args.kwargs["json"]
        self.assertEqual((body["size"], body["response_format"], body["watermark"]), ("1728x2304", "b64_json", False))
        self.assertNotIn("image", body)
        self.assertEqual((w, h), (1024, 1024))
        self.assertEqual(Image.open(io.BytesIO(png)).size, (1024, 1024))

    def test_draw_edit_sends_source_image(self):
        self.set_key()
        src = ark.prepare_source(data_url())
        with mock.patch("pindou.ark.requests.post", return_value=image()) as post:
            ark.draw("把猫改成蓝色", "3:2", src)
        self.assertTrue(post.call_args.kwargs["json"]["image"].startswith("data:image/jpeg;base64,"))

    def test_draw_without_image_in_response(self):
        self.set_key()
        with mock.patch("pindou.ark.requests.post", return_value=FakeResp(200, {"data": [{"error": {"message": "审核未通过"}}]})):
            with self.assertRaises(ark.AiError) as cm:
                ark.draw("p", "1:1")
        self.assertEqual(cm.exception.kind, "upstream")
        self.assertIn("审核", cm.exception.message)

    def test_prepare_source_validation(self):
        bad = ["", "data:text/html;base64,AAAA", "data:image/png;base64,@@@", data_url(w=8, h=8),
               data_url(w=1000, h=100), "data:image/png;base64," + base64.b64encode(b"not an image").decode()]
        for u in bad:
            with self.assertRaises(ark.AiError, msg=u[:40]) as cm:
                ark.prepare_source(u)
            self.assertEqual(cm.exception.kind, "input")

    def test_prepare_source_flattens_transparency_onto_white(self):
        raw, mime = ark.prepare_source(data_url(w=64, h=64, color=(0, 0, 0, 0), mode="RGBA"))
        self.assertEqual(mime, "image/jpeg")
        px = Image.open(io.BytesIO(raw)).getpixel((10, 10))
        self.assertTrue(all(v > 240 for v in px), px)

    def test_nearest_ratio(self):
        self.assertEqual(ark.nearest_ratio(1000, 1000), "1:1")
        self.assertEqual(ark.nearest_ratio(1600, 900), "16:9")
        self.assertEqual(ark.nearest_ratio(600, 800), "3:4")

    def test_settings_refuse_foreign_base_url(self):
        (Path(TMP) / "ai.json").write_text(json.dumps({"base_url": "https://evil.example/api/v3", "daily_limit": 5}))
        st = config.settings()
        self.assertEqual(st["base_url"], config.DEFAULTS["base_url"])
        self.assertEqual(st["daily_limit"], 5)


class ApiTests(Base):
    def test_healthz_and_status(self):
        self.assertEqual(self.c.get("/healthz").json(), {"ok": True, "app": "pindou"})
        s = self.c.get("/api/ai/status").json()
        self.assertEqual((s["enabled"], s["remaining"]), (False, config.DEFAULTS["daily_limit"]))
        self.set_key()
        self.assertTrue(self.c.get("/api/ai/status").json()["enabled"])

    def test_plan_falls_back_when_text_model_fails(self):
        self.set_key()
        with mock.patch("pindou.ark.requests.post", return_value=FakeResp(404, {"error": {"message": "no model"}})):
            r = self.c.post("/api/ai/plan", json={"text": "一只猫", "mode": "generate"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("一只猫", r.json()["prompt"])
        self.assertIn("默认模板", r.json()["reply"])

    def test_plan_reports_bad_key_instead_of_falling_back(self):
        self.set_key()
        with mock.patch("pindou.ark.requests.post", return_value=FakeResp(401, {})):
            r = self.c.post("/api/ai/plan", json={"text": "猫", "mode": "generate"})
        self.assertEqual((r.status_code, r.json()["error"]["kind"]), (502, "auth"))

    def test_plan_requires_key(self):
        r = self.c.post("/api/ai/plan", json={"text": "猫", "mode": "generate"})
        self.assertEqual((r.status_code, r.json()["error"]["kind"]), (503, "config"))

    def test_image_generate_and_quota(self):
        self.set_key()
        (Path(TMP) / "ai.json").write_text(json.dumps({"daily_limit": 2}))
        with mock.patch("pindou.ark.requests.post", return_value=image()):
            for left in (1, 0):
                r = self.c.post("/api/ai/image", json={"prompt": "猫", "mode": "generate"})
                self.assertEqual(r.status_code, 200, r.text)
                self.assertEqual(r.json()["remaining"], left)
                self.assertTrue(r.json()["image"].startswith("data:image/png;base64,"))
            r = self.c.post("/api/ai/image", json={"prompt": "猫", "mode": "generate"})
        self.assertEqual((r.status_code, r.json()["error"]["kind"]), (429, "quota"))

    def test_failed_image_does_not_consume_quota(self):
        self.set_key()
        before = quota.remaining()
        with mock.patch("pindou.ark.requests.post", return_value=FakeResp(500, {})):
            r = self.c.post("/api/ai/image", json={"prompt": "猫", "mode": "generate"})
        self.assertEqual(r.status_code, 502)
        self.assertEqual(quota.remaining(), before)

    def test_edit_needs_valid_image(self):
        self.set_key()
        r = self.c.post("/api/ai/image", json={"prompt": "改", "mode": "edit"})
        self.assertEqual((r.status_code, r.json()["error"]["kind"]), (400, "input"))
        r = self.c.post("/api/ai/image", json={"prompt": "改", "mode": "edit", "image": "data:image/png;base64,AAAA"})
        self.assertEqual(r.status_code, 400)
        with mock.patch("pindou.ark.requests.post", return_value=image()) as post:
            r = self.c.post("/api/ai/image", json={"prompt": "改", "mode": "edit", "image": data_url(), "ratio": "3:2"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("image", post.call_args.kwargs["json"])

    def test_validation_error_shape(self):
        r = self.c.post("/api/ai/plan", json={"text": "", "mode": "generate"})
        self.assertEqual((r.status_code, r.json()["error"]["kind"]), (400, "input"))
        r = self.c.post("/api/ai/plan", json={"text": "x" * 501, "mode": "generate"})
        self.assertEqual(r.status_code, 400)

    def test_key_only_from_environment(self):
        (Path(TMP) / "ark.key").write_text(KEY, encoding="utf-8")     # 旧的文件方式不再生效
        self.assertIsNone(config.api_key())
        self.set_key()
        self.assertEqual(config.api_key(), KEY)
        self.assertNotIn(KEY, self.c.get("/api/ai/status").text)

    def test_presets_select_models(self):
        self.set_key()
        fast, pro = config.preset("fast"), config.preset("pro")
        self.assertEqual((fast["text_model"], fast["image_model"]),
                         ("deepseek-v4-1-flash-261017", "doubao-seedream-5-0-flash-260915"))
        self.assertEqual((pro["text_model"], pro["image_model"]),
                         ("doubao-seed-2-1-pro-260915", "doubao-seedream-5-0-pro-260628"))
        self.assertEqual(config.preset(None)["id"], "fast")
        self.assertEqual(config.preset("bogus")["id"], "fast")
        with mock.patch("pindou.ark.requests.post", return_value=chat(json.dumps({"prompt": "p"}))) as post:
            ark.plan("猫", "generate", "pro")
        self.assertEqual(post.call_args.kwargs["json"]["model"], "doubao-seed-2-1-pro-260915")
        with mock.patch("pindou.ark.requests.post", return_value=image()) as post:
            self.c.post("/api/ai/image", json={"prompt": "猫", "mode": "generate", "preset": "pro"})
            self.c.post("/api/ai/image", json={"prompt": "猫", "mode": "generate"})
        self.assertEqual([c.kwargs["json"]["model"] for c in post.call_args_list],
                         ["doubao-seedream-5-0-pro-260628", "doubao-seedream-5-0-flash-260915"])
        s = self.c.get("/api/ai/status").json()
        self.assertEqual([p["id"] for p in s["presets"]], ["fast", "pro"])
        self.assertEqual(s["limit"], 100)
        self.assertEqual(s["presets"][1]["image_model"], "doubao-seedream-5-0-pro-260628")
        self.assertEqual(self.c.post("/api/ai/plan", json={"text": "猫", "mode": "generate", "preset": "x"}).status_code, 400)

    def test_preset_overrides_from_ai_json(self):
        (Path(TMP) / "ai.json").write_text(json.dumps({"default_preset": "pro", "presets": {
            "pro": {"image_model": "ep-20260101-abcde", "text_model": "bad model;rm"}}}))
        p = config.preset(None)
        self.assertEqual((p["id"], p["image_model"], p["text_model"]), ("pro", "ep-20260101-abcde", "doubao-seed-2-1-pro-260915"))

    def test_prompts_do_not_ask_for_pixel_art(self):
        for text in (ark.STYLE, ark.fallback_plan("猫", "generate")["prompt"], ark.fallback_plan("猫", "edit")["prompt"]):
            self.assertNotIn("像素", text)
        for mode in ("generate", "edit"):
            sys_prompt = ark.SYSTEM[mode]
            self.assertIn("不要要求画成像素画", sys_prompt)

    def test_frontend_uses_relative_api_paths(self):
        # 应用挂在 /<id>/ 下，前端若用绝对 /api/... 会打到入口而不是本应用
        js = (Path(__file__).resolve().parents[2] / "public" / "app.js").read_text(encoding="utf-8")
        self.assertIn(r'path.replace(/^\//, "")', js)
        self.assertNotIn('api("/api', js)
        self.assertIn("X-Requested-With", js)


if __name__ == "__main__":
    unittest.main()
