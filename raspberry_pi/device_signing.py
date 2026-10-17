"""Ed25519 signing for the BaySignal canonical device-ingestion protocol."""

import base64
import hashlib
import time
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def _decode_base64url(value):
    return base64.urlsafe_b64decode(value + ("=" * (-len(value) % 4)))


def canonical_request(method, path, timestamp, request_id, raw_body):
    body_hash = hashlib.sha256(raw_body).hexdigest()
    return f"{method.upper()}\n{path}\n{timestamp}\n{request_id}\n{body_hash}".encode("utf-8")


def signed_request_headers(device_id, credential_id, private_key_base64url, method, path, raw_body, *, timestamp=None, request_id=None):
    timestamp_text = str(timestamp if timestamp is not None else int(time.time()))
    request_id_text = request_id or str(uuid.uuid4())
    private_key = serialization.load_der_private_key(_decode_base64url(private_key_base64url), password=None)
    if not isinstance(private_key, Ed25519PrivateKey):
        raise ValueError("Configured device key is not Ed25519")
    signature = private_key.sign(canonical_request(method, path, timestamp_text, request_id_text, raw_body))
    signature_base64url = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")
    return {
        "X-Device-Credential-Id": credential_id,
        "X-Device-Id": device_id,
        "X-Device-Timestamp": timestamp_text,
        "X-Device-Request-Id": request_id_text,
        "X-Device-Signature": signature_base64url,
    }
