# -*- coding: utf-8 -*-
"""Daily check-in persistence and route contracts."""

from contextlib import closing
from datetime import datetime, timezone
import unittest

from backend import database
from backend.migrations.account_schema import migrate_account_schema
from backend.repository import daily_checkins
from backend.routers import daily_checkin_routes
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user


class DailyCheckinRepositoryTests(IsolatedDatabaseTestCase):
    def test_checkin_is_idempotent_per_user_and_china_local_day(self):
        first_now = datetime(2026, 8, 15, 15, 30, tzinfo=timezone.utc)
        first = daily_checkins.check_in(self.test_user.id, now=first_now)
        duplicate = daily_checkins.check_in(self.test_user.id, now=first_now)
        next_day = daily_checkins.get_status(
            self.test_user.id,
            now=datetime(2026, 8, 15, 16, 30, tzinfo=timezone.utc),
        )

        self.assertEqual(first["date"], "2026-08-15")
        self.assertTrue(first["checked_in"])
        self.assertFalse(first["already_checked_in"])
        self.assertTrue(duplicate["already_checked_in"])
        self.assertFalse(next_day["checked_in"])
        self.assertEqual(first["fortune"], duplicate["fortune"])
        self.assertEqual(first["streak_days"], 1)
        self.assertEqual(first["points_awarded"], 1)
        self.assertEqual(first["points_total"], 1)

    def test_checkins_track_consecutive_days_and_keep_users_isolated(self):
        day_one = datetime(2026, 8, 13, 4, tzinfo=timezone.utc)
        day_two = datetime(2026, 8, 14, 4, tzinfo=timezone.utc)
        day_four = datetime(2026, 8, 16, 4, tzinfo=timezone.utc)

        first = daily_checkins.check_in(self.test_user.id, now=day_one)
        second = daily_checkins.check_in(self.test_user.id, now=day_two)
        after_break = daily_checkins.check_in(self.test_user.id, now=day_four)
        with closing(database.connect()) as connection:
            other_account = create_test_user(connection, username="another-user")
            connection.commit()
        other = daily_checkins.check_in(other_account["id"], now=day_two)

        self.assertEqual(first["streak_days"], 1)
        self.assertEqual(second["streak_days"], 2)
        self.assertEqual(second["points_total"], 2)
        self.assertEqual(after_break["streak_days"], 1)
        self.assertEqual(after_break["points_total"], 3)
        self.assertEqual(other["streak_days"], 1)
        self.assertEqual(other["points_total"], 1)
        self.assertEqual(second["fortune"], daily_checkins._fortune_for(self.test_user.id, second["date"]))
        self.assertEqual(other["fortune"], daily_checkins._fortune_for(other_account["id"], other["date"]))

    def test_legacy_checkin_is_backfilled_with_fortune_streak_and_points(self):
        checked_at = "2026-08-15T09:00:00+08:00"
        with closing(database.connect()) as connection:
            connection.execute(
                """
                INSERT INTO daily_checkins (user_id, checkin_date, checked_in_at)
                VALUES (?, ?, ?)
                """,
                (self.test_user.id, "2026-08-15", checked_at),
            )
            connection.commit()

        result = daily_checkins.get_status(
            self.test_user.id,
            now=datetime(2026, 8, 15, 1, tzinfo=timezone.utc),
        )

        self.assertTrue(result["checked_in"])
        self.assertEqual(result["fortune"], daily_checkins._fortune_for(self.test_user.id, "2026-08-15"))
        self.assertEqual(result["streak_days"], 1)
        self.assertEqual(result["points_awarded"], 1)
        self.assertEqual(result["points_total"], 1)

    def test_schema_migration_adds_checkin_fields_without_losing_existing_rows(self):
        with closing(database.connect()) as connection:
            connection.execute("DROP TABLE daily_checkins")
            connection.execute(
                """
                CREATE TABLE daily_checkins (
                    user_id INTEGER NOT NULL,
                    checkin_date TEXT NOT NULL,
                    checked_in_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, checkin_date)
                )
                """
            )
            connection.execute(
                "INSERT INTO daily_checkins (user_id, checkin_date, checked_in_at) VALUES (?, ?, ?)",
                (self.test_user.id, "2026-08-15", "2026-08-15T09:00:00+08:00"),
            )
            migrate_account_schema(connection)
            row = connection.execute(
                """
                SELECT fortune_json, streak_days, points_awarded
                FROM daily_checkins
                WHERE user_id = ? AND checkin_date = ?
                """,
                (self.test_user.id, "2026-08-15"),
            ).fetchone()
            connection.commit()

        self.assertEqual(row["fortune_json"], "")
        self.assertEqual(row["streak_days"], 0)
        self.assertEqual(row["points_awarded"], 1)

    def test_route_returns_current_account_state(self):
        created = daily_checkin_routes.create_daily_checkin(auth=self.test_auth)
        current = daily_checkin_routes.read_daily_checkin(auth=self.test_auth)

        self.assertTrue(created["checked_in"])
        self.assertTrue(current["checked_in"])
        self.assertEqual(created["date"], current["date"])
        self.assertEqual(created["fortune"], current["fortune"])
        self.assertEqual(created["streak_days"], current["streak_days"])
        self.assertEqual(created["points_awarded"], 1)


if __name__ == "__main__":
    unittest.main()
