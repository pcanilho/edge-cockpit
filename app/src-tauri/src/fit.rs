//! Putting the console on its display at exactly the size of that display.
//!
//! Moving a window onto a display with another Windows scale (say from a 150% main
//! screen to the Edge at 100%) makes Windows send WM_DPICHANGED during the move, and
//! the window library answers it by rescaling the window to keep its size in points:
//! 2560 x 720 became 1707 x 480. Once the window is on the right display a second
//! move keeps its size, so the move is repeated until the window has the right rect.

/// x, y, width and height in pixels.
pub type Rect = (i32, i32, i32, i32);

/// Calls `apply` (move the window to the rect, then report where it ended up) until
/// the window has `target`, at most three times. Returns where it ended up.
pub fn settle(target: Rect, mut apply: impl FnMut(Rect) -> Rect) -> Rect {
    let mut got = apply(target);
    for _ in 0..2 {
        if got == target {
            break;
        }
        got = apply(target);
    }
    got
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A window as Windows and the window library treat it: a move onto a display with
    /// another scale rescales its size by new / old scale, keeping the top-left corner.
    struct Fake {
        rect: Rect,
        displays: Vec<(Rect, f64)>,
        moves: u32,
    }

    impl Fake {
        fn scale_at(&self, x: i32, y: i32) -> f64 {
            self.displays
                .iter()
                .find(|((dx, dy, dw, dh), _)| x >= *dx && x < dx + dw && y >= *dy && y < dy + dh)
                .map_or(1.0, |d| d.1)
        }

        fn apply(&mut self, r: Rect) -> Rect {
            self.moves += 1;
            let old = self.scale_at(self.rect.0, self.rect.1);
            let new = self.scale_at(r.0, r.1);
            self.rect = if old == new {
                r
            } else {
                let f = new / old;
                (
                    r.0,
                    r.1,
                    (r.2 as f64 * f).round() as i32,
                    (r.3 as f64 * f).round() as i32,
                )
            };
            self.rect
        }
    }

    // A 5120 x 2160 main screen at 150%, the Edge beside it at 100%.
    fn desk(start: Rect) -> Fake {
        Fake {
            rect: start,
            displays: vec![((0, 0, 5120, 2160), 1.5), ((5120, 0, 2560, 720), 1.0)],
            moves: 0,
        }
    }
    const EDGE: Rect = (5120, 0, 2560, 720);

    #[test]
    fn coming_back_from_the_main_screen_fills_the_edge() {
        // The console was hidden and Windows moved it to the main screen (the Edge slept).
        let mut one = desk((40, 40, 2560, 720));
        assert_eq!(
            one.apply(EDGE),
            (5120, 0, 1707, 480),
            "one move shrinks it, as in v0.9.1"
        );
        let mut w = desk((40, 40, 2560, 720));
        assert_eq!(settle(EDGE, |r| w.apply(r)), EDGE);
        assert_eq!(w.moves, 2);
    }

    #[test]
    fn already_on_the_edge_moves_once() {
        let mut w = desk(EDGE);
        assert_eq!(settle(EDGE, |r| w.apply(r)), EDGE);
        assert_eq!(w.moves, 1);
    }

    #[test]
    fn same_scale_moves_once() {
        let mut w = desk((40, 40, 2560, 720));
        w.displays[0].1 = 1.0;
        assert_eq!(settle(EDGE, |r| w.apply(r)), EDGE);
        assert_eq!(w.moves, 1);
    }

    #[test]
    fn gives_up_after_three_moves() {
        let mut moves = 0;
        assert_eq!(
            settle(EDGE, |_| {
                moves += 1;
                (0, 0, 1, 1)
            }),
            (0, 0, 1, 1)
        );
        assert_eq!(moves, 3);
    }
}
