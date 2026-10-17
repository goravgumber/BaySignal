import base64
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.exceptions import InvalidSignature

from device_signing import canonical_request, signed_request_headers


class DeviceSigningTests(unittest.TestCase):
    def setUp(self):
        self.private_key = Ed25519PrivateKey.generate()
        private_der = self.private_key.private_bytes(
            serialization.Encoding.DER,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        self.private_key_base64url = base64.urlsafe_b64encode(private_der).rstrip(b"=").decode("ascii")
        self.public_key = self.private_key.public_key()

    def test_signature_matches_the_documented_canonical_request(self):
        raw_body = b'{"cpuPercent":10}'
        path = "/api/simulation/pi-payload"
        headers = signed_request_headers(
            "device-id",
            "credential-id",
            self.private_key_base64url,
            "post",
            path,
            raw_body,
            timestamp=1792140000,
            request_id="56a7c6bf-ea42-4fc7-a843-e3bc89eaebde",
        )
        signature = base64.urlsafe_b64decode(headers["X-Device-Signature"] + "==")
        canonical = canonical_request("POST", path, "1792140000", headers["X-Device-Request-Id"], raw_body)
        self.public_key.verify(signature, canonical)

    def test_signature_does_not_verify_after_body_tampering(self):
        raw_body = b'{"cpuPercent":10}'
        headers = signed_request_headers("device-id", "credential-id", self.private_key_base64url, "PUT", "/api/devices/id/heartbeat", raw_body)
        signature = base64.urlsafe_b64decode(headers["X-Device-Signature"] + "==")
        changed = canonical_request("PUT", "/api/devices/id/heartbeat", headers["X-Device-Timestamp"], headers["X-Device-Request-Id"], b'{"cpuPercent":99}')
        with self.assertRaises(InvalidSignature):
            self.public_key.verify(signature, changed)

    def test_signature_for_device_observation_endpoint(self):
        raw_body = b'{"parking_id":"fac-123","timestamp":"2026-10-17T00:00:00Z","slots":{"A-01":"available"}}'
        path = "/api/devices/dev-456/observations"
        headers = signed_request_headers(
            "dev-456",
            "cred-789",
            self.private_key_base64url,
            "POST",
            path,
            raw_body,
            timestamp=1792140500,
            request_id="88888888-4444-4444-4444-121212121212"
        )
        signature = base64.urlsafe_b64decode(headers["X-Device-Signature"] + "==")
        canonical = canonical_request("POST", path, "1792140500", "88888888-4444-4444-4444-121212121212", raw_body)
        self.public_key.verify(signature, canonical)
        self.assertEqual(headers["X-Device-Id"], "dev-456")
        self.assertEqual(headers["X-Device-Credential-Id"], "cred-789")


if __name__ == "__main__":
    unittest.main()
