use physis::common::Platform;
use physis::ReadableFile;
use physis::tex::Texture;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct FFXIVTexture {
}

#[wasm_bindgen]
impl FFXIVTexture {
    pub fn decode_bc7(tex_file_data: Vec<u8>) -> Vec<u8> {
        Texture::from_existing(Platform::Win32, tex_file_data.as_slice()).unwrap().rgba
    }
}