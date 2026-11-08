#!/usr/bin/env python3
"""Serve the sandbox locally and expose opt-in weather-station data to the LAN."""

import ipaddress
import json
import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 8000
MAX_REQUEST_BYTES = 1_000_000
MAX_STATIONS = 1000
STALE_AFTER_SECONDS = 10
SHARE_STATE = {"revision": -1, "snapshot": None, "updated_at": 0.0}
SHARE_LOCK = threading.Lock()


def is_lan_client(address):
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def is_localhost_origin(origin):
    try:
        parsed = urlsplit(origin)
        return (
            parsed.scheme == "http"
            and parsed.hostname in {"localhost", "127.0.0.1"}
            and parsed.username is None
            and parsed.password is None
        )
    except ValueError:
        return False


def reject_nonstandard_json_constant(value):
    raise ValueError(f"Invalid JSON number: {value}")


class WeatherServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload, allow_lan_read=False, allow_local_publish=False):
        encoded = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        if allow_lan_read:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        if allow_local_publish:
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", ""))
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if not is_lan_client(self.client_address[0]):
            self.send_json(403, {"error": "LAN clients only"})
            return

        if urlsplit(self.path).path == "/api/weather-stations":
            with SHARE_LOCK:
                snapshot = SHARE_STATE["snapshot"]
                age = time.monotonic() - SHARE_STATE["updated_at"]
            if snapshot is None or age > STALE_AFTER_SECONDS:
                self.send_json(
                    503,
                    {"error": "Weather data sharing is disabled or its data is stale"},
                    allow_lan_read=True,
                )
                return
            self.send_json(200, snapshot, allow_lan_read=True)
            return

        super().do_GET()

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        if (
            urlsplit(self.path).path == "/api/publish"
            and self.client_address_is_loopback()
            and is_localhost_origin(origin)
        ):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
            self.end_headers()
            return
        if (
            urlsplit(self.path).path == "/api/weather-stations"
            and is_lan_client(self.client_address[0])
        ):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()
            return
        self.send_json(403, {"error": "LAN read access only"})

    def client_address_is_loopback(self):
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def do_POST(self):
        if urlsplit(self.path).path != "/api/publish":
            self.send_json(404, {"error": "Not found"})
            return
        if not self.client_address_is_loopback() or not is_localhost_origin(self.headers.get("Origin", "")):
            self.send_json(
                403,
                {"error": "Publishing is only allowed from the local sandbox page"},
                allow_local_publish=is_localhost_origin(self.headers.get("Origin", "")),
            )
            return

        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_json(
                400,
                {"error": "Invalid content length"},
                allow_local_publish=True,
            )
            return
        if content_length < 0 or content_length > MAX_REQUEST_BYTES:
            self.send_json(
                413,
                {"error": "Weather data payload is too large"},
                allow_local_publish=True,
            )
            return

        try:
            body = self.rfile.read(content_length)
            if len(body) != content_length:
                raise ValueError("Incomplete request body")
            message = json.loads(
                body.decode("utf-8"),
                parse_constant=reject_nonstandard_json_constant,
            )
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
            self.send_json(400, {"error": f"Invalid JSON payload: {error}",}, allow_local_publish=True)
            return

        if not isinstance(message, dict) or type(message.get("enabled")) is not bool:
            self.send_json(
                400,
                {"error": "Payload must include a boolean enabled field"},
                allow_local_publish=True,
            )
            return
        revision = message.get("revision")
        if type(revision) is not int or revision < 0:
            self.send_json(
                400,
                {"error": "Payload must include a non-negative integer revision"},
                allow_local_publish=True,
            )
            return

        snapshot = None
        if message["enabled"]:
            snapshot = message.get("snapshot")
            stations = snapshot.get("stations") if isinstance(snapshot, dict) else None
            if (
                not isinstance(snapshot, dict)
                or snapshot.get("schemaVersion") != 1
                or not isinstance(snapshot.get("generatedAt"), str)
                or not isinstance(stations, list)
                or len(stations) > MAX_STATIONS
                or any(not isinstance(station, dict) for station in stations)
            ):
                self.send_json(
                    400,
                    {"error": "Invalid weather station snapshot"},
                    allow_local_publish=True,
                )
                return
            try:
                json.dumps(snapshot, allow_nan=False)
            except (RecursionError, TypeError, ValueError) as error:
                self.send_json(
                    400,
                    {"error": f"Snapshot contains unsupported data: {error}"},
                    allow_local_publish=True,
                )
                return

        with SHARE_LOCK:
            if revision >= SHARE_STATE["revision"]:
                SHARE_STATE["revision"] = revision
                SHARE_STATE["snapshot"] = snapshot
                SHARE_STATE["updated_at"] = time.monotonic() if snapshot is not None else 0.0
        self.send_json(200, {"ok": True}, allow_local_publish=True)

class LanWeatherHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def local_lan_addresses():
    addresses = set()
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = result[4][0]
            if is_lan_client(address) and not ipaddress.ip_address(address).is_loopback:
                addresses.add(address)
    except OSError:
        pass
    return sorted(addresses)


def main():
    server = LanWeatherHTTPServer((HOST, PORT), WeatherServerHandler)
    print(f"Open the sandbox on this computer: http://127.0.0.1:{PORT}/")
    addresses = local_lan_addresses()
    if addresses:
        print("LAN data endpoint(s):")
        for address in addresses:
            print(f"  http://{address}:{PORT}/api/weather-stations")
    else:
        print("No private LAN IPv4 address was detected; check your network adapter.")
    print("Station data is read-only, unauthenticated, and available only while sharing is enabled.")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping LAN weather server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
