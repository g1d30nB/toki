#!/usr/bin/env python3
"""Sends Toki one setup line over USB and prints its answer (Phase 7).

The `toki` command (bridge/src/cli.ts) does all the talking; this only carries
one message down the cable and one back, because opening the port safely needs
pyserial (DTR high and RTS low, or the ESP32-S3 restarts).

  toki-usb.py PORT '{"setup": "status"}' [seconds]

Prints Toki's reply (the JSON after "## setup ") and exits 0; exits 2 if Toki
didn't answer in time, 3 if the port couldn't be opened.
"""

import sys
import time

import serial


def main() -> int:
    path, line = sys.argv[1], sys.argv[2]
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
    port = serial.Serial()
    port.port = path
    port.baudrate = 115200
    port.dtr = True
    port.rts = False
    port.timeout = 0.3
    try:
        port.open()
    except serial.SerialException as e:
        print(str(e), file=sys.stderr)
        return 3
    try:
        port.reset_input_buffer()
        port.write((line.strip() + "\n").encode())
        end = time.monotonic() + wait
        while time.monotonic() < end:
            text = port.readline().decode("utf-8", errors="replace").strip()
            if text.startswith("## setup {"):
                print(text[len("## setup ") :])
                return 0
        return 2
    finally:
        port.close()


if __name__ == "__main__":
    sys.exit(main())
