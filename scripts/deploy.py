import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


DEFAULT_HOST = "150.241.98.5"
DEFAULT_USER = "root"
DEFAULT_HOSTKEY = "ssh-ed25519 255 SHA256:/fzdD/7oR90d0y5F3BxIXD8NMwMlRcrgu9//5/XZZTU"
DEFAULT_REMOTE_DIR = "/opt/runrehab"
DEFAULT_CONTAINER = "runrehab-app-1"
DEFAULT_HEALTH_URL = "http://127.0.0.1:3000/api/health"


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str

def load_config() -> dict[str, str]:
    config_path = Path("deploy.json")
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load deploy.json: {e}", file=sys.stderr)
    return {}


def build_plink_command(password: str, host: str, user: str, hostkey: str, remote_command: str) -> list[str]:
    return [
        r"C:\Program Files\PuTTY\plink.exe",
        "-batch",
        "-ssh",
        f"{user}@{host}",
        "-pw",
        password,
        "-hostkey",
        hostkey,
        remote_command,
    ]


def run_remote(password: str, host: str, user: str, hostkey: str, remote_command: str, retries: int = 1) -> CommandResult:
    attempt = 0
    while True:
        attempt += 1
        result = subprocess.run(
            build_plink_command(password, host, user, hostkey, remote_command),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        command_result = CommandResult(
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )
        if result.returncode == 0:
            return command_result

        combined = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
        is_network_glitch = "unexpectedly closed network connection" in combined.lower()
        if attempt > retries or not is_network_glitch:
            return command_result

        print(f"[retry {attempt}/{retries}] SSH connection dropped, retrying...", file=sys.stderr)
        time.sleep(2)


def run_remote_streamed(password: str, host: str, user: str, hostkey: str, remote_command: str, retries: int = 1) -> CommandResult:
    attempt = 0
    while True:
        attempt += 1
        process = subprocess.Popen(
            build_plink_command(password, host, user, hostkey, remote_command),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        output_chunks: list[str] = []
        assert process.stdout is not None
        for line in process.stdout:
            output_chunks.append(line)
            print(line, end="")

        returncode = process.wait()
        stdout = "".join(output_chunks)
        command_result = CommandResult(returncode=returncode, stdout=stdout, stderr="")

        if returncode == 0:
            return command_result

        is_network_glitch = "unexpectedly closed network connection" in stdout.lower()
        if attempt > retries or not is_network_glitch:
            return command_result

        print(f"[retry {attempt}/{retries}] SSH connection dropped, retrying...", file=sys.stderr)
        time.sleep(2)


def require_password(cli_password: str | None) -> str:
    password = cli_password or os.environ.get("RUNREHAB_SSH_PASSWORD")
    if password:
        return password

    print("Set RUNREHAB_SSH_PASSWORD or pass --password.", file=sys.stderr)
    sys.exit(2)


def print_output(result: CommandResult) -> None:
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)


def deploy(args: argparse.Namespace) -> int:
    password = require_password(args.password)

    deploy_command = (
        f"cd {args.remote_dir} && "
        "git pull --ff-only && "
        "docker compose up -d --build"
    )

    print("[1/2] Deploying on server...")
    deploy_result = run_remote_streamed(
        password=password,
        host=args.host,
        user=args.user,
        hostkey=args.hostkey,
        remote_command=deploy_command,
        retries=args.ssh_retries,
    )
    if deploy_result.returncode != 0:
        return deploy_result.returncode

    health_command = f"docker exec {args.container} wget -qO- {args.health_url}"

    print("[2/2] Waiting for health-check...")
    for attempt in range(1, args.health_attempts + 1):
        health_result = run_remote(
            password=password,
            host=args.host,
            user=args.user,
            hostkey=args.hostkey,
            remote_command=health_command,
            retries=args.ssh_retries,
        )
        if health_result.returncode == 0:
            print_output(health_result)
            print("Deploy finished successfully.")
            return 0

        if attempt < args.health_attempts:
            print(f"Health-check not ready yet, retrying in {args.health_wait}s...")
            time.sleep(args.health_wait)

    print_output(health_result)
    return health_result.returncode


def parse_args() -> argparse.Namespace:
    config_data = load_config()

    parser = argparse.ArgumentParser(description="Deploy RunRehab to the production server.")
    parser.add_argument("--host", default=config_data.get("host", DEFAULT_HOST))
    parser.add_argument("--user", default=config_data.get("user", DEFAULT_USER))
    parser.add_argument("--password", default=config_data.get("password"))
    parser.add_argument("--hostkey", default=config_data.get("hostkey", DEFAULT_HOSTKEY))
    parser.add_argument("--remote-dir", default=config_data.get("remote_dir", DEFAULT_REMOTE_DIR))
    parser.add_argument("--container", default=config_data.get("container", DEFAULT_CONTAINER))
    parser.add_argument("--health-url", default=config_data.get("health_url", DEFAULT_HEALTH_URL))
    parser.add_argument("--health-attempts", type=int, default=config_data.get("health_attempts", 8))
    parser.add_argument("--health-wait", type=int, default=config_data.get("health_wait", 3))
    parser.add_argument("--ssh-retries", type=int, default=config_data.get("ssh_retries", 2))
    return parser.parse_args()


def main() -> int:
    try:
        return deploy(parse_args())
    except KeyboardInterrupt:
        print("\nDeploy interrupted by user.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
