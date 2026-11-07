from __future__ import annotations

import pathlib
import sys
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4] / "scripts"))

import probe_app  # noqa: E402 - the path above is what finds it

class StartedBare(unittest.TestCase):
    def test_the_process_is_started_from_a_thread_of_its_own(self) -> None:
        asked: list[tuple[int, list[str], dict]] = []

        def popen(argv: list[str], **how: object) -> str:
            asked.append((threading.get_ident(), argv, how))
            return "the process"

        with mock.patch.object(probe_app.subprocess, "Popen", popen):
            made = probe_app._started_bare(["orden.exe", "--flag"], cwd="here")

        self.assertEqual(made, "the process")
        self.assertEqual(len(asked), 1)
        thread, argv, how = asked[0]
        self.assertNotEqual(thread, threading.get_ident(), "started from the caller's own thread")
        self.assertEqual(argv, ["orden.exe", "--flag"])
        self.assertEqual(how, {"cwd": "here"})

    def test_a_start_that_fails_fails_in_the_caller(self) -> None:
        def popen(_argv: list[str], **_how: object) -> None:
            raise FileNotFoundError("no orden.exe")

        with mock.patch.object(probe_app.subprocess, "Popen", popen):
            with self.assertRaises(FileNotFoundError):
                probe_app._started_bare(["orden.exe"])

if __name__ == "__main__":
    unittest.main()
