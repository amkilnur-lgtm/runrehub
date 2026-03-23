import subprocess
import sys


def run_command(command: list[str], step_label: str) -> int:
    print(step_label)
    result = subprocess.run(command)
    return result.returncode


def main() -> int:
    try:
        push_exit_code = run_command(["git", "push"], "[1/2] Pushing current branch...")
        if push_exit_code != 0:
            print("Push failed. Deploy was skipped.", file=sys.stderr)
            return push_exit_code

        deploy_exit_code = run_command([sys.executable, "scripts/deploy.py"], "[2/2] Deploying after successful push...")
        return deploy_exit_code
    except KeyboardInterrupt:
        print("\nRelease interrupted by user.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
