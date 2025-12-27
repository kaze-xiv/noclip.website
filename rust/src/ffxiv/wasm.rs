use ironworks::file::mdl::ModelContainer;
use wasm_bindgen::prelude::wasm_bindgen;
use crate::ffxiv::model::FFXIVModel;

#[wasm_bindgen]
pub struct FFXIVSceneManager {

}

#[wasm_bindgen(js_class = "FFXIVSceneManager")]
impl FFXIVSceneManager {
    #[wasm_bindgen]
    pub fn parse_mdl(bytes: Vec<u8>) -> FFXIVModel {
        FFXIVModel::parse(bytes)
    }
}