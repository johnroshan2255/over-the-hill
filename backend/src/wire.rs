//! THE WIRE's codec (proto/wire.json): every event and intent as compact binary, by the schema the game reads too.
//! An event is made as its serde JSON shape (`world::Ev`) and written field by field in the schema's order; an
//! intent is read into the same JSON shape and handed to serde (`proto::Envelope`). Poses are packed by hand (proto.rs).

use std::{collections::HashMap, sync::OnceLock};

use serde::Serialize;
use serde_json::{Map, Number, Value};

use crate::proto::Envelope;

static WIRE: &str = include_str!("../../proto/wire.json");

#[derive(Debug, Clone)]
enum Ty {
    U8,
    Bool,
    Var,
    VarN,
    Zz,
    F32,
    F32N,
    U64,
    Str,
    StrN,
    Enum(Vec<String>),
    Obj(Vec<(String, Ty)>),
    List(Box<Ty>),
    Tuple(Vec<Ty>),
}

struct Msg {
    name: String,
    tag: u8,
    fields: Ty,
    event: bool,
}

pub struct Schema {
    events: HashMap<String, usize>,
    intents: HashMap<String, usize>,
    by_tag: HashMap<u8, usize>,
    msgs: Vec<Msg>,
}

fn parse_ty(v: &Value, enums: &Map<String, Value>, types: &Map<String, Value>, depth: u32) -> Ty {
    assert!(depth < 32, "wire.json: a type refers to itself");
    match v {
        Value::String(s) => match s.as_str() {
            "u8" => Ty::U8,
            "bool" => Ty::Bool,
            "var" => Ty::Var,
            "varn" => Ty::VarN,
            "zz" => Ty::Zz,
            "f32" => Ty::F32,
            "f32n" => Ty::F32N,
            "u64" => Ty::U64,
            "str" => Ty::Str,
            "strn" => Ty::StrN,
            name => {
                if let Some(e) = enums.get(name) {
                    Ty::Enum(e.as_array().expect("enum").iter().map(|s| s.as_str().expect("enum name").to_string()).collect())
                } else {
                    parse_ty(types.get(name).unwrap_or_else(|| panic!("wire.json: no type {name}")), enums, types, depth + 1)
                }
            }
        },
        Value::Object(o) => {
            if let Some(f) = o.get("obj") {
                Ty::Obj(fields(f, enums, types, depth))
            } else if let Some(t) = o.get("list") {
                Ty::List(Box::new(parse_ty(t, enums, types, depth + 1)))
            } else if let Some(t) = o.get("tuple") {
                Ty::Tuple(t.as_array().expect("tuple").iter().map(|t| parse_ty(t, enums, types, depth + 1)).collect())
            } else {
                panic!("wire.json: a type {o:?}")
            }
        }
        _ => panic!("wire.json: a type {v}"),
    }
}

fn fields(v: &Value, enums: &Map<String, Value>, types: &Map<String, Value>, depth: u32) -> Vec<(String, Ty)> {
    v.as_array()
        .expect("fields")
        .iter()
        .map(|f| {
            let f = f.as_array().expect("[name, type]");
            (f[0].as_str().expect("name").to_string(), parse_ty(&f[1], enums, types, depth + 1))
        })
        .collect()
}

pub fn schema() -> &'static Schema {
    static S: OnceLock<Schema> = OnceLock::new();
    S.get_or_init(|| {
        let w: Value = serde_json::from_str(WIRE).expect("proto/wire.json");
        let (enums, types) = (w["enums"].as_object().unwrap(), w["types"].as_object().unwrap());
        let mut s = Schema { events: HashMap::new(), intents: HashMap::new(), by_tag: HashMap::new(), msgs: vec![] };
        for (kind, is_event) in [("events", true), ("intents", false)] {
            for (name, m) in w[kind].as_object().unwrap() {
                let tag = m[0].as_u64().unwrap() as u8;
                let i = s.msgs.len();
                s.msgs.push(Msg { name: name.clone(), tag, fields: Ty::Obj(fields(&m[1], enums, types, 0)), event: is_event });
                assert!(s.by_tag.insert(tag, i).is_none(), "wire.json: tag {tag} twice");
                if is_event { s.events.insert(name.clone(), i) } else { s.intents.insert(name.clone(), i) };
            }
        }
        s
    })
}

// ---- writing

fn var(out: &mut Vec<u8>, mut v: u32) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}

fn write(ty: &Ty, v: &Value, out: &mut Vec<u8>) -> Result<(), String> {
    let num = |v: &Value| v.as_f64().ok_or_else(|| format!("a number, not {v}"));
    match ty {
        Ty::U8 => out.push(num(v)? as u8),
        Ty::Bool => out.push(v.as_bool().ok_or("a bool")? as u8),
        Ty::Var => var(out, v.as_u64().ok_or_else(|| format!("a whole number, not {v}"))? as u32),
        Ty::VarN => match v {
            Value::Null => out.push(0),
            _ => var(out, (v.as_u64().ok_or("a whole number or null")? as u32).wrapping_add(1)),
        },
        Ty::Zz => {
            let i = v.as_i64().ok_or("an integer")? as i32;
            var(out, ((i << 1) ^ (i >> 31)) as u32)
        }
        Ty::F32 => out.extend_from_slice(&(num(v)? as f32).to_le_bytes()),
        Ty::F32N => out.extend_from_slice(&(if v.is_null() { f32::NAN } else { num(v)? as f32 }).to_le_bytes()),
        Ty::U64 => out.extend_from_slice(&v.as_u64().ok_or("a u64")?.to_le_bytes()),
        Ty::Str => {
            let s = v.as_str().ok_or_else(|| format!("a string, not {v}"))?;
            var(out, s.len() as u32);
            out.extend_from_slice(s.as_bytes());
        }
        Ty::StrN => match v {
            Value::Null => out.push(0),
            _ => {
                out.push(1);
                write(&Ty::Str, v, out)?
            }
        },
        Ty::Enum(names) => {
            let s = v.as_str().ok_or("an enum name")?;
            out.push(names.iter().position(|n| n == s).ok_or_else(|| format!("no {s} in {names:?}"))? as u8)
        }
        Ty::Obj(fs) => {
            for (name, t) in fs {
                write(t, v.get(name).unwrap_or(&Value::Null), out).map_err(|e| format!("{name}: {e}"))?
            }
        }
        Ty::List(t) => {
            let a = v.as_array().ok_or("a list")?;
            var(out, a.len() as u32);
            for x in a {
                write(t, x, out)?
            }
        }
        Ty::Tuple(ts) => {
            let a = v.as_array().ok_or("a tuple")?;
            if a.len() != ts.len() {
                return Err(format!("a tuple of {}", ts.len()));
            }
            for (t, x) in ts.iter().zip(a) {
                write(t, x, out)?
            }
        }
    }
    Ok(())
}

/// An event (the server's), as bytes.
pub fn encode_ev<T: Serialize + ?Sized>(ev: &T) -> Vec<u8> {
    let v = serde_json::to_value(ev).expect("event");
    let s = schema();
    let m = &s.msgs[*s.events.get(v["t"].as_str().unwrap_or("")).unwrap_or_else(|| panic!("no event {} in wire.json", v["t"]))];
    let mut out = vec![m.tag];
    write(&m.fields, &v, &mut out).unwrap_or_else(|e| panic!("event {}: {e}", m.name));
    out
}

/// An intent (a client's — the tests' bots) from its JSON shape `{t, req?, …}`.
pub fn encode_intent(v: &Value) -> Result<Vec<u8>, String> {
    let s = schema();
    let t = v["t"].as_str().ok_or("no t")?;
    let m = &s.msgs[*s.intents.get(t).ok_or_else(|| format!("no intent {t}"))?];
    let mut out = vec![m.tag];
    write(&Ty::VarN, v.get("req").unwrap_or(&Value::Null), &mut out)?;
    write(&m.fields, v, &mut out).map_err(|e| format!("{t}: {e}"))?;
    Ok(out)
}

// ---- reading

struct Rd<'a> {
    b: &'a [u8],
    o: usize,
}

impl Rd<'_> {
    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let s = self.b.get(self.o..self.o.checked_add(n)?)?;
        self.o += n;
        Some(s)
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    fn var(&mut self) -> Option<u32> {
        let mut v: u64 = 0;
        for k in 0..5 {
            let b = self.u8()?;
            v |= ((b & 0x7f) as u64) << (7 * k);
            if b & 0x80 == 0 {
                return u32::try_from(v).ok();
            }
        }
        None
    }
    fn f32(&mut self) -> Option<f32> {
        Some(f32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
}

fn f(x: f32) -> Option<Value> {
    Number::from_f64(x as f64).map(Value::Number)
}

fn read(ty: &Ty, r: &mut Rd) -> Option<Value> {
    Some(match ty {
        Ty::U8 => Value::from(r.u8()?),
        Ty::Bool => Value::Bool(r.u8()? != 0),
        Ty::Var => Value::from(r.var()?),
        Ty::VarN => match r.var()? {
            0 => Value::Null,
            v => Value::from(v - 1),
        },
        Ty::Zz => {
            let u = r.var()?;
            Value::from(((u >> 1) as i32) ^ -((u & 1) as i32))
        }
        Ty::F32 => f(r.f32()?)?,
        Ty::F32N => {
            let x = r.f32()?;
            if x.is_nan() { Value::Null } else { f(x)? }
        }
        Ty::U64 => Value::from(u64::from_le_bytes(r.take(8)?.try_into().ok()?)),
        Ty::Str => {
            let n = r.var()? as usize;
            Value::String(std::str::from_utf8(r.take(n)?).ok()?.to_string())
        }
        Ty::StrN => match r.u8()? {
            0 => Value::Null,
            _ => read(&Ty::Str, r)?,
        },
        Ty::Enum(names) => Value::String(names.get(r.u8()? as usize)?.clone()),
        Ty::Obj(fs) => {
            let mut m = Map::new();
            for (name, t) in fs {
                m.insert(name.clone(), read(t, r)?);
            }
            Value::Object(m)
        }
        Ty::List(t) => {
            let n = r.var()? as usize;
            // (no count larger than the bytes left could hold: a bad frame can't make us allocate)
            if n > r.b.len() - r.o {
                return None;
            }
            let mut a = Vec::with_capacity(n);
            for _ in 0..n {
                a.push(read(t, r)?);
            }
            Value::Array(a)
        }
        Ty::Tuple(ts) => Value::Array(ts.iter().map(|t| read(t, r)).collect::<Option<_>>()?),
    })
}

fn msg_of(b: &[u8], events: bool) -> Option<(&'static Msg, Rd<'_>)> {
    let s = schema();
    let m = &s.msgs[*s.by_tag.get(b.first()?)?];
    (m.event == events).then_some((m, Rd { b, o: 1 }))
}

/// A client's intent → its envelope (None: not one, or malformed — or trailing bytes).
pub fn decode_intent(b: &[u8]) -> Option<Envelope> {
    let (m, mut r) = msg_of(b, false)?;
    let req = read(&Ty::VarN, &mut r)?;
    let Value::Object(mut o) = read(&m.fields, &mut r)? else { return None };
    if r.o != b.len() {
        return None;
    }
    o.insert("t".into(), Value::String(m.name.clone()));
    o.insert("req".into(), req);
    serde_json::from_value(Value::Object(o)).ok()
}

/// An event → its JSON shape (the tests, tools; the game does the same in TypeScript).
pub fn decode_ev(b: &[u8]) -> Option<Value> {
    let (m, mut r) = msg_of(b, true)?;
    let Value::Object(mut o) = read(&m.fields, &mut r)? else { return None };
    if r.o != b.len() {
        return None;
    }
    let mut out = Map::new();
    out.insert("t".into(), Value::String(m.name.clone()));
    out.append(&mut o);
    Some(Value::Object(out))
}

/// An intent's JSON shape back (the golden test).
pub fn decode_intent_json(b: &[u8]) -> Option<Value> {
    let (m, mut r) = msg_of(b, false)?;
    let req = read(&Ty::VarN, &mut r)?;
    let Value::Object(o) = read(&m.fields, &mut r)? else { return None };
    let mut out = Map::new();
    out.insert("t".into(), Value::String(m.name.clone()));
    out.insert("req".into(), req);
    out.extend(o);
    (r.o == b.len()).then_some(Value::Object(out))
}
