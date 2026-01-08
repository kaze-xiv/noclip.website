use physis::common::Platform;
use physis::mtrl::Material;
use physis::ReadableFile;
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
        let material = Material::from_existing(Platform::Win32, data.as_slice()).unwrap();

        FFXIVMaterial {
            texture_names: material.texture_paths,
            shader_name: material.shader_package_name,
        }
    }
}
