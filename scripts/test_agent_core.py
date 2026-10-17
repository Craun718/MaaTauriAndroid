#!/usr/bin/env python3
"""Check native distribution records and runtime packaging without compiling."""

# ruff: noqa: PT009, PT027 -- Stdlib unittest avoids an extra test runner dependency.

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from build_agent_bundle import pack_site_packages
from build_agent_core import BuildError, regenerate_records, validate_records
from build_agent_native import NativeBuildError, patch_once, write_distribution


class NativePackagingTests(unittest.TestCase):
    """Exercise the metadata and archive boundaries used by native bindings."""

    def test_record_covers_top_level_extension(self) -> None:
        """A top-level extension must survive record regeneration and hash checks."""
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            (site / "cv2.so").write_bytes(b"target extension")
            license_path = site / "LICENSE"
            license_path.write_text("license", encoding="utf-8")
            write_distribution(site, "opencv-python", "4.12.0", [Path("cv2.so")], [license_path])
            regenerate_records(site)
            validate_records(site)
            record = site / "opencv_python-4.12.0.dist-info/RECORD"
            self.assertIn("cv2.so,sha256=", record.read_text(encoding="utf-8"))
            (site / "cv2.so").write_bytes(b"changed extension")
            with self.assertRaisesRegex(BuildError, "hash or size mismatch"):
                validate_records(site)

    def test_record_covers_nested_extension_and_notices(self) -> None:
        """ORT's package and license files must both be recorded."""
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            capi = site / "onnxruntime/capi"
            capi.mkdir(parents=True)
            (capi / "onnxruntime_pybind11_state.so").write_bytes(b"target extension")
            license_path = site / "LICENSE"
            license_path.write_text("license", encoding="utf-8")
            write_distribution(site, "onnxruntime", "1.23.2", [Path("onnxruntime")], [license_path])
            regenerate_records(site)
            validate_records(site)
            record = site / "onnxruntime-1.23.2.dist-info/RECORD"
            text = record.read_text(encoding="utf-8")
            self.assertIn("onnxruntime/capi/onnxruntime_pybind11_state.so,sha256=", text)
            self.assertIn("licenses/0-LICENSE,sha256=", text)

    def test_runtime_keeps_extensions_on_disk(self) -> None:
        """Zipimport must not hide native extensions or their Python package."""
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            (site / "cv2.so").write_bytes(b"target extension")
            (site / "helper.py").write_text("VALUE = 1\n", encoding="utf-8")
            capi = site / "onnxruntime/capi"
            capi.mkdir(parents=True)
            (site / "onnxruntime/__init__.py").write_text("", encoding="utf-8")
            (capi / "onnxruntime_pybind11_state.so").write_bytes(b"target extension")
            pack_site_packages(site)
            self.assertTrue((site / "cv2.so").is_file())
            self.assertTrue((site / "onnxruntime/__init__.py").is_file())
            self.assertTrue((capi / "onnxruntime_pybind11_state.so").is_file())
            with zipfile.ZipFile(site / "pure.zip") as archive:
                self.assertIn("helper.py", archive.namelist())
                self.assertNotIn("cv2.so", archive.namelist())

    def test_patch_rejects_unknown_upstream_layout(self) -> None:
        """A changed or ambiguous upstream guard must fail before building."""
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "CMakeLists.txt"
            for text in ("upstream changed", "guard\nguard\n"):
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(NativeBuildError):
                    patch_once(path, "guard", "patched")
                self.assertEqual(path.read_text(encoding="utf-8"), text)


if __name__ == "__main__":
    unittest.main()
