use euclid::default::Transform3D;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct FlatLayoutObject {
    pub layer_type: i32,
    pub asset_name: Option<String>,
    pub festival_id: u16,
    pub festival_phase_id: u16,
    pub instance_id: u32,
    pub(crate) mm: Transform3D<f32>,
}


#[wasm_bindgen]
impl FlatLayoutObject {
    pub fn write_model_matrix(&self, target: &mut [f32]) {
        target.copy_from_slice(&self.mm.to_array())
    }
}