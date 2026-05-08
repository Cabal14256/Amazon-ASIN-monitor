#!/usr/bin/env python3
import os
import select
import sys
from pathlib import Path

import paramiko


def require_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def stream_channel(channel: paramiko.Channel) -> int:
    stdout_chunks: list[bytes] = []
    stderr_chunks: list[bytes] = []

    while True:
        if channel.recv_ready():
            chunk = channel.recv(4096)
            if chunk:
                stdout_chunks.append(chunk)
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()

        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(4096)
            if chunk:
                stderr_chunks.append(chunk)
                sys.stderr.buffer.write(chunk)
                sys.stderr.buffer.flush()

        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break

        read_targets = []
        if not channel.exit_status_ready():
            read_targets.append(channel)
        if read_targets:
            select.select(read_targets, [], [], 0.2)

    return channel.recv_exit_status()


def main() -> int:
    host = require_env("DEPLOY_SERVER_HOST")
    user = require_env("DEPLOY_SERVER_USER")
    password = os.environ.get("DEPLOY_SSH_PASSWORD", "")
    local_archive = Path(require_env("DEPLOY_LOCAL_ARCHIVE"))
    local_script = Path(require_env("DEPLOY_LOCAL_SCRIPT"))
    remote_archive = require_env("DEPLOY_REMOTE_ARCHIVE")
    remote_script = require_env("DEPLOY_REMOTE_SCRIPT")
    remote_command = require_env("DEPLOY_REMOTE_COMMAND")

    if not local_archive.is_file():
        raise RuntimeError(f"Archive not found: {local_archive}")
    if not local_script.is_file():
        raise RuntimeError(f"Deploy script not found: {local_script}")

    print(f"[INFO] Uploading archive to {user}@{host}:{remote_archive}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = {
        "hostname": host,
        "username": user,
        "timeout": 20,
        "banner_timeout": 20,
        "auth_timeout": 20,
        "look_for_keys": not bool(password),
        "allow_agent": not bool(password),
    }
    if password:
        connect_kwargs["password"] = password

    client.connect(**connect_kwargs)

    try:
        with client.open_sftp() as sftp:
            sftp.put(str(local_archive), remote_archive)
            sftp.put(str(local_script), remote_script)

        print(f"[INFO] Executing remote deploy command on {host}")
        stdin, stdout, stderr = client.exec_command(remote_command, get_pty=True)
        stdin.close()
        exit_code = stream_channel(stdout.channel)
        if exit_code != 0:
            raise RuntimeError(f"Remote deploy failed with exit code {exit_code}")
    finally:
        client.close()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - script entrypoint
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
