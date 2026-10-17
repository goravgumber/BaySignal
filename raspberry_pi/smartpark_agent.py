import os
import sys
import time
import socket
import json
import requests
import psutil
from datetime import datetime
from threading import Lock

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

SERVER_URL = os.environ.get("BAYSIGNAL_SERVER_URL", "http://localhost:4000").rstrip("/")
DEVICE_API_KEY = os.environ.get("BAYSIGNAL_DEVICE_API_KEY", "")
FACILITY_ID = "348efc36-7857-4569-a402-730186287dda"
DEVICE_CODE = "RAPI-01"
SEND_INTERVAL_SECONDS = 3
USE_CAMERA = False

SLOT_ZONES = [
    { "slot_code": "A-01", "x": 0,   "y": 0, "w": 320, "h": 480 },
    { "slot_code": "A-02", "x": 320, "y": 0, "w": 320, "h": 480 },
    { "slot_code": "A-03", "x": 640, "y": 0, "w": 320, "h": 480 },
    { "slot_code": "A-04", "x": 960, "y": 0, "w": 320, "h": 480 },
    { "slot_code": "A-05", "x": 0,   "y": 480, "w": 320, "h": 480 },
]

GREEN = "\033[92m"
RED = "\033[91m"
RESET = "\033[0m"
YELLOW = "\033[93m"

lock = Lock()
slots = {}
slot_changes = {}
camera = None
fgbg = None

def get_ip_address():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def get_temperature():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            return float(f.read().strip()) / 1000.0
    except Exception:
        return 45.0

def get_device_health():
    cpu_percent = psutil.cpu_percent(interval=0.1)
    ram_percent = psutil.virtual_memory().percent
    temperature = get_temperature()
    ip_address = get_ip_address()
    return {
        "cpuPercent": cpu_percent,
        "ramPercent": ram_percent,
        "temperature": temperature,
        "ipAddress": ip_address,
        "status": "ONLINE"
    }

def send_payload(payload):
    try:
        headers = {
            "X-Device-Key": DEVICE_API_KEY,
            "Content-Type": "application/json"
        }
        response = requests.post(
            f"{SERVER_URL}/api/simulation/pi-payload",
            json=payload,
            headers=headers,
            timeout=10
        )
        return response.status_code
    except Exception as e:
        print(f"{RED}Payload send error: {e}{RESET}")
        return None

def init_camera():
    global camera, fgbg
    if not CV2_AVAILABLE:
        print(f"{RED}OpenCV not available. Install: pip3 install opencv-python-headless{RESET}")
        return False
    camera = cv2.VideoCapture(0)
    if not camera.isOpened():
        print(f"{RED}Failed to open camera{RESET}")
        return False
    fgbg = cv2.createBackgroundSubtractorMOG2(detectShadows=False)
    print(f"{GREEN}Camera initialized{RESET}")
    return True

def detect_slots_camera():
    global slots, slot_changes
    ret, frame = camera.read()
    if not ret:
        return slots
    
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (21, 21), 0)
    fgmask = fgbg.apply(gray)
    
    for zone in SLOT_ZONES:
        x, y, w, h = zone["x"], zone["y"], zone["w"], zone["h"]
        if x + w > frame.shape[1] or y + h > frame.shape[0]:
            continue
        roi = fgmask[y:y+h, x:x+w]
        contours, _ = cv2.findContours(roi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        occupied = any(cv2.contourArea(c) > 4000 for c in contours)
        new_state = "occupied" if occupied else "available"
        old_state = slots.get(zone["slot_code"], "available")
        
        if old_state != new_state:
            slot_changes[zone["slot_code"]] = (old_state, new_state)
        
        slots[zone["slot_code"]] = new_state
    
    return slots

def simulate_slots():
    global slots, slot_changes
    default_slots = ["A-01", "A-02", "A-03", "A-04", "A-05"]
    
    if not slots:
        for s in default_slots:
            slots[s] = "available"
    
    for slot in default_slots:
        current = slots.get(slot, "available")
        if current == "available":
            if os.urandom(1)[0] < 76:
                new_state = "occupied"
                slot_changes[slot] = (current, new_state)
                slots[slot] = new_state
        else:
            if os.urandom(1)[0] < 102:
                new_state = "available"
                slot_changes[slot] = (current, new_state)
                slots[slot] = new_state
    
    return slots

def build_payload(slot_states):
    timestamp = datetime.now(datetime.UTC).isoformat()
    health = get_device_health()
    
    payload = {
        "parking_id": FACILITY_ID,
        "device_id": DEVICE_CODE,
        "timestamp": timestamp,
        "slots": slot_states,
        "confidence": 0.95,
        "device_health": health
    }
    return payload

def print_status(slot_states, status_code):
    timestamp = datetime.now().strftime("%H:%M:%S")
    health = get_device_health()
    
    slot_str = "  ".join([f"{k}={v.upper()}" for k, v in slot_states.items()])
    
    status_str = f"[{timestamp}] {slot_str} | sent {status_code} | CPU={int(health['cpuPercent'])}% TEMP={int(health['temperature'])}°C"
    print(status_str)

def print_changes():
    global slot_changes
    for slot, (old, new) in slot_changes.items():
        if new == "available":
            print(f"{GREEN}[CAR LEFT] {slot}: {old.upper()} -> {new.upper()}{RESET}")
        elif new == "occupied":
            print(f"{RED}[CAR ARRIVED] {slot}: {old.upper()} -> {new.upper()}{RESET}")
    slot_changes = {}

def main():
    global USE_CAMERA, camera
    
    print(f"{YELLOW}SmartPark AI Agent Starting...{RESET}")
    print(f"Server: {SERVER_URL}")
    print(f"Facility: {FACILITY_ID}")
    print(f"Device: {DEVICE_CODE}")
    print(f"Mode: {'Camera' if USE_CAMERA else 'Simulation'}")

    if not DEVICE_API_KEY:
        print(f"{RED}BAYSIGNAL_DEVICE_API_KEY must be configured before the agent can send data.{RESET}")
        return
    
    if USE_CAMERA:
        if not init_camera():
            print(f"{YELLOW}Falling back to simulation mode{RESET}")
            USE_CAMERA = False
    
    print(f"{YELLOW}Starting data collection... (Press Ctrl+C to stop){RESET}")
    
    try:
        while True:
            if USE_CAMERA:
                current_slots = detect_slots_camera()
            else:
                current_slots = simulate_slots()
            
            print_changes()
            
            payload = build_payload(current_slots)
            status = send_payload(payload)
            
            print_status(current_slots, status)
            
            time.sleep(SEND_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print(f"\n{GREEN}SmartPark Agent stopped.{RESET}")
    finally:
        if camera is not None:
            camera.release()
            cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
