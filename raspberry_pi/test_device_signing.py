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


if __name__ == "__main__":
    unittest.main()
