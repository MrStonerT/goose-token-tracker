"""
Goose Token Tracker - System Tray Icon
Shows a cute goose in the Windows system tray:
  GREEN goose = proxy server is running and reachable
  RED goose   = proxy server is down or unreachable

Right-click the tray icon for options.
"""

import threading
import time
import subprocess
import os
import sys
import webbrowser

try:
    import pystray
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    # Auto-install if missing
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pystray", "pillow", "--quiet"])
    import pystray
    from PIL import Image, ImageDraw

try:
    import urllib.request
    def check_server():
        try:
            urllib.request.urlopen("http://localhost:4747/", timeout=2)
            return True
        except Exception:
            return False
except Exception:
    def check_server():
        return False

# ── Path to the server directory ────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(BASE_DIR, "server.js")
LOG_FILE = os.path.join(BASE_DIR, "data", "server.log")

# ── Global state ─────────────────────────────────────────────
server_proc = None
tray_icon = None
current_status = None   # True / False / None


# ─────────────────────────────────────────────────────────────
# Icon drawing  –  a cute 64×64 goose on a coloured badge
# ─────────────────────────────────────────────────────────────
def draw_goose(connected: bool) -> Image.Image:
    SIZE = 64
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Badge background circle
    if connected:
        badge = (34, 180, 34, 255)      # green
        shadow = (20, 120, 20, 180)
    else:
        badge = (210, 40, 40, 255)      # red
        shadow = (140, 20, 20, 180)

    # Drop-shadow
    d.ellipse([4, 5, 62, 63], fill=shadow)
    # Main badge
    d.ellipse([2, 2, 62, 60], fill=badge)

    # ── Body (plump white oval) ──────────────────────────────
    d.ellipse([10, 30, 50, 56], fill="white", outline=(220, 220, 220), width=1)

    # ── Wing line ───────────────────────────────────────────
    d.arc([13, 33, 47, 54], start=190, end=340,
          fill=(180, 180, 180), width=2)

    # ── Neck ────────────────────────────────────────────────
    d.polygon([(28, 22), (36, 22), (38, 34), (26, 34)],
              fill="white", outline=(220, 220, 220))

    # ── Head ────────────────────────────────────────────────
    d.ellipse([24, 8, 46, 28], fill="white", outline=(220, 220, 220), width=1)

    # ── Eye ─────────────────────────────────────────────────
    d.ellipse([37, 13, 42, 18], fill="black")
    d.ellipse([38, 13, 40, 15], fill="white")   # highlight

    # ── Beak ────────────────────────────────────────────────
    d.polygon([(45, 16), (56, 19), (45, 22)],
              fill=(255, 160, 0), outline=(200, 120, 0))

    # ── Tail feather ────────────────────────────────────────
    d.polygon([(10, 44), (2, 38), (4, 52)],
              fill="white", outline=(200, 200, 200))

    # ── Feet (orange) ───────────────────────────────────────
    d.line([(24, 55), (20, 62)], fill=(255, 160, 0), width=2)
    d.line([(20, 62), (14, 62)], fill=(255, 160, 0), width=2)
    d.line([(36, 55), (38, 62)], fill=(255, 160, 0), width=2)
    d.line([(38, 62), (44, 62)], fill=(255, 160, 0), width=2)

    return img


# ─────────────────────────────────────────────────────────────
# Server management
# ─────────────────────────────────────────────────────────────
def start_server():
    global server_proc
    if server_proc and server_proc.poll() is None:
        return  # already running
    os.makedirs(os.path.join(BASE_DIR, "data"), exist_ok=True)
    log = open(LOG_FILE, "a")
    server_proc = subprocess.Popen(
        ["node", SERVER_SCRIPT],
        cwd=BASE_DIR,
        stdout=log,
        stderr=log,
        creationflags=subprocess.CREATE_NO_WINDOW
    )


def stop_server():
    global server_proc
    if server_proc and server_proc.poll() is None:
        server_proc.terminate()
        server_proc = None


def restart_server(icon=None, item=None):
    stop_server()
    time.sleep(1)
    start_server()


# ─────────────────────────────────────────────────────────────
# Tray menu callbacks
# ─────────────────────────────────────────────────────────────
def open_dashboard(icon=None, item=None):
    webbrowser.open("http://localhost:4747/")


def open_log(icon=None, item=None):
    os.startfile(LOG_FILE)


def quit_app(icon=None, item=None):
    stop_server()
    if tray_icon:
        tray_icon.stop()


def build_menu():
    return pystray.Menu(
        pystray.MenuItem("📊 Open Dashboard",  open_dashboard, default=True),
        pystray.MenuItem("📄 View Log",        open_log),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("🔄 Restart Server",  restart_server),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("❌ Quit",             quit_app),
    )


# ─────────────────────────────────────────────────────────────
# Background status-polling loop
# ─────────────────────────────────────────────────────────────
def poll_status():
    global current_status, tray_icon
    while True:
        alive = check_server()
        # Restart the server if the process we launched has died
        if not alive and server_proc and server_proc.poll() is not None:
            start_server()
        if alive != current_status:
            current_status = alive
            if tray_icon:
                tray_icon.icon = draw_goose(alive)
                status_text = "Connected ✅" if alive else "Not Running ❌"
                tray_icon.title = f"Goose Token Tracker — {status_text}"
        time.sleep(5)


# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Start the Node proxy server
    start_server()

    # Brief pause so the server has a moment to come up
    time.sleep(2)

    # Build initial icon
    initial_status = check_server()
    current_status = initial_status
    icon_img = draw_goose(initial_status)
    status_text = "Connected ✅" if initial_status else "Not Running ❌"

    # Create tray icon
    tray_icon = pystray.Icon(
        name="GooseTokenTracker",
        icon=icon_img,
        title=f"Goose Token Tracker — {status_text}",
        menu=build_menu(),
    )

    # Start polling thread
    poll_thread = threading.Thread(target=poll_status, daemon=True)
    poll_thread.start()

    # Run tray (blocks until quit)
    tray_icon.run()
