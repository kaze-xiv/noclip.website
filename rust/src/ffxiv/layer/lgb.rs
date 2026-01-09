use std::collections::HashSet;
use crate::ffxiv::layer::layer::LayerWrapped;
use physis::common::Platform;
use physis::lgb::Lgb;
use physis::ReadableFile;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug)]
pub struct FFXIVLgb {
    #[wasm_bindgen(getter_with_clone)]
    pub layers: Vec<LayerWrapped>,
}

#[wasm_bindgen]
impl FFXIVLgb {
    pub fn parse(data: Vec<u8>) -> FFXIVLgb {
        let lgb = Lgb::from_existing(Platform::Win32, data.as_slice()).unwrap();
        let layers = lgb.chunks.into_iter().flat_map(|chunk| chunk.layers);

        FFXIVLgb {
            layers: layers
                .map(|layer| LayerWrapped::from_physis(&layer))
                .collect(),
        }
    }

    pub fn find_festivals(&self) -> Vec<u16> {
        let festival_ids = self.layers.iter().map(|x| x.festival_id);
        let unique: HashSet<u16> = festival_ids.collect();
        unique.into_iter().collect()
    }
}
