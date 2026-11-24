#!/usr/bin/env python3
"""Check native distribution records and runtime packaging without compiling."""

# ruff: noqa: PT009, PT027 -- Stdlib unittest avoids an extra test runner dependency.

from __future__ import annotations

import hashlib
import io
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from build_agent_bundle import CORE_SHA256, fetch_core, pack_site_packages
from build_agent_core import BuildError, regenerate_records, validate_records
from build_agent_native import NativeBuildError, patch_once, write_distribution


def core_tarball(payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        member = tarfile.TarInfo("arm64-v8a/bundle/agent-core.json")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    return buffer.getvalue()


class CoreDownloadTests(unittest.TestCase):
    """Exercise the integrity check on downloads and existing caches."""

    def setUp(self) -> None:
        """Create a pinned fixture and use only in-memory HTTP responses."""
        self.key = ("Example/Core", "fixture-tag", "arm64-v8a")
        self.archive_bytes = core_tarball(b'{"verified": true}')
        digest = hashlib.sha256(self.archive_bytes).hexdigest()
        self.enterContext(mock.patch.dict(CORE_SHA256, {self.key: digest}))
        self.urlopen = self.enterContext(mock.patch("build_agent_bundle.urllib.request.urlopen"))
        self.work = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.asset = "agent-core-3.13.15-arm64-v8a.tar.gz"
        self.archive = self.work / f"{digest}-{self.asset}"
        self.staging: list[tempfile.TemporaryDirectory] = []
        self.addCleanup(self._cleanup_staging)

    def _cleanup_staging(self) -> None:
        for item in self.staging:
            item.cleanup()

    def _fetch(self) -> Path:
        repo, tag, abi = self.key
        return fetch_core(abi, repo, tag, self.work, self.staging)

    def test_verified_download_is_cached(self) -> None:
        """Only a valid archive may reach the persistent cache."""
        (self.work / self.asset).write_bytes(core_tarball(b'{"verified": false}'))
        self.urlopen.return_value = io.BytesIO(self.archive_bytes)
        bundle = self._fetch()
        self.assertEqual((bundle / "agent-core.json").read_bytes(), b'{"verified": true}')
        self.assertEqual(self.archive.read_bytes(), self.archive_bytes)
        self.urlopen.assert_called_once_with(f"https://github.com/Example/Core/releases/download/fixture-tag/{self.asset}", timeout=120)

    def test_unverified_download_is_not_extracted_or_cached(self) -> None:
        """A valid tar with different contents must fail before the tar parser."""
        self.urlopen.return_value = io.BytesIO(core_tarball(b'{"verified": false}'))
        with mock.patch("build_agent_bundle.tarfile.open") as parser, self.assertRaisesRegex(
            SystemExit, "agent core SHA-256 mismatch",
        ):
            self._fetch()
        parser.assert_not_called()
        self.assertEqual(list(self.work.iterdir()), [])

    def test_bad_cache_cannot_reuse_an_existing_extracted_bundle(self) -> None:
        """A previous extracted manifest cannot bypass a mismatched cached archive."""
        self.archive.write_bytes(core_tarball(b'{"verified": false}'))
        legacy = self.work / "core-fixture-tag/arm64-v8a/bundle"
        legacy.mkdir(parents=True)
        (legacy / "agent-core.json").write_bytes(b'{"verified": true}')
        with mock.patch("build_agent_bundle.tarfile.open") as parser, self.assertRaisesRegex(
            SystemExit, "agent core SHA-256 mismatch",
        ):
            self._fetch()
        parser.assert_not_called()
        self.urlopen.assert_not_called()

    def test_good_cache_is_extracted_again(self) -> None:
        """Only verified archives, not their previously extracted files, are reused."""
        self.archive.write_bytes(self.archive_bytes)
        legacy = self.work / "core-fixture-tag/arm64-v8a/bundle"
        legacy.mkdir(parents=True)
        (legacy / "agent-core.json").write_bytes(b'{"verified": false}')
        bundle = self._fetch()
        self.assertEqual((bundle / "agent-core.json").read_bytes(), b'{"verified": true}')
        self.urlopen.assert_not_called()

    def test_unpinned_remote_is_rejected(self) -> None:
        """Changing any of the release coordinates cannot inherit a trusted pin."""
        self.archive.write_bytes(self.archive_bytes)
        repo, tag, abi = self.key
        for other_abi, other_repo, other_tag in ((abi, "Other/Core", tag), (abi, repo, "other-tag"), ("x86_64", repo, tag)):
            with self.assertRaisesRegex(SystemExit, "no pinned agent core SHA-256"):
                fetch_core(other_abi, other_repo, other_tag, self.work, self.staging)
        self.urlopen.assert_not_called()


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
