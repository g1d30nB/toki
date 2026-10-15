#!/usr/bin/env python3
"""Record the raw Hardware Buddy stream that the buddy-stream firmware echoes over USB.

Each line from the robot is tagged by the firmware:
  "<< " received from the Claude desktop app
  ">> " sent back to the desktop app
  "## " a device event (boot, pairing, connect, errors)

Lines are saved as JSON Lines with a Mac timestamp, one file per run, in
~/StackChanData/recordings/. That folder is personal data and never goes in git:
it contains transcript lines and command hints.

Run:  uv run --with pyserial bridge/tools/record-stream.py [port]
Stop: Ctrl+C
"""

import json
import sys
import time
from datetime import datetime
from pathlib import Path

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbmodem1401"
OUT_DIR = Path.home() / "StackChanData" / "recordings"
TAGS = {"<< ": "rx", ">> ": "tx", "## ": "dev"}
# The desktop polls the robot every 2 s while paired, so silence this long means
# the USB link has gone stale (e.g. the robot restarted) and the port is reopened.
STALE_S = 15


def open_port() -> serial.Serial:
    # Keep DTR high and RTS low: the ESP32-S3's USB-serial treats RTS high with
    # DTR low as "reset", and Arduino's USB serial only sends while DTR is high.
    port = serial.Serial()
    port.port = PORT
    port.baudrate = 115200
    port.dtr = True
    port.rts = False
    port.timeout = 1
    while True:
        try:
            port.open()
            return port
        except serial.SerialException:
            time.sleep(1)  # unplugged or re-enumerating; try again


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.parent.chmod(0o700)
    out_path = OUT_DIR / f"{datetime.now():%Y-%m-%d_%H%M%S}.jsonl"

    port = open_port()
    last_data = time.monotonic()

    counts = {"rx": 0, "tx": 0, "dev": 0, "log": 0}
    print(f"Recording {PORT} -> {out_path}\nCtrl+C to stop.\n")
    with out_path.open("a", encoding="utf-8") as out:
        try:
            while True:
                try:
                    raw = port.readline()
                except serial.SerialException:
                    raw = None
                    last_data = 0  # device vanished: force a reopen below
                if not raw:
                    if time.monotonic() - last_data > STALE_S:
                        print("(no data for a while: reopening the port)")
                        port.close()
                        port = open_port()
                        last_data = time.monotonic()
                    continue
                last_data = time.monotonic()
                text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                kind = TAGS.get(text[:3], "log")  # "log" = untagged firmware output
                line = text[3:] if kind != "log" else text
                record = {"t": datetime.now().astimezone().isoformat(timespec="milliseconds"),
                          "dir": kind, "line": line}
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
                counts[kind] += 1
                print(f"{record['t'][11:23]} {kind:>3}  {line[:160]}")
        except KeyboardInterrupt:
            pass
        finally:
            port.close()

    print(f"\nSaved {out_path}")
    print("  " + "  ".join(f"{k} {v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
