from google.cloud import firestore
import json
import sys

db = firestore.Client(project="prj-defenda-platform-adf")

event_id_to_check = sys.argv[1]

count = 0
for doc in db.collection("alerts").stream():
    alert = doc.to_dict()
    for e in alert.get("events", []):
        eid = e.get("details", {}).get("eventid") or e.get("eventid")
        if eid == event_id_to_check:
            count += 1

print(f"Alerts found for {event_id_to_check}: {count}")

processed = db.collection("processed_events").document(event_id_to_check).get().exists
print(f"Is processed_events doc present: {processed}")
