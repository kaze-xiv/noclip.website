use ironworks::file::mtrl::Material;
use std::io::Cursor;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct FFXIVMaterial {
    inner: Material
}

#[wasm_bindgen]
impl FFXIVMaterial {
    #[wasm_bindgen]
    pub fn parse(data: Vec<u8>) -> FFXIVMaterial {
        let cursor = Cursor::new(data);
        let mat: Material = ironworks::file::File::read(cursor).unwrap();

        FFXIVMaterial {
            inner: mat,
        }
    }

    #[wasm_bindgen]
    pub fn get_texture_names(&self) -> Vec<String> {
        self.inner.samplers().into_iter().map(|s| s.texture()).collect()
    }

    #[wasm_bindgen]
    pub fn get_shader_name(&self) -> String { self.inner.shader().to_string() }
    // #[wasm_bindgen]
    // pub fn get_samplers(&self) -> String { self.inner.shader().to_string() }
}