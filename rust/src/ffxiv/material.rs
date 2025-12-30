use ironworks::file::mtrl::Material;
use std::io::Cursor;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[wasm_bindgen(getter_with_clone)]
pub struct FFXIVMaterial {
    pub texture_names: Vec<String>,
    pub shader_name: String,
}

#[wasm_bindgen]
impl FFXIVMaterial {
    #[wasm_bindgen]
    pub fn parse(data: Vec<u8>) -> FFXIVMaterial {
        let cursor = Cursor::new(data);
        let mat: Material = ironworks::file::File::read(cursor).unwrap();

        FFXIVMaterial {
            texture_names: mat.samplers().into_iter().map(|s| s.texture()).collect(),
            shader_name: mat.shader().to_string(),
        }
    }
}