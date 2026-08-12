import importlib
import importlib.util
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.routers import cards_routes


HELPER_MODULE = "backend.routers._error_helpers"


class RouterErrorHelperContractTests(unittest.TestCase):
    def _load_helpers(self):
        spec = importlib.util.find_spec(HELPER_MODULE)
        if spec is None:
            self.fail("shared router error helper has not been created")
        return importlib.import_module(HELPER_MODULE)

    def test_not_found_helper_matches_existing_card_route_contract(self):
        helpers = self._load_helpers()

        with self.assertRaises(HTTPException) as helper_error:
            helpers._raise_not_found("角色卡不存在")

        with patch.object(cards_routes.repositories, "get_card", return_value=None):
            with self.assertRaises(HTTPException) as route_error:
                cards_routes._get_card_or_404(7)

        expected = {
            "status_code": 404,
            "detail": {"code": "not_found", "message": "角色卡不存在"},
        }
        self.assertEqual(helper_error.exception.status_code, expected["status_code"])
        self.assertEqual(helper_error.exception.detail, expected["detail"])
        self.assertEqual(route_error.exception.status_code, expected["status_code"])
        self.assertEqual(route_error.exception.detail, expected["detail"])

    def test_validation_helper_preserves_existing_error_contract(self):
        helpers = self._load_helpers()

        with self.assertRaises(HTTPException) as context:
            helpers._raise_validation_error("角色卡名称不能为空")

        self.assertEqual(context.exception.status_code, 422)
        self.assertEqual(
            context.exception.detail,
            {"code": "validation_error", "message": "角色卡名称不能为空"},
        )

    def test_empty_update_helper_preserves_existing_message(self):
        helpers = self._load_helpers()

        with self.assertRaises(HTTPException) as context:
            helpers._raise_no_update_fields()

        self.assertEqual(context.exception.status_code, 422)
        self.assertEqual(
            context.exception.detail,
            {"code": "validation_error", "message": "没有可更新的字段"},
        )

    def test_value_error_helper_preserves_validation_cause_and_contract(self):
        helpers = self._load_helpers()
        original = ValueError("字段格式错误")

        with self.assertRaises(HTTPException) as context:
            helpers._raise_validation_from_value_error(original)

        self.assertIs(context.exception.__cause__, original)
        self.assertEqual(context.exception.status_code, 422)
        self.assertEqual(
            context.exception.detail,
            {"code": "validation_error", "message": "字段格式错误"},
        )
