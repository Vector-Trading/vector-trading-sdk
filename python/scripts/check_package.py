import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
UV = "uv"
ENV = {**os.environ, "UV_CACHE_DIR": str(WORKSPACE / ".cache/uv")}


def run(args, cwd, env=None):
    result = subprocess.run(
        args, cwd=cwd, env=env or ENV, text=True, capture_output=True, timeout=60
    )
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout.strip()


(wheel,) = ROOT.joinpath("dist").glob("*.whl")
(sdist,) = ROOT.joinpath("dist").glob("*.tar.gz")
for artifact in (wheel, sdist):
    print(
        artifact.name + " SHA-256 " + hashlib.sha256(artifact.read_bytes()).hexdigest(), flush=True
    )
    if artifact == wheel:
        with zipfile.ZipFile(artifact) as archive:
            paths = archive.namelist()
            source = [archive.read(name) for name in paths if name.endswith((".py", ".json"))]
            assert "vector_trading/py.typed" in paths
            assert any(name.endswith("/licenses/LICENSE") for name in paths)
            assert not any(
                "/api/" in name or name.endswith(("api_client.py", "rest.py", "configuration.py"))
                for name in paths
            )
    else:
        with tarfile.open(artifact) as archive:
            paths = archive.getnames()
            source = [
                archive.extractfile(name).read()
                for name in paths
                if name.endswith((".py", ".json"))
            ]
    assert not any("/tests/" in name or "/examples/" in name or "uv.lock" in name for name in paths)
    for contents in source:
        assert str(WORKSPACE).encode() not in contents
        assert b"from typing_extensions" not in contents
        assert b"dateutil" not in contents
        assert b"@vector-trading/types" not in contents

for tag, interpreter in [
    (
        "3.12",
        os.environ.get("SDK_PYTHON312")
        or run([UV, "python", "find", "3.12", "--no-project"], ROOT),
    ),
    (
        "3.14",
        os.environ.get("SDK_PYTHON314")
        or run([UV, "python", "find", "3.14", "--no-project"], ROOT),
    ),
]:
    for artifact in (wheel, sdist):
        with tempfile.TemporaryDirectory(prefix="vector-sdk-python-consumer-") as temp:
            cwd = Path(temp)
            python = cwd / "venv/bin/python"
            run([UV, "venv", "--python", interpreter, str(cwd / "venv")], cwd)
            run([UV, "pip", "install", "--python", str(python), str(artifact)], cwd)
            consumer_env = {**ENV, "PYTHONPATH": "", "PYTHONNOUSERSITE": "1"}
            consumer = cwd / "consumer.py"
            consumer.write_text((ROOT / "scripts/installed_consumer.py").read_text())
            print(
                tag
                + " "
                + artifact.suffix
                + ": "
                + run([str(python), "-I", str(consumer)], cwd, consumer_env),
                flush=True,
            )
            metadata = run(
                [
                    str(python),
                    "-I",
                    "-c",
                    "import json,importlib.metadata as m,vector_trading as v; d=m.distribution('vector-trading-sdk'); print(json.dumps({'requirements':d.requires,'files':[str(f) for f in d.files], 'origin':v.__file__, 'distributions':sorted(x.metadata['Name'].lower() for x in m.distributions())}))",
                ],
                cwd,
                consumer_env,
            )
            meta = json.loads(metadata)
            assert str(cwd / "venv") in meta["origin"]
            assert len(meta["requirements"]) == 2
            assert any(req.startswith("httpx") for req in meta["requirements"])
            assert any(req.startswith("pydantic") for req in meta["requirements"])
            assert "python-dateutil" not in meta["distributions"]
            assert "pytest" not in meta["distributions"] and "ruff" not in meta["distributions"]
            assert not any(name.endswith(".pth") for name in meta["files"])
            print("Runtime graph: " + ", ".join(meta["distributions"]), flush=True)
            types = cwd / "consumer_types.py"
            types.write_text((ROOT / "scripts/consumer_types.py").read_text())
            print(
                run(
                    [
                        sys.executable,
                        "-m",
                        "mypy",
                        "--strict",
                        "--python-executable",
                        str(python),
                        str(types),
                    ],
                    cwd,
                ),
                flush=True,
            )
            for example in ROOT.joinpath("examples").glob("*.py"):
                target = cwd / example.name
                target.write_text(example.read_text())
                run(
                    [
                        str(python),
                        "-I",
                        "-c",
                        "import runpy; runpy.run_path(" + repr(str(target)) + ")",
                    ],
                    cwd,
                    consumer_env,
                )
                print(
                    run(
                        [
                            sys.executable,
                            "-m",
                            "mypy",
                            "--strict",
                            "--python-executable",
                            str(python),
                            str(target),
                        ],
                        cwd,
                    ),
                    flush=True,
                )
print("Four clean wheel/sdist consumers and public examples passed.")
