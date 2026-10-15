# Restoring the stock firmware

The factory image was backed up on 1 Oct 2026, before anything was flashed.

| | |
|---|---|
| File | `firmware/stock-backup/stackchan-k151-stock-2026-10-01.bin` |
| Size | 16,777,216 bytes (the full 16 MB flash) |
| SHA-256 | `71c12c78af2a719e930d34f87b4ca97aebd83faa67091be0be7dc7d1e4a28437` |
| Device | ESP32-S3 (QFN56) rev v0.2, 16 MB quad flash |
| Checked | size, SHA-256, and `verify-flash` against the chip (digest matched) |

**The file is private.** It contains the Wi-Fi password and the device's pairing data. It is gitignored and must never be committed, uploaded or shared. A second copy is kept off this Mac.

There are two ways back. Path A puts the robot back exactly as it was on 1 Oct. Path B gives you a clean, current official firmware.

## Path A: esptool (exact restore)

Run everything from the project root.

1. **Check the backup is intact.** This compares the file with its saved fingerprint.
   ```bash
   cd firmware/stock-backup && shasum -a 256 -c stackchan-k151-stock-2026-10-01.bin.sha256 && cd ../..
   ```
   You should see `stackchan-k151-stock-2026-10-01.bin: OK`. If it says `FAILED`, stop and use the off-Mac copy instead.
2. **Find the port.** This lists the USB serial devices.
   ```bash
   ls /dev/cu.usbmodem*
   ```
   It was `/dev/cu.usbmodem1401` on 1 Oct; it can change.
3. **Write the image back.** This overwrites the whole flash with the backup.
   ```bash
   esptool --port /dev/cu.usbmodem1401 write-flash 0 firmware/stock-backup/stackchan-k151-stock-2026-10-01.bin
   ```
   If it says `Failed to connect`, put the robot into download mode: hold the reset button on the side of the CoreS3 for about 2 s until the green LED lights, release, then repeat steps 2 and 3. A custom firmware that has crashed or taken over the USB port needs this.
4. **Confirm.** The chip checksums its flash and compares it with the file.
   ```bash
   esptool --port /dev/cu.usbmodem1401 verify-flash 0 firmware/stock-backup/stackchan-k151-stock-2026-10-01.bin
   ```
   You should see `Verification successful (digest matched)`. The robot then reboots with its old face, its old Wi-Fi settings and its old pairing.

## Path B: M5Burner (official firmware)

Use this if the backup is lost, or if you want the latest official version instead of the 1 Oct snapshot.

1. Install and open **M5Burner** from the M5Stack website (docs.m5stack.com, Downloads).
2. Choose **StackChan** in the device list on the left.
3. Pick the firmware marked **Only Official** and click **Download**, then **Burn**.
4. Select the robot's port (`/dev/cu.usbmodem...`). If it isn't found, use download mode as in Path A, step 3.
5. After it reboots, set up Wi-Fi and pairing again. This path doesn't contain your old settings.

## Gotcha

The stock firmware auto-updates whenever **AI Agent mode** is entered. After a restore, that's harmless. While running a custom build, never enter AI Agent mode, because the update overwrites the custom firmware.
