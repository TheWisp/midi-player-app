// BLE MIDI output via D-Bus/BlueZ GATT
// Bypasses BlueZ's MIDI plugin to write properly timestamped BLE MIDI packets
const dbus = require('dbus-next');

const MIDI_SERVICE_UUID = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const MIDI_IO_CHAR_UUID = '7772e5db-3868-4112-a1a9-f2669d106bf3';

class BleMidiOutput {
  constructor() {
    this.bus = null;
    this.charIface = null;
    this.charPath = null;
    this.deviceName = null;
    this.connected = false;
    this._startMs = Date.now(); // reference for BLE MIDI timestamps
  }

  async init() {
    this.bus = dbus.systemBus();
    return true;
  }

  async findMidiDevices() {
    const obj = await this.bus.getProxyObject('org.bluez', '/');
    const manager = obj.getInterface('org.freedesktop.DBus.ObjectManager');
    const objects = await manager.GetManagedObjects();
    const devices = [];

    // Find all GATT characteristics that match the MIDI I/O UUID
    for (const [path, interfaces] of Object.entries(objects)) {
      const charInfo = interfaces['org.bluez.GattCharacteristic1'];
      if (!charInfo || charInfo.UUID?.value !== MIDI_IO_CHAR_UUID) continue;

      // Find the parent device name
      const devPath = path.split('/service')[0];
      const devInfo = objects[devPath]?.['org.bluez.Device1'];
      const name = devInfo?.Name?.value || devInfo?.Alias?.value || 'Unknown BLE MIDI';

      devices.push({ path, devPath, name });
    }
    return devices;
  }

  async connect(charPath) {
    const obj = await this.bus.getProxyObject('org.bluez', charPath);
    this.charIface = obj.getInterface('org.bluez.GattCharacteristic1');
    this.charPath = charPath;
    this.connected = true;
    this._startMs = Date.now();
  }

  disconnect() {
    this.charIface = null;
    this.charPath = null;
    this.connected = false;
  }

  // Encode BLE MIDI timestamp (13-bit millisecond counter)
  _encodeTimestamp(ms) {
    const t = ms & 0x1FFF; // 13-bit wrap
    const high = 0x80 | ((t >> 7) & 0x3F);
    const low = 0x80 | (t & 0x7F);
    return { high, low };
  }

  // Send a single MIDI message with a BLE MIDI timestamp
  async send(midiBytes, timestampMs) {
    if (!this.charIface) return;

    const ts = this._encodeTimestamp(timestampMs !== undefined ? timestampMs : Date.now());

    // BLE MIDI packet: [tsHigh, tsLow, status, data1, ...]
    const packet = Buffer.alloc(2 + midiBytes.length);
    packet[0] = ts.high;
    packet[1] = ts.low;
    for (let i = 0; i < midiBytes.length; i++) {
      packet[2 + i] = midiBytes[i];
    }

    try {
      await this.charIface.WriteValue(
        [...packet],
        { type: new dbus.Variant('s', 'command') } // write-without-response
      );
    } catch (e) {
      // Silently ignore write errors during playback (device may be busy)
    }
  }

  // Send multiple MIDI messages in one BLE packet (more efficient, better timing)
  // Each message gets its own timestamp_low byte within the same packet
  async sendBatch(messages) {
    if (!this.charIface) return;

    // BLE MIDI packet format for multiple messages:
    // [tsHigh, tsLow1, status1, d1, d2, tsLow2, status2, d1, d2, ...]
    // All share the same tsHigh, each has its own tsLow
    // MTU is 23, usable payload ~20 bytes

    const MAX_PAYLOAD = 20;
    let buf = [];
    let currentTsHigh = -1;

    for (const { midiBytes, timestampMs } of messages) {
      const ts = this._encodeTimestamp(timestampMs !== undefined ? timestampMs : Date.now());

      if (currentTsHigh === -1 || currentTsHigh !== ts.high) {
        // New tsHigh needed — flush current batch if any
        if (buf.length > 0) {
          await this._writePacket(buf);
          buf = [];
        }
        currentTsHigh = ts.high;
        buf.push(ts.high);
      }

      // Check if adding this message would exceed MTU
      const msgSize = 1 + midiBytes.length; // tsLow + midi bytes
      if (buf.length + msgSize > MAX_PAYLOAD) {
        await this._writePacket(buf);
        buf = [ts.high];
      }

      buf.push(ts.low);
      for (const b of midiBytes) buf.push(b);
    }

    if (buf.length > 1) { // more than just tsHigh
      await this._writePacket(buf);
    }
  }

  async _writePacket(bytes) {
    try {
      await this.charIface.WriteValue(
        bytes,
        { type: new dbus.Variant('s', 'command') }
      );
    } catch (e) {
      // Silently ignore
    }
  }
}

module.exports = { BleMidiOutput };
