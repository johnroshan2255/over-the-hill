use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since 1970.
pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

const ID_CHARS: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";
const CODE_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

fn pick(set: &[u8], n: usize) -> String {
    let bytes: [u8; 32] = rand::random();
    // (32 symbols: 5 bits a byte, no bias)
    bytes.iter().take(n).map(|b| set[(*b as usize) % set.len()] as char).collect()
}

/// A short random id (things, players, worlds).
pub fn rand_id(n: usize) -> String {
    pick(ID_CHARS, n.min(32))
}

/// A world's join code: 6 upper-case letters / digits, no look-alikes.
pub fn rand_code() -> String {
    pick(CODE_CHARS, 6)
}

/// 32 random bytes as hex (a player's token).
pub fn rand_hex32() -> String {
    let bytes: [u8; 32] = rand::random();
    hex(&bytes)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A name a player typed: trimmed, 1–`max` characters, no control characters.
pub fn clean_name(s: &str, max: usize) -> Option<String> {
    let t: String = s.trim().chars().filter(|c| !c.is_control()).collect();
    let n = t.chars().count();
    (n >= 1 && n <= max).then_some(t)
}

pub fn finite(v: &[f32]) -> bool {
    v.iter().all(|x| x.is_finite())
}
