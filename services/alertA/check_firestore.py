from google.cloud import firestore
import json
from datetime import datetime


class JSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return str(obj)


db = firestore.Client(project="prj-defenda-platform-adf")

print("--- ALERTS ---")
for doc in db.collection("alerts").stream():
    print(json.dumps(doc.to_dict(), cls=JSONEncoder, indent=2))

print("--- INFLIGHT ALERTS ---")
for doc in db.collection("inflight_alerts").stream():
    print(json.dumps(doc.to_dict(), cls=JSONEncoder, indent=2))

print("--- PROCESSED EVENTS ---")
for doc in db.collection("processed_events").stream():
    print(doc.id)
