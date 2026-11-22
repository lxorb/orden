use windows::Win32::{
  Foundation::{HWND, POINT, RECT},
  Graphics::Gdi::{
    ClientToScreen, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromRect,
    MonitorFromWindow, ScreenToClient,
  },
  UI::WindowsAndMessaging::{GetClientRect, GetParent},
};

fn outside(at: [i32; 4], client: [i32; 2]) -> bool {
  let [x, y, width, height] = at;
  let [wide, high] = client;
  x + width <= 0 || y + height <= 0 || x >= wide || y >= high
}

fn chosen(
  at: [i32; 4],
  client: [i32; 2],
  screen: [i32; 4],
  same_screen: impl Fn([i32; 4]) -> bool,
) -> Option<[i32; 2]> {
  if !outside(at, client) {
    return None;
  }
  let [_, _, width, height] = at;
  let [left, top, right, bottom] = screen;
  [
    [0, bottom - 1],
    [right - 1, 0],
    [left - width + 1, 0],
    [0, top - height + 1],
    [0, bottom],
    [right, 0],
    [left - width, 0],
    [0, top - height],
  ]
  .into_iter()
  .find(|&[x, y]| outside([x, y, width, height], client) && same_screen([x, y, width, height]))
}

pub(crate) fn parked(child: HWND, x: i32, y: i32, width: i32, height: i32) -> (i32, i32) {
  unsafe {
    let Ok(parent) = GetParent(child) else {
      return (x, y);
    };
    let mut client = RECT::default();
    if GetClientRect(parent, &mut client).is_err() {
      return (x, y);
    }
    let home = MonitorFromWindow(parent, MONITOR_DEFAULTTONEAREST);
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if !GetMonitorInfoW(home, &mut info).as_bool() {
      return (x, y);
    }
    let mut corners = [
      POINT { x: info.rcMonitor.left, y: info.rcMonitor.top },
      POINT { x: info.rcMonitor.right, y: info.rcMonitor.bottom },
    ];
    for corner in &mut corners {
      if !ScreenToClient(parent, corner).as_bool() {
        return (x, y);
      }
    }
    let screen = [corners[0].x, corners[0].y, corners[1].x, corners[1].y];
    let same_screen = |[x, y, width, height]: [i32; 4]| {
      let mut corner = POINT { x, y };
      if !ClientToScreen(parent, &mut corner).as_bool() {
        return false;
      }
      let rect = RECT { left: corner.x, top: corner.y, right: corner.x + width, bottom: corner.y + height };
      MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST) == home
    };
    chosen([x, y, width, height], [client.right, client.bottom], screen, same_screen)
      .map_or((x, y), |[x, y]| (x, y))
  }
}

#[cfg(test)]
mod tests {
  use super::chosen;

  #[test]
  fn a_page_put_away_waits_at_the_edge_of_its_window_s_own_screen() {
    let client = [1600, 900];
    let screen = [-200, -100, 2360, 1340];
    let away = [-20000, -20000, 1400, 800];
    assert_eq!(chosen([100, 80, 1400, 800], client, screen, |_| true), None);
    assert_eq!(chosen(away, client, screen, |_| true), Some([0, 1339]));
    let not_below = |[_, y, _, _]: [i32; 4]| y != 1339;
    assert_eq!(chosen(away, client, screen, not_below), Some([2359, 0]));
    let maximized = [0, 0, 1600, 900];
    assert_eq!(chosen(away, client, maximized, |_| true), Some([0, 900]));
    let screen_below = |[_, y, _, _]: [i32; 4]| y != 900;
    assert_eq!(chosen(away, client, maximized, screen_below), Some([1600, 0]));
    let with_a_bar = [0, 0, 1600, 948];
    assert_eq!(chosen(away, client, with_a_bar, |_| true), Some([0, 947]));
    assert_eq!(chosen(away, client, screen, |_| false), None);
  }
}
