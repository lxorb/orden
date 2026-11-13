use orden_contracts::{Failure, FailureKind, Outcome};

use crate::MODULE;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct NativeWindow(pub u64);

impl NativeWindow {
    #[must_use]
    pub fn as_x11(self) -> Option<u32> {
        u32::try_from(self.0).ok().filter(|id| *id != 0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    NorthWest,
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
    Move,
}

impl Edge {
    #[must_use]
    pub fn parse(named: Option<&str>) -> Option<Self> {
        Some(match named {
            None => Self::Move,
            Some("nw") => Self::NorthWest,
            Some("n") => Self::North,
            Some("ne") => Self::NorthEast,
            Some("e") => Self::East,
            Some("se") => Self::SouthEast,
            Some("s") => Self::South,
            Some("sw") => Self::SouthWest,
            Some("w") => Self::West,
            Some(_) => return None,
        })
    }

    #[must_use]
    pub fn ewmh(self) -> u32 {
        match self {
            Self::NorthWest => 0,
            Self::North => 1,
            Self::NorthEast => 2,
            Self::East => 3,
            Self::SouthEast => 4,
            Self::South => 5,
            Self::SouthWest => 6,
            Self::West => 7,
            Self::Move => 8,
        }
    }

    #[must_use]
    pub fn is_move(self) -> bool {
        self == Self::Move
    }
}

pub trait WindowSystem: Send + Sync {
    fn name(&self) -> &'static str;

    fn move_resize(
        &self,
        window: NativeWindow,
        edge: Edge,
        from: Option<(i32, i32)>,
    ) -> Outcome<String>;

    fn frame(&self, window: NativeWindow, scale: f64) -> Outcome<()>;

    fn float(&self, window: NativeWindow) -> Outcome<()>;

    fn bare(&self, page: NativeWindow);

    fn hide(&self, page: NativeWindow);

    fn desktop_scale(&self) -> Option<f64>;
}

pub struct Plain;

#[must_use]
pub fn left_to_the_platform(what: &str) -> Failure {
    Failure::new(
        MODULE,
        FailureKind::Unsupported,
        format!("{what} is the window system's own here"),
    )
}

impl WindowSystem for Plain {
    fn name(&self) -> &'static str {
        "plain"
    }

    fn move_resize(
        &self,
        _window: NativeWindow,
        _edge: Edge,
        _from: Option<(i32, i32)>,
    ) -> Outcome<String> {
        Err(left_to_the_platform("a move or resize"))
    }

    fn frame(&self, _window: NativeWindow, _scale: f64) -> Outcome<()> {
        Ok(())
    }

    fn float(&self, _window: NativeWindow) -> Outcome<()> {
        Ok(())
    }

    fn bare(&self, _page: NativeWindow) {}

    fn hide(&self, _page: NativeWindow) {}

    fn desktop_scale(&self) -> Option<f64> {
        None
    }
}
