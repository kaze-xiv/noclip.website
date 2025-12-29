use ironworks::file::mdl::ModelContainer;
use physis::model::Vertex;
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

#[wasm_bindgen]
pub struct VertexWrapper {
    #[wasm_bindgen(skip)]
    pub inner: Vertex,
}

#[wasm_bindgen]
impl VertexWrapper {
    pub fn position(&self) -> Vec<f32> {
        self.inner.position.to_vec()
    }
    pub fn uv0(&self) -> Vec<f32> {
        self.inner.uv0.to_vec()
    }

    pub fn uv1(&self) -> Vec<f32> {
        self.inner.uv1.to_vec()
    }

    pub fn normal(&self) -> Vec<f32> {
        self.inner.normal.to_vec()
    }

    pub fn bitangent(&self) -> Vec<f32> {
        self.inner.bitangent.to_vec()
    }

    pub fn color(&self) -> Vec<f32> {
        self.inner.color.to_vec()
    }

    pub fn bone_weight(&self) -> Vec<f32> {
        self.inner.bone_weight.to_vec()
    }

    pub fn bone_id(&self) -> Vec<u8> {
        self.inner.bone_id.to_vec()
    }
}