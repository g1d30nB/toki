#!/usr/bin/env python3
"""The face tour: shows each of Toki's faces on the robot, one at a time, for review.

  uv run --with pyserial bridge/tools/face-tour.py [PORT] [NOTES]

Press Return for the next face, type "b" to go back, or type a comment and press
Return to note it against the face shown (and move on). Comments are appended to
NOTES (default notes/face-review.md). Ctrl+C ends the tour; Toki goes back to
following Claude within a minute either way.
"""

import glob
import sys
import time
from datetime import datetime

import serial

FACES = [
    ("idle", "content, nothing to do"),
    ("think", "thinking, before a tool"),
    ("read", "reading files"),
    ("run", "running commands"),
    ("working", "working, the general case"),
    ("search", "searching (the magnifier)"),
    ("web", "on the web (the www wave)"),
    ("edit", "editing (tongue out)"),
    ("test", "running tests (worried)"),
    ("subagent", "with 3 subagents (the minis)"),
    ("blocked", "waiting for your approval"),
    ("asked", "a question for you in Claude"),
    ("done", "finished a turn (sparkles)"),
    ("approved", "you said yes"),
    ("denied", "you said no"),
    ("error", "something failed: spiral, then cross"),
    ("boop", "tapped on the face"),
    ("quiet", "quiet mode"),
    ("closeAsk", "Close the day?"),
    ("closed", "day closed, earned"),
    ("sleepy", "day closed, not earned"),
    ("night", "the night shutter"),
]


def send(port: serial.Serial, name: str) -> None:
    port.write(('{"setup": "face", "name": "%s", "ms": 600000}\n' % name).encode())
    end = time.monotonic() + 2
    while time.monotonic() < end:
        if port.readline().startswith(b"## setup {"):
            return


def main() -> int:
    ports = sorted(glob.glob("/dev/cu.usbmodem*"))
    path = sys.argv[1] if len(sys.argv) > 1 else (ports[0] if ports else "")
    notes = sys.argv[2] if len(sys.argv) > 2 else "notes/face-review.md"
    if not path:
        print("Toki isn't on USB. Plug the cable into the base and try again.")
        return 3
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = path, 115200, 0.3
    port.dtr, port.rts = True, False  # opening the port mustn't restart Toki
    try:
        port.open()
    except serial.SerialException as e:
        print(f"Couldn't open {path}: {e}")
        return 3
    print(f"Face tour on {path}. Return: next · b: back · text: a comment · Ctrl+C: stop\n")
    i = 0
    try:
        with open(notes, "a") as out:
            out.write(f"\n## Face review, {datetime.now():%d %b %Y %H:%M}\n\n")
            while i < len(FACES):
                name, what = FACES[i]
                send(port, name)
                answer = input(f"{i + 1:2}/{len(FACES)}  {name:9} {what}  > ").strip()
                if answer.lower() == "b":
                    i = max(0, i - 1)
                    continue
                if answer:
                    out.write(f"- **{name}**: {answer}\n")
                    out.flush()
                i += 1
        print(f"\nThat's all {len(FACES)}. Comments are in {notes}.")
    except (KeyboardInterrupt, EOFError):
        print("\nTour stopped.")
    finally:
        send(port, "")  # ends the tour: back to following Claude
        port.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
