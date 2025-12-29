use physis::layer::{LayerChunk, LayerEntryData, LayerGroup};
use wasm_bindgen::prelude::wasm_bindgen;
use crate::ffxiv::model::MeshWrapper;

#[wasm_bindgen]
pub struct FFXIVLgb {
    chunks: Vec<LayerChunkW>
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct LayerChunkW {
    inner: LayerChunk,
}

#[wasm_bindgen]
impl FFXIVLgb {
    pub fn parse(data: Vec<u8>) -> FFXIVLgb {
        let lgb = LayerGroup::from_existing(data.as_slice()).unwrap();
        FFXIVLgb { chunks: lgb.chunks.into_iter().map(|x| LayerChunkW{inner: x}).collect() }
    }

    pub fn discover_models(&self) -> Vec<String> {
        let layers = self.chunks.iter().flat_map(|x| &x.inner.layers);
        let objs = layers.flat_map(|x| &x.objects);
        let data = objs.map(|b| &b.data);
        let assets = data.filter_map(|d| match d {
            LayerEntryData::BG(bg) => {
                Some(bg.asset_path.value.clone())
            }
            _ => None,
        });
        assets.collect()
    }

    pub fn dump(&self) -> String {
        format!("{:#?}", self.chunks)
    }
}
