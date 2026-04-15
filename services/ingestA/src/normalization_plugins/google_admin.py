from utils.dict_helpers import sub_dict, enum_keys, dict_match
from utils.dotdict import DotDict
from utils.dates import toUTC
import chevron


class message(object):

    def __init__(self):
        """
        handle google workspace admin activity records
        """

        self.registration = ["kind"]
        self.priority = 20

    def onMessage(self, message, metadata):
        # for convenience, make a dot dict version of the message
        dot_message = DotDict(message)

        # double check that this is our target message
        if (
            "admin#reports#activity" not in dot_message.get("details.kind", "")
            or "id" not in message.get("details", "")
            or "etag" not in message.get("details", "")
        ):
            return (message, metadata)

        message["source"] = "google_workspace"
        message["tags"].append("google_workspace")

        # clean up ipaddress field
        if "ipaddress" in message["details"]:
            message["details"]["sourceipaddress"] = message["details"]["ipaddress"]
            del message["details"]["ipaddress"]

        # set the actual time
        if dot_message.get("details.id.time", None):
            message["utctimestamp"] = toUTC(
                message["details"]["id"]["time"]
            ).isoformat()

        # set the user_name
        if dot_message.get("details.actor.email", None):
            message["details"]["user"] = dot_message.get("details.actor.email", "")

        # extract extra info for summary
        extra_info = None
        category = dot_message.get("details.id.applicationname", "")
        events = dot_message.get("details.events", [])
        if events:
            event = events[0]
            params = event.get("parameters", [])

            def get_param(parameters, name):
                for p in parameters:
                    p_name = p.get("name")
                    if p_name and p_name.lower() == name.lower():
                        for k in [
                            "value",
                            "boolvalue",
                            "intvalue",
                            "multivalue",
                            "messagevalue",
                            "multimessagevalue",
                        ]:
                            if k in p:
                                return p[k]
                return None

            if category == "gmail":
                msg_info = get_param(params, "message_info")
                if msg_info and "parameter" in msg_info:
                    extra_info = get_param(msg_info["parameter"], "subject")
            elif category == "calendar":
                extra_info = get_param(params, "event_title")
            elif category == "mobile":
                extra_info = get_param(params, "device_model") or get_param(
                    params, "device_type"
                )
            elif category == "token":
                extra_info = get_param(params, "app_name")
            elif category == "access_evaluation":
                extra_info = get_param(params, "scopes_requested") or get_param(
                    params, "service_account"
                )
                if isinstance(extra_info, list) and len(extra_info) > 0:
                    extra_info = extra_info[0]

        if extra_info:
            message["details"]["extra_info"] = extra_info

        # set summary
        summary_template = "{{details.user}} {{details.events.0.name}}"
        if extra_info:
            summary_template += " ({{details.extra_info}})"
        if "sourceipaddress" in message["details"]:
            summary_template += " from IP {{details.sourceipaddress}}"

        message["summary"] = chevron.render(summary_template, message)

        # set category
        message["category"] = dot_message.get(
            "details.id.applicationname", "google_workspace"
        )

        # success/failure
        if "fail" in message["summary"]:
            message["details"]["success"] = False
        if "success" in message["summary"]:
            message["details"]["success"] = True

        # suspicious?
        suspicious = {"boolValue": True, "name": "is_suspicious"}
        for e in dot_message.get("details.events", []):
            for p in e.get("parameters", []):
                if dict_match(suspicious, p):
                    message["details"]["suspicious"] = True

        return (message, metadata)
