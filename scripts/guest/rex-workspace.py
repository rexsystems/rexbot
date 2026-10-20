"""Structured project operations, executed only inside the guest over SSH."""
import html
import base64
import http.client
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import tempfile
import time


def location(root, value):
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError("Provide a workspace-relative path.")
    target = (root / value).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Path must stay inside this bot's workspace.")
    return target


def files(root, args):
    action = args.get("action")
    target = location(root, args.get("path", "."))
    if action == "list":
        return {"path": str(target), "entries": [{"name": p.name, "directory": p.is_dir()} for p in sorted(target.iterdir())[:200]]}
    if action == "read":
        if target.stat().st_size > 2_000_000:
            raise ValueError("File exceeds the 2 MB text limit.")
        content = target.read_text()
        offset = args.get("offset", 0)
        if type(offset) is not int or offset < 0:
            raise ValueError("offset must be a nonnegative integer.")
        return {"path": str(target), "content": content[offset:offset + 32000], "next_offset": offset + 32000 if len(content) > offset + 32000 else None}
    if action == "write":
        content = args.get("content")
    elif action == "replace":
        old, new = args.get("old_text"), args.get("new_text")
        if not isinstance(old, str) or not old or not isinstance(new, str):
            raise ValueError("replace requires nonempty old_text and a new_text string.")
        content = target.read_text()
        if content.count(old) != 1:
            raise ValueError("old_text must match exactly once. Read the file and use a more specific match.")
        content = content.replace(old, new, 1)
    else:
        raise ValueError("Unknown file action.")
    if not isinstance(content, str) or len(content.encode()) > 262144:
        raise ValueError("Write at most 256 KiB of text per file operation.")
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=target.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            handle.write(content)
        if target.exists():
            os.chmod(temporary, target.stat().st_mode & 0o777)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"path": str(target), "bytes": len(content.encode()), "saved": True}


def identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return fields[19] if fields[0] != "Z" else None
    except (OSError, IndexError):
        return None


def running(state):
    return bool(state and state.get("boot") == Path("/proc/sys/kernel/random/boot_id").read_text().strip()
                and state.get("identity") and identity(state["pid"]) == state["identity"])


def probe(port, route="/"):
    if not isinstance(route, str) or not route.startswith("/") or route.startswith("//") or "\r" in route or "\n" in route:
        raise ValueError("Use a local request path beginning with /.")
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", route)
        response = connection.getresponse()
        body = response.read(64000).decode("utf-8", "replace")
        title = re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
        return {"http_status": response.status, "title": html.unescape(title[1]).strip() if title else None,
                "source_excerpt": body[:12000], "note": "HTTP source only; JavaScript is not executed by this check."}
    except OSError as error:
        return {"http_status": None, "error": str(error)}
    finally:
        connection.close()


def project(root, bot, args, allow_browser=True):
    folder = Path("/var/lib/rex-sessiond/projects")
    folder.mkdir(parents=True, exist_ok=True)
    state_file, logfile = folder / f"{bot}.json", folder / f"{bot}.log"
    try:
        state = json.loads(state_file.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        state = None
    action = args.get("action")
    if action == "stop":
        if running(state):
            os.killpg(state["pid"], signal.SIGTERM)
            for _ in range(20):
                if not running(state):
                    break
                time.sleep(0.1)
            if running(state):
                os.killpg(state["pid"], signal.SIGKILL)
        state_file.unlink(missing_ok=True)
        return {"running": False, "stopped": True}
    if action == "start":
        if running(state):
            raise ValueError("A project server is already running. Stop it before starting another.")
        directory = location(root, args.get("directory", "."))
        if not directory.is_dir():
            raise ValueError("Project directory does not exist. Write the project files first.")
        port = args.get("port")
        if port is None:
            with socket.socket() as available:
                available.bind(("127.0.0.1", 0))
                port = available.getsockname()[1]
        if type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError("port must be between 1024 and 65535.")
        with socket.socket() as check:
            check.bind(("127.0.0.1", port))
        command = args.get("command")
        if command is not None and (not isinstance(command, str) or not command.strip() or len(command) > 4000 or "\0" in command):
            raise ValueError("command must contain 1 to 4000 characters.")
        env = {**os.environ, "HOME": str(root), "PORT": str(port), "HOST": "127.0.0.1", "BROWSER": "none"}
        argv = ["bash", "-lc", command] if command else ["python3", "-m", "http.server", str(port), "--bind", "127.0.0.1"]
        with logfile.open("wb") as output:
            proc = subprocess.Popen(argv, cwd=directory, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        state = {"pid": proc.pid, "identity": identity(proc.pid), "boot": Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "port": port, "directory": str(directory), "url": f"http://127.0.0.1:{port}/"}
        state_file.write_text(json.dumps(state))
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if not running(state) or probe(port).get("http_status") is not None:
                break
            time.sleep(0.1)
    elif action not in ("status", "logs", "inspect", "open"):
        raise ValueError("Unknown project action.")
    result = {**(state or {}), "running": running(state)}
    if logfile.exists():
        with logfile.open("rb") as output:
            output.seek(max(0, logfile.stat().st_size - 12000))
            result["logs"] = output.read(12000).decode("utf-8", "replace")
    if result["running"] and action != "logs":
        result["check"] = probe(state["port"], args.get("path", "/"))
        if action in ("start", "open") and result["check"].get("http_status") is not None:
            if not allow_browser:
                result["browser_launched"] = False
                result["note"] = "The user has the screen. The server continues in the background; open it after they return control."
                return result
            sessions = json.loads(subprocess.check_output(["rex-sessiond", "status"], text=True, timeout=10))["sessions"]
            session = next((s for s in sessions if s["botId"] == bot and s["alive"]), None)
            if session:
                with open(os.devnull, "wb") as output:
                    subprocess.Popen(["rex-browser", state["url"]], env={**os.environ, "HOME": str(root), "DISPLAY": session["display"]}, stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
                result["browser_launched"] = True
    return result


def main(request):
    bot = request["bot"]
    if not isinstance(bot, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", bot) or bot == "owner":
        raise ValueError("Invalid bot id.")
    root = Path("/workspace/bots") / bot
    root.mkdir(parents=True, exist_ok=True)
    if request["operation"] == "image":
        value = request["args"].get("path")
        if value is None:
            result = json.loads(subprocess.check_output(["rex-sessiond", "screenshot", bot], text=True, timeout=25))
            value = result.get("path")
            if not value:
                raise ValueError("The screen capture did not produce an image.")
        target = location(root, value)
        with target.open("rb") as handle:
            data = handle.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise ValueError("Image exceeds 8 MB. Capture a smaller image.")
        return {"filename": target.name, "data": base64.b64encode(data).decode("ascii")}
    return files(root, request["args"]) if request["operation"] == "files" else project(root, bot, request["args"], request.get("open_browser", True))


if "REQUEST" in globals():
    try:
        print(json.dumps(main(REQUEST)))
    except Exception as error:
        print(str(error), file=__import__("sys").stderr)
        raise SystemExit(2)
