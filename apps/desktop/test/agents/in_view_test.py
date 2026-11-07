from __future__ import annotations

import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4] / "scripts"))

import probe_app  # noqa: E402 - the path above is what finds it

SCREEN = (0, 0, 1920, 1080)

def window(hwnd: int) -> probe_app.Seen:
    return probe_app.Seen(hwnd=hwnd, pid=7, kind="Chrome_WidgetWin_1", visible=True, box=(4, 0, 1024, 720))

class InView(unittest.TestCase):
    def test_a_layered_window_at_no_opacity_draws_nothing(self) -> None:
        self.assertTrue(probe_app.draws_nothing(0x0828_0080, probe_app.LWA_ALPHA, 0))
        self.assertFalse(probe_app.draws_nothing(0x0828_0080, probe_app.LWA_ALPHA, 1))
        self.assertFalse(probe_app.draws_nothing(0x0828_0080, 0x1, 0), "a colour key still draws the rest")
        self.assertFalse(probe_app.draws_nothing(0x0800_0080, probe_app.LWA_ALPHA, 0), "not layered")

    def test_a_window_that_draws_nothing_on_a_screen_is_not_in_view(self) -> None:
        look = probe_app.Look(windows=(window(1), window(2)), front=0, screens=(SCREEN,))
        with mock.patch.object(probe_app, "see_through", lambda hwnd: hwnd == 1):
            found = probe_app.in_view(look, {7})
        self.assertEqual(len(found), 1)
        self.assertIn("0x2 ", found[0])

if __name__ == "__main__":
    unittest.main()
