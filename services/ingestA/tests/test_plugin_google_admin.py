import pytest
import json
from pathlib import Path
from normalization_plugins.google_admin import message as google_admin_plugin
from normalization_plugins.event_shell import message as event_shell_plugin
from normalization_plugins.lowercase_keys import message as lowercase_keys_plugin

class TestGoogleAdminSummary:
    def setup_method(self):
        self.plugin = google_admin_plugin()
        self.shell = event_shell_plugin()
        self.lowercase = lowercase_keys_plugin()

    def normalize(self, raw_event):
        metadata = {}
        event, metadata = self.shell.onMessage(raw_event, metadata)
        event, metadata = self.lowercase.onMessage(event, metadata)
        event, metadata = self.plugin.onMessage(event, metadata)
        return event

    def test_gmail_summary(self):
        raw_event = {
            "details": {
                "kind": "admin#reports#activity",
                "id": {"applicationname": "gmail", "time": "2026-04-15T19:36:20.318Z"},
                "actor": {"email": "user@example.com"},
                "ipaddress": "1.2.3.4",
                "etag": "tag123",
                "events": [{
                    "name": "delivery",
                    "parameters": [
                        {
                            "name": "message_info",
                            "messagevalue": {
                                "parameter": [
                                    {"name": "subject", "value": "Test Subject"}
                                ]
                            }
                        }
                    ]
                }]
            }
        }
        normalized = self.normalize(raw_event)
        assert "Test Subject" in normalized["summary"]
        assert normalized["summary"].startswith("user@example.com delivery")

    def test_mobile_summary(self):
        raw_event = {
            "details": {
                "kind": "admin#reports#activity",
                "id": {"applicationname": "mobile", "time": "2026-04-15T18:36:48.350Z"},
                "actor": {"email": "user@example.com"},
                "ipaddress": "1.2.3.4",
                "etag": "tag123",
                "events": [{
                    "name": "DEVICE_SYNC_EVENT",
                    "parameters": [
                        {"name": "DEVICE_MODEL", "value": "MacBookPro18,2"}
                    ]
                }]
            }
        }
        normalized = self.normalize(raw_event)
        assert "MacBookPro18,2" in normalized["summary"]

    def test_calendar_summary(self):
        raw_event = {
            "details": {
                "kind": "admin#reports#activity",
                "id": {"applicationname": "calendar", "time": "2026-04-15T18:33:46.493Z"},
                "actor": {"email": "user@example.com"},
                "ipaddress": "1.2.3.4",
                "etag": "tag123",
                "events": [{
                    "name": "change_event",
                    "parameters": [
                        {"name": "event_title", "value": "Catch up"}
                    ]
                }]
            }
        }
        normalized = self.normalize(raw_event)
        assert "Catch up" in normalized["summary"]

    def test_token_summary(self):
        raw_event = {
            "details": {
                "kind": "admin#reports#activity",
                "id": {"applicationname": "token", "time": "2026-04-15T19:35:01.616Z"},
                "actor": {"email": "user@example.com"},
                "ipaddress": "1.2.3.4",
                "etag": "tag123",
                "events": [{
                    "name": "authorize",
                    "parameters": [
                        {"name": "app_name", "value": "respondA"}
                    ]
                }]
            }
        }
        normalized = self.normalize(raw_event)
        assert "respondA" in normalized["summary"]

    def test_access_evaluation_summary(self):
        raw_event = {
            "details": {
                "kind": "admin#reports#activity",
                "id": {"applicationname": "access_evaluation", "time": "2026-04-15T19:37:48.320Z"},
                "actor": {"email": "user@example.com"},
                "ipaddress": "1.2.3.4",
                "etag": "tag123",
                "events": [{
                    "name": "allow_credential_validation_request",
                    "parameters": [
                        {"name": "scopes_requested", "multivalue": ["Drive and Docs"]}
                    ]
                }]
            }
        }
        normalized = self.normalize(raw_event)
        assert "Drive and Docs" in normalized["summary"]

    def test_access_evaluation_service_account_summary(self):
        raw_event = {
            "details": {
                "kind": "admin#reports#activity",
                "id": {"applicationname": "access_evaluation", "time": "2026-04-15T18:50:25.554Z"},
                "actor": {"email": "user@example.com"},
                "ipaddress": "1.2.3.4",
                "etag": "tag123",
                "events": [{
                    "name": "allow_token_impersonation",
                    "parameters": [
                        {"name": "service_account", "value": "sa@prj.iam.gserviceaccount.com"}
                    ]
                }]
            }
        }
        normalized = self.normalize(raw_event)
        assert "sa@prj.iam.gserviceaccount.com" in normalized["summary"]
