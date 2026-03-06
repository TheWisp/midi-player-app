const { app, BrowserWindow, session } = require("electron");
const path = require("path");

app.commandLine.appendSwitch("enable-web-midi");
app.commandLine.appendSwitch("no-sandbox");

function createWindow() {
  // Grant all MIDI permission requests
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === "midi" || permission === "midi-sysex") {
      callback(true);
    } else {
      callback(true);
    }
  });

  // Allow all MIDI devices
  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === "midi") {
      return true;
    }
    return true;
  });

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "MIDI Player",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
