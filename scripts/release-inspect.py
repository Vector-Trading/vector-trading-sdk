"""Inspect frozen package bytes without rebuilding or executing package code."""

import email
import json
import sys
import tarfile
import tomllib
import zipfile
from pathlib import Path


def inspect(directory, version):
    directory = Path(directory)
    npm = directory / f"vector-trading-sdk-{version}.tgz"
    crate = directory / f"vector-trading-sdk-{version}.crate"
    with tarfile.open(npm) as archive:
        package = json.load(archive.extractfile("package/package.json"))
        assert (
            package["name"] == "@vector-trading/sdk" and package["version"] == version
        )
    with zipfile.ZipFile(
        directory / f"vector_trading_sdk-{version}-py3-none-any.whl"
    ) as archive:
        metadata = email.message_from_bytes(
            archive.read(f"vector_trading_sdk-{version}.dist-info/METADATA")
        )
        assert (
            metadata["Name"] == "vector-trading-sdk" and metadata["Version"] == version
        )
    with tarfile.open(directory / f"vector_trading_sdk-{version}.tar.gz") as archive:
        metadata = email.message_from_bytes(
            archive.extractfile(f"vector_trading_sdk-{version}/PKG-INFO").read()
        )
        assert (
            metadata["Name"] == "vector-trading-sdk" and metadata["Version"] == version
        )
    prefix = f"vector-trading-sdk-{version}/"
    with tarfile.open(crate) as archive:
        manifest = tomllib.loads(
            archive.extractfile(prefix + "Cargo.toml").read().decode()
        )
        p = manifest["package"]
        assert p["name"] == "vector-trading-sdk" and p["version"] == version
        vcs = json.load(archive.extractfile(prefix + ".cargo_vcs_info.json"))
        readme_file = p.get("readme")
        readme = (
            archive.extractfile(prefix + readme_file).read().decode()
            if readme_file
            else None
        )
    dependencies = []

    def deps(table, target=None):
        for section, kind in (
            ("dependencies", "normal"),
            ("dev-dependencies", "dev"),
            ("build-dependencies", "build"),
        ):
            for name, spec in table.get(section, {}).items():
                if isinstance(spec, str):
                    spec = {"version": spec}
                assert not any(
                    key in spec for key in ("path", "git", "registry", "registry-index")
                )
                dependencies.append(
                    {
                        "name": spec.get("package", name),
                        "version_req": spec["version"],
                        "features": spec.get("features", []),
                        "optional": spec.get("optional", False),
                        "default_features": spec.get("default-features", True),
                        "target": target,
                        "kind": kind,
                        "explicit_name_in_toml": name if "package" in spec else None,
                    }
                )

    deps(manifest)
    for target, table in manifest.get("target", {}).items():
        deps(table, target)
    result = {
        key: p.get(key)
        for key in (
            "description",
            "documentation",
            "homepage",
            "license",
            "license_file",
            "repository",
            "links",
        )
    }
    result.update(
        name=p["name"],
        vers=p["version"],
        deps=dependencies,
        features=manifest.get("features", {}),
        authors=p.get("authors", []),
        keywords=p.get("keywords", []),
        categories=p.get("categories", []),
        badges={},
        readme=readme,
        readme_file=readme_file,
        rust_version=p.get("rust-version"),
    )
    with zipfile.ZipFile(directory / f"vector-trading-sdk-v{version}.zip") as archive:
        assert all(
            name.startswith(
                f"github.com/Vector-Trading/vector-trading-sdk/go@v{version}/"
            )
            for name in archive.namelist()
        )
    return {"metadata": result, "vcs": vcs}


if __name__ == "__main__":
    print(json.dumps(inspect(sys.argv[1], sys.argv[2]), sort_keys=True))
