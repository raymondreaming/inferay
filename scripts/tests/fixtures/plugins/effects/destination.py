"""Local conformance destination. No network, credentials, or production accounts."""
import json
import os
import sqlite3
import sys

request = json.load(sys.stdin)
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("PRAGMA synchronous=FULL")
    db.execute("CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, intent_hash TEXT, payload TEXT, receipt TEXT)")
    delivery = request["deliveryId"]
    previous = db.execute("SELECT intent_hash,payload,receipt FROM receipts WHERE id=?", (delivery,)).fetchone()
    if request["operation"] == "reconcile":
        response = {"state": "delivered", "receipt": json.loads(previous[2])} if previous else {"state": "absent"}
    elif request["operation"] == "deliver":
        payload = json.dumps(request["payload"], sort_keys=True, separators=(",", ":"))
        if previous and (previous[0] != request["intentHash"] or previous[1] != payload):
            raise ValueError("Conflicting delivery identity")
        if previous:
            receipt = json.loads(previous[2])
        else:
            receipt = {"deliveryId": delivery, "intentHash": request["intentHash"], "destinationId": "fixture:" + delivery, "completedAt": request["time"]}
            db.execute("INSERT INTO receipts VALUES(?,?,?,?)", (delivery, request["intentHash"], payload, json.dumps(receipt)))
            db.commit()
        if request.get("loseReply"):
            os._exit(75)  # Destination state is durable; the caller receives no receipt.
        response = {"state": "delivered", "receipt": receipt}
    else:
        raise ValueError("Unknown operation")
print(json.dumps(response))
