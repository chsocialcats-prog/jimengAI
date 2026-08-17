# -*- coding: utf-8 -*-
"""Daily check-in persistence and route contracts."""

from contextlib import closing
from datetime import date, datetime, timezone
import unittest

from backend import database
from backend.migrations.account_schema import migrate_account_schema
from backend.repository import daily_checkins
from backend.routers import daily_checkin_routes
from backend.services.holiday_calendar import festival_for
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

    def test_current_month_checkins_exclude_other_users_and_months(self):
        august_thirteenth = datetime(2026, 8, 13, 4, tzinfo=timezone.utc)
        august_fifteenth = datetime(2026, 8, 15, 4, tzinfo=timezone.utc)
        september_first = datetime(2026, 9, 1, 4, tzinfo=timezone.utc)

        daily_checkins.check_in(self.test_user.id, now=august_thirteenth)
        daily_checkins.check_in(self.test_user.id, now=august_fifteenth)
        daily_checkins.check_in(self.test_user.id, now=september_first)
        with closing(database.connect()) as connection:
            other_account = create_test_user(connection, username="calendar-user")
            connection.commit()
        daily_checkins.check_in(other_account["id"], now=august_fifteenth)

        result = daily_checkins.get_current_month_checkins(self.test_user.id, now=august_fifteenth)

        self.assertEqual(result["month"], "2026-08")
        self.assertEqual(result["checkin_dates"], ["2026-08-13", "2026-08-15"])
        self.assertEqual(
            result["festivals"],
            [{"date": "2026-08-19", "id": "qixi_festival", "name": "七夕节", "icon": "heart", "priority": 3}],
        )

    def test_festival_checkin_has_fixed_great_fortune_and_festival_metadata(self):
        new_year = datetime(2026, 2, 17, 4, tzinfo=timezone.utc)

        result = daily_checkins.check_in(self.test_user.id, now=new_year)

        self.assertEqual(result["fortune"]["rank"], "大吉")
        self.assertEqual(result["fortune"]["festival"], {
            "id": "spring_festival",
            "name": "春节",
            "icon": "house",
            "priority": 3,
        })
        self.assertEqual(result["points_awarded"], 1)
        self.assertEqual(result["streak_days"], 1)

    def test_calendar_returns_only_current_month_festivals_and_user_dates(self):
        february_fourteenth = datetime(2026, 2, 14, 4, tzinfo=timezone.utc)
        march_first = datetime(2026, 3, 1, 4, tzinfo=timezone.utc)
        daily_checkins.check_in(self.test_user.id, now=february_fourteenth)
        daily_checkins.check_in(self.test_user.id, now=march_first)
        with closing(database.connect()) as connection:
            other_account = create_test_user(connection, username="festival-calendar-user")
            connection.commit()
        daily_checkins.check_in(other_account["id"], now=february_fourteenth)

        result = daily_checkins.get_current_month_checkins(self.test_user.id, now=february_fourteenth)

        self.assertEqual(result["checkin_dates"], ["2026-02-14"])
        self.assertEqual(
            result["festivals"],
            [
                {"date": "2026-02-14", "id": "valentines_day", "name": "情人节", "icon": "heart", "priority": 1},
                {"date": "2026-02-17", "id": "spring_festival", "name": "春节", "icon": "house", "priority": 3},
            ],
        )

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
        calendar = daily_checkin_routes.read_current_month_checkins(auth=self.test_auth)

        self.assertTrue(created["checked_in"])
        self.assertTrue(current["checked_in"])
        self.assertEqual(created["date"], current["date"])
        self.assertEqual(created["fortune"], current["fortune"])
        self.assertEqual(created["streak_days"], current["streak_days"])
        self.assertEqual(created["points_awarded"], 1)
        self.assertEqual(calendar["month"], current["date"][:7])
        self.assertEqual(calendar["checkin_dates"], [current["date"]])
        self.assertIn("festivals", calendar)
        self.assertIsInstance(calendar["festivals"], list)


class HolidayCalendarTests(unittest.TestCase):
    def test_gregorian_and_lunar_festivals_are_resolved(self):
        self.assertEqual(festival_for(date(2026, 1, 1))["id"], "new_years_day")
        self.assertEqual(festival_for(date(2026, 4, 5))["id"], "qingming_festival")
        self.assertEqual(festival_for(date(2026, 2, 17))["id"], "spring_festival")
        self.assertEqual(festival_for(date(2026, 9, 25))["id"], "mid_autumn_festival")

    def test_traditional_festival_wins_when_it_overlaps_a_theme_day(self):
        festival = festival_for(date(2010, 2, 14))

        self.assertEqual(festival["id"], "spring_festival")
        self.assertEqual(festival["priority"], 3)

    def test_non_festival_falls_back_to_the_normal_deterministic_fortune(self):
        fortune = daily_checkins._fortune_for(42, "2026-08-17")

        self.assertIn(fortune["rank"], {"大吉", "中吉", "小吉", "平"})
        self.assertNotIn("festival", fortune)

if __name__ == "__main__":
    unittest.main()
