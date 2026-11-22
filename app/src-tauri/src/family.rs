//! Process trees from (pid, parent) pairs.

/// A process and everything started under it, from (pid, parent) pairs. Windows reuses
/// ids, so a stale parent link can point anywhere: each id is taken at most once.
// Used by the Windows process walk; plain data, so its test runs on any system.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn family(root: u32, pairs: &[(u32, u32)]) -> Vec<u32> {
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        let p = out[i];
        for &(c, parent) in pairs {
            if parent == p && c != p && !out.contains(&c) {
                out.push(c);
            }
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::family;

    #[test]
    fn family_takes_children_and_grandchildren_once() {
        // 1 -> 2 -> 4, 1 -> 3; 5 is someone else's; 6 claims itself as parent; 7 <-> 8 loop.
        let pairs = [
            (2, 1),
            (3, 1),
            (4, 2),
            (5, 9),
            (6, 6),
            (7, 8),
            (8, 7),
            (1, 7),
        ];
        let mut got = family(1, &pairs);
        got.sort();
        assert_eq!(got, vec![1, 2, 3, 4]);
    }
}
