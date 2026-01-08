use physis::common::Platform;
use physis::lgb::Lgb;
use physis::ReadableFile;
use wasm_bindgen::prelude::wasm_bindgen;
use crate::ffxiv::layer::object::FlatLayoutObject;
use crate::ffxiv::layer::util::walk;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct FFXIVLgb {
    pub objects: Vec<FlatLayoutObject>,
}


#[wasm_bindgen]
impl FFXIVLgb {
    pub fn parse(data: Vec<u8>) -> FFXIVLgb {
        let lgb = Lgb::from_existing(Platform::Win32, data.as_slice()).unwrap();

        FFXIVLgb {
            objects: walk(lgb.chunks.iter().flat_map(|x| &x.layers)),
        }
    }
}