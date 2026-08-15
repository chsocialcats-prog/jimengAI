import unittest
from datetime import datetime, timedelta, timezone


class HttpSecurityTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)

    def test_cookie_helpers_set_required_flags_and_no_store(self):
        from backend.auth.cookies import apply_auth_cookies, set_no_store
        from backend.auth.types import IssuedSession
        from starlette.responses import Response

        response = Response()
        apply_auth_cookies(response, IssuedSession(7, "opaque-token", "2026-09-12T00:00:00+00:00"), "csrf", secure=False)
        set_no_store(response)
        cookies = "\n".join(response.headers.getlist("set-cookie"))
        self.assertIn("neko_session=opaque-token; HttpOnly;", cookies)
        self.assertRegex(cookies, r"neko_session=.*Max-Age=\d+; Path=/; SameSite=lax")
        self.assertIn("neko_csrf=csrf; Path=/; SameSite=lax", cookies)
        self.assertNotIn("Domain=", cookies)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_csrf_requires_matching_cookie_header_signature_and_session(self):
        from backend.auth.csrf import issue_csrf_token, verify_csrf

        key = b"k" * 32
        token = issue_csrf_token([key], session_id=9, now=self.now)
        self.assertTrue(verify_csrf(token, token, [key], session_id=9, now=self.now + timedelta(minutes=29)))
        self.assertFalse(verify_csrf(token, token + "x", [key], session_id=9, now=self.now))
        self.assertFalse(verify_csrf(token, token, [key], session_id=8, now=self.now))
        self.assertFalse(verify_csrf(token, token, [key], session_id=9, now=self.now + timedelta(minutes=31)))

    def test_csrf_rejects_token_issued_in_the_future(self):
        from backend.auth.csrf import issue_csrf_token, verify_csrf

        key = b"k" * 32
        token = issue_csrf_token([key], now=self.now + timedelta(seconds=1))
        self.assertFalse(verify_csrf(token, token, [key], now=self.now))

    def test_origin_policy_rejects_cross_site_and_origin_tricks(self):
        from backend.auth.origin import OriginPolicy

        policy = OriginPolicy("http://example.test:8000")
        self.assertTrue(policy.is_allowed(method="POST", origin="http://example.test:8000", referer=None, sec_fetch_site="same-origin"))
        self.assertFalse(policy.is_allowed(method="POST", origin="http://example.test.evil", referer=None, sec_fetch_site="same-origin"))
        self.assertFalse(policy.is_allowed(method="POST", origin="http://example.test@evil", referer=None, sec_fetch_site="same-origin"))
        self.assertFalse(policy.is_allowed(method="POST", origin="http://example.test:8000/path", referer=None, sec_fetch_site="same-origin"))
        self.assertFalse(policy.is_allowed(method="POST", origin="http://example.test:8000", referer=None, sec_fetch_site="cross-site"))
        self.assertFalse(policy.is_allowed(method="POST", origin=None, referer=None, sec_fetch_site=None))

    def test_origin_policy_does_not_fallback_when_origin_is_present_but_malformed(self):
        from backend.auth.origin import OriginPolicy

        policy = OriginPolicy("http://example.test:8000")
        self.assertFalse(policy.is_allowed(
            method="POST",
            origin="",
            referer="http://example.test:8000/safe-page",
            sec_fetch_site="same-origin",
        ))

    def test_runtime_settings_parse_local_safe_defaults_and_trusted_proxies(self):
        from backend.auth.runtime_settings import RuntimeSettings
        from backend.services.provider_catalog import builtin_provider_origins

        settings = RuntimeSettings.from_environ({"NEKO_TRUSTED_PROXY_CIDRS": "127.0.0.0/8,10.0.0.0/8"})
        self.assertFalse(settings.cookie_secure)
        self.assertEqual(settings.public_origin, None)
        self.assertTrue(settings.is_trusted_proxy("127.0.0.1"))
        self.assertFalse(settings.is_trusted_proxy("192.168.1.5"))
        self.assertEqual(settings.ai_allowed_origins, builtin_provider_origins())
        self.assertIn("https://api.openai.com", settings.ai_allowed_origins)
        self.assertIn("https://api.moonshot.cn", settings.ai_allowed_origins)

    def test_runtime_settings_parse_explicit_origins_and_origin_policy_trusts_forwarding_only_for_proxy(self):
        from backend.auth.origin import OriginPolicy
        from backend.auth.runtime_settings import RuntimeSettings

        settings = RuntimeSettings.from_environ({
            "NEKO_COOKIE_SECURE": "true",
            "NEKO_PUBLIC_ORIGIN": "https://adventure.test",
            "NEKO_TRUSTED_PROXY_CIDRS": "10.0.0.0/8",
            "NEKO_AI_ALLOWED_ORIGINS": "https://api.example.test,http://localhost:11434",
            "NEKO_AI_HTTPS_ONLY": "false",
        })
        self.assertTrue(settings.cookie_secure)
        self.assertEqual(settings.public_origin, "https://adventure.test")
        self.assertEqual(settings.ai_allowed_origins, ("https://api.example.test", "http://localhost:11434"))
        self.assertEqual(OriginPolicy.client_ip("10.1.2.3", {"x-forwarded-for": "198.51.100.7"}, settings.trusted_proxy_cidrs), "198.51.100.7")
        self.assertEqual(OriginPolicy.client_ip("192.168.1.5", {"x-forwarded-for": "198.51.100.7"}, settings.trusted_proxy_cidrs), "192.168.1.5")

    def test_unsafe_methods_are_exactly_the_documented_verbs(self):
        from backend.auth.csrf import is_unsafe_method

        self.assertTrue(all(is_unsafe_method(method) for method in ("POST", "PUT", "PATCH", "DELETE")))
        self.assertFalse(any(is_unsafe_method(method) for method in ("GET", "HEAD", "OPTIONS", "TRACE")))
