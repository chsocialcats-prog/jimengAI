import unittest


class RateLimitTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0

    def limiter(self):
        from backend.auth.rate_limit import AuthRateLimiter

        return AuthRateLimiter(clock=lambda: self.now)

    def test_login_failure_limits_username_and_ip_with_retry_after(self):
        limiter = self.limiter()
        for _ in range(5):
            self.assertTrue(limiter.record_login_failure("127.0.0.1", "Neko").allowed)
        denied = limiter.record_login_failure("127.0.0.1", "Neko")
        self.assertFalse(denied.allowed)
        self.assertEqual(denied.code, "rate_limited")
        self.assertGreater(denied.retry_after, 0)

    def test_success_clears_only_username_counter(self):
        limiter = self.limiter()
        for _ in range(5):
            limiter.record_login_failure("127.0.0.1", "Neko")
        limiter.record_login_success("127.0.0.1", "Neko")
        self.assertTrue(limiter.record_login_failure("127.0.0.1", "Neko").allowed)
        for _ in range(25):
            limiter.record_login_failure("127.0.0.1", "Other")
        self.assertFalse(limiter.record_login_failure("127.0.0.1", "Third").allowed)

    def test_registration_limit_expires_with_injectable_clock(self):
        limiter = self.limiter()
        for _ in range(5):
            self.assertTrue(limiter.record_registration_attempt("127.0.0.1").allowed)
        self.assertFalse(limiter.record_registration_attempt("127.0.0.1").allowed)
        self.now += 3601
        self.assertTrue(limiter.record_registration_attempt("127.0.0.1").allowed)
