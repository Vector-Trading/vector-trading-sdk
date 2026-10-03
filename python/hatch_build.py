from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        root = Path(self.root)
        # The sdist carries these exact derived files and builds without the repository.
        source = root / "src/vector_trading/_generated"
        if not (source / "models").exists():
            source = root.parent / "generation/generated/python/vector_trading/_generated"
        contract = source / "models/contract.json"
        if not contract.exists():
            contract = root.parent / "generation/generated/python/contract.json"
        if not (source / "models").is_dir() or not contract.is_file():
            raise RuntimeError("Accepted generated models are missing; run pnpm generate")
        prefix = (
            "src/vector_trading/_generated"
            if self.target_name == "sdist"
            else "vector_trading/_generated"
        )
        if source != root / "src/vector_trading/_generated":
            build_data["force_include"][str(source / "models")] = prefix + "/models"
            build_data["force_include"][str(contract)] = prefix + "/models/contract.json"
        if version == "editable":
            build_data["force_include"][str(root / "src/vector_trading/py.typed")] = (
                "vector_trading/py.typed"
            )
            build_data["force_include_editable"] = build_data["force_include"]
