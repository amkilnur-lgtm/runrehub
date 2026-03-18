import argparse
import os
import subprocess
import sys
import time


DEFAULT_HOST = "150.241.98.5"
DEFAULT_USER = "root"
DEFAULT_HOSTKEY = "ssh-ed25519 255 SHA256:/fzdD/7oR90d0y5F3BxIXD8NMwMlRcrgu9//5/XZZTU"
DEFAULT_REMOTE_DIR = "/opt/runrehab"
DEFAULT_CONTAINER = "runrehab-app-1"
DEFAULT_HEALTH_URL = "http://127.0.0.1:3000/api/health"


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


def run_remote(password: str, host: str, user: str, hostkey: str, remote_command: str, retries: int = 1) -> subprocess.CompletedProcess[str]:
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
        if result.returncode == 0:
            return result

        combined = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
        is_network_glitch = "unexpectedly closed network connection" in combined.lower()
        if attempt > retries or not is_network_glitch:
            return result

        print(f"[retry {attempt}/{retries}] SSH connection dropped, retrying...", file=sys.stderr)
        time.sleep(2)


def require_password(cli_password: str | None) -> str:
    password = cli_password or os.environ.get("RUNREHAB_SSH_PASSWORD")
    if password:
        return password

    print("Set RUNREHAB_SSH_PASSWORD or pass --password.", file=sys.stderr)
    sys.exit(2)


def print_output(result: subprocess.CompletedProcess[str]) -> None:
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
    deploy_result = run_remote(
        password=password,
        host=args.host,
        user=args.user,
        hostkey=args.hostkey,
        remote_command=deploy_command,
        retries=args.ssh_retries,
    )
    print_output(deploy_result)
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
    parser = argparse.ArgumentParser(description="Deploy RunRehab to the production server.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--password")
    parser.add_argument("--hostkey", default=DEFAULT_HOSTKEY)
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR)
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--health-url", default=DEFAULT_HEALTH_URL)
    parser.add_argument("--health-attempts", type=int, default=8)
    parser.add_argument("--health-wait", type=int, default=3)
    parser.add_argument("--ssh-retries", type=int, default=2)
    return parser.parse_args()


def main() -> int:
    return deploy(parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
