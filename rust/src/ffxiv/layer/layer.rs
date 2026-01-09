use physis::layer::Layer;
use wasm_bindgen::prelude::wasm_bindgen;
use crate::ffxiv::layer::object::LayerObject;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct LayerWrapped {
    pub name: String,
    pub festival_id: u16,
    pub festival_phase_id: u16,
    pub objects: Vec<LayerObject>
}

impl LayerWrapped {
    pub fn from_physis(inner: &Layer) -> Self {
        LayerWrapped {
            name: inner.header.name.value.clone(),
            festival_id: inner.header.festival_id,
            festival_phase_id: inner.header.festival_phase_id,
            objects: inner.objects.iter().map(|o| LayerObject::from_physis(o)).collect(),
        }
    }
}