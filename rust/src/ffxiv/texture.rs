use ironworks::file::tex::Texture;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct FFXIVTexture {
    inner: Texture,
}

// impl FFXIVTexture {
//     pub fn parse(data: Vec<u8>) -> FFXIVTexture {
//         let cursor = Cursor::new(data);
//         let container: Texture = ironworks::file::File::read(cursor).unwrap();
//         container.
//         let model = container.model(Lod::High);
//         FFXIVModel {
//             inner: model,
//         }
//     }
// }
